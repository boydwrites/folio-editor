# Local Word document proof

The Word adapter sends only the paragraph you select to the local Gemma runtime. It saves a new `.docx` and leaves the input file unchanged. It preserves the selected paragraph's style and its single text run's formatting; other document parts, including styles, headings, lists, and tables, are copied unchanged.

Run these commands from this `local-gemma` directory:

```sh
./gemma word inspect samples/board-notes.docx
./gemma word rewrite samples/board-notes.docx outputs/my-board-revised.docx --paragraph 4 --stats
```

`inspect` prints JSON with one-based paragraph numbers and whether each selection is supported. Paragraph numbers count direct document-body paragraphs, including empty paragraphs. Table cells, headers, footers, and text boxes are not numbered or editable in this proof. The provided notes are entirely synthetic.

By default, a rewrite preserves all facts and returns one plain paragraph. To customize the instruction, keep private instructions in a local UTF-8 text file:

```sh
./gemma word rewrite samples/board-notes.docx outputs/board-revised-custom.docx --paragraph 4 --instruction-file private/instruction.txt
```

The output directory must already exist. Existing destinations, source-file overwrites, empty generations, multi-paragraph output, and obvious Markdown or reasoning output are rejected. Cancellation or failure leaves no incomplete output document. Successful commands print only the resulting path; runtime diagnostics and optional statistics go to stderr.

## Legacy Word files

Microsoft Word for macOS performs conversion locally. The adapter captures Word's prior automation-security setting, opens a temporary copy with macros disabled, exports the requested format, and closes that copy. Python attempts to restore the prior setting even if conversion times out or is cancelled. The adapter does not change Word's display-alert setting. Other open documents are not intentionally changed. Conversion requires an unlocked Mac and permission for automation to control Word.

```sh
./gemma word convert samples/board-notes.docx outputs/board-notes-legacy.doc
./gemma word convert outputs/board-notes-legacy.doc outputs/board-notes-roundtrip.docx
./gemma word rewrite outputs/board-notes-legacy.doc outputs/board-from-legacy.docx --paragraph 4
./gemma word convert outputs/board-from-legacy.docx outputs/board-from-legacy.doc
```

Rewriting a `.doc` input converts it to temporary `.docx` first and always writes a new `.docx`. Use the explicit final conversion when `.doc` output is required. The original is preserved. Word format conversion can change layout or features, so inspect converted documents in Word before relying on them. The proof does not claim lossless conversion of arbitrary legacy documents.

If Word shows a dialog, address it before retrying. A conversion timeout removes the adapter's temporary files and does not publish an output. The settings-restoration attempt waits up to 10 seconds. If Word remains unresponsive, the adapter retains a private `private/word-state/pending-restoration.json` record containing only the prior setting, and refuses another conversion until restoration succeeds. It also retains this record if the Python process is killed. After unlocking and addressing any Word dialog, run:

```sh
./gemma word restore-settings
```

Conversion and restoration commands are serialized to protect Word's shared settings. Inspect Word after an interrupted conversion for a temporary document that did not close. The recovery record does not contain document text or filenames.

## Current limits and verification

This milestone supports one plain-text run in the selected paragraph. It deliberately rejects selections containing multiple formatting runs, hyperlinks, fields, revisions, tabs, explicit line breaks, or embedded objects. It preserves those features elsewhere in the `.docx`; it does not implement comments, tracked changes, table-cell edits, or a whole-document rewrite. Model output should still be reviewed for factual accuracy.

The adapter uses the Python runtime selected by `./gemma`, with `lxml` for precise package edits. The fixture builder additionally uses `python-docx`. No document conversion service or cloud document API is used.

Run the structural and source-safety tests with:

```sh
python3 -m unittest discover -s tests -p test_word.py -v
```

The tests verify exact package-part preservation outside the selected text, source integrity, output protection, paragraph selection, cancellation, failed generation, output validation, private instruction-file handling, and Word settings restoration after timeout or cancellation. Word calls in the recovery tests are mocked, including an unresponsive Word and a successful later recovery. These tests do not establish model quality or actual Word conversion compatibility. Actual model quality, legacy Word conversion, and rendered layout require separate checks on the target Mac.

The reusable verifier checks a generated document without putting paragraph contents into its JSON report:

```sh
python3 scripts/verify_word_proof.py samples/board-notes.docx outputs/board-revised.docx --paragraph 4 --report outputs/word-proof.json
```

For source-integrity evidence, record the source file's SHA-256 before rewriting, then pass it as `--expected-source-sha256 HASH`. The report records hashes, counts, and individual structural checks. It does not check factual accuracy or visual layout. The command exits unsuccessfully if unrelated text, document parts, styles, lists, or tables change.
