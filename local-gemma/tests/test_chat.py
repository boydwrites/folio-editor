"""Chat transaction and stream/cancellation checks without model inference."""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import gemma_chat as chat


class ChatTests(unittest.TestCase):
    def test_role_history_commits_only_complete_pairs(self):
        history = [{"role": "system", "content": "Be concise."}]
        seen = []
        def generate(messages, on_text):
            seen.append(messages)
            return chat.TurnResult("First reply" if len(seen) == 1 else "Revision", {})
        chat.complete_turn(history, "First request", lambda _: None, generate)
        chat.complete_turn(history, "Revise it", lambda _: None, generate)
        self.assertEqual([row["role"] for row in seen[1]], ["system", "user", "assistant", "user"])
        self.assertEqual(seen[1][2]["content"], "First reply")
        self.assertEqual(history[-1], {"role": "assistant", "content": "Revision"})

    def test_cancel_does_not_leave_user_or_partial_assistant_in_history(self):
        history = [{"role": "system", "content": "Be concise."}]
        def cancel(messages, on_text):
            on_text("Partial")
            raise chat.ChatCancelled()
        with self.assertRaises(chat.ChatCancelled):
            chat.complete_turn(history, "Cancelled request", lambda _: None, cancel)
        self.assertEqual(history, [{"role": "system", "content": "Be concise."}])

    def test_each_turn_checks_model_and_transmits_content_only_through_stdin(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            fake = root / "fake_node"
            fake.write_text(f"#!{sys.executable}\n" + """
import json, pathlib, sys
request = json.load(sys.stdin)
assert all('Private synthetic content' not in arg for arg in sys.argv)
assert request['messages'][-1]['content'] == 'Private synthetic content'
print(json.dumps({'type':'delta','text':'Reply'}))
print(json.dumps({'type':'complete','text':'Reply','stats':{'stopReason':'eosFound'}}))
""")
            fake.chmod(0o700)
            config = {"identifier":"gemma-local", "model_repo":chat.runtime.SELECTED_REPO,
                      "context_length":8192, "ttl_seconds":900}
            with patch.object(chat, "NODE", fake), patch.object(chat, "SDK", fake), \
                 patch.object(chat.runtime, "ensure_model") as ensure, \
                 patch.object(chat.runtime, "_config", return_value=config):
                for _ in range(2):
                    result = chat.run_turn([{"role":"user", "content":"Private synthetic content"}], lambda _: None)
                    self.assertEqual(result.text, "Reply")
                self.assertEqual(ensure.call_count, 2)

    def test_real_child_interrupt_is_forwarded_without_committing_history(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            fake = root / "fake_node"
            fake.write_text(f"#!{sys.executable}\n" + """
import json, os, pathlib, signal, sys, time
root = pathlib.Path(os.environ['CHAT_TEST_DIR'])
def cancel(*_):
    (root / 'cancelled').touch()
    print(json.dumps({'type':'cancelled'}), flush=True)
    raise SystemExit(130)
signal.signal(signal.SIGINT, cancel)
json.load(sys.stdin)
(root / 'started').touch()
time.sleep(30)
""")
            fake.chmod(0o700)
            worker = root / "worker.py"
            worker.write_text("""
import os, pathlib, sys
sys.path.insert(0, os.environ['CHAT_PROJECT'])
import gemma_chat as chat
chat.NODE = pathlib.Path(os.environ['CHAT_TEST_DIR']) / 'fake_node'
chat.SDK = chat.NODE
chat.runtime.ensure_model = lambda: None
history = [{'role':'system','content':'Test'}]
try:
    chat.complete_turn(history, 'Synthetic', lambda _:None)
except chat.ChatCancelled:
    assert len(history) == 1
    raise SystemExit(130)
""")
            env = {**os.environ, "CHAT_TEST_DIR":str(root), "CHAT_PROJECT":str(ROOT)}
            process = subprocess.Popen([sys.executable, str(worker)], env=env)
            try:
                deadline = time.monotonic() + 10
                while not (root / "started").exists() and time.monotonic() < deadline:
                    time.sleep(0.02)
                self.assertTrue((root / "started").exists())
                process.send_signal(signal.SIGINT)
                self.assertEqual(process.wait(timeout=10), 130)
                self.assertTrue((root / "cancelled").exists())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    unittest.main()
