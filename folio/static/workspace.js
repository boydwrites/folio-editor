/* State transitions shared by the interface and the regression tests. */
(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const stamp = () => new Date().toISOString();
  function snapshot(session, label, text = session.draft) {
    if (!text) return;
    session.versions ||= [];
    const last = session.versions.at(-1);
    if (last?.text === text && last?.title === session.title && last?.date === session.date) return last;
    const version = { id: crypto.randomUUID(), text, title: session.title, date: session.date, label, createdAt: stamp() };
    session.versions.push(version);
    return version;
  }
  function capture(session, mode, instruction, selected) {
    if (session.deletedAt) throw new Error('Restore this document from Trash before editing.');
    if (!session.draft?.trim()) throw new Error('Add some writing first.');
    if (!instruction.trim()) throw new Error(mode === 'discuss' ? 'Enter a question.' : 'Describe the edit you want.');
    if (mode !== 'discuss' && session.status === 'final') throw new Error('Unlock this document to edit it.');
    const request = { sessionId: session.id, mode, instruction, base: session.draft, scope: 'document' };
    if (selected) {
      const chars = Array.from(session.draft);
      if (selected.invalid || selected.base !== session.draft || !Number.isInteger(selected.start) || !Number.isInteger(selected.end) ||
          selected.start < 0 || selected.end <= selected.start || selected.end > chars.length || chars.slice(selected.start, selected.end).join('') !== selected.text) {
        throw new Error('The selection changed. Select the passage again, or clear it to edit the whole document.');
      }
      request.scope = 'selection';
      request.selection = selected.text;
      request.selectionRange = { start: selected.start, end: selected.end };
      request.scopeLabel = selected.label || '';
    }
    return request;
  }
  function applyResult(session, request, text) {
    if (!text?.trim()) throw new Error('The model returned an empty response. Your document is unchanged.');
    if (session.id !== request.sessionId) throw new Error('The response belongs to a different document.');
    if (request.mode === 'discuss') return { kind: 'answer', text };
    if (session.draft !== request.base || session.status === 'final' || session.deletedAt) return { kind: 'stale' };
    let draft = text;
    if (request.scope === 'selection') {
      const chars = Array.from(request.base);
      const { start, end } = request.selectionRange;
      if (chars.slice(start, end).join('') !== request.selection) throw new Error('The selected passage changed while the assistant was working, so nothing was applied. Select it again and retry.');
      draft = chars.slice(0, start).join('') + text + chars.slice(end).join('');
    }
    if (draft === session.draft) return { kind: 'unchanged', text: draft };
    snapshot(session, 'Before AI edit');
    return { kind: 'edit', text: draft };
  }
  function recordEdit(session, request, text) {
    const before = snapshot(session, 'Before AI edit', request.base);
    const after = snapshot(session, 'AI edit', text);
    const edit = {id:crypto.randomUUID(),beforeId:before.id,afterId:after.id,instruction:request.instruction,
      scope:request.scope,scopeLabel:request.scopeLabel||'',selection:request.selection || '',selectionRange:request.selectionRange,createdAt:stamp()};
    (session.edits ||= []).push(edit);
    return edit;
  }
  function editTexts(session, edit) {
    return {before:session.versions.find(v=>v.id===edit.beforeId)?.text,
      after:session.versions.find(v=>v.id===edit.afterId)?.text};
  }
  function conversation(session) {
    // Failed/in-flight requests aren't model conversation. UI metadata and saved
    // revisions stay local. Earlier edits contribute what was asked and the wording
    // they produced, never the wording they removed: the author moves forward, and
    // Undo edit or History is the reliable way back.
    return session.history.filter(m=>!m.status || m.status==='complete').map(m=> {
      const edit = m.editId && session.edits?.find(e=>e.id===m.editId);
      if (!edit) return {role:m.role,content:m.content};
      const {before,after} = editTexts(session,edit);
      let content=m.content;
      if (before!==undefined && after!==undefined) {
        if(edit.scope==='selection') {
          const start=edit.selectionRange.start;
          const count=Array.from(after).length-(Array.from(before).length-(edit.selectionRange.end-start));
          content+='\nReplacement: '+Array.from(after).slice(start,start+count).join('');
        } else content+='\nThat revision was applied to the document.';
        if(session.draft===before)content+='\nThis edit has since been undone. The current draft takes precedence.';
        else if(session.draft!==after)content+='\nThe author has edited the document since this revision. Their current draft takes precedence; do not restore anything they removed.';
      }
      return {role:m.role,content};
    });
  }
  function createSaver(read, write, status) {
    let revision = 0, saved = 0, pending = null;
    return {
      change() { revision++; status?.('Saving…'); },
      get dirty() { return revision !== saved; },
      get pending() { return !!pending; },
      flush() {
        if (pending) return pending;
        if (saved === revision) return Promise.resolve();
        pending = (async () => {
          while (revision !== saved) {
            const current = revision;
            await write(copy(read()));
            saved = current;
          }
          status?.('Saved');
        })().catch(error => { status?.('Not saved · Retry'); throw error; }).finally(() => { pending = null; });
        return pending;
      },
    };
  }
  async function readStream(response, event, cancelled) {
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', result = null;
    const receive = value => {
      if (cancelled()) throw new Error('Stopped. Your document is unchanged.');
      if (value.type === 'error' || value.type === 'cancelled') throw new Error(value.message || 'Stopped. Your document is unchanged.');
      if (value.type === 'complete') result = value;
      event(value);
    };
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          if (line.trim()) receive(JSON.parse(line));
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) receive(JSON.parse(buffer));
      if (cancelled()) throw new Error('Stopped. Your document is unchanged.');
      if (!result?.text?.trim()) throw new Error('The response ended early. Your document is unchanged.');
      return result;
    } finally { reader.releaseLock?.(); }
  }
  const api = { snapshot, capture, applyResult, recordEdit, editTexts, conversation, createSaver, readStream };
  if (typeof module !== 'undefined') module.exports = api;
  else root.FolioWorkspace = api;
}(typeof window === 'undefined' ? globalThis : window));
