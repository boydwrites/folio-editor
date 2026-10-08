"""Meaningful preservation and source-safety checks for the Word proof."""
from copy import deepcopy
import contextlib
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemma_word import (NS, W, WordError, clean_revision, inspect_document,
                        main, read_document, rewrite_document, convert_document,
                        restore_word_settings, WORD_READ_SECURITY_SCRIPT,
                        WORD_RESTORE_SECURITY_SCRIPT)
from scripts.verify_word_proof import verify

FIXTURE = Path(__file__).resolve().parents[1] / "samples" / "board-notes.docx"
REVISION = (
    "At the facilities committee meeting on 14 Sep 2026, approval of the roof repair was deferred. "
    "The current estimate is $24,000, compared with the previous estimate of $21,500. "
    "Two additional quotes are required before a decision, and Morgan will request them by 21 Sep 2026. "
    "No spending was authorized at the meeting. Attendance was not recorded."
)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def assert_preserved(test, source, result, paragraph=4):
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(result) as after:
        test.assertEqual(before.namelist(), after.namelist())
        for name in before.namelist():
            if name != "word/document.xml":
                test.assertEqual(before.read(name), after.read(name), name)
    old_root, old_paragraphs = read_document(source)
    new_root, new_paragraphs = read_document(result)
    test.assertEqual(len(old_paragraphs), len(new_paragraphs))
    old = old_paragraphs[paragraph - 1]
    new = new_paragraphs[paragraph - 1]
    test.assertNotEqual("".join(old.itertext()), "".join(new.itertext()))
    # Restoring just the original text nodes must yield identical document XML.
    old_run = old.find("w:r", NS)
    new_run = new.find("w:r", NS)
    for item in new_run.findall("w:t", NS):
        new_run.remove(item)
    for item in old_run.findall("w:t", NS):
        new_run.append(deepcopy(item))
    test.assertEqual(etree.tostring(old_root), etree.tostring(new_root))


class WordAdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.output = Path(self.temp.name) / "revised.docx"

    def tearDown(self):
        self.temp.cleanup()

    def test_edit_changes_only_selected_text_and_preserves_original(self):
        before = sha(FIXTURE)
        calls = []
        def stub(text, instruction, stats=False):
            calls.append((text, instruction, stats))
            return REVISION
        rewrite_document(FIXTURE, self.output, 4, generate=stub)
        self.assertEqual(before, sha(FIXTURE))
        self.assertEqual(len(calls), 1)
        self.assertIn("$24,000", calls[0][0])
        assert_preserved(self, FIXTURE, self.output)

    def test_inspect_distinguishes_formatted_text_and_body_from_table(self):
        info = inspect_document(FIXTURE)
        self.assertEqual(info["tables"], 1)
        self.assertTrue(info["paragraphs"][3]["editable"])
        self.assertEqual(info["paragraphs"][2]["style"], "Heading1")
        self.assertFalse(info["paragraphs"][9]["editable"])

    def test_original_and_existing_outputs_are_not_overwritten(self):
        def forbidden(*args, **kwargs):
            self.fail("Model should not be called for invalid output")
        with self.assertRaises(WordError):
            rewrite_document(FIXTURE, FIXTURE, 4, generate=forbidden)
        self.output.write_bytes(b"keep this")
        with self.assertRaises(WordError):
            rewrite_document(FIXTURE, self.output, 4, generate=forbidden)
        self.assertEqual(self.output.read_bytes(), b"keep this")

    def test_mixed_runs_and_bad_indexes_rejected_before_generation(self):
        def forbidden(*args, **kwargs):
            self.fail("Model should not be called for unsupported selection")
        for paragraph in [0, 100, 10]:
            with self.subTest(paragraph=paragraph), self.assertRaises(WordError):
                rewrite_document(FIXTURE, self.output, paragraph, generate=forbidden)
        self.assertFalse(self.output.exists())

    def test_failed_generation_leaves_no_partial_output(self):
        def fail(*args, **kwargs):
            raise RuntimeError("Disconnected")
        with self.assertRaises(RuntimeError):
            rewrite_document(FIXTURE, self.output, 4, generate=fail)
        self.assertFalse(self.output.exists())

    def test_cancellation_leaves_no_partial_output(self):
        def cancel(*args, **kwargs):
            raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            rewrite_document(FIXTURE, self.output, 4, generate=cancel)
        self.assertFalse(self.output.exists())

    def test_plain_paragraph_validation(self):
        for value in ["", "# Heading", "one\n\ntwo", "**bold**", "<think>reason</think>", "- bullet"]:
            with self.subTest(value=value), self.assertRaises(WordError):
                clean_revision(value)

    def test_instruction_file_is_read_locally(self):
        instruction_file = Path(self.temp.name) / "private instruction.txt"
        instruction_file.write_text("Keep every fact and return one paragraph.\n", encoding="utf-8")
        with patch("gemma_word.rewrite_document", return_value=self.output) as rewrite:
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(main(["rewrite", str(FIXTURE), str(self.output), "--paragraph", "4",
                                       "--instruction-file", str(instruction_file)]), 0)
            self.assertEqual(rewrite.call_args.args[3], "Keep every fact and return one paragraph.")

    def test_empty_instruction_file_does_not_call_model(self):
        instruction_file = Path(self.temp.name) / "empty.txt"
        instruction_file.write_text(" \n", encoding="utf-8")
        with patch("gemma_word.rewrite_document") as rewrite:
            with contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(main(["rewrite", str(FIXTURE), str(self.output), "--paragraph", "4",
                                       "--instruction-file", str(instruction_file)]), 1)
            rewrite.assert_not_called()

    def test_conversion_timeout_restores_security_and_removes_temporary_files(self):
        state = Path(self.temp.name) / "state"
        previous = subprocess.CompletedProcess([], 0, "by_ui\n", "")
        restored = subprocess.CompletedProcess([], 0, "restored\n", "")
        with patch("gemma_word.WORD_STATE_DIR", state), patch("gemma_word.subprocess.run") as run:
            run.side_effect = [previous, subprocess.TimeoutExpired("osascript", 120), restored]
            with self.assertRaisesRegex(WordError, "conversion timed out"):
                convert_document(FIXTURE, self.output)
            self.assertEqual(run.call_args_list[0].kwargs["input"], WORD_READ_SECURITY_SCRIPT)
            self.assertEqual(run.call_args_list[2].kwargs["input"], WORD_RESTORE_SECURITY_SCRIPT)
            self.assertEqual(run.call_args_list[2].args[0][-1], "by_ui")
            self.assertEqual(run.call_args_list[2].kwargs["timeout"], 10)
        self.assertFalse((state / "pending-restoration.json").exists())
        self.assertFalse(self.output.exists())
        self.assertEqual(list(Path(self.temp.name).glob("gemma-word-*")), [])

    def test_unresponsive_word_retains_minimal_recovery_record_and_blocks_conversion(self):
        state = Path(self.temp.name) / "state"
        pending = state / "pending-restoration.json"
        previous = subprocess.CompletedProcess([], 0, "low\n", "")
        with patch("gemma_word.WORD_STATE_DIR", state), patch("gemma_word.subprocess.run") as run:
            run.side_effect = [previous, subprocess.TimeoutExpired("osascript", 120),
                               subprocess.TimeoutExpired("osascript", 10)]
            with self.assertRaisesRegex(WordError, "restore-settings"):
                convert_document(FIXTURE, self.output)
            self.assertEqual(json.loads(pending.read_text()), {"schema": 1, "automation_security": "low"})
            self.assertEqual(pending.stat().st_mode & 0o777, 0o600)
            run.reset_mock()
            with self.assertRaisesRegex(WordError, "recovery is pending"):
                convert_document(FIXTURE, self.output)
            run.assert_not_called()
            run.side_effect = None
            run.return_value = subprocess.CompletedProcess([], 0, "restored\n", "")
            restore_word_settings()
            self.assertEqual(run.call_args.args[0][-1], "low")
            self.assertFalse(pending.exists())
        self.assertFalse(self.output.exists())
        self.assertEqual(list(Path(self.temp.name).glob("gemma-word-*")), [])

    def test_conversion_cancellation_still_restores_security(self):
        state = Path(self.temp.name) / "state"
        with patch("gemma_word.WORD_STATE_DIR", state), patch("gemma_word.subprocess.run") as run:
            run.side_effect = [subprocess.CompletedProcess([], 0, "force_disable\n", ""),
                               KeyboardInterrupt(), subprocess.CompletedProcess([], 0, "restored\n", "")]
            with self.assertRaises(KeyboardInterrupt):
                convert_document(FIXTURE, self.output)
            self.assertEqual(run.call_args.args[0][-1], "force_disable")
        self.assertFalse((state / "pending-restoration.json").exists())
        self.assertFalse(self.output.exists())

    def test_proof_report_contains_no_paragraph_content_and_checks_source_hash(self):
        rewrite_document(FIXTURE, self.output, 4, generate=lambda *args, **kwargs: REVISION)
        result = verify(FIXTURE, self.output, expected_source_sha256=sha(FIXTURE))
        self.assertTrue(result["passed"])
        self.assertEqual(result["tables"], 1)
        self.assertEqual(result["list_paragraphs"], 2)
        self.assertEqual(result["heading_paragraphs"], 4)
        self.assertNotIn("$24,000", json.dumps(result))
        self.assertNotIn("Morgan", json.dumps(result))
        failed_hash = verify(FIXTURE, self.output, expected_source_sha256="0" * 64)
        self.assertFalse(failed_hash["passed"])

    def test_proof_report_rejects_unrelated_formatting_changes(self):
        rewrite_document(FIXTURE, self.output, 4, generate=lambda *args, **kwargs: REVISION)
        damaged = Path(self.temp.name) / "damaged.docx"
        with zipfile.ZipFile(self.output) as package, zipfile.ZipFile(damaged, "w") as changed:
            for member in package.infolist():
                data = package.read(member)
                if member.filename == "word/document.xml":
                    root = etree.fromstring(data)
                    heading = root.find("w:body/w:p[3]/w:pPr/w:pStyle", NS)
                    heading.set(W + "val", "Heading2")
                    data = etree.tostring(root)
                changed.writestr(member, data)
        result = verify(FIXTURE, damaged)
        self.assertFalse(result["passed"])
        self.assertFalse(result["checks"]["heading_styles_preserved"])
        self.assertFalse(result["checks"]["all_document_xml_except_selected_text_identical"])


if __name__ == "__main__":
    unittest.main()
