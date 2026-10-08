/* A small, local document editor. Markdown remains the on-disk format. */
(function () {
  'use strict';

  const mounts = new WeakMap();
  const escape = value => String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  function closingEmphasis(text, start, count) {
    const character = text[start];
    const nested = [];
    let cursor = start + count;
    while (cursor < text.length) {
      if (text[cursor] === '\\') { cursor += 2; continue; }
      if (text[cursor] !== character) { cursor++; continue; }
      let end = cursor;
      while (text[end] === character) end++;
      let remaining = end - cursor;
      let at = cursor;
      const canClose = cursor > 0 && !/\s/.test(text[cursor - 1]) && !(character === '_' && /[\p{L}\p{N}]/u.test(text[end] || ''));
      const canOpen = end < text.length && !/\s/.test(text[end]) && !(character === '_' && /[\p{L}\p{N}]/u.test(text[cursor - 1] || ''));
      if (canClose) {
        while (nested.length && remaining >= nested[nested.length - 1]) {
          const consumed = nested.pop(); at += consumed; remaining -= consumed;
        }
        if (!nested.length && remaining >= count) return at;
      }
      if (canOpen && remaining) nested.push(Math.min(3, remaining));
      cursor = end;
    }
    return -1;
  }

  // Build a text-to-source map alongside the safe HTML. This lets a selection
  // spanning bold or italic text still identify an exact Markdown substring.
  function parse(markdown) {
    const source = String(markdown ?? '');
    const positions = [];
    const emphasis = [];
    let plain = '';
    function literal(text, offset) {
      for (let index = 0; index < text.length; index++) positions.push(offset + index);
      plain += text;
      return escape(text);
    }
    function inline(text, offset) {
      let html = '';
      for (let index = 0; index < text.length;) {
        if (text[index] === '\\' && /[\\*_\[\]#!+\-.>()`]/.test(text[index + 1] || '')) {
          html += literal(text[index + 1], offset + index + 1);
          index += 2;
          continue;
        }
        const character = text[index];
        if ((character === '*' || character === '_') && !(character === '_' && /[\p{L}\p{N}]/u.test(text[index - 1] || ''))) {
          let count = 1;
          while (text[index + count] === character && count < 3) count++;
          const found = text[index + count] && !/\s/.test(text[index + count]) ? closingEmphasis(text, index, count) : -1;
          if (found > index + count) {
            const start = plain.length;
            const body = inline(text.slice(index + count, found), offset + index + count);
            const tag = count === 1 ? 'em' : 'strong';
            html += count === 3 ? `<strong><em>${body}</em></strong>` : `<${tag}>${body}</${tag}>`;
            emphasis.push({ start, end: plain.length, from: offset + index, to: offset + found + count });
            index = found + count;
            continue;
          }
        }
        html += literal(character, offset + index);
        index++;
      }
      return html;
    }

    let html = '';
    let paragraph = [];
    let list = null;
    let offset = 0;
    function flushParagraph() {
      if (!paragraph.length) return;
      html += `<p>${paragraph.map(line => inline(line.text, line.offset)).join('<br>')}</p>`;
      paragraph = [];
    }
    function closeList() {
      if (list) html += `</${list}>`;
      list = null;
    }
    for (const originalLine of source.split('\n')) {
      const line = originalLine.replace(/\r$/, '');
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      const item = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList();
        const level = heading[1].length;
        html += `<h${level}>${inline(heading[2], offset + line.indexOf(heading[2], level))}</h${level}>`;
      } else if (item) {
        flushParagraph();
        const ordered = /^\d/.test(item[1]);
        const kind = ordered ? 'ol' : 'ul';
        if (list !== kind) {
          closeList();
          html += ordered ? `<ol start="${Number.parseInt(item[1], 10)}">` : '<ul>';
          list = kind;
        }
        const value = ordered ? ` value="${Number.parseInt(item[1], 10)}"` : '';
        html += `<li${value}>${inline(item[2], offset + line.lastIndexOf(item[2]))}</li>`;
      } else if (!line.trim()) {
        flushParagraph(); closeList();
      } else {
        closeList();
        paragraph.push({ text: line, offset });
      }
      offset += originalLine.length + 1;
    }
    flushParagraph(); closeList();
    return { html: html || '<p><br></p>', plain, positions, emphasis };
  }

  const blockTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'BLOCKQUOTE', 'PRE']);
  const ignoredTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'VIDEO', 'AUDIO']);
  const escapeInline = text => text.replace(/\u00a0/g, ' ').replace(/[\\*_]/g, '\\$&');
  const protectBlockStart = text => text.replace(/^(\s*)(#{1,6})(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*)([-+])(?=\s)/gm, '$1\\$2')
    .replace(/^(\s*\d+)([.)])(?=\s)/gm, '$1\\$2');

  function inlineMarkdown(node) {
    if (node.nodeType === 3) return escapeInline(node.nodeValue || '');
    if (node.nodeType !== 1 || ignoredTags.has(node.tagName)) return '';
    if (node.tagName === 'BR') return '\n';
    let text = Array.from(node.childNodes, inlineMarkdown).join('');
    const bold = ['STRONG', 'B'].includes(node.tagName) || /^(bold|[6-9]00)$/.test(node.style.fontWeight);
    const italic = ['EM', 'I'].includes(node.tagName) || node.style.fontStyle === 'italic';
    if ((bold || italic) && text.trim()) {
      const leading = text.match(/^\s*/)[0];
      const trailing = text.match(/\s*$/)[0];
      text = text.slice(leading.length, trailing ? -trailing.length : undefined);
      const marker = bold && italic ? '***' : bold ? '**' : '*';
      return leading + marker + text + marker + trailing;
    }
    return text;
  }

  function listMarkdown(list, depth = 0) {
    let next = Number.parseInt(list.getAttribute('start') || '1', 10);
    const ordered = list.tagName === 'OL';
    const lines = [];
    for (const item of Array.from(list.children)) {
      if (item.tagName !== 'LI') continue;
      const number = item.hasAttribute('value') ? Number.parseInt(item.getAttribute('value'), 10) : next;
      const children = Array.from(item.childNodes);
      const body = children.filter(node => !['UL', 'OL'].includes(node.tagName)).map(node => {
        if (['P', 'DIV'].includes(node.tagName)) return inlineMarkdown(node) + '\n';
        return inlineMarkdown(node);
      }).join('').replace(/\n+$/, '');
      const prefix = ordered ? `${number}. ` : '- ';
      lines.push('  '.repeat(depth) + prefix + body);
      for (const nested of children.filter(node => ['UL', 'OL'].includes(node.tagName))) lines.push(listMarkdown(nested, depth + 1));
      next = number + 1;
    }
    return lines.join('\n');
  }

  function serialize(element) {
    const blocks = [];
    let run = '';
    const flush = () => { if (run) { blocks.push(protectBlockStart(run)); run = ''; } };
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType !== 1 || !blockTags.has(node.tagName)) { run += inlineMarkdown(node); continue; }
      flush();
      if (node.tagName === 'UL' || node.tagName === 'OL') blocks.push(listMarkdown(node));
      else if (/^H[1-6]$/.test(node.tagName)) blocks.push('#'.repeat(Math.min(3, Number(node.tagName[1]))) + ' ' + inlineMarkdown(node).replace(/\n+$/, ''));
      else if (Array.from(node.children).some(child => blockTags.has(child.tagName))) blocks.push(serialize(node));
      else blocks.push(protectBlockStart(inlineMarkdown(node).replace(/\n$/, '')));
    }
    flush();
    return blocks.join('\n\n').replace(/^\n+|\n+$/g, '');
  }

  function read(element) {
    const mounted = mounts.get(element);
    return mounted && element.innerHTML === mounted.html ? mounted.markdown : serialize(element);
  }

  // Visible words and structure, without Markdown's formatting markers.
  function plainText(markdown, { lists = true } = {}) {
    const container = document.createElement('div');
    container.innerHTML = parse(markdown).html;
    const inline = node => node.nodeType === 3 ? node.textContent :
      node.nodeName === 'BR' ? '\n' : Array.from(node.childNodes, inline).join('');
    return Array.from(container.children, block => {
      if (!['UL', 'OL'].includes(block.tagName)) return inline(block);
      return Array.from(block.children, (item, index) =>
        (lists ? block.tagName === 'UL' ? '- ' : `${item.value || index + 1}. ` : '') + inline(item)).join('\n');
    }).join('\n\n');
  }

  function selectedRange(element) {
    const selected = element.ownerDocument.getSelection();
    if (!selected || !selected.rangeCount) return null;
    const range = selected.getRangeAt(0);
    return element.contains(range.startContainer) && element.contains(range.endContainer) ? range : null;
  }

  function selection(element) {
    return selectedRange(element)?.toString().trim() || '';
  }

  function selectionRange(element) {
    const range = selectedRange(element);
    if (!range || range.collapsed) return null;
    const markdown = read(element);
    const parsed = parse(markdown);
    const before = element.ownerDocument.createRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    let start = before.toString().length;
    before.setEnd(range.endContainer, range.endOffset);
    let end = before.toString().length;
    while (start < end && /\s/.test(parsed.plain[start])) start++;
    while (end > start && /\s/.test(parsed.plain[end - 1])) end--;
    // Never guess a location from matching text: repeated phrases are common.
    // Typing can leave non-breaking spaces in the page where the saved text has
    // ordinary spaces; they occupy the same position, so they still line up.
    if (parsed.plain !== element.textContent.replace(/ /g, ' ') || start >= end) return null;
    let from = parsed.positions[start];
    let to = parsed.positions[end - 1] + 1;
    for (const span of parsed.emphasis) {
      if (span.start >= start && span.end <= end) {
        from = Math.min(from, span.from);
        to = Math.max(to, span.to);
      }
    }
    return { start: Array.from(markdown.slice(0, from)).length,
      end: Array.from(markdown.slice(0, to)).length,
      text: markdown.slice(from, to), plain: range.toString().trim(), base: markdown };
  }

  function selectionMarkdown(element) { return selectionRange(element)?.text || ''; }

  // A retained scope remains visible after focus moves into the assistant.
  // Highlight ranges never become document markup or enter copy/export output.
  function highlight(element, selected) {
    const win=element.ownerDocument.defaultView;
    if (!win.CSS?.highlights || !win.Highlight) return;
    win.CSS.highlights.delete('folio-scope');
    if (!selected || selected.invalid || selected.base!==read(element)) return;
    const parsed=parse(selected.base),chars=Array.from(selected.base);
    if(parsed.plain!==element.textContent.replace(/ /g,' '))return;
    const from=chars.slice(0,selected.start).join('').length,to=chars.slice(0,selected.end).join('').length;
    const start=parsed.positions.findIndex(p=>p>=from),finish=parsed.positions.findIndex(p=>p>=to);
    if(start<0)return;
    const walker=element.ownerDocument.createTreeWalker(element,4),nodes=[];
    while(walker.nextNode())nodes.push(walker.currentNode);
    const locate=offset=>{for(const node of nodes){if(offset<=node.length)return [node,offset];offset-=node.length;}return [nodes.at(-1),nodes.at(-1).length];};
    if(!nodes.length)return;
    const range=element.ownerDocument.createRange();range.setStart(...locate(start));range.setEnd(...locate(finish<0?parsed.plain.length:finish));
    win.CSS.highlights.set('folio-scope',new win.Highlight(range));
  }

  function caret(element) {
    const range = selectedRange(element);
    if (!range) return null;
    const prefix = element.ownerDocument.createRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(range.startContainer, range.startOffset);
    const start = prefix.toString().length;
    prefix.setEnd(range.endContainer, range.endOffset);
    return { start, end: prefix.toString().length };
  }

  function restoreCaret(element, saved) {
    if (!saved) return;
    const doc = element.ownerDocument;
    const walker = doc.createTreeWalker(element, 4);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    if (!nodes.length) return;
    const locate = offset => {
      for (const node of nodes) {
        if (offset <= node.length) return [node, offset];
        offset -= node.length;
      }
      return [nodes.at(-1), nodes.at(-1).length];
    };
    const range = doc.createRange();
    range.setStart(...locate(saved.start)); range.setEnd(...locate(saved.end));
    doc.getSelection().removeAllRanges(); doc.getSelection().addRange(range);
    preserveSelection(element);
  }

  function replace(element, markdown, { notify = true, record = true, savedCaret = null, metadata = null } = {}) {
    const mounted = mounts.get(element);
    if (!mounted) return;
    if (record && (markdown !== mounted.markdown || metadata)) {
      mounted.history.past.push({ text: mounted.markdown, caret: caret(element), ...(metadata?{metadata}: {}) });
      mounted.history.future.length = 0;
    }
    element.innerHTML = parse(markdown).html;
    mounted.markdown = markdown; mounted.html = element.innerHTML; mounted.range = null; mounted.group = null;
    restoreCaret(element, savedCaret);
    if (notify) mounted.onChange?.(markdown);
    mounted.onHistory?.();
  }

  function travel(element, direction) {
    const mounted = mounts.get(element);
    if (!mounted || !editable(element)) return false;
    const from = direction === 'undo' ? mounted.history.past : mounted.history.future;
    const to = direction === 'undo' ? mounted.history.future : mounted.history.past;
    if (!from.length) return false;
    const entry = from.pop();
    to.push({ text: mounted.markdown, caret: caret(element), ...(entry.metadata?{metadata:mounted.getMetadata?.()}: {}) });
    replace(element, entry.text, { record: false, savedCaret: entry.caret });
    if(entry.metadata)mounted.restoreMetadata?.(entry.metadata);
    return true;
  }

  const editable = element => element.getAttribute('contenteditable') === 'true';
  function preserveSelection(element) {
    const range = selectedRange(element);
    const mounted = mounts.get(element);
    if (range && mounted) mounted.range = range.cloneRange();
  }

  function mount(element, options = {}) {
    mounts.get(element)?.cleanup();
    const record = {
      html: element.innerHTML,
      markdown: typeof options.markdown === 'string' ? options.markdown : serialize(element),
      range: null,
      history: options.history || { past: [], future: [] },
      onChange: options.onChange, onHistory: options.onHistory, beforeCaret: null,
      getMetadata:options.getMetadata, restoreMetadata:options.restoreMetadata,
    };
    const changed = () => {
      if (!editable(element) || element.innerHTML === record.html) return;
      const markdown = serialize(element);
      const previous = record.markdown;
      if (markdown !== previous) {
        const timestamp = Date.now(), before = record.beforeCaret, after = caret(element);
        const typing = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(record.inputType) && before?.start === before?.end;
        const continued = typing && record.group?.type === record.inputType && timestamp-record.group.time < 900 &&
          record.group.after?.start === before?.start && record.group.after?.end === before?.end;
        if (!continued) record.history.past.push({ text: previous, caret: before });
        record.history.future.length = 0;
        record.group = typing ? {type:record.inputType,time:timestamp,after} : null;
      }
      record.markdown = markdown;
      record.html = element.innerHTML;
      preserveSelection(element);
      if (markdown !== previous) options.onChange?.(markdown);
      options.onHistory?.();
    };
    const selected = () => {
      if (!element.isConnected) { record.cleanup(); return; }
      preserveSelection(element);
      if (selectedRange(element)) options.onSelection?.(selection(element));
    };
    const insertText = text => {
      if (!editable(element)) return;
      element.focus();
      record.group = null; record.inputType = null;
      record.beforeCaret = caret(element);
      text = text.replace(/\r\n?/g, '\n');
      // Chrome turns multiline insertText into extra empty block elements.
      // Escaped text plus line breaks preserves the pasted paragraph spacing.
      const multiline = text.includes('\n');
      if (!element.ownerDocument.execCommand(multiline ? 'insertHTML' : 'insertText', false,
          multiline ? escape(text).replace(/\n/g, '<br>') : text)) {
        const range = selectedRange(element);
        if (!range) return;
        range.deleteContents();
        const fragment = element.ownerDocument.createDocumentFragment();
        const lines = text.split(/\r?\n/);
        lines.forEach((line, index) => {
          if (index) fragment.append(element.ownerDocument.createElement('br'));
          fragment.append(element.ownerDocument.createTextNode(line));
        });
        const last = fragment.lastChild;
        range.insertNode(fragment);
        if (last) { range.setStartAfter(last); range.collapse(true); }
      }
      changed();
      if (multiline) replace(element, record.markdown, { notify:false, record:false, savedCaret:caret(element) });
      record.group = null;
    };
    const paste = event => {
      event.preventDefault();
      if (editable(element)) insertText(event.clipboardData?.getData('text/plain') || '');
    };
    const drop = event => {
      if (event.dataTransfer?.files.length) return;
      event.preventDefault();
      if (!editable(element)) return;
      const doc = element.ownerDocument;
      const caret = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
      if (caret && element.contains(caret.startContainer)) {
        const selected = doc.getSelection();
        selected.removeAllRanges(); selected.addRange(caret);
      }
      insertText(event.dataTransfer?.getData('text/plain') || '');
    };
    const beforeInput = event => {
      record.beforeCaret = caret(element);
      record.inputType = event.inputType;
      if (['historyUndo', 'historyRedo'].includes(event.inputType)) {
        event.preventDefault(); travel(element, event.inputType === 'historyUndo' ? 'undo' : 'redo'); return;
      }
      if (!editable(element) || ['insertFromPaste', 'insertFromDrop'].includes(event.inputType)) event.preventDefault();
    };
    const keydown = event => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); travel(element, event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.altKey && ['b', 'i'].includes(event.key.toLowerCase())) {
        event.preventDefault();
        command(element, event.key.toLowerCase() === 'b' ? 'bold' : 'italic');
      }
    };
    record.changed = changed;
    record.cleanup = () => {
      element.removeEventListener('input', changed);
      element.removeEventListener('paste', paste);
      element.removeEventListener('drop', drop);
      element.removeEventListener('beforeinput', beforeInput);
      element.removeEventListener('keydown', keydown);
      element.ownerDocument.removeEventListener('selectionchange', selected);
      mounts.delete(element);
    };
    mounts.set(element, record);
    element.addEventListener('input', changed);
    element.addEventListener('paste', paste);
    element.addEventListener('drop', drop);
    element.addEventListener('beforeinput', beforeInput);
    element.addEventListener('keydown', keydown);
    element.ownerDocument.addEventListener('selectionchange', selected);
    return record.cleanup;
  }

  function command(element, action) {
    if (!editable(element)) return false;
    if (action === 'undo' || action === 'redo') return travel(element, action);
    const commands = { bold: 'bold', italic: 'italic', bullet: 'insertUnorderedList', undo: 'undo', redo: 'redo' };
    if (!commands[action] && action !== 'heading') return false;
    const mounted = mounts.get(element);
    const range = selectedRange(element) || mounted?.range;
    element.focus();
    if (range && element.contains(range.startContainer) && element.contains(range.endContainer)) {
      const selected = element.ownerDocument.getSelection();
      selected.removeAllRanges(); selected.addRange(range);
    }
    const doc = element.ownerDocument;
    if (mounted) { mounted.beforeCaret = caret(element); mounted.group = null; mounted.inputType = null; }
    doc.execCommand('styleWithCSS', false, false);
    let success;
    if (action === 'heading') {
      const start = doc.getSelection()?.anchorNode;
      const current = start?.nodeType === 1 ? start : start?.parentElement;
      success = doc.execCommand('formatBlock', false, current?.closest('h2') ? 'p' : 'h2');
    } else success = doc.execCommand(commands[action], false);
    mounted?.changed();
    preserveSelection(element);
    return success;
  }

  window.FolioEditor = { render: markdown => parse(markdown).html, plainText, read, mount, command, selection, selectionMarkdown, selectionRange, preserveSelection, replace, highlight };
}());
