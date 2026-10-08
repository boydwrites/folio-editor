/* Real-browser checks for local rich-text editing. Synthetic text only.
 * Run: node --test folio/tests/test_editor.cjs
 * Set FOLIO_PLAYWRIGHT if Playwright isn't resolvable from this repository.
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { chromium } = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');

let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function editor(markdown) {
  const page = await browser.newPage();
  const requests = [];
  const errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.setContent('<!doctype html><html><body><div id="draft" contenteditable="true"></div><button id="toolbar">Toolbar</button></body></html>');
  await page.addScriptTag({ path: path.join(__dirname, '../static/editor.js') });
  await page.evaluate(markdown => {
    window.changes = [];
    window.selections = [];
    const element = document.querySelector('#draft');
    element.innerHTML = FolioEditor.render(markdown);
    FolioEditor.mount(element, {
      markdown,
      onChange: text => changes.push(text),
      onSelection: text => selections.push(text),
    });
    window.selectText = (from, to = from) => {
      const nodes = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode);
      const startNode = nodes.find(node => node.textContent.includes(from));
      const endNode = nodes.find(node => node.textContent.includes(to));
      if (!startNode || !endNode) throw new Error('Synthetic selection was not found');
      const range = document.createRange();
      range.setStart(startNode, startNode.textContent.indexOf(from));
      range.setEnd(endNode, endNode.textContent.indexOf(to) + to.length);
      const selected = getSelection();
      selected.removeAllRanges(); selected.addRange(range);
      FolioEditor.preserveSelection(element);
    };
  }, markdown);
  return { page, requests, errors, close: () => page.close() };
}

test('rendering shows a formatted document and mounting preserves the exact source', async () => {
  const markdown = '# Board notes — September 14, 2026\r\n\r\n## Finance\r\nRevenue was **$2.4m**, up *12.5%*. São Paulo approved €40,000.\r\nNext review: 10/19/2026.\r\n\r\n- No vote was held.\r\n- Ask María about Q4.\r\n\r\n3. First follow-up\r\n7. Second follow-up\r\n';
  const h = await editor(markdown);
  try {
    assert.equal(await h.page.locator('h1').innerText(), 'Board notes — September 14, 2026');
    assert.equal(await h.page.locator('h2').innerText(), 'Finance');
    assert.equal(await h.page.locator('strong').innerText(), '$2.4m');
    assert.equal(await h.page.locator('em').innerText(), '12.5%');
    assert.deepEqual(await h.page.locator('ol li').evaluateAll(items => items.map(item => item.value)), [3, 7]);
    assert.equal(await h.page.evaluate(() => FolioEditor.read(document.querySelector('#draft'))), markdown);
    await h.page.evaluate(() => selectText('Next review: 10/19/2026.'));
    assert.deepEqual(await h.page.evaluate(() => changes), []);
    assert.equal(await h.page.evaluate(() => FolioEditor.read(document.querySelector('#draft'))), markdown);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('selections spanning emphasis map to the exact source, including repeated wording', async () => {
  const markdown = 'The board reviewed the plan.\n\nThe board approved **the budget** and *next steps* today.';
  const h = await editor(markdown);
  try {
    const result = await h.page.evaluate(() => {
      selectText('The board approved', 'today.');
      const element = document.querySelector('#draft');
      return { plain: FolioEditor.selection(element), source: FolioEditor.selectionMarkdown(element) };
    });
    assert.equal(result.plain, 'The board approved the budget and next steps today.');
    assert.equal(result.source, 'The board approved **the budget** and *next steps* today.');
    assert.ok(markdown.includes(result.source));
    const bold = await h.page.evaluate(() => {
      selectText('the budget');
      return FolioEditor.selectionMarkdown(document.querySelector('#draft'));
    });
    assert.equal(bold, '**the budget**');
    assert.deepEqual(await h.page.evaluate(() => changes), []);
  } finally { await h.close(); }
});

test('formatting and undo retain figures, dates, Unicode, and literal Markdown characters', async () => {
  const h = await editor('Finance\n\nRevenue was $2.4m. María will follow up on October 19.\n\nLiteral \\*stars\\* and board_notes stay intact.');
  try {
    await h.page.evaluate(() => {
      selectText('$2.4m');
      document.querySelector('#toolbar').focus();
      FolioEditor.command(document.querySelector('#draft'), 'bold');
    });
    assert.equal(await h.page.locator('b, strong').innerText(), '$2.4m');
    assert.match(await h.page.evaluate(() => changes.at(-1)), /\*\*\$2\.4m\*\*/);
    assert.match(await h.page.evaluate(() => changes.at(-1)), /María will follow up on October 19/);
    await h.page.evaluate(() => FolioEditor.command(document.querySelector('#draft'), 'undo'));
    assert.equal(await h.page.locator('b, strong').count(), 0);
    await h.page.evaluate(() => FolioEditor.command(document.querySelector('#draft'), 'redo'));
    assert.equal(await h.page.locator('b, strong').innerText(), '$2.4m');
    await h.page.evaluate(() => { selectText('Finance'); FolioEditor.command(document.querySelector('#draft'), 'heading'); });
    assert.equal(await h.page.locator('h2').innerText(), 'Finance');
    await h.page.evaluate(() => FolioEditor.command(document.querySelector('#draft'), 'heading'));
    assert.equal(await h.page.locator('h2').count(), 0);
    await h.page.evaluate(() => { selectText('María'); FolioEditor.command(document.querySelector('#draft'), 'italic'); });
    await h.page.evaluate(() => { selectText('Literal'); FolioEditor.command(document.querySelector('#draft'), 'bullet'); });
    const final = await h.page.evaluate(() => {
      const element = document.querySelector('#draft');
      const text = FolioEditor.read(element);
      element.innerHTML = FolioEditor.render(text);
      return { text, visible: element.textContent };
    });
    assert.match(final.text, /\*María\*/);
    assert.match(final.visible, /Literal \*stars\* and board_notes stay intact/);
    assert.match(final.visible, /\$2\.4m/);
    assert.match(final.visible, /October 19/);
    assert.equal(await h.page.locator('ul li').count(), 1);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('normal edits are saved and formatted content survives a render/read cycle', async () => {
  const h = await editor('## Finance\n\nThe board approved **$40,000** on September 14.\n\n1. Confirm the plan\n2. Call María');
  try {
    await h.page.evaluate(() => { selectText('September 14'); });
    await h.page.keyboard.insertText('September 21');
    const markdown = await h.page.evaluate(() => FolioEditor.read(document.querySelector('#draft')));
    assert.match(markdown, /September 21/);
    assert.match(markdown, /\*\*\$40,000\*\*/);
    assert.match(markdown, /1\. Confirm the plan\n2\. Call María/);
    assert.equal((await h.page.evaluate(() => changes)).length, 1);
    const after = await h.page.evaluate(markdown => {
      const temporary = document.createElement('div');
      temporary.innerHTML = FolioEditor.render(markdown);
      return FolioEditor.read(temporary);
    }, markdown);
    assert.equal(after, markdown);
  } finally { await h.close(); }
});

test('nested bold and italic render together without losing words on reload', async () => {
  const h = await editor('*The **board** approved* **the *revised* budget** and ***next steps***.');
  try {
    assert.equal(await h.page.locator('#draft').innerText(), 'The board approved the revised budget and next steps.');
    assert.equal(await h.page.locator('em > strong').innerText(), 'board');
    assert.deepEqual(await h.page.locator('strong > em').allInnerTexts(), ['revised', 'next steps']);
    const result = await h.page.evaluate(() => {
      const element = document.querySelector('#draft');
      const temporary = document.createElement('div');
      temporary.innerHTML = element.innerHTML;
      const saved = FolioEditor.read(temporary);
      temporary.innerHTML = FolioEditor.render(saved);
      return temporary.textContent;
    });
    assert.equal(result, 'The board approved the revised budget and next steps.');
  } finally { await h.close(); }
});

test('raw HTML, rich clipboard content, and drops cannot execute code or request remote resources', async () => {
  const h = await editor('Confidential <img src="https://example.invalid/leak" onerror="window.pwned=1">\n\n[Private link](https://example.invalid/private)\n\n<script>window.pwned=2</script>');
  try {
    assert.equal(await h.page.locator('#draft img, #draft a, #draft script').count(), 0);
    await h.page.evaluate(() => {
      const element = document.querySelector('#draft');
      element.focus();
      const range = document.createRange();
      range.selectNodeContents(element); range.collapse(false);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      const clipboard = new DataTransfer();
      clipboard.setData('text/html', '<img src="https://example.invalid/clipboard" onerror="window.pwned=3"><b>Injected</b>');
      clipboard.setData('text/plain', '\nClipboard <script>window.pwned=4</script>\nRevenue: €40,000.');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
      const dropped = new DataTransfer();
      dropped.setData('text/html', '<img src="https://example.invalid/drop">');
      dropped.setData('text/plain', ' Safe drop.');
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dropped }));
    });
    assert.equal(await h.page.evaluate(() => window.pwned), undefined);
    assert.equal(await h.page.locator('#draft img, #draft a, #draft script').count(), 0);
    assert.match(await h.page.locator('#draft').innerText(), /Revenue: €40,000/);
    assert.match(await h.page.locator('#draft').innerText(), /Safe drop/);
    assert.deepEqual(h.requests, []);
    assert.deepEqual(h.errors, []);
  } finally { await h.close(); }
});

test('finalized documents ignore formatting, paste, and drop edits', async () => {
  const markdown = 'Locked **board notes**. Approved $40,000 on October 19.';
  const h = await editor(markdown);
  try {
    const result = await h.page.evaluate(() => {
      const element = document.querySelector('#draft');
      selectText('board notes');
      element.setAttribute('contenteditable', 'false');
      const command = FolioEditor.command(element, 'italic');
      const data = new DataTransfer(); data.setData('text/plain', 'Replace confidential text');
      element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      return { command, text: FolioEditor.read(element), changes };
    });
    assert.equal(result.command, false);
    assert.equal(result.text, markdown);
    assert.deepEqual(result.changes, []);
  } finally { await h.close(); }
});

test('source offsets preserve surrounding bytes for partial emphasis, lists, paragraphs and Unicode', async () => {
  const cases = [
    {text:'Café 😀 **before selected after** stays.',from:'selected',to:'selected',expected:'selected'},
    {text:'Café 😀 *before selected after* stays.',from:'selected',to:'selected',expected:'selected'},
    {text:'- Keep one\n- Change **two**\n- Keep three',from:'Change ',to:'two',expected:'Change **two**'},
    {text:'Keep first.\n\nStart café 😀.\n\nEnd naïve.\n\nKeep last.',from:'Start',to:'naïve.',expected:'Start café 😀.\n\nEnd naïve.'},
    {text:'Keep first.\r\n\r\n**Start bold** and *end italic* remain.\r\n\r\nKeep last.',from:'bold',to:'end',expected:'bold** and *end'},
  ];
  for(const item of cases) {
    const h=await editor(item.text);
    try {
      const selected=await h.page.evaluate(({from,to})=>{selectText(from,to);return FolioEditor.selectionRange(document.querySelector('#draft'));},item);
      assert.equal(selected.text,item.expected);
      assert.equal(Array.from(item.text).slice(selected.start,selected.end).join(''),item.expected);
      const before=Array.from(item.text).slice(0,selected.start).join(''),after=Array.from(item.text).slice(selected.end).join('');
      const replacement='replacement';
      await h.page.evaluate(text=>FolioEditor.replace(document.querySelector('#draft'),text),before+replacement+after);
      const actual=await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft')));
      assert.equal(actual,before+replacement+after);
      await h.page.evaluate(()=>FolioEditor.command(document.querySelector('#draft'),'undo'));
      assert.equal(await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft'))),item.text);
    } finally {await h.close();}
  }
});

test('multiline plain-text paste keeps paragraphs consistent before and after reload',async()=>{
  const h=await editor('');
  const text='Hi Alex,\n\nThanks for the conversation.\n\nBest,\nSam';
  try {
    await h.page.locator('#draft').focus();
    await h.page.evaluate(text=>{
      const data=new DataTransfer();data.setData('text/plain',text);
      document.querySelector('#draft').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));
    },text);
    assert.equal(await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft'))),text);
    const before=await h.page.locator('#draft').innerText();
    await h.page.evaluate(()=>{const e=document.querySelector('#draft');FolioEditor.replace(e,FolioEditor.read(e),{record:false});});
    assert.equal(await h.page.locator('#draft').innerText(),before);
    await h.page.evaluate(()=>FolioEditor.command(document.querySelector('#draft'),'undo'));
    assert.equal(await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft'))),'');
  }finally{await h.close();}
});
test('Undo groups continuous typing and keeps formatting and AI changes separate',async()=>{
  const h=await editor('');try{
    await h.page.locator('#draft').pressSequentially('A short sentence.');
    await h.page.keyboard.press('ControlOrMeta+z');assert.equal(await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft'))),'');
    await h.page.keyboard.press('ControlOrMeta+Shift+z');assert.equal(await h.page.locator('#draft').innerText(),'A short sentence.');
    await h.page.evaluate(()=>{selectText('short');FolioEditor.command(document.querySelector('#draft'),'bold');});
    await h.page.evaluate(()=>FolioEditor.replace(document.querySelector('#draft'),'A **clear** sentence.'));
    await h.page.keyboard.press('ControlOrMeta+z');assert.equal(await h.page.evaluate(()=>FolioEditor.read(document.querySelector('#draft'))),'A **short** sentence.');
    await h.page.keyboard.press('ControlOrMeta+z');assert.equal(await h.page.locator('#draft b,#draft strong').count(),0);
  }finally{await h.close();}
});
test('plain text strips formatting, preserves paragraph and list structure and literal characters',async()=>{
  const h=await editor('');try{
    const text=await h.page.evaluate(()=>FolioEditor.plainText('# Café\n\nA **bold** and *italic* thought.\n\n- One\n- Two\n\n3. Third\n4. Fourth\n\nLiteral \\*stars\\* and <tag>.'));
    assert.equal(text,'Café\n\nA bold and italic thought.\n\n- One\n- Two\n\n3. Third\n4. Fourth\n\nLiteral *stars* and <tag>.');
  }finally{await h.close();}
});
