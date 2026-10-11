"""Local model discovery and cancellable predictions; no remote endpoints or logs.

The LM Studio SDK/CLI are already installed with the verified local-gemma runtime.
Only metadata is read during discovery. Private prompts cross stdin and a pinned
loopback SDK connection; the daemon must have been started in our network sandbox.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

ROOT = Path(__file__).resolve().parent
BASELINE_DIR = ROOT.parent / "local-gemma"
sys.path.insert(0, str(BASELINE_DIR))
import gemma_runtime as baseline

NODE = Path(os.environ.get("FOLIO_NODE") or shutil.which("node") or "node")
SDK = Path.home() / ".lmstudio/extensions/plugins/lmstudio/rag-v1/node_modules/@lmstudio/sdk/dist/index.mjs"
MODEL_INDEX = Path.home() / ".lmstudio/.internal/model-index-cache.json"
BRIDGE = ROOT / "model_bridge.mjs"
PROFILE = ROOT / "localhost-only.sb"
CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


class ModelError(RuntimeError):
    """Messages contain setup details only, never model diagnostics or content."""


class Cancelled(ModelError):
    pass


@dataclass
class Job:
    identifier: str
    cancelled: threading.Event = field(default_factory=threading.Event)
    process: subprocess.Popen | None = None
    lock: threading.Lock = field(default_factory=threading.Lock)

    def check(self):
        if self.cancelled.is_set():
            raise Cancelled("Stopped. Your document is unchanged.")

    def attach(self, process):
        with self.lock:
            self.process = process
            if self.cancelled.is_set():
                _signal(process)

    def cancel(self):
        self.cancelled.set()
        with self.lock:
            if self.process is not None:
                _signal(self.process)


def _signal(process):
    try:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGINT)
    except ProcessLookupError:
        pass


def _run(args, *, job=None, timeout=120, sandbox=False):
    if job:
        job.check()
    try:
        command = [baseline._lms(), *args]
        if sandbox:
            command = ["/usr/bin/sandbox-exec", "-f", str(PROFILE), *command]
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, encoding="utf-8",
                                   start_new_session=True, env={**os.environ, "NO_COLOR": "1"})
    except (OSError, baseline.GemmaError) as exc:
        raise ModelError("The installed local model runtime is unavailable. Check LM Studio and the editor's launcher.") from exc
    if job:
        job.attach(process)
    start = time.monotonic()
    try:
        while True:
            try:
                stdout, _ = process.communicate(timeout=0.25)
                break
            except subprocess.TimeoutExpired:
                if job:
                    job.check()
                if time.monotonic() - start > timeout:
                    raise ModelError("The local runtime took too long to respond. Restart the editor and try again.")
        if job:
            job.check()
        if process.returncode:
            raise ModelError("The local runtime command failed. Close LM Studio, restart the editor, and try again.")
        return stdout
    finally:
        baseline._cancel(process)
        if job:
            with job.lock:
                if job.process is process:
                    job.process = None


def _json(args, **kwargs):
    try:
        return json.loads(_run(args, **kwargs))
    except ValueError as exc:
        raise ModelError("The local runtime returned invalid metadata.") from exc


def _model_id(path):
    return "local-" + hashlib.sha256(path.encode()).hexdigest()[:16]


def discover():
    """Fast disk-only enumeration. Inference revalidates against the live runtime."""
    models = []
    try:
        config = baseline._config()
        index = json.loads(MODEL_INDEX.read_text())
        for row in index.get("models", []):
            path = row.get("indexedModelIdentifier")
            disk = row.get("containingDirAbsolutePath")
            if row.get("domain") != "llm" or row.get("deviceIdentifier") is not None:
                continue
            if not isinstance(path, str) or not isinstance(disk, str) or not Path(disk).is_dir():
                continue
            recommended = path == config.get("model_path", config["model_repo"])
            models.append({"id": _model_id(path), "path": path,
                           "name": "Gemma 4 · 31B" if recommended else (row.get("displayName") or path.rsplit("/", 1)[-1]),
                           "loaded": False, "recommended": recommended,
                           "contextLength": config["context_length"] if recommended else min(8192, row.get("contextLength") or 8192),
                           "format": row.get("format", "local")})
    except (OSError, ValueError, TypeError, baseline.GemmaError):
        pass
    return sorted({row["id"]: row for row in models}.values(), key=lambda row: (not row["recommended"], row["name"]))


class ModelAdapter:
    def __init__(self, private_dir):
        self.private_dir = Path(private_dir)
        self.loaded_path = None
        self.network_isolated = False

    def metadata(self):
        models = discover()
        for model in models:
            model["loaded"] = model["path"] == self.loaded_path
        return {"models": models, "runtime": {"available": bool(models) and NODE.is_file() and SDK.is_file(),
                "engine": "LM Studio · Apple Metal", "localOnly": True,
                "networkIsolated": self.network_isolated, "contextLength": 8192,
                "status": "ready" if self.loaded_path else "idle",
                "message": "Models load on demand. All inference stays on this Mac." if models else "No local language models found. Install a model in LM Studio, then refresh."}}

    @staticmethod
    def _identity(pid):
        if not isinstance(pid, int) or pid < 1:
            return None
        try:
            result = subprocess.run(["/bin/ps", "-p", str(pid), "-o", "lstart="],
                                    capture_output=True, text=True, timeout=5, check=True)
            return result.stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            return None

    def _ensure_daemon(self, job, emit):
        marker = self.private_dir / "runtime.json"
        status = _json(["daemon", "status", "--json"], job=job, timeout=15)
        if not isinstance(status, dict):
            raise ModelError("Unable to verify the local daemon.")
        if status.get("status") == "running":
            try:
                recorded = json.loads(marker.read_text())
            except (OSError, ValueError):
                recorded = {}
            identity = self._identity(status.get("pid"))
            if (not identity or recorded.get("pid") != status.get("pid") or
                    recorded.get("started") != identity or status.get("isDaemon") is not True):
                raise ModelError("LM Studio is already running outside the editor’s privacy sandbox. Quit LM Studio or run ./local-gemma/gemma stop, then try again. The editor will start its isolated local runtime.")
        else:
            if not Path("/usr/bin/sandbox-exec").is_file():
                raise ModelError("The editor requires the macOS local-network privacy sandbox.")
            emit({"type": "status", "text": "Starting the private local runtime…"})
            _run(["daemon", "up", "--json"], sandbox=True, job=job, timeout=120)
            status = _json(["daemon", "status", "--json"], job=job, timeout=15)
            identity = self._identity(status.get("pid"))
            if status.get("status") != "running" or status.get("isDaemon") is not True or not identity:
                raise ModelError("The private local runtime could not be verified.")
            fd = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w") as handle:
                json.dump({"pid": status["pid"], "started": identity}, handle)
            marker.chmod(0o600)
        self.network_isolated = True

    def ensure_model(self, model_id, job, emit):
        selected = next((row for row in discover() if model_id in (row["id"], row["path"])), None)
        if not selected:
            raise ModelError("Select a downloaded local language model before generating.")
        self._ensure_daemon(job, emit)
        models = _json(["ls", "--json"], job=job, timeout=30)
        exact = [row for row in models if row.get("path") == selected["path"] and
                 row.get("deviceIdentifier") is None and row.get("type") in (None, "llm")]
        if len(exact) != 1:
            raise ModelError("The selected model is no longer uniquely available on this Mac. Refresh the model list.")
        config = baseline._config()
        identifier = config["identifier"] if selected["recommended"] else "folio-" + selected["id"]
        context = selected["contextLength"]
        loaded = _json(["ps", "--json"], job=job, timeout=30)
        local = [row for row in loaded if row.get("deviceIdentifier") is None]
        ours = [row for row in local if row.get("identifier") == identifier and
                row.get("path") == selected["path"] and row.get("contextLength") == context]
        for row in local:
            if row not in ours:
                emit({"type": "status", "text": "Switching the local model…"})
                _run(["unload", row["identifier"]], job=job, timeout=60)
        if not ours:
            emit({"type": "status", "text": f"Loading {selected['name']} on this Mac…"})
            if selected["recommended"] or selected["format"] == "safetensors":
                _run(["runtime", "select", config["runtime_alias"]], job=job, timeout=30)
            _run(["load", selected["path"], "--exact", "--local", "--identifier", identifier,
                  "--context-length", str(context), "--parallel", "1", "--ttl", str(config["ttl_seconds"]),
                  "--no-speculative-draft-mtp", "--yes"], job=job, timeout=600)
        self.loaded_path = selected["path"]
        return {"identifier": identifier, "model_path": selected["path"], "context_length": context,
                "ttl_seconds": config["ttl_seconds"]}

    def generate(self, model_id, messages, job, emit):
        if not NODE.is_file() or not SDK.is_file():
            raise ModelError("The bundled Node runtime or local LM Studio SDK is missing.")
        request = self.ensure_model(model_id, job, emit)
        request["messages"] = messages
        job.check()
        process = subprocess.Popen([str(NODE), str(BRIDGE)], stdin=subprocess.PIPE,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   encoding="utf-8", start_new_session=True)
        job.attach(process)
        def drain():
            for _ in process.stderr:
                pass
        diagnostic_thread = threading.Thread(target=drain, daemon=True)
        diagnostic_thread.start()
        timer = threading.Timer(1830, job.cancel)
        timer.daemon = True
        timer.start()
        fragments, complete, error = [], None, None
        start = time.monotonic()
        try:
            process.stdin.write(json.dumps(request))
            process.stdin.close()
            for line in process.stdout:
                job.check()
                try:
                    event = json.loads(line)
                except ValueError as exc:
                    raise ModelError("The local model returned an invalid stream.") from exc
                if event.get("type") == "delta":
                    fragment = event.get("text")
                    if not isinstance(fragment, str) or CONTROL.search(fragment):
                        raise ModelError("The model returned unsupported control characters.")
                    fragments.append(fragment)
                    emit(event)
                elif event.get("type") == "status":
                    emit(event)
                elif event.get("type") == "complete":
                    complete = event
                elif event.get("type") == "cancelled":
                    raise Cancelled("Stopped. Your document is unchanged.")
                elif event.get("type") == "error":
                    error = event.get("message", "The local prediction failed.")
                else:
                    raise ModelError("The local model returned an unknown stream event.")
            process.wait(timeout=15)
            job.check()
            if error:
                raise ModelError(error)
            if process.returncode or not complete or complete.get("stats", {}).get("stopReason") not in {"eosFound", "stopStringFound"}:
                raise ModelError("The response did not finish cleanly. Your document is unchanged.")
            text = "".join(fragments).strip()
            if not text or text != complete.get("text", "").strip():
                raise ModelError("The response was incomplete. Your document is unchanged.")
            if re.search(r"</?think>|<\|(?:channel|message|im_start|im_end)", text):
                raise ModelError("The response contains unsupported model formatting. Your document is unchanged.")
            complete["text"] = text
            complete["stats"]["requestWallSeconds"] = round(time.monotonic() - start, 3)
            return complete
        finally:
            timer.cancel()
            baseline._cancel(process)
            for stream in (process.stdin, process.stdout):
                if stream and not stream.closed:
                    stream.close()
            diagnostic_thread.join(timeout=2)
            if process.stderr and not process.stderr.closed:
                process.stderr.close()
            with job.lock:
                if job.process is process:
                    job.process = None
