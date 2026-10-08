# Local Gemma runtime

Gemma 4 31B IT, six-bit MLX, runs through LM Studio’s Apple Silicon `llmster` service. The project provides terminal chat, text rewriting, and a small Word-document editing proof. It is the model foundation Folio runs on.

Chat and rewrite commands start the runtime automatically. The tests use synthetic documents, and model weights aren't included.

## Start a conversation

```sh
cd local-gemma
./gemma chat --stats
```

The launcher starts the local daemon when necessary and loads the exact selected package. Type a request, then continue with follow-up revisions. Every turn checks and reloads the same 8K baseline if it has unloaded, while preserving the conversation in memory. Use `/exit` to quit, `/clear` to start a new conversation, or `/paste` to enter multiple lines and `/end` to submit them. Ctrl-C cancels an active reply; a cancelled turn is not added to the conversation. Ctrl-C at the input prompt exits.

```sh
./gemma status
./gemma stop
```

`status` inspects the service without starting it. `stop` ends the daemon and unloads its models; the downloaded weights remain available.

## Rewrite a text file

```sh
mkdir -p outputs
./gemma rewrite samples/rewrite.txt outputs/draft.md --stats
```

Output must be a new filename. A failed, cancelled, or truncated generation does not replace the source or publish a partial draft. Both source text and editing instructions are sent through stdin. Statistics and status messages are separate from the saved response.

To use your own editing instructions, save them in a UTF-8 text file and pass `--instruction-file path/to/instructions.txt`.

## Edit a Word document

```sh
./gemma word inspect samples/board-notes.docx
./gemma word rewrite samples/board-notes.docx outputs/my-board-revised.docx --paragraph 4 --stats
```

`inspect` lists one-based body-paragraph numbers and reports which paragraphs this proof can edit. Table paragraphs are excluded from numbering. The adapter rewrites one selected plain-text paragraph and preserves the document’s other package contents. It refuses selected paragraphs containing mixed formatting runs, hyperlinks, fields, tracked revisions, or embedded objects. This deliberately small proof does not yet implement a complete Word editor.

The original is preserved. A revised Word document is always saved to a new filename. Review the rewritten wording against the original notes before using it.

Legacy Word conversion runs locally through the installed Microsoft Word application:

```sh
./gemma word convert samples/board-notes.docx outputs/legacy-example.doc
./gemma word convert outputs/legacy-example.doc outputs/converted-example.docx
```

Word must be able to open normally, and macOS may request permission for automation. Conversion works on a temporary copy, opens it read-only with macros disabled, and restores Word’s application settings afterward. Older `.doc` inputs can also be passed to `word rewrite`; the edited output is `.docx`.

## Configuration

`config/runtime-config.json` records the selected package and settings:

- Package: `lmstudio-community/gemma-4-31B-it-MLX-6bit`.
- Context: 8,192 tokens, including instructions, input, conversation, and output.
- One loaded model and one concurrent request.
- Thinking disabled; supplied chat template and model sampling defaults retained.
- Automatic Apple Metal acceleration and supported prompt caching.
- 900-second idle timeout; speculative decoding disabled.

The configuration pins MLX runtime **1.9.1**. The launcher checks the loaded context capacity rather than assuming that the requested limit was honored. Changing runtime versions requires rechecking compatibility. The chat commands supply writing instructions that preserve qualifications and avoid adding unstated causal explanations or commitments.

Large weights live once in LM Studio’s managed directory, outside this project. The recorded model location can later move to an external SSD using LM Studio’s supported storage configuration. The launcher refuses a similarly named or differently quantized model.

File rewriting uses Python’s standard library and `lms`. Interactive chat additionally uses Node (from `PATH`, or `GEMMA_NODE`) and LM Studio SDK 1.5.0 already installed with its `rag-v1` plugin. The SDK connects only to the local daemon. Word editing uses Python with `lxml`; `GEMMA_PYTHON` can select another compatible Python. `GEMMA_LMS` can point to a different installation of the same verified CLI. Normally neither override is needed.

## Verification and local data

The included samples are synthetic. Generated drafts belong in the ignored `outputs/` directory. The selected model package and file hashes are recorded in `verification/model-manifest.json`; a manifest alone is not evidence of output quality.

The application sends model requests to the local runtime. Model downloads and runtime updates use the internet. Folio’s app runtime applies macOS network restrictions to its model daemon while allowing localhost. This does not disconnect the Mac.

The chat loop does not save a transcript. The runtime may use temporary local prompt-cache files; stop the daemon to end the runtime session.

Keep private inputs and outputs in the ignored `inputs/`, `outputs/`, `history/`, or `private/` directories. Ignore rules prevent ordinary Git additions; they are not encryption or access control. Working from this folder does not automatically give the model access to other documents.

## Sources

- [LM Studio headless installation](https://lmstudio.ai/docs/developer/core/headless)
- [Selected six-bit model package](https://huggingface.co/lmstudio-community/gemma-4-31B-it-MLX-6bit)
- [Terminal chat](https://lmstudio.ai/docs/cli/local-models/chat)
- [MLX prompt caching](https://lmstudio.ai/blog/mlx-engine-agentic-workloads)
