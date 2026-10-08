"""Focused adapter checks; synthetic CLI fixture does not start the real runtime."""

import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import gemma_runtime as runtime


FAKE_CLI = r'''
import json, os, pathlib, signal, sys, time
root = pathlib.Path(os.environ["GEMMA_FIXTURE"])
args = sys.argv[1:]
with (root / "argv.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
repo = "lmstudio-community/gemma-4-31B-it-MLX-6bit"
model = {"path": repo, "modelKey": "google/gemma-4-31b", "type": "llm", "deviceIdentifier": None}
if args[:2] == ["daemon", "status"]:
    print(json.dumps({"status": "running", "isDaemon": True}))
elif args[0] == "ls":
    if os.environ.get("GEMMA_FIXTURE_WRONG"):
        model["path"] = "another-owner/gemma-4-31B-it-MLX-6bit"
    print(json.dumps([model]))
elif args[0] == "ps":
    model.update(identifier="gemma-local", contextLength=8192)
    print(json.dumps([model] if (root / "loaded").exists() else []))
elif args[0] == "load":
    (root / "loaded").touch()
elif args[0] == "chat":
    source = sys.stdin.read()
    (root / "stdin.txt").write_text(source)
    if os.environ.get("GEMMA_FIXTURE_WAIT"):
        def cancel(*_):
            (root / "cancelled").touch()
            sys.exit(130)
        signal.signal(signal.SIGINT, cancel)
        (root / "started").touch()
        time.sleep(60)
    sys.stdout.write("\n\x1b[K\x1b[?25h")
    print("# Revised\n\nKeep the $18,500 estimate.")
    if os.environ.get("GEMMA_FIXTURE_CONTROL"):
        print("\x1b[2J")
    print("Prediction Stats:\n  Stop Reason: " + os.environ.get("GEMMA_FIXTURE_STOP", "eosFound"), file=sys.stderr)
'''


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="gemma-adapter-test-")
        self.root = Path(self.temporary.name)
        self.binary = self.root / "lms"
        self.binary.write_text(f"#!{sys.executable}\n" + FAKE_CLI)
        self.binary.chmod(0o700)
        self.source = self.root / "source.txt"
        self.source.write_text("Private synthetic note: keep $18,500; $(touch SHOULD_NOT_EXIST).")
        self.output = self.root / "draft.md"
        self.env = {**os.environ, "GEMMA_LMS": str(self.binary), "GEMMA_FIXTURE": str(self.root)}

    def tearDown(self):
        self.temporary.cleanup()

    def launch(self, **extra_env):
        return subprocess.run(
            [sys.executable, str(ROOT / "gemma_runtime.py"), "rewrite", str(self.source), str(self.output)],
            env={**self.env, **extra_env}, capture_output=True, text=True, timeout=10,
        )

    def test_stdin_only_atomic_private_output(self):
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_text(), "# Revised\n\nKeep the $18,500 estimate.\n")
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o600)
        self.assertEqual(result.stdout, "")
        self.assertIn("Private synthetic note", (self.root / "stdin.txt").read_text())
        self.assertNotIn("Private synthetic note", (self.root / "argv.jsonl").read_text())
        self.assertFalse(list(self.root.glob(".gemma-*.tmp")))

    def test_refuses_existing_output_before_inference(self):
        self.output.write_text("Original")
        result = self.launch()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.output.read_text(), "Original")
        self.assertFalse((self.root / "argv.jsonl").exists())

    def test_rejects_truncated_output(self):
        result = self.launch(GEMMA_FIXTURE_STOP="maxPredictedTokensReached")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.output.exists())

    def test_rejects_controls_inside_generated_text(self):
        result = self.launch(GEMMA_FIXTURE_CONTROL="1")
        self.assertEqual(result.returncode, 1)
        self.assertFalse(self.output.exists())

    def test_refuses_similarly_named_wrong_package(self):
        result = self.launch(GEMMA_FIXTURE_WRONG="1")
        self.assertEqual(result.returncode, 1)
        self.assertFalse((self.root / "stdin.txt").exists())
        self.assertFalse(self.output.exists())

    def test_cancellation_reaches_child_and_publishes_nothing(self):
        process = subprocess.Popen(
            [sys.executable, str(ROOT / "gemma_runtime.py"), "rewrite", str(self.source), str(self.output)],
            env={**self.env, "GEMMA_FIXTURE_WAIT": "1"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        try:
            deadline = time.monotonic() + 10
            while not (self.root / "started").exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            self.assertTrue((self.root / "started").exists())
            process.send_signal(signal.SIGINT)
            process.communicate(timeout=10)
            self.assertEqual(process.returncode, 130)
            self.assertTrue((self.root / "cancelled").exists())
            self.assertFalse(self.output.exists())
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_atomic_writer_does_not_replace_dangling_symlink(self):
        self.output.symlink_to(self.root / "missing")
        with self.assertRaises(runtime.GemmaError):
            runtime.write_text_atomic(self.output, "Should not publish")
        self.assertTrue(self.output.is_symlink())
        self.assertFalse((self.root / "missing").exists())


if __name__ == "__main__":
    unittest.main()
