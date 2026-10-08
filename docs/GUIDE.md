# Folio user guide

[Back to the project overview](../README.md). Run all commands below from the repository root.

Folio is a private writing editor for any kind of document. It runs on the Gemma and LM Studio setup in `local-gemma`, and both your documents and the model stay on your Mac. The privacy section below spells out exactly where the boundaries are.

## Requirements and setup

Folio is a personal Mac app, not a packaged download. To run it you need:

- macOS on Apple Silicon, with the Swift compiler from Xcode or the Command Line Tools (only for the Mac app wrapper).
- Python 3.12 or later: `python3 -m pip install -r requirements.txt`. Set `FOLIO_PYTHON` to use a different interpreter.
- Node.js on your `PATH` (or set `FOLIO_NODE`), used for the local LM Studio connection.
- [LM Studio](https://lmstudio.ai) with its `lms` CLI, its `rag-v1` plugin (which provides the SDK Folio connects through), and a downloaded Gemma model. See [local-gemma](../local-gemma/README.md) for the tested model and settings.

Nothing is downloaded or installed by Folio itself. Your writing, examples, and settings are stored in `folio/private/`, which is ignored by Git.

## Open the app

Build it once with **Build Folio App.command**, then double-click **Folio.app**. It opens the existing editor in its own Mac window and starts the local server in the background. No Terminal or Chrome window is needed. You can drag the app to the Dock or copy it into your Applications folder; it continues to use this project and the existing private writing library.

**Close the window**, press **⌘W**, or choose **Folio → Quit Folio (⌘Q)** to finish saving and stop the app's server, releasing its port. An active assistant request is cancelled before the final save. If saving fails, Folio stays open so you can retry. Imports use the Mac file picker, and exports use a Save dialog. The server also stops if the launcher crashes or is force-quit; force quitting cannot guarantee the latest unsaved keystrokes are saved. Minimizing or hiding the window keeps Folio running. Quitting Folio does not stop the separately managed LM Studio runtime.

To rebuild the app after moving this project or changing Python, double-click **Build Folio App.command**. Building uses the Mac's installed Swift compiler and downloads nothing. This is a personal app host for this checkout, not a distributable package with Python, models, and LM Studio bundled inside. Editing the web editor or Python code does not require rebuilding; changes to `folio/desktop/Folio.swift` do.

The Finder, Dock, and About icons use Folio's existing F-and-orange-dot logo from `folio/static/favicon.svg`, with its original geometry and colors, a Mac app tile, and transparent outer padding. The build renders each icon size directly from the vector and packages normal and Retina representations up to 1024 pixels. Rebuild after changing the logo; quit and reopen Folio to refresh its running Dock icon.

If an older Terminal-launched Folio is already running, stop it with Control-C once before opening the Mac app. Folio refuses to start two desktop hosts on the same writing library. It chooses an available loopback port and never kills another application to free one.

The terminal/browser launcher is still available. Double-click **Open Folio.command**, or run:

```sh
./'Open Folio.command'
```

The browser launcher starts at `http://127.0.0.1:8765` and automatically picks the next available port if another app is using it. If Folio is already running, it reopens that instance in the default browser. Keep its terminal window running; Control-C stops that application server. Closing a browser tab does not stop it. Both launchers need the requirements above and an already downloaded model. They install and download nothing. Override Python with `FOLIO_PYTHON` if needed.

## The editing workflow

1. Choose **New**, then write, paste, drop in, or **Import** a document. Importing into a document that already has writing asks whether to add the file to the end or open it as a new document. Click the title to rename it.
2. The assistant sits beside the document. Drag the divider to give it more or less room, or hide it with the panel button in the header. Both choices are remembered.
3. The composer has two modes. **Chat** talks about your writing and never changes it. **Revise** changes the document, with **Tighten**, **Clarify**, **Proofread**, and **Smooth** presets that fill in an editable request. Enter sends; Shift+Enter adds a line. Each mode keeps its own unfinished request across switches and reloads.
4. Highlight a passage, or choose a section from **Whole document**, to work on just that part. The scope stays highlighted while you type in the assistant and survives follow-up edits, undo, reapply, document switches, and reloads.
5. When a revision lands, its changes appear marked inside the document: removed wording struck through, new wording highlighted, with arrows to step through each change. **Undo edit** reverses it; **Done** or clicking into the text returns to editing. The conversation card for each edit offers **Show changes** and **Undo edit** at any time.
6. Every request shows its progress and elapsed time while it runs, and each reply records how long it took. If you change the document mid-request, Folio keeps your writing and offers **Try again**. **Stop**, model errors, and incomplete responses leave your writing untouched.
7. **History** (beside Conversation) is one timeline of edits, restores, and imports, grouped by day, with each edit's timing and word changes. Selecting an entry shows its changes in the document, where you can restore it. Restoring is undoable.
8. **Export** downloads Word or text. Lock a document through **Document options** (•••); **Unlock to edit** reverses it.

Folio does not ask what kind of writing a document is. The model works that out from the text and applies only the parts of your writing preferences that fit, so one set of preferences can cover stories, essays, emails, and anything else.

**Documents** lets you search, open, and remove saved documents. Choose **Move to Trash** beside a document, or from its **••• Document options**. The confirmation includes **Undo**. Open **Documents → Trash** to restore writing with its original notes, conversation, edit receipts, saved versions, and lock status intact. Trash stays on this Mac until you choose **Delete permanently…** and confirm. Permanent deletion removes the document from the current workspace; imported files, exports, and backups are unaffected. Removing a document stops its pending AI request. Removing the last document opens a blank one.

**Writing style** holds samples, paired examples, and preferences. **Settings** selects a downloaded model and Word formatting. Folio follows the Mac's light or dark appearance. On narrow screens, the **Assistant** button opens the assistant over the document, and it steps aside when a revision lands so the marked changes are visible; it keeps the selected passage and unfinished request.

Changes save automatically on this Mac. If a save fails, the writing stays in the editor and **Not saved · Retry** retries the latest state. Undo/Redo survives document switches during the session; saved versions survive closing or reloading the app.

The first launch of this editor makes an owner-only recovery copy of the previous workspace in `folio/private/recovery-v1-*.json`. Both accepted and pending drafts are kept in History; the visible pending draft becomes the working document. Locked documents remain locked. Recovery copies, writing, and style examples are ignored by Git.

The clipboard and browser download location remain under your Mac/browser settings. PDF import is text extraction, not OCR. Old `.doc` files should be saved as `.docx` in Word before import. Original uploaded documents are never overwritten. Rich-editor paste and drop accept plain text, not arbitrary HTML.

## Your writing library

Add ordinary writing samples and paired rough/polished notes under **Writing style**. Each can be enabled or disabled for the next request. Examples guide vocabulary, tone, structure and degree of editing; the prompt explicitly prohibits copying their facts into another document. This is in-context guidance, not model training.

Unfinished sample and before/after forms save privately as drafts, including when you close the dialog or reload. **Continue sample** or **Continue before & after** resumes them. Only **Save example** adds those drafts to the assistant's reference library.

Existing writing guidance remains available in **Writing style → Writing preferences**. It guides each request and can be edited directly. Original samples can remain saved with their reference toggles off.

Notes, drafts, writing examples, and the writing guide have no per-field character cap in generation. The configured Gemma baseline has an 8,192-token context. Source, current draft, examples, instructions, and conversation share that space. Folio includes selected references in full and checks the actual prompt token count while reserving room for the response. An oversized request reports the token count and loaded context capacity rather than silently dropping material. Use representative excerpts from long examples, deselect some references, or clear the feedback conversation while retaining the current draft. File-import, request-size, and workspace-storage limits remain separate from the model's context capacity.

Prompts preserve facts, qualifications, disagreement, unresolved questions, action owners and deadlines. Your own edits take precedence over old model output. This improves fidelity; final human review is still part of the workflow.

## Local privacy boundaries

- The server binds only `127.0.0.1`, validates Host/Origin, and requires a per-process request token for writes and model requests. Cross-site browser access is blocked.
- The frontend has no third-party JavaScript, remote fonts, trackers, analytics, or cloud APIs. Its content policy blocks external connections.
- Model inference connects to LM Studio over loopback. Folio starts its own model runtime with macOS network restrictions that deny external connections. It verifies the process identity before reuse. If another unverified LM Studio runtime is already running, Folio asks you to stop it before proceeding.
- Model selection is limited to locally downloaded language models. It never downloads a model automatically or connects to a remote model/device. Switching can unload the previous local model to preserve the one-model memory budget.
- Notes, examples, feedback, and versions are stored in `folio/private/state.json`. The directory is owner-only (0700), files owner-readable/writable (0600), and writes use atomic replacement. Private application state is ignored by Git.
- These files are **not encrypted by Folio**. Device access controls, FileVault, Time Machine, and any folder-sync/backup settings still apply. Use a workspace location excluded from cloud sync if needed.
- Content is not written to server logs or command arguments. LM Studio may maintain temporary local prompt caches. The model unloads after its idle TTL; `local-gemma/gemma stop` stops the runtime and releases caches. Stopping the Folio server alone does not stop LM Studio.
- No confidentiality claim covers other software on your Mac, browser extensions, the OS, or your own sharing/export actions.

## Document output

Word export creates a new DOCX with title, optional document date, headings, paragraphs, bullets, bold/italic emphasis, and an optional Confidential footer. Settings control font, size, line spacing, margins, and Letter/A4. This is a configurable clean document format, not a reproduction of arbitrary corporate letterhead or complex tables. Imports are text-based; original layout is not retained in the editor.

## Verification

Run server, document, and prompt tests:

```sh
python3 -m unittest discover -s folio/tests -v
python3 -m unittest discover -s tests -v
```

HTTP tests open temporary loopback ports. Model tests use fictional notes.

Rich-editor and state regression tests:

```sh
node --test folio/tests/test_frontend_state.cjs
node --test folio/tests/test_editor.cjs
node --test folio/tests/test_workflow.cjs
node --test folio/tests/test_desktop_quit.cjs
```

The rich-editor tests use Playwright's Chromium with external requests blocked (set `FOLIO_PLAYWRIGHT` if `playwright` isn't resolvable from the repository). They cover source preservation, formatting, selection mapping, undo, paste/drop safety, and finalized locks.

Desktop lifecycle tests in `folio/tests/test_launch.py` verify shutdown on control-pipe closure, termination signals and a host crash, port reuse, writing preservation, workspace ownership and collisions with unrelated servers. `test_desktop_quit.cjs` verifies save-before-quit, failed-save recovery and cancellation in WebKit with synthetic writing.

The complete workflow suite starts its own temporary local server, uses synthetic writing, and exercises migration, questions, repeated revisions, exact selected edits, cancellation, stale results, failed saves, history, locks, examples, preferences, imports, exports, document search, Trash/restore/permanent deletion, mobile layouts and keyboard focus. It checks browser requests stay on the loopback origin. Screenshots and downloads are written to a temporary verification folder, never to Git.

## Local typefaces

Outfit and Source Serif 4 are served from `folio/static/fonts/`; their SIL Open Font License files are included alongside them. No font service is contacted at runtime.
