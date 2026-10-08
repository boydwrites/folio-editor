// One local SDK prediction per process. Requests arrive only through stdin;
// stdout is a JSON-lines stream and never a saved transcript.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const emit = event => process.stdout.write(JSON.stringify(event) + '\n');
let client;
let timer;
let metadataTimer;
let abortWatchdog;
let cancelled = false;
let timedOut = false;
const abort = new AbortController();
const requestAbort = () => {
  abort.abort();
  // The SDK cancellation request is asynchronous. Bound a backend that never
  // acknowledges it so the Python stream reader cannot wait indefinitely.
  abortWatchdog ??= setTimeout(() => {
    emit(cancelled ? { type: 'cancelled' } : { type: 'error', message: 'Generation timed out; the local connection was closed.' });
    process.exit(cancelled ? 130 : 1);
  }, 10000);
};
process.on('SIGINT', () => { cancelled = true; requestAbort(); });
process.on('SIGTERM', () => { cancelled = true; requestAbort(); });

try {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input);
  if (!Array.isArray(request.messages) || request.messages.length === 0 ||
      request.messages.some(message => !['system', 'user', 'assistant'].includes(message.role) ||
        typeof message.content !== 'string')) throw new Error('Invalid conversation');

  const sdk = path.join(os.homedir(), '.lmstudio/extensions/plugins/lmstudio/rag-v1/node_modules/@lmstudio/sdk/dist/index.mjs');
  const { LMStudioClient } = await import(pathToFileURL(sdk).href);
  const localInfo = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.lmstudio/.internal/http-server.json'), 'utf8'));
  const port = localInfo.port;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid local daemon port');
  const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
  client = new LMStudioClient({ baseUrl: `ws://127.0.0.1:${port}`, logger: silentLogger, verboseErrorMessages: false });
  // Metadata methods have no signal argument. Bound their connection phase;
  // inference has its own abortable timeout below.
  metadataTimer = setTimeout(() => {
    emit({ type: 'error', message: 'The local model metadata request timed out.' });
    process.exit(1);
  }, 30000);
  const model = client.llm.createDynamicHandle({
    identifier: request.identifier, path: request.model_path, deviceIdentifier: null,
  });
  const info = await model.getModelInfo();
  const settings = await model.getLoadConfig();
  clearTimeout(metadataTimer);
  if (!info || info.identifier !== request.identifier || info.path !== request.model_path || info.deviceIdentifier !== null ||
      info.contextLength !== request.context_length || info.ttlMs !== request.ttl_seconds * 1000 ||
      settings.maxParallelPredictions !== 1) {
    emit({ type: 'error', message: 'The loaded model does not match the configured local baseline. Run ./gemma stop and retry.' });
    process.exitCode = 1;
  } else {
    timer = setTimeout(() => { timedOut = true; requestAbort(); }, 1800000);
    const prediction = model.respond(request.messages, {
      enableThinking: false, contextOverflowPolicy: 'stopAtLimit', signal: abort.signal,
    });
    for await (const fragment of prediction) {
      if (cancelled || timedOut || fragment.isStructural || fragment.reasoningType !== 'none') continue;
      if (fragment.content) emit({ type: 'delta', text: fragment.content });
    }
    const result = await prediction.result();
    if (cancelled) {
      emit({ type: 'cancelled' });
      process.exitCode = 130;
    } else if (timedOut) {
      emit({ type: 'error', message: 'Generation timed out; this turn was not added to the conversation.' });
      process.exitCode = 1;
    } else if (result.modelInfo.path !== info.path || result.modelInfo.identifier !== info.identifier ||
        result.modelInfo.deviceIdentifier !== null || result.modelInfo.instanceReference !== info.instanceReference) {
      emit({ type: 'error', message: 'The loaded model changed during generation; this turn was not added.' });
      process.exitCode = 1;
    } else if (!['eosFound', 'stopStringFound'].includes(result.stats.stopReason)) {
      emit({ type: 'error', message: 'Generation did not finish cleanly (' + result.stats.stopReason + '). Use /clear if the context is full.' });
      process.exitCode = 1;
    } else {
      emit({ type: 'complete', text: result.nonReasoningContent, stats: result.stats });
    }
  }
} catch (error) {
  if (cancelled) {
    emit({ type: 'cancelled' });
    process.exitCode = 130;
  } else {
    const contextError = /context|too many tokens|token limit/i.test(String(error?.message || ''));
    emit({ type: 'error', message: contextError
      ? 'The conversation exceeds the model context. Use /clear and try a shorter request.'
      : 'The local SDK request failed. Check ./gemma status and retry.' });
    process.exitCode = 1;
  }
} finally {
  clearTimeout(timer);
  clearTimeout(metadataTimer);
  if (client) {
    const cleanupWatchdog = setTimeout(() => {
      emit({ type: 'error', message: 'The local SDK connection did not close promptly.' });
      process.exit(cancelled ? 130 : 1);
    }, 5000);
    try {
      await client[Symbol.asyncDispose]();
    } finally {
      clearTimeout(cleanupWatchdog);
    }
  }
  clearTimeout(abortWatchdog);
}
