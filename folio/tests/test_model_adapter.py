"""Local-only metadata, runtime attestation, and bridge transaction checks."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import model_adapter as adapter


class AdapterTests(unittest.TestCase):
    def test_discovery_excludes_remote_missing_and_embedding_models(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            index = root / "index.json"
            local = {"domain": "llm", "indexedModelIdentifier": "test/local", "containingDirAbsolutePath": str(root), "contextLength": 4096}
            index.write_text(json.dumps({"models": [local, {**local, "indexedModelIdentifier": "remote", "deviceIdentifier": "remote-pc"},
                {**local, "indexedModelIdentifier": "embed", "domain": "embedding"}, {**local, "indexedModelIdentifier": "missing", "containingDirAbsolutePath": str(root / "missing") }]}))
            with patch.object(adapter, "MODEL_INDEX", index):
                models = adapter.discover()
            self.assertEqual([model["path"] for model in models], ["test/local"])
            self.assertEqual(models[0]["contextLength"], 4096)

    def test_unattested_running_daemon_is_rejected_before_prompts(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = adapter.ModelAdapter(directory)
            with patch.object(adapter, "_json", return_value={"status": "running", "pid": 123, "isDaemon": True}), \
                    patch.object(instance, "_identity", return_value="started today"):
                with self.assertRaisesRegex(adapter.ModelError, "privacy sandbox"):
                    instance._ensure_daemon(adapter.Job("test"), lambda event: None)
            self.assertFalse(instance.network_isolated)

    def test_attestation_includes_process_start_time(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "runtime.json").write_text(json.dumps({"pid": 123, "started": "old process"}))
            instance = adapter.ModelAdapter(root)
            with patch.object(adapter, "_json", return_value={"status": "running", "pid": 123, "isDaemon": True}), \
                    patch.object(instance, "_identity", return_value="different process"):
                with self.assertRaises(adapter.ModelError):
                    instance._ensure_daemon(adapter.Job("test"), lambda event: None)

    def test_content_goes_through_stdin_and_complete_stream_is_verified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / "fake-node"
            fake.write_text(f"#!{sys.executable}\n" + """
import json,sys
request=json.load(sys.stdin)
assert all('PRIVATE-CANARY' not in arg for arg in sys.argv)
assert request['messages'][-1]['content']=='PRIVATE-CANARY'
print(json.dumps({'type':'delta','text':'Synthetic reply'}))
print(json.dumps({'type':'complete','text':'Synthetic reply','stats':{'stopReason':'eosFound'}}))
""")
            fake.chmod(0o700)
            instance = adapter.ModelAdapter(root)
            with patch.object(adapter, "NODE", fake), patch.object(adapter, "SDK", fake), \
                    patch.object(instance, "ensure_model", return_value={}):
                events = []
                result = instance.generate("local-test", [{"role": "user", "content": "PRIVATE-CANARY"}], adapter.Job("test"), events.append)
            self.assertEqual(result["text"], "Synthetic reply")
            self.assertEqual([event["type"] for event in events], ["delta"])

    def test_truncated_generation_is_not_complete(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fake = root / "fake-node"
            fake.write_text(f"#!{sys.executable}\n" + """
import json,sys
json.load(sys.stdin)
print(json.dumps({'type':'delta','text':'Partial reply'}))
print(json.dumps({'type':'complete','text':'Partial reply','stats':{'stopReason':'contextLengthReached'}}))
""")
            fake.chmod(0o700)
            instance = adapter.ModelAdapter(root)
            with patch.object(adapter, "NODE", fake), patch.object(adapter, "SDK", fake), \
                    patch.object(instance, "ensure_model", return_value={}):
                with self.assertRaisesRegex(adapter.ModelError, "finish cleanly"):
                    instance.generate("local-test", [{"role": "user", "content": "Synthetic"}], adapter.Job("test"), lambda _: None)


if __name__ == "__main__":
    unittest.main()
