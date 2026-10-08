"""Streaming terminal chat with exact baseline reload before every turn.

Uses LM Studio's already installed SDK 1.5.0 from its bundled rag-v1 plugin.
Conversation history consists of real system/user/assistant messages and remains
in this Python process only. Completed turns are committed together; cancelled
or failed turns are not appended. The Node bridge gets JSON via stdin.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Callable

import gemma_runtime as runtime

NODE = Path(os.environ.get("GEMMA_NODE") or shutil.which("node") or "node")
BRIDGE = Path(__file__).resolve().with_name("chat_bridge.mjs")
SDK = Path.home() / ".lmstudio/extensions/plugins/lmstudio/rag-v1/node_modules/@lmstudio/sdk/dist/index.mjs"
SYSTEM = runtime.WRITING_SYSTEM


class ChatCancelled(Exception):
    """The current user/assistant pair was cancelled without changing history."""


@dataclass
class TurnResult:
    text: str
    stats: dict


def run_turn(messages: list[dict], on_text: Callable[[str], None]) -> TurnResult:
    """Stream one turn; ensure the exact baseline anew after any idle expiration."""
    if not NODE.is_file() or not SDK.is_file():
        raise runtime.GemmaError("The bundled Node/LM Studio SDK is unavailable; reinstall the documented local runtime.")
    runtime.ensure_model()
    config = runtime._config()
    request = {
        "messages": messages, "identifier": config["identifier"],
        "model_path": config.get("model_path") or config["model_repo"],
        "context_length": config["context_length"], "ttl_seconds": config["ttl_seconds"],
    }
    process = subprocess.Popen(
        [str(NODE), str(BRIDGE)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        text=True, encoding="utf-8", start_new_session=True,
    )
    # Drain SDK/import diagnostics without retaining them or exposing user text.
    def drain_diagnostics():
        for _ in process.stderr:
            pass
    drain = threading.Thread(target=drain_diagnostics, daemon=True)
    drain.start()
    fragments, metrics, final_text, error = [], None, None, None
    start = time.monotonic()
    try:
        process.stdin.write(json.dumps(request))
        process.stdin.close()
        for line in process.stdout:
            try:
                event = json.loads(line)
            except ValueError as exc:
                raise runtime.GemmaError("The local chat bridge returned an invalid response.") from exc
            if event.get("type") == "delta":
                text = event.get("text")
                if not isinstance(text, str) or re.search(r"[\x00-\x08\x0b-\x1f\x7f]", text):
                    raise runtime.GemmaError("The model returned unexpected terminal control characters.")
                fragments.append(text)
                on_text(text)
            elif event.get("type") == "complete":
                metrics = event.get("stats")
                final_text = event.get("text")
            elif event.get("type") == "cancelled":
                raise ChatCancelled()
            elif event.get("type") == "error":
                error = str(event.get("message", "Local generation failed."))
            else:
                raise runtime.GemmaError("The local chat bridge returned an unknown event.")
        code = process.wait(timeout=15)
        if error:
            raise runtime.GemmaError(error)
        if code or not isinstance(metrics, dict) or metrics.get("stopReason") not in {"eosFound", "stopStringFound"}:
            raise runtime.GemmaError("The reply did not finish cleanly; this turn was not added to the conversation.")
        answer = "".join(fragments).strip()
        if not isinstance(final_text, str) or answer != final_text.strip():
            raise runtime.GemmaError("The streamed reply was incomplete; this turn was not added.")
        if not answer or re.search(r"</?think>|<\|(?:channel|message|im_start|im_end)", answer):
            raise runtime.GemmaError("The reply is empty or contains template markers; this turn was not added.")
        metrics["request_wall_seconds"] = round(time.monotonic() - start, 3)
        return TurnResult(answer, metrics)
    except KeyboardInterrupt as exc:
        runtime._cancel(process)
        raise ChatCancelled() from exc
    finally:
        runtime._cancel(process)
        for stream in (process.stdin, process.stdout):
            if stream and not stream.closed:
                stream.close()
        drain.join(timeout=2)
        if process.stderr and not process.stderr.closed:
            process.stderr.close()


def complete_turn(history: list[dict], text: str, on_text: Callable[[str], None],
                  generate: Callable = run_turn) -> TurnResult:
    """Commit one complete role pair; never leave a failed/cancelled user turn."""
    user = {"role": "user", "content": text}
    result = generate([*history, user], on_text)
    history.extend([user, {"role": "assistant", "content": result.text}])
    return result


def _read_message() -> str:
    text = input("You: ")
    if text.strip() != "/paste":
        return text
    print("Paste multiple lines; type /end on its own line to submit.", file=sys.stderr)
    lines = []
    while True:
        line = input()
        if line == "/end":
            return "\n".join(lines)
        lines.append(line)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local Gemma chat with automatic reload after idle expiry.")
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args(argv)
    if not sys.stdin.isatty():
        print("Use ./gemma chat for piped prompts; this module provides interactive chat.", file=sys.stderr)
        return 1
    history = [{"role": "system", "content": SYSTEM}]
    print("Local Gemma chat. /clear starts fresh; /paste enters multiple lines; /exit quits.")
    print("Ctrl-C cancels a reply. Conversation history stays in memory.")
    while True:
        try:
            message = _read_message()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not message.strip():
            continue
        command = message.strip().lower()
        if command in {"/exit", "/quit"}:
            return 0
        if command == "/clear":
            history[:] = [{"role": "system", "content": SYSTEM}]
            print("Conversation cleared.")
            continue
        first = True
        def display(fragment: str) -> None:
            nonlocal first
            if first:
                print("Gemma: ", end="", flush=True)
                first = False
            print(fragment, end="", flush=True)
        try:
            result = complete_turn(history, message, display)
            print("\n")
            if args.stats:
                print(json.dumps(result.stats, sort_keys=True), file=sys.stderr)
        except (ChatCancelled, KeyboardInterrupt):
            print("\nCancelled; this turn was not added to the conversation.\n")
        except (runtime.GemmaError, OSError, UnicodeError, subprocess.SubprocessError) as exc:
            print(f"\nGemma: {exc}\n", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
