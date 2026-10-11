#!/usr/bin/env python3
"""The editor's private, loopback-only application server.

No external service, analytics, remote asset, transcript logging, or arbitrary
filesystem endpoint. All mutations require the per-process browser capability.
"""
from __future__ import annotations

import argparse
import base64
import binascii
import copy
from datetime import datetime, timezone
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import stat
import threading
from urllib.parse import unquote, urlsplit

import documents
from model_adapter import Cancelled, Job, ModelAdapter, ModelError
from prompts import PromptError, build_messages

ROOT = Path(__file__).resolve().parent
MAX_REQUEST = 32 * 1024 * 1024
MAX_FILE = 20 * 1024 * 1024
MAX_STATE = 24 * 1024 * 1024
DEFAULT_STATE = {"sessions": [], "examples": [], "settings": {}}
CSP = ("default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; "
       "object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; "
       "media-src 'none'; worker-src 'none'")


class APIError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status


class PrivateStore:
    def __init__(self, directory):
        self.directory = Path(directory)
        if self.directory.is_symlink():
            raise RuntimeError("Private storage must not be a symbolic link.")
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory.chmod(0o700)
        self.path = self.directory / "state.json"
        self.lock = threading.RLock()

    def load(self, *, migrate=False):
        with self.lock:
            if not self.path.exists():
                return {"sessions": [], "examples": [], "settings": {}}
            if self.path.is_symlink():
                raise APIError("Private storage could not be opened safely.", 500)
            try:
                fd = os.open(self.path, os.O_RDONLY | os.O_NOFOLLOW)
                with os.fdopen(fd, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
                self.path.chmod(0o600)
                validate_state(data)
                if migrate and data["settings"].get("editorVersion") != 2:
                    data = self._migrate(data)
                return data
            except (OSError, ValueError, APIError) as exc:
                raise APIError("The saved workspace could not be read. Your saved file has been preserved.", 500) from exc

    def _migrate(self, original):
        """Preserve the exact old file locally before adopting one working draft."""
        backup = self.directory / ("recovery-v1-" + secrets.token_hex(8) + ".json")
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(self.path.read_bytes())
            handle.flush()
            os.fsync(handle.fileno())
        data = copy.deepcopy(original)
        timestamp = datetime.now(timezone.utc).isoformat()
        for session in data["sessions"]:
            proposal = session.get("proposal")
            versions = session.setdefault("versions", [])
            if isinstance(proposal, dict) and isinstance(proposal.get("text"), str) and proposal["text"].strip():
                for label, text in [("Before restored suggestion", session.get("draft", "")),
                                    ("Restored suggestion", proposal["text"])]:
                    if text:
                        versions.append({"id": secrets.token_hex(16), "text": text,
                                         "title": session.get("title", "Untitled document"),
                                         "date": session.get("date", ""), "label": label, "createdAt": timestamp})
                session["draft"] = proposal["text"]
            elif not session.get("draft"):
                session["draft"] = session.get("source", "")
            session.pop("proposal", None)
            session.setdefault("history", [])
        data["settings"]["editorVersion"] = 2
        self.save(data)
        return data

    def save(self, data):
        validate_state(data)
        encoded = json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > MAX_STATE:
            raise APIError("This workspace is too large to save. Remove unneeded documents or references.", 413)
        with self.lock:
            # Refuse accidental replacement of a linked private file. Writes use
            # exclusive temporary names, fsync, and atomic replacement.
            if self.path.is_symlink():
                raise APIError("Private storage could not be opened safely.", 500)
            temporary = self.directory / (".state-" + secrets.token_hex(8))
            try:
                fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(fd, "wb") as handle:
                    handle.write(encoded)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(temporary, self.path)
                self.path.chmod(0o600)
            except OSError as exc:
                raise APIError("Your changes could not be saved to this device. Check available disk space.", 500) from exc
            finally:
                temporary.unlink(missing_ok=True)


def validate_state(data):
    if not isinstance(data, dict) or set(data) - {"sessions", "examples", "settings"}:
        raise APIError("The workspace format is invalid.")
    if not isinstance(data.get("sessions"), list) or not isinstance(data.get("examples"), list) or not isinstance(data.get("settings"), dict):
        raise APIError("The workspace format is invalid.")
    if len(data["sessions"]) > 500 or len(data["examples"]) > 100:
        raise APIError("The workspace limit is 500 documents and 100 references.")
    for group in ("sessions", "examples"):
        if any(not isinstance(row, dict) for row in data[group]):
            raise APIError("The workspace contains an invalid item.")


class FolioServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address=("127.0.0.1", 8765), private_dir=None, static_dir=None, adapter=None):
        if address[0] != "127.0.0.1":
            raise ValueError("The editor may bind only to 127.0.0.1.")
        self.token = secrets.token_urlsafe(32)
        self.store = PrivateStore(private_dir or ROOT / "private")
        self.static_dir = Path(static_dir or ROOT / "static").resolve()
        self.adapter = adapter or ModelAdapter(self.store.directory)
        self.generation_lock = threading.Lock()
        self.jobs_lock = threading.Lock()
        self.jobs = {}
        super().__init__(address, Handler)

    def handle_error(self, request, client_address):
        # Default socketserver tracebacks can expose request or model content.
        pass

    def server_close(self):
        with self.jobs_lock:
            for job in self.jobs.values():
                job.cancel()
        super().server_close()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Folio"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(35)

    def log_message(self, format, *args):
        pass

    def _headers(self, status, content_type, length=None, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
        if length is not None:
            self.send_header("Content-Length", str(length))
        if extra:
            for key, value in extra.items():
                self.send_header(key, value)
        self.end_headers()

    def _json(self, data, status=200):
        encoded = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(encoded))
        if self.command != "HEAD":
            self.wfile.write(encoded)

    def _error(self, message, status=400):
        self.close_connection = True
        self._json({"error": message}, status)

    def _guard(self, mutation=False):
        host_values = self.headers.get_all("Host", [])
        port = self.server.server_address[1]
        hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if len(host_values) != 1 or host_values[0] not in hosts:
            raise APIError("This application is available only from its local address.", 403)
        if self.client_address[0] != "127.0.0.1":
            raise APIError("Local access only.", 403)
        origin_values = self.headers.get_all("Origin", [])
        if len(origin_values) > 1 or (origin_values and origin_values[0] != "http://" + host_values[0]):
            raise APIError("Cross-origin access is blocked.", 403)
        fetch_site = self.headers.get("Sec-Fetch-Site")
        if fetch_site and fetch_site not in {"same-origin", "none"}:
            raise APIError("Cross-origin access is blocked.", 403)
        if mutation:
            tokens = self.headers.get_all("X-Folio-Token", [])
            if len(tokens) != 1 or not hmac.compare_digest(tokens[0], self.server.token):
                raise APIError("Your local session expired. Reload the editor and try again.", 403)

    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise APIError("Unsupported request encoding.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not lengths[0].isdigit():
            raise APIError("A request length is required.", 411)
        length = int(lengths[0])
        if length > MAX_REQUEST:
            raise APIError("This file or workspace is too large.", 413)
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            raise APIError("Requests must contain JSON.", 415)
        try:
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise ValueError()
            body = json.loads(raw)
            if not isinstance(body, dict):
                raise ValueError()
            return body
        except (UnicodeError, ValueError, RecursionError) as exc:
            raise APIError("The request could not be read.") from exc

    def do_GET(self):
        try:
            self._guard()
            path = urlsplit(self.path).path
            if path == "/api/health":
                self._json({"ok": True, "app": "Folio", "localOnly": True})
            elif path == "/api/bootstrap":
                self._json({"token": self.server.token, "state": self.server.store.load(migrate=True), **self.server.adapter.metadata()})
            elif path == "/api/models":
                self._json(self.server.adapter.metadata())
            elif path.startswith("/api/"):
                raise APIError("Endpoint not found.", 404)
            else:
                self._static(path)
        except APIError as exc:
            self._error(exc.message, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error("The local request could not be completed.", 500)

    def do_HEAD(self):
        self.do_GET()

    def do_OPTIONS(self):
        self._error("Cross-origin requests are not supported.", 403)

    def _static(self, path):
        path = unquote(path)
        if "\x00" in path or "\\" in path:
            raise APIError("File not found.", 404)
        relative = path.lstrip("/") or "index.html"
        candidate = (self.server.static_dir / relative).resolve()
        if not candidate.is_relative_to(self.server.static_dir) or not candidate.is_file() or any(part.startswith(".") for part in Path(relative).parts):
            raise APIError("File not found.", 404)
        # Static assets are deliberately confined to a small type allowlist.
        allowed = {".html", ".js", ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2", ".ttf"}
        if candidate.suffix.lower() not in allowed:
            raise APIError("File not found.", 404)
        content = candidate.read_bytes()
        mime = mimetypes.guess_type(candidate.name)[0] or "application/octet-stream"
        if candidate.suffix in {".html", ".js", ".css", ".svg"}:
            mime += "; charset=utf-8"
        self._headers(200, mime, len(content))
        if self.command != "HEAD":
            self.wfile.write(content)

    def do_POST(self):
        try:
            self._guard(mutation=True)
            body = self._body()
            path = urlsplit(self.path).path
            if path == "/api/state":
                self.server.store.save(body)
                self._json({"ok": True})
            elif path == "/api/import":
                name, data = body.get("name"), body.get("data")
                if not isinstance(name, str) or not name or len(name) > 255 or not isinstance(data, str):
                    raise APIError("Choose a supported document to import.")
                try:
                    content = base64.b64decode(data, validate=True)
                except (binascii.Error, ValueError) as exc:
                    raise APIError("The file could not be read.") from exc
                if len(content) > MAX_FILE:
                    raise APIError("Choose a file smaller than 15 MB.", 413)
                try:
                    extracted = documents.extract_text(name, content)
                except ValueError as exc:
                    raise APIError(str(exc)) from exc
                self._json({"text": extracted, "name": Path(name).name})
            elif path == "/api/export":
                self._export(body)
            elif path == "/api/generate":
                self._generate(body)
            elif path == "/api/cancel":
                identifier = body.get("requestId")
                if not isinstance(identifier, str):
                    raise APIError("The generation request is missing.")
                with self.server.jobs_lock:
                    job = self.server.jobs.get(identifier)
                    if job:
                        job.cancel()
                self._json({"ok": True, "cancelled": bool(job)})
            else:
                raise APIError("Endpoint not found.", 404)
        except APIError as exc:
            self._error(exc.message, exc.status)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            self._error("The local request could not be completed. Your document is unchanged.", 500)

    def _export(self, body):
        title, text, settings, format = body.get("title", "Untitled document"), body.get("text"), body.get("settings", {}), body.get("format", "docx")
        if not isinstance(title, str) or len(title) > 250 or not isinstance(text, str) or not text.strip() or len(text) > 1_000_000 or not isinstance(settings, dict):
            raise APIError("Add a title and document text before exporting.")
        date = body.get("date")
        if date is not None and (not isinstance(date, str) or len(date) > 100):
            raise APIError("The document date is invalid.")
        filename = re.sub(r"[^\w .-]", "", title, flags=re.UNICODE).strip(". ")[:100] or "Untitled document"
        # ASCII fallback keeps response headers deterministic and injection-free.
        filename = filename.encode("ascii", "ignore").decode().strip() or "Document"
        if format == "docx":
            try:
                content = documents.export_docx(title, text, settings, date)
            except ValueError as exc:
                raise APIError(str(exc)) from exc
            mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        elif format == "txt":
            content = text.encode("utf-8")
            mime = "text/plain; charset=utf-8"
        else:
            raise APIError("Choose Word (.docx) or plain text (.txt) output.")
        self._headers(200, mime, len(content), {"Content-Disposition": f'attachment; filename="{filename}.{format}"'})
        self.wfile.write(content)

    def _generate(self, body):
        try:
            messages, references = build_messages(body)
        except PromptError as exc:
            raise APIError(str(exc)) from exc
        identifier = body.get("requestId") or secrets.token_urlsafe(16)
        if not isinstance(identifier, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", identifier):
            raise APIError("The generation identifier is invalid.")
        if not isinstance(body.get("model"), str):
            raise APIError("Select a local model first.")
        if not self.server.generation_lock.acquire(blocking=False):
            raise APIError("A local generation is already running. Wait for it to finish, or stop it, before starting another.", 409)
        job = Job(identifier)
        with self.server.jobs_lock:
            self.server.jobs[identifier] = job
        self.close_connection = True
        try:
            self._headers(200, "application/x-ndjson; charset=utf-8", extra={"Connection": "close", "X-Accel-Buffering": "no"})
            def emit(event):
                self.wfile.write((json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8"))
                self.wfile.flush()
            emit({"type": "status", "text": "Preparing your private writing session…", "requestId": identifier})
            try:
                result = self.server.adapter.generate(body["model"], messages, job, emit)
                job.check()
                result["referenceInfo"] = references
                emit(result)
            except (ModelError, Cancelled) as exc:
                emit({"type": "error", "message": str(exc), "cancelled": job.cancelled.is_set()})
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                job.cancel()
            except Exception:
                emit({"type": "error", "message": "The local generation failed. Your document is unchanged."})
        finally:
            job.cancel()
            with self.server.jobs_lock:
                self.server.jobs.pop(identifier, None)
            self.server.generation_lock.release()


def main():
    parser = argparse.ArgumentParser(description="Private Writing Editor: private writing on this Mac.")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    os.umask(0o077)
    try:
        server = FolioServer(("127.0.0.1", args.port))
    except OSError:
        parser.exit(1, "The editor could not open its local port. Another instance may already be running.\n")
    print(f"Private Writing Editor is ready at http://127.0.0.1:{args.port} · Ctrl-C to stop", flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
