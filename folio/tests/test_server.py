"""HTTP privacy boundaries and complete/cancelled generation behavior."""
import base64
import http.client
import json
from pathlib import Path
import stat
import sys
import tempfile
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import FolioServer, PrivateStore
from model_adapter import Cancelled


class FakeAdapter:
    def __init__(self):
        self.wait = False
        self.started = threading.Event()
        self.seen = None

    def metadata(self):
        return {"models": [{"id": "local-test", "name": "Synthetic", "loaded": False}], "runtime": {"localOnly": True}}

    def generate(self, model, messages, job, emit):
        self.seen = messages
        self.started.set()
        if self.wait:
            while not job.cancelled.wait(0.02):
                pass
            job.check()
        emit({"type": "delta", "text": "Polished synthetic notes."})
        return {"type": "complete", "text": "Polished synthetic notes.", "stats": {"stopReason": "eosFound"}}


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "static").mkdir()
        (self.root / "static" / "index.html").write_text("<!doctype html><title>Folio</title>")
        (self.root / "private-secret.txt").write_text("Secret canary")
        self.adapter = FakeAdapter()
        self.server = FolioServer(("127.0.0.1", 0), self.root / "private", self.root / "static", self.adapter)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def request(self, path, body=None, headers=None, method=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        default = {"Host": f"127.0.0.1:{self.port}"}
        if body is not None:
            default.update({"Content-Type": "application/json", "X-Folio-Token": self.server.token})
        default.update(headers or {})
        connection.request(method or ("POST" if body is not None else "GET"), path,
                           json.dumps(body) if body is not None else None, default)
        response = connection.getresponse()
        result = (response.status, dict(response.getheaders()), response.read())
        connection.close()
        return result

    def test_bootstrap_and_private_atomic_state(self):
        status, headers, body = self.request("/api/bootstrap")
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data["token"], self.server.token)
        self.assertEqual(data["state"]["sessions"], [])
        state = {"sessions": [{"id": "meeting", "source": "Private synthetic minutes"}], "examples": [], "settings": {"editorVersion": 2}}
        self.assertEqual(self.request("/api/state", state)[0], 200)
        self.assertEqual(json.loads(self.request("/api/bootstrap")[2])["state"], state)
        self.assertEqual(stat.S_IMODE(self.server.store.directory.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.server.store.path.stat().st_mode), 0o600)
        self.assertFalse(list(self.server.store.directory.glob(".state-*")))

    def test_dns_rebinding_cross_origin_and_token_forgery_are_rejected(self):
        self.assertEqual(self.request("/api/bootstrap", headers={"Host": f"evil.test:{self.port}"})[0], 403)
        self.assertEqual(self.request("/api/bootstrap", headers={"Origin": "https://evil.test"})[0], 403)
        self.assertEqual(self.request("/api/bootstrap", headers={"Sec-Fetch-Site": "cross-site"})[0], 403)
        state = {"sessions": [], "examples": [], "settings": {"editorVersion": 2}}
        self.assertEqual(self.request("/api/state", state, {"X-Folio-Token": "wrong"})[0], 403)
        self.assertEqual(self.request("/api/state", state, {"Origin": "http://localhost:" + str(self.port)})[0], 403)
        self.assertFalse(self.server.store.path.exists())

    def test_static_does_not_expose_private_or_escape_root(self):
        for path in ("/../private-secret.txt", "/%2e%2e/private-secret.txt", "/private/state.json", "/.hidden", "/server.py"):
            status, headers, body = self.request(path)
            self.assertEqual(status, 404, path)
            self.assertNotIn(b"Secret canary", body)
        (self.root / "static" / "leak.html").symlink_to(self.root / "private-secret.txt")
        self.assertEqual(self.request("/leak.html")[0], 404)
        status, headers, _ = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store, max-age=0")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_import_and_safe_export_headers(self):
        encoded = base64.b64encode("Synthetic notes • café".encode()).decode()
        status, _, body = self.request("/api/import", {"name": "notes.txt", "data": encoded})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)["text"], "Synthetic notes • café")
        self.assertEqual(self.request("/api/import", {"name": "notes.txt", "data": "!invalid"})[0], 400)
        status, headers, body = self.request("/api/export", {"title": 'Title\r\nInjected: value', "text": "Synthetic minutes", "format": "txt"})
        self.assertEqual(status, 200)
        self.assertEqual(body, b"Synthetic minutes")
        self.assertNotIn("Injected", headers)
        status, headers, body = self.request("/api/export", {"title": "Minutes", "text": "Synthetic minutes", "format": "docx"})
        self.assertEqual(status, 200)
        self.assertTrue(body.startswith(b"PK"))

    def test_generation_stream_includes_only_verified_complete(self):
        status, headers, data = self.request("/api/generate", {"model": "local-test", "mode": "polish", "source": "Synthetic rough notes", "requestId": "test-1"})
        self.assertEqual(status, 200)
        events = [json.loads(line) for line in data.splitlines()]
        self.assertEqual([row["type"] for row in events], ["status", "delta", "complete"])
        self.assertIn("referenceInfo", events[-1])
        self.assertIn("Synthetic rough notes", self.adapter.seen[-1]["content"])
        self.assertFalse(self.server.store.path.exists(), "Generation must not autosave partial server drafts")

    def test_long_reference_and_notes_save_and_reach_adapter_without_truncation(self):
        source = "Synthetic notes with approval still pending.\n" * 800
        example = {"type": "pair", "before": "Rough sample.\n" * 1_000,
                   "after": "Polished sample.\n" * 1_000}
        state = {"sessions": [{"id": "long-meeting", "source": source}],
                 "examples": [example], "settings": {"editorVersion": 2}}
        self.assertEqual(self.request("/api/state", state)[0], 200)
        self.assertEqual(json.loads(self.request("/api/bootstrap")[2])["state"], state)
        status, _, data = self.request("/api/generate", {
            "model": "local-test", "mode": "polish", "source": source,
            "examples": [example], "requestId": "long-content",
        })
        self.assertEqual(status, 200)
        events = [json.loads(line) for line in data.splitlines()]
        self.assertEqual(events[-1]["type"], "complete")
        content = json.loads(self.adapter.seen[-1]["content"])
        self.assertEqual(content["source"], source)
        self.assertEqual(content["styleReferences"], [example])
        self.assertGreater(events[-1]["referenceInfo"]["inputCharacters"], 30_000)

    def test_one_generation_at_a_time_and_real_http_cancel(self):
        self.adapter.wait = True
        result = []
        body = {"model": "local-test", "mode": "polish", "source": "Synthetic", "requestId": "cancellable"}
        worker = threading.Thread(target=lambda: result.append(self.request("/api/generate", body)))
        worker.start()
        self.assertTrue(self.adapter.started.wait(3))
        self.assertEqual(self.request("/api/generate", {**body, "requestId": "second"})[0], 409)
        self.assertEqual(self.request("/api/cancel", {"requestId": "cancellable"})[0], 200)
        worker.join(4)
        self.assertFalse(worker.is_alive())
        events = [json.loads(line) for line in result[0][2].splitlines()]
        self.assertEqual(events[-1]["type"], "error")
        self.assertTrue(events[-1]["cancelled"])
        self.assertNotIn("complete", [row["type"] for row in events])
        self.assertEqual(self.server.jobs, {})
        self.assertFalse(self.server.generation_lock.locked())

    def test_saved_state_symlink_is_never_read_or_overwritten(self):
        target = self.root / "private-secret.txt"
        self.server.store.path.symlink_to(target)
        self.assertEqual(self.request("/api/bootstrap")[0], 500)
        self.assertEqual(self.request("/api/state", {"sessions": [], "examples": [], "settings": {"editorVersion": 2}})[0], 500)
        self.assertEqual(target.read_text(), "Secret canary")


if __name__ == "__main__":
    unittest.main()
