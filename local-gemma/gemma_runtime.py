"""Small, local-only terminal adapter for the verified Gemma package.

Document content and instructions travel through stdin, never command arguments.
No transcript is persisted by this adapter. The installed lms CLI handles the
chat template, Metal runtime, prompt caching, and interactive conversation UI.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config" / "runtime-config.json"
SELECTED_REPO = "lmstudio-community/gemma-4-31B-it-MLX-6bit"
WRITING_SYSTEM = (
    "You are a careful writing assistant. When revising supplied material, preserve "
    "facts, amounts, dates, assignments, negations, uncertainty, and qualifications. "
    "Do not add causal explanations, decisions, approvals, or commitments that the "
    "source does not state. Follow the user's requested format."
)
DEFAULT_INSTRUCTION = (
    "Rewrite the supplied notes as concise Markdown. Preserve every fact, "
    "amount, date, assignment, negation, and uncertainty. Add no facts. "
    "Return only the revised text, without an introduction or code fence."
)
ANSI = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")


class GemmaError(RuntimeError):
    """A recoverable setup or generation error, safe to show in the terminal."""


def _config() -> dict:
    try:
        value = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise GemmaError(f"Cannot read runtime configuration: {exc}") from exc
    if not isinstance(value, dict):
        raise GemmaError("Runtime configuration must be a JSON object.")
    if value.get("model_repo") != SELECTED_REPO:
        raise GemmaError("Runtime configuration does not identify the selected six-bit package.")
    for key in ("context_length", "parallel", "ttl_seconds"):
        if not isinstance(value.get(key), int) or value[key] < 1:
            raise GemmaError(f"Invalid runtime configuration: {key} must be a positive integer.")
    if value["parallel"] != 1 or value.get("reasoning") != "off":
        raise GemmaError("This verified baseline requires parallel=1 and reasoning=off.")
    if not isinstance(value.get("identifier"), str) or not value["identifier"]:
        raise GemmaError("The runtime identifier is missing.")
    return value


def _lms() -> str:
    path = Path(os.environ.get("GEMMA_LMS", "~/.lmstudio/bin/lms")).expanduser()
    if not path.is_file() or not os.access(path, os.X_OK):
        raise GemmaError(f"lms is not installed at {path}. Complete the documented runtime installation.")
    return str(path)


def _cancel(process: subprocess.Popen) -> None:
    """Forward cancellation and reap the CLI without leaving an orphan client."""
    if process.poll() is not None:
        return
    for sig, timeout in ((signal.SIGINT, 5), (signal.SIGTERM, 3), (signal.SIGKILL, None)):
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            process.wait()
            return
        try:
            process.wait(timeout=timeout)
            return
        except subprocess.TimeoutExpired:
            continue


def _run(args: list[str], *, input_text: str | None = None,
         timeout: float = 120, check: bool = True) -> subprocess.CompletedProcess:
    env = os.environ.copy()
    env["NO_COLOR"] = "1"
    env.pop("FORCE_COLOR", None)
    process = subprocess.Popen(
        [_lms(), *args], stdin=subprocess.PIPE if input_text is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8",
        env=env, start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(input_text, timeout=timeout)
    except KeyboardInterrupt:
        _cancel(process)
        raise
    except subprocess.TimeoutExpired as exc:
        _cancel(process)
        raise GemmaError(f"lms {args[0]} timed out; the request was cancelled.") from exc
    result = subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
    if check and result.returncode:
        # Never echo prompts or private generated text from a CLI failure report.
        raise GemmaError(f"lms {' '.join(args[:2])} failed (exit {result.returncode}); no output was saved.")
    return result


def _json(args: list[str]) -> object:
    result = _run(args)
    try:
        return json.loads(result.stdout)
    except ValueError as exc:
        raise GemmaError(f"lms {' '.join(args)} did not return valid JSON; verify the installed CLI version.") from exc


def _models(args: list[str]) -> list[dict]:
    result = _json(args)
    if not isinstance(result, list) or not all(isinstance(row, dict) for row in result):
        raise GemmaError(f"Unexpected model list from lms {args[0]}.")
    return result


def _daemon_status() -> dict:
    result = _json(["daemon", "status", "--json"])
    if not isinstance(result, dict) or result.get("status") not in {"running", "not-running"}:
        raise GemmaError("Unexpected daemon status; verify the installed CLI version.")
    return result


def _selected_model(config: dict, models: list[dict]) -> dict:
    # Exact repository path comparison deliberately excludes fuzzy, remote, and
    # differently quantized candidates. MLX packages have a directory path.
    expected = config.get("model_path") or config["model_repo"]
    matches = [row for row in models
               if row.get("path") == expected and row.get("deviceIdentifier") is None]
    if len(matches) != 1:
        raise GemmaError(
            "The exact local six-bit model was not found uniquely. Check lms ls --json "
            "and the recorded model_path in config/runtime-config.json."
        )
    row = matches[0]
    path_parts = Path(row["path"]).parts
    repo_parts = tuple(config["model_repo"].split("/"))
    if tuple(path_parts[-2:]) != repo_parts:
        raise GemmaError("The recorded model path does not belong to the selected six-bit repository.")
    if row.get("type") not in (None, "llm"):
        raise GemmaError("The selected package is not a language model.")
    return row


def ensure_model() -> str:
    """Start llmster and load only the exact recorded local package as needed."""
    config = _config()
    daemon = _daemon_status()
    if daemon["status"] != "running":
        print("Starting the local model runtime…", file=sys.stderr)
        _run(["daemon", "up", "--json"])
    model = _selected_model(config, _models(["ls", "--json"]))
    loaded = _models(["ps", "--json"])
    local = [row for row in loaded if row.get("deviceIdentifier") is None]
    ours = [row for row in local if row.get("identifier") == config["identifier"]]
    if any(row.get("identifier") != config["identifier"] for row in local):
        raise GemmaError("Another model is loaded. Unload it with lms unload before using the one-model baseline.")
    if ours:
        if len(ours) != 1 or ours[0].get("path") != model["path"]:
            raise GemmaError("The gemma-local identifier belongs to a different package. Run ./gemma stop first.")
        context = ours[0].get("contextLength")
        if context is not None and context != config["context_length"]:
            raise GemmaError("The loaded model uses a different context length. Run ./gemma stop to reload the baseline.")
        return config["identifier"]
    print(f"Loading Gemma with {config['context_length']:,} tokens of context…", file=sys.stderr)
    # Later stable releases changed explicit context limits into automatic fits.
    # Select the tested runtime before every fresh load to keep this baseline.
    _run(["runtime", "select", "mlx-llm-mac-arm64-apple-metal-advsimd@1.9.1"])
    start = time.monotonic()
    result = _run([
        "load", model["path"], "--exact", "--local", "--identifier", config["identifier"],
        "--context-length", str(config["context_length"]), "--parallel", "1", "--ttl",
        str(config["ttl_seconds"]), "--no-speculative-draft-mtp", "--yes",
    ], timeout=600)
    if result.stderr.strip():
        print(ANSI.sub("", result.stderr).strip(), file=sys.stderr)
    print(f"Gemma loaded in {time.monotonic() - start:.2f}s.", file=sys.stderr)
    loaded = _models(["ps", "--json"])
    if not any(row.get("identifier") == config["identifier"] and row.get("path") == model["path"]
               and row.get("deviceIdentifier") is None for row in loaded):
        raise GemmaError("The exact model could not be verified after loading.")
    return config["identifier"]


def _chat_args(config: dict, *, stats: bool = True) -> list[str]:
    args = ["chat", config["identifier"], "--ttl", str(config["ttl_seconds"]),
            "--reasoning", "off", "--dont-fetch-catalog", "--system-prompt", WRITING_SYSTEM]
    if stats:
        args.append("--stats")
    return args


def parse_prediction_stats(diagnostics: str) -> dict:
    """Extract content-free CLI statistics for benchmark records."""
    diagnostics = ANSI.sub("", diagnostics)
    result = {}
    fields = {
        "Stop Reason": ("stop_reason", str),
        "Tokens/Second": ("tokens_per_second", float),
        "Time to First Token": ("time_to_first_token_seconds", lambda x: float(x.removesuffix("s"))),
        "Prompt Tokens": ("prompt_tokens", int),
        "Predicted Tokens": ("predicted_tokens", int),
        "Total Tokens": ("total_tokens", int),
    }
    for label, (key, convert) in fields.items():
        values = re.findall(r"^\s*" + re.escape(label) + r":\s*(\S+)", diagnostics, re.MULTILINE)
        if values:
            try:
                result[key] = convert(values[-1])
            except ValueError as exc:
                raise GemmaError(f"Invalid {label} in CLI prediction statistics.") from exc
    return result


def generate_detailed(text: str, instruction: str, stats: bool = False) -> tuple[str, dict]:
    """Return completed text plus content-free metrics, excluding ensure/load time."""
    if not text.strip():
        raise GemmaError("The input contains no text.")
    if not instruction.strip():
        raise GemmaError("A writing instruction is required.")
    ensure_model()
    config = _config()
    # Both fields are carried through stdin. Source content is clearly separated
    # from the editing instruction; shell metacharacters have no special meaning.
    prompt = f"{instruction}\n\n--- BEGIN SOURCE TEXT ---\n{text}\n--- END SOURCE TEXT ---\n"
    start = time.monotonic()
    result = _run(_chat_args(config), input_text=prompt, timeout=1800)
    diagnostics = ANSI.sub("", result.stderr)
    metrics = parse_prediction_stats(diagnostics)
    metrics["request_wall_seconds"] = round(time.monotonic() - start, 3)
    if metrics.get("stop_reason") not in {"eosFound", "stopStringFound"}:
        reason = metrics.get("stop_reason", "unverified completion")
        raise GemmaError(f"Generation did not finish cleanly ({reason}); no output was saved.")
    # lms ff50809 emits this cursor reset even with piped stdin and NO_COLOR.
    # Remove only that observed CLI prefix; reject controls inside model text.
    answer = result.stdout.removeprefix("\n\x1b[K\x1b[?25h").strip()
    if not answer:
        raise GemmaError("The model returned an empty answer; no output was saved.")
    if re.search(r"</?think>|<\|(?:channel|message|im_start|im_end)", answer):
        raise GemmaError("The answer contains reasoning or template markers; no output was saved.")
    if "\x1b" in answer:
        raise GemmaError("Unexpected terminal formatting in generated text; no output was saved.")
    if stats:
        print(diagnostics.strip(), file=sys.stderr)
        print(f"Request wall time: {metrics['request_wall_seconds']:.2f}s", file=sys.stderr)
    return answer, metrics


def generate(text: str, instruction: str, stats: bool = False) -> str:
    """Return a completed answer; raise rather than publish truncated/failed text."""
    answer, _ = generate_detailed(text, instruction, stats)
    return answer


def write_text_atomic(output: Path, content: str) -> None:
    """Publish a complete private file atomically, refusing concurrent overwrite."""
    if os.path.lexists(output):
        raise GemmaError(f"Output already exists: {output}")
    if not output.parent.is_dir():
        raise GemmaError(f"Output directory does not exist: {output.parent}")
    fd, temporary = tempfile.mkstemp(prefix=".gemma-", suffix=".tmp", dir=output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(content.rstrip() + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary, output)
        except FileExistsError as exc:
            raise GemmaError(f"Output already exists: {output}") from exc
    finally:
        os.unlink(temporary)


def _rewrite(args: argparse.Namespace) -> None:
    source, output = Path(args.input).expanduser(), Path(args.output).expanduser()
    if source.suffix.lower() in {".doc", ".docx"} or output.suffix.lower() in {".doc", ".docx"}:
        raise GemmaError("Use ./gemma word rewrite for Word documents.")
    if os.path.lexists(output):
        raise GemmaError(f"Output already exists: {output}")
    if not output.parent.is_dir():
        raise GemmaError(f"Output directory does not exist: {output.parent}")
    content = source.read_text(encoding="utf-8")
    if "\x00" in content:
        raise GemmaError("Input appears to be binary. Use UTF-8 text or the Word adapter.")
    instruction = (Path(args.instruction_file).expanduser().read_text(encoding="utf-8")
                   if args.instruction_file else DEFAULT_INSTRUCTION)
    write_text_atomic(output, generate(content, instruction, stats=args.stats))
    print(f"Saved {output}", file=sys.stderr)


def _chat(args: argparse.Namespace) -> None:
    if not sys.stdin.isatty():
        answer = generate(sys.stdin.read(), "Respond helpfully and concisely to the supplied message.", args.stats)
        print(answer)
        return
    from gemma_chat import main as chat_main
    chat_main(["--stats"] if args.stats else [])


def _status() -> None:
    config = _config()
    daemon = _daemon_status()
    print(f"Package: {config['model_repo']}")
    print(f"Baseline: {config['context_length']} context, parallel 1, reasoning off, {config['ttl_seconds']}s idle TTL")
    print(f"Daemon: {daemon['status']}")
    if daemon["status"] == "running":
        model = _selected_model(config, _models(["ls", "--json"]))
        print(f"Model path: {model['path']}")
        loaded = _models(["ps", "--json"])
        print("Loaded: " + (", ".join(str(row.get("identifier")) for row in loaded) or "none"))


def _stop() -> None:
    daemon = _daemon_status()
    if daemon["status"] == "not-running":
        print("The local model runtime is already stopped.")
        return
    if daemon.get("isDaemon") is not True:
        raise GemmaError("The running service is the LM Studio app. Close it directly to stop its runtime.")
    _run(["daemon", "down"], timeout=120)
    if _daemon_status()["status"] != "not-running":
        raise GemmaError("The local model runtime did not stop.")
    print("Stopped llmster and unloaded its models. Downloaded weights remain on disk.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Private local Gemma chat and file rewriting.",
        epilog="Word documents: ./gemma word --help. Chat reloads the configured baseline after idle expiry.",
    )
    commands = parser.add_subparsers(dest="command", required=True)
    chat = commands.add_parser("chat", help="Start an interactive conversation, or read one prompt from stdin")
    chat.add_argument("--stats", action="store_true")
    rewrite = commands.add_parser("rewrite", help="Rewrite UTF-8 text into a new Markdown/text file")
    rewrite.add_argument("input")
    rewrite.add_argument("output")
    rewrite.add_argument("--instruction-file", help="Read custom editing instructions from a UTF-8 file")
    rewrite.add_argument("--stats", action="store_true")
    commands.add_parser("status", help="Report status without starting the daemon")
    commands.add_parser("stop", help="Stop llmster and release loaded-model memory")
    args = parser.parse_args()
    try:
        if args.command == "rewrite":
            _rewrite(args)
        elif args.command == "chat":
            _chat(args)
        elif args.command == "status":
            _status()
        else:
            _stop()
        return 0
    except KeyboardInterrupt:
        print("\nCancelled. No rewrite output was saved.", file=sys.stderr)
        return 130
    except (GemmaError, OSError, UnicodeError) as exc:
        print(f"Gemma: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
