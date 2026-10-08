"""Local, conservative Word paragraph rewriting and Microsoft Word conversion."""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from typing import Callable, Iterator
import zipfile

from lxml import etree

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
W = "{" + NS["w"] + "}"
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"
WORD_STATE_DIR = Path(__file__).resolve().parent / "private" / "word-state"
DEFAULT_INSTRUCTION = (
    "Rewrite these board meeting notes as one clear, concise paragraph. "
    "Preserve every fact, name, amount, date, decision, condition, negation, and uncertainty. "
    "State recorded figures and facts directly. Do not imply events such as a presentation, "
    "discussion, report, or vote unless the source explicitly states that event. "
    "Add no facts. Return only the revised paragraph as plain text. "
    "Do not include a heading, bullets, Markdown, commentary, or reasoning."
)


class WordError(Exception):
    pass


def source_path(value: str | Path) -> Path:
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in {".doc", ".docx"}:
        raise WordError("Input must be an existing .doc or .docx file.")
    return path


def output_path(value: str | Path, source: Path, suffixes: set[str]) -> Path:
    path = Path(value).expanduser().absolute()
    if path.suffix.lower() not in suffixes:
        raise WordError("Output must end in " + " or ".join(sorted(suffixes)) + ".")
    if path.resolve() == source.resolve():
        raise WordError("The source document cannot be overwritten. Choose a new output file.")
    if os.path.lexists(path):
        raise WordError(f"Output already exists; refusing to overwrite: {path}")
    if not path.parent.is_dir():
        raise WordError(f"Output directory does not exist: {path.parent}")
    return path


def publish_file(staged: Path, output: Path) -> None:
    """Atomically expose a complete file without replacing an existing destination."""
    os.chmod(staged, 0o600)
    try:
        os.link(staged, output)
    except FileExistsError as exc:
        raise WordError(f"Output already exists; refusing to overwrite: {output}") from exc


WORD_CONVERSION_SCRIPT = r'''
on run argv
    set inputPath to item 1 of argv
    set outputPath to item 2 of argv
    set outputKind to item 3 of argv
    tell application "Microsoft Word"
        set documentToConvert to missing value
        try
            set automation security to msoAutomationSecurityForceDisable
            open (POSIX file inputPath) add to recent files false read only true
            set documentToConvert to active document
            if outputKind is "docx" then
                save as documentToConvert file name outputPath file format format document add to recent files false
            else
                save as documentToConvert file name outputPath file format format document97 add to recent files false
            end if
            close documentToConvert saving no
        on error errorText number errorNumber
            if documentToConvert is not missing value then
                try
                    close documentToConvert saving no
                end try
            end if
            error errorText number errorNumber
        end try
    end tell
end run
'''

WORD_READ_SECURITY_SCRIPT = r'''
tell application "Microsoft Word"
    set currentSecurity to automation security
    if currentSecurity is msoAutomationSecurityLow then return "low"
    if currentSecurity is msoAutomationSecurityByUI then return "by_ui"
    if currentSecurity is msoAutomationSecurityForceDisable then return "force_disable"
    error "Unrecognized Word automation security value"
end tell
'''

WORD_RESTORE_SECURITY_SCRIPT = r'''
on run argv
    set previousSecurity to item 1 of argv
    tell application "Microsoft Word"
        if previousSecurity is "low" then
            set restoredSecurity to msoAutomationSecurityLow
        else if previousSecurity is "by_ui" then
            set restoredSecurity to msoAutomationSecurityByUI
        else if previousSecurity is "force_disable" then
            set restoredSecurity to msoAutomationSecurityForceDisable
        else
            error "Unrecognized Word automation security value"
        end if
        set automation security to restoredSecurity
        if automation security is not restoredSecurity then error "Word setting was not restored"
        return "restored"
    end tell
end run
'''


def word_setting_script(script: str, *args: str) -> str:
    try:
        result = subprocess.run(["/usr/bin/osascript", "-", *args], input=script,
                                text=True, capture_output=True, timeout=10)
    except subprocess.TimeoutExpired as exc:
        raise WordError("Word did not respond within 10 seconds.") from exc
    if result.returncode:
        raise WordError("Word settings request failed: " + result.stderr.strip())
    return result.stdout.strip()


@contextlib.contextmanager
def word_conversion_lock() -> Iterator[Path]:
    WORD_STATE_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock_path = WORD_STATE_DIR / "conversion.lock"
    with open(lock_path, "a") as lock:
        os.chmod(lock_path, 0o600)
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise WordError("Another Word conversion or settings restoration is running.") from exc
        yield WORD_STATE_DIR / "pending-restoration.json"


def restore_word_settings_record(pending: Path) -> None:
    try:
        record = json.loads(pending.read_text(encoding="utf-8"))
        previous = record["automation_security"]
        if record.get("schema") != 1 or previous not in {"low", "by_ui", "force_disable"}:
            raise ValueError("Unrecognized settings record")
    except (ValueError, KeyError) as exc:
        raise WordError(f"Cannot read Word settings recovery record: {pending}") from exc
    if word_setting_script(WORD_RESTORE_SECURITY_SCRIPT, previous) != "restored":
        raise WordError("Word did not confirm restoring its prior automation security setting.")
    pending.unlink()


def restore_word_settings() -> None:
    with word_conversion_lock() as pending:
        if pending.exists():
            restore_word_settings_record(pending)


@contextlib.contextmanager
def preserve_word_security() -> Iterator[None]:
    with word_conversion_lock() as pending:
        if pending.exists():
            raise WordError("Word settings recovery is pending. Unlock the Mac, address any Word dialog, then run './gemma word restore-settings' before converting again.")
        previous = word_setting_script(WORD_READ_SECURITY_SCRIPT)
        if previous not in {"low", "by_ui", "force_disable"}:
            raise WordError("Cannot determine Word's prior automation security setting; conversion was not started.")
        # Persist only the prior setting, before any mutation, so process crashes are recoverable.
        descriptor = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as handle:
            json.dump({"schema": 1, "automation_security": previous}, handle)
            handle.flush()
            os.fsync(handle.fileno())
        try:
            yield
        finally:
            original_error = sys.exc_info()[1]
            try:
                restore_word_settings_record(pending)
            except Exception as exc:
                message = (f"Word's prior automation security setting could not be restored. "
                           f"Recovery record: {pending}. Unlock the Mac, address any Word dialog, "
                           "then run './gemma word restore-settings'. No output was published.")
                if original_error is not None:
                    message = f"{original_error} {message}"
                raise WordError(message) from exc


def convert_document(input_file: str | Path, output_file: str | Path) -> Path:
    source = source_path(input_file)
    output = output_path(output_file, source, {".doc", ".docx"})
    if sys.platform != "darwin":
        raise WordError("Legacy conversion requires Microsoft Word on macOS.")
    # Word sees a private copy, so it cannot modify a user's open original.
    with tempfile.TemporaryDirectory(prefix="gemma-word-", dir=output.parent) as tmp:
        work = Path(tmp)
        copied = work / ("source" + source.suffix.lower())
        staged = work / ("converted" + output.suffix.lower())
        shutil.copyfile(source, copied)
        os.chmod(copied, 0o600)
        with preserve_word_security():
            try:
                result = subprocess.run(
                    ["/usr/bin/osascript", "-", str(copied), str(staged), output.suffix[1:].lower()],
                    input=WORD_CONVERSION_SCRIPT, text=True, capture_output=True, timeout=120,
                )
            except subprocess.TimeoutExpired as exc:
                raise WordError("Word conversion timed out; check Word for a dialog, then retry.") from exc
        if result.returncode:
            raise WordError("Microsoft Word conversion failed: " + result.stderr.strip())
        if not staged.is_file() or staged.stat().st_size == 0:
            raise WordError("Word did not produce the requested document.")
        if output.suffix.lower() == ".docx":
            read_document(staged)
        elif staged.read_bytes()[:8] != bytes.fromhex("d0cf11e0a1b11ae1"):
            raise WordError("Word did not produce a valid legacy .doc container.")
        publish_file(staged, output)
    return output


@contextlib.contextmanager
def as_docx(source: Path) -> Iterator[Path]:
    if source.suffix.lower() == ".docx":
        yield source
    else:
        with tempfile.TemporaryDirectory(prefix="gemma-doc-import-") as tmp:
            converted = Path(tmp) / "source.docx"
            convert_document(source, converted)
            yield converted


def read_document(path: Path) -> tuple[etree._Element, list[etree._Element]]:
    try:
        with zipfile.ZipFile(path) as package:
            xml = package.read("word/document.xml")
        root = etree.fromstring(xml, etree.XMLParser(resolve_entities=False, no_network=True))
    except (zipfile.BadZipFile, KeyError, etree.XMLSyntaxError) as exc:
        raise WordError("The input is not a readable, unencrypted .docx document.") from exc
    body = root.find("w:body", NS)
    if body is None:
        raise WordError("No document body was found.")
    return root, body.findall("w:p", NS)


def paragraph_text(paragraph: etree._Element) -> str:
    return "".join(paragraph.itertext("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"))


def editable_run(paragraph: etree._Element) -> etree._Element:
    if any(child.tag not in {W + "pPr", W + "r"} for child in paragraph):
        raise WordError("Selected paragraph contains hyperlinks, fields, revisions, or other inline objects; this proof supports plain text only.")
    runs = paragraph.findall("w:r", NS)
    if len(runs) != 1:
        raise WordError("Selected paragraph has multiple formatting runs or is empty. This proof supports one plain text run; choose another paragraph.")
    run = runs[0]
    if any(child.tag not in {W + "rPr", W + "t"} for child in run):
        raise WordError("Selected paragraph contains tabs, breaks, fields, or embedded content; choose a plain text paragraph.")
    if not paragraph_text(paragraph).strip():
        raise WordError("Selected paragraph is empty.")
    return run


def inspect_document(input_file: str | Path) -> dict:
    source = source_path(input_file)
    with as_docx(source) as docx:
        root, paragraphs = read_document(docx)
        items = []
        for index, paragraph in enumerate(paragraphs, 1):
            style = paragraph.find("w:pPr/w:pStyle", NS)
            reason = None
            try:
                editable_run(paragraph)
            except WordError as exc:
                reason = str(exc)
            items.append({
                "paragraph": index,
                "style": style.get(W + "val") if style is not None else "Normal",
                "text": paragraph_text(paragraph),
                "editable": reason is None,
                **({"reason": reason} if reason else {}),
            })
        return {"input": str(source), "paragraph_indexing": "one-based direct body paragraphs; tables excluded",
                "paragraphs": items, "tables": len(root.findall(".//w:tbl", NS))}


def clean_revision(value: str) -> str:
    value = value.strip()
    if not value:
        raise WordError("The model returned an empty revision; no output was saved.")
    if "\n" in value or "\r" in value or re.search(r"```|\*\*|<think|</think|^#|^[-*] |^\d+[.)] ", value, re.I):
        raise WordError("The model returned multiple paragraphs or markup. No output was saved; retry with a single plain paragraph instruction.")
    if any(ord(char) < 32 and char != "\t" for char in value):
        raise WordError("The model returned invalid control characters; no output was saved.")
    return value


def rewrite_document(input_file: str | Path, output_file: str | Path, paragraph_number: int,
                     instruction: str = DEFAULT_INSTRUCTION, stats: bool = False,
                     generate: Callable | None = None) -> Path:
    source = source_path(input_file)
    output = output_path(output_file, source, {".docx"})
    with as_docx(source) as docx:
        root, paragraphs = read_document(docx)
        if not 1 <= paragraph_number <= len(paragraphs):
            raise WordError(f"Paragraph must be between 1 and {len(paragraphs)}. Use inspect to select it.")
        paragraph = paragraphs[paragraph_number - 1]
        run = editable_run(paragraph)
        if generate is None:
            from gemma_runtime import generate
        revised = clean_revision(generate(paragraph_text(paragraph), instruction, stats=stats))
        text_nodes = run.findall("w:t", NS)
        text_nodes[0].text = revised
        text_nodes[0].set(XML_SPACE, "preserve")
        for extra in text_nodes[1:]:
            run.remove(extra)
        updated_xml = etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone=True)
        with tempfile.TemporaryDirectory(prefix="gemma-word-save-", dir=output.parent) as tmp:
            staged = Path(tmp) / "revised.docx"
            with zipfile.ZipFile(docx) as old, zipfile.ZipFile(staged, "w") as new:
                new.comment = old.comment
                for member in old.infolist():
                    new.writestr(member, updated_xml if member.filename == "word/document.xml" else old.read(member))
            publish_file(staged, output)
    return output


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("restore-settings", help="Restore Word settings after an interrupted conversion")
    inspect_parser = commands.add_parser("inspect", help="List paragraph numbers and supported selections")
    inspect_parser.add_argument("input")
    convert_parser = commands.add_parser("convert", help="Convert .doc/.docx locally through Microsoft Word")
    convert_parser.add_argument("input")
    convert_parser.add_argument("output")
    rewrite_parser = commands.add_parser("rewrite", help="Rewrite one paragraph into a new DOCX")
    rewrite_parser.add_argument("input")
    rewrite_parser.add_argument("output")
    rewrite_parser.add_argument("--paragraph", type=int, required=True)
    instruction_group = rewrite_parser.add_mutually_exclusive_group()
    instruction_group.add_argument("--instruction", help="Non-sensitive instruction; use --instruction-file for private text")
    instruction_group.add_argument("--instruction-file", help="Read a custom instruction from a local UTF-8 text file")
    rewrite_parser.add_argument("--stats", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.command == "restore-settings":
            restore_word_settings()
            print("No pending Word settings restoration remains.")
        elif args.command == "inspect":
            print(json.dumps(inspect_document(args.input), ensure_ascii=False, indent=2))
        elif args.command == "convert":
            print(convert_document(args.input, args.output))
        else:
            instruction = args.instruction or DEFAULT_INSTRUCTION
            if args.instruction_file:
                instruction = Path(args.instruction_file).expanduser().read_text(encoding="utf-8").strip()
                if not instruction:
                    raise WordError("The instruction file is empty.")
            print(rewrite_document(args.input, args.output, args.paragraph, instruction, args.stats))
    except KeyboardInterrupt:
        print("Cancelled; no incomplete document was saved.", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"gemma word: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
