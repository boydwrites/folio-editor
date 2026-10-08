"""Verify a targeted DOCX rewrite without recording document text in the report."""
from __future__ import annotations

import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import zipfile

from lxml import etree

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gemma_word import NS, W, WordError, clean_revision, editable_run, paragraph_text, read_document


def sha256(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def xml(value) -> bytes | None:
    return etree.tostring(value) if value is not None else None


def style_id(paragraph) -> str:
    style = paragraph.find("w:pPr/w:pStyle", NS)
    return style.get(W + "val", "") if style is not None else ""


def verify(source: Path, revised: Path, paragraph_number: int = 4,
           expected_source_sha256: str | None = None) -> dict:
    original, old_paragraphs = read_document(source)
    modified, new_paragraphs = read_document(revised)
    if not 1 <= paragraph_number <= min(len(old_paragraphs), len(new_paragraphs)):
        raise WordError("Selected paragraph is absent from the source or revised document.")
    old = old_paragraphs[paragraph_number - 1]
    new = new_paragraphs[paragraph_number - 1]
    old_run, new_run = editable_run(old), editable_run(new)
    clean_revision(paragraph_text(new))
    with zipfile.ZipFile(source) as before, zipfile.ZipFile(revised) as after:
        before_names, after_names = before.namelist(), after.namelist()
        members = set(before_names) | set(after_names)
        changed = sorted(name for name in members if name not in before_names or name not in after_names
                         or before.read(name) != after.read(name))
        unchanged_outside_main = all(name == "word/document.xml" for name in changed)
        styles_preserved = all(name not in changed for name in members
                               if name == "word/numbering.xml" or name.startswith("word/styles"))
    source_hash = sha256(source)
    old_headings = [p for p in old_paragraphs if style_id(p).lower().startswith("heading")]
    new_headings = [p for p in new_paragraphs if style_id(p).lower().startswith("heading")]
    def is_list(p):
        return style_id(p).lower().startswith("list") or p.find("w:pPr/w:numPr", NS) is not None
    old_lists, new_lists = [p for p in old_paragraphs if is_list(p)], [p for p in new_paragraphs if is_list(p)]
    old_tables, new_tables = original.findall(".//w:tbl", NS), modified.findall(".//w:tbl", NS)
    checks = {
        "different_source_and_output_paths": source.resolve() != revised.resolve(),
        "same_package_members_and_order": before_names == after_names,
        "all_other_package_parts_byte_identical": unchanged_outside_main,
        "style_and_numbering_definitions_preserved": styles_preserved,
        "body_paragraph_count_preserved": len(old_paragraphs) == len(new_paragraphs),
        "selected_paragraph_text_changed": paragraph_text(old) != paragraph_text(new),
        "selected_paragraph_properties_preserved": xml(old.find("w:pPr", NS)) == xml(new.find("w:pPr", NS)),
        "selected_run_formatting_preserved": xml(old_run.find("w:rPr", NS)) == xml(new_run.find("w:rPr", NS)),
        "heading_styles_preserved": [xml(p.find("w:pPr", NS)) for p in old_headings] == [xml(p.find("w:pPr", NS)) for p in new_headings],
        "list_styles_preserved": [xml(p.find("w:pPr", NS)) for p in old_lists] == [xml(p.find("w:pPr", NS)) for p in new_lists],
        "tables_preserved_exactly": [xml(t) for t in old_tables] == [xml(t) for t in new_tables],
    }
    # Normalize only the selected run's text elements, preserving all other XML.
    for node in new_run.findall("w:t", NS):
        new_run.remove(node)
    for node in old_run.findall("w:t", NS):
        new_run.append(deepcopy(node))
    checks["all_document_xml_except_selected_text_identical"] = xml(original) == xml(modified)
    if expected_source_sha256:
        checks["source_matches_pre_rewrite_hash"] = source_hash == expected_source_sha256.lower()
    return {
        "verified_at_utc": datetime.now(timezone.utc).isoformat(),
        "passed": all(checks.values()),
        "selected_body_paragraph": paragraph_number,
        "source_sha256": source_hash,
        "revised_sha256": sha256(revised),
        "source_bytes": source.stat().st_size,
        "revised_bytes": revised.stat().st_size,
        "source_body_paragraphs": len(old_paragraphs),
        "heading_paragraphs": len(old_headings),
        "list_paragraphs": len(old_lists),
        "tables": len(old_tables),
        "changed_package_parts": changed,
        "checks": checks,
        "limitations": "Structural preservation only; factual accuracy and rendered layout require separate review.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("revised", type=Path)
    parser.add_argument("--paragraph", type=int, default=4)
    parser.add_argument("--expected-source-sha256")
    parser.add_argument("--report", type=Path, help="Optional new JSON file; existing files are never overwritten")
    args = parser.parse_args()
    try:
        result = verify(args.source, args.revised, args.paragraph, args.expected_source_sha256)
        serialized = json.dumps(result, indent=2) + "\n"
        if args.report:
            with args.report.open("x", encoding="utf-8") as report:
                report.write(serialized)
        print(serialized, end="")
        return 0 if result["passed"] else 1
    except Exception as exc:
        print(f"Word proof verification failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
