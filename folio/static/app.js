'use strict';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const words = text => (window.FolioEditor.plainText(text || '', {lists:false}).trim().match(/\S+/g) || []).length;
const clip = (text, length) => text.length > length ? text.slice(0, length).trimEnd() + '…' : text;
const defaults = {font:'Aptos',fontSize:11,lineSpacing:1.15,margins:'standard',pageSize:'letter',includeDate:false,confidentiality:false,voice:'',editorVersion:2};
const W = window.FolioWorkspace, E = window.FolioEditor, D = window.FolioChanges;
const svg = paths => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
const icons = {
  chat:svg('<path d="M20 11.5a8 8 0 0 1-8 8H5l-3 2.5 1-5.5A8 8 0 1 1 20 11.5Z"/>'),
  revise:svg('<path d="m15 5 4 4M4 20l4.5-1L20 7.5a2.1 2.1 0 0 0-3.5-3.5L5 15.5z"/>'),
  send:svg('<path d="M12 19V5m-6 6 6-6 6 6"/>'),
  stop:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none"/></svg>',
  undo:svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo:svg('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  heading:svg('<path d="M6 5v14M16 5v14M6 12h10M19 19v-6l-1.5 1"/>'),
  bold:svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zm0 7h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic:svg('<path d="M18 5h-8M14 19H6M14.5 5l-5 14"/>'),
  list:svg('<path d="M10 6h10M10 12h10M10 18h10M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>'),
  upload:svg('<path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5v4h4M12 10.5v6m-2.5-2.5 2.5 2.5 2.5-2.5"/>'),
  copy:svg('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15H9"/>'),
  more:svg('<path d="M5 12h.01M12 12h.01M19 12h.01"/>'),
  panel:svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M14 4v16"/>'),
  plus:svg('<path d="M12 5v14M5 12h14"/>'),
  chevron:svg('<path d="m7 10 5 5 5-5"/>'),
  close:svg('<path d="M7 7l10 10M17 7 7 17"/>'),
  up:svg('<path d="m7 14 5-5 5 5"/>'),
  down:svg('<path d="m7 10 5 5 5-5"/>'),
  gear:svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>'),
  clock:svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  doc:svg('<path d="M14 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V7.5z"/><path d="M14 3.5v4h4"/>'),
  target:svg('<path d="M4 7V5.5A1.5 1.5 0 0 1 5.5 4H7M17 4h1.5A1.5 1.5 0 0 1 20 5.5V7M20 17v1.5a1.5 1.5 0 0 1-1.5 1.5H17M7 20H5.5A1.5 1.5 0 0 1 4 18.5V17M8 9h8M8 12h8M8 15h5"/>'),
};
const rewritePresets = [
  {label:'You decide',instruction:'Improve this however you think will help most.',auto:true},
  {label:'Tighten',instruction:'Tighten this. Cut repetition and filler, and keep my meaning, voice, and details.'},
  {label:'Clarify',instruction:'Make this clearer without changing its meaning or voice.'},
  {label:'Proofread',instruction:'Fix spelling, grammar, and punctuation only. Change nothing else.'},
  {label:'Smooth',instruction:'Improve the flow between sentences and paragraphs without changing the meaning or voice.'},
];
// "You decide" first asks the model to choose one improvement, then applies that choice as an ordinary revision.
const planInstruction = scope => `Do not rewrite anything yet. Read the ${scope==='selection'?'selected passage':'document'} and decide the single change that would most improve it for its reader as it stands now, taking my writing preferences into account. Build on the current text; never suggest restoring anything that is not in it. Reply with only that request, in one or two sentences, written as an instruction to an editor, for example: Cut the repeated point in the second paragraph and end on the deadline. Keep my meaning, facts, and voice.`;
function cleanPlan(text) {
  const first=String(text||'').split(/\n\s*\n/).map(part=>part.trim()).find(Boolean)||'';
  let plan=first.replace(/^[-*>\s]+/,'').replace(/^(\*\*)?(instruction|revision|request|plan|edit)(\*\*)?\s*:\s*(\*\*)?/i,'').replace(/\*\*/g,'').replace(/^["“']|["”']$/g,'').replace(/\s+/g,' ').trim();
  if(plan.length>400){const cut=plan.slice(0,400),end=Math.max(cut.lastIndexOf('. '),cut.lastIndexOf('; '));plan=end>80?cut.slice(0,end+1):cut.trimEnd()+'…';}
  return plan||'Tighten and clarify this while keeping my meaning, voice, and details.';
}
const starters = {
  discuss:['What is working here, and what is not?','Where might a reader get confused or lose interest?','Suggest three stronger openings.'],
  revise:['Make the opening stronger.','Cut this by about a third.','Make this sound more like me.'],
};
const pref = {
  get(key,fallback){try{const value=localStorage.getItem('folio-'+key);return value===null?fallback:JSON.parse(value);}catch{return fallback;}},
  set(key,value){try{if(value===null)localStorage.removeItem('folio-'+key);else localStorage.setItem('folio-'+key,JSON.stringify(value));}catch{}},
};
let state = {sessions:[],examples:[],settings:{...defaults}}, token = '', models = [], runtime = {};
let activeId = null, selection = null, generation = null, cleanup = null, saveTimer, toastTimer, modalFocus;
let mobileAssistant = false, assistantHidden = pref.get('assistant-hidden',false), panelView = 'chat', reviewing = null;
let statusText = 'Saved', exporting = false, emptyStateKey = '';
const histories = new Map();
let generationTimer, importing = false, documentMutation = false;
const comparisonCache = new Map();
const active = () => state.sessions.find(s => s.id === activeId && !s.deletedAt);
const saver = W.createSaver(() => state, snapshot => api('/api/state', snapshot), text => {statusText = text; updateStatus();});
const narrow = () => matchMedia('(max-width:900px)').matches;

function duration(ms) {
  const seconds=Math.max(0,Math.round(ms/1000));
  return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;
}
// Completed requests read "under 1s" rather than a misleading "0s".
const tookText = (ms, verb='took') => `${verb} ${ms<1000?'under 1s':duration(ms)}`;
function clock(iso) {
  const date=new Date(iso),today=new Date();if(Number.isNaN(date.getTime()))return '';
  const time=date.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
  return date.toDateString()===today.toDateString()?time:`${date.toLocaleDateString([], {month:'short',day:'numeric'})}, ${time}`;
}
function dayLabel(iso) {
  const date=new Date(iso),today=new Date(),yesterday=new Date(Date.now()-864e5);
  if(date.toDateString()===today.toDateString())return 'Today';
  if(date.toDateString()===yesterday.toDateString())return 'Yesterday';
  return date.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'});
}
async function api(path, body) {
  const response = await fetch(path, {method:body === undefined ? 'GET' : 'POST', headers:{'X-Folio-Token':token,...(body === undefined ? {} : {'Content-Type':'application/json'})},...(body === undefined ? {} : {body:JSON.stringify(body)})});
  if (!response.ok) {
    let message = 'The local request failed. Please try again.';
    try {message = (await response.json()).error || message;} catch {}
    throw new Error(message);
  }
  return response;
}
function notice(text) {
  $('#toast').textContent = text; $('#toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => {$('#toast').hidden = true;}, 4500);
}
function queueSave() {
  if (active()) active().updatedAt = now();
  saver.change(); clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveState().catch(error => notice(error.message)), 450);
}
function saveState() {clearTimeout(saveTimer); return saver.flush();}
// The desktop host awaits this before closing its window and server. Keeping
// the save in the editor also preserves drafts in open preference dialogs.
window.FolioDesktop = {
  async prepareToQuit() {
    if (!token) return true;
    if (exporting || importing || documentMutation) throw new Error('Wait for the current import or export to finish, then quit again.');
    document.documentElement.inert = true;
    try {
      if (generation) {
        await cancelGeneration();
        const deadline = Date.now() + 10000;
        while (generation && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
        if (generation) throw new Error('The current request is still stopping. Please try quitting again.');
      }
      await saveState();
      return true;
    } catch (error) {document.documentElement.inert = false; throw error;}
  },
};
function updateStatus() {
  const button=$('#save-status');
  if (button) {button.textContent = statusText; button.classList.toggle('is-error', statusText.startsWith('Not saved'));}
  if ($('#example-save-status')) $('#example-save-status').textContent = statusText==='Saved'?'Draft saved':statusText;
}
function normalize(session) {
  session.draft ||= ''; session.source ||= ''; session.history ||= []; session.versions ||= [];
  session.edits ||= []; session.feedback ||= ''; session.status ||= 'draft'; session.title ||= 'Untitled document';
  if(!['discuss','revise'].includes(session.composerMode))session.composerMode=session.feedback?'revise':'discuss';
  session.composerDrafts ||= {[session.composerMode]:session.feedback};
  session.feedback=session.composerDrafts[session.composerMode] || '';
}
function setComposerText(session,mode,text) {
  session.composerDrafts[mode]=text;
  if(session.composerMode===mode){session.feedback=text;if(activeId===session.id&&$('#feedback')&&$('#feedback').value!==text){$('#feedback').value=text;fitComposer();}}
}
function setComposerMode(mode) {
  const s=active();if(s.composerMode===mode)return;
  s.composerMode=mode;s.feedback=s.composerDrafts[mode]||'';$('#feedback').value=s.feedback;fitComposer();
  queueSave();updateComposer();if(!s.history.length)renderConversation();
}
function fitComposer() {
  const box=$('#feedback');if(!box)return;
  box.style.height='auto';box.style.height=Math.min(box.scrollHeight+2,Math.max(160,innerHeight*.4))+'px';
}
function updateComposer() {
  const s=active();if(!s||!$('#submit-request'))return;
  const editing=s.composerMode==='revise',locked=s.status==='final',preset=rewritePresets.find(p=>p.instruction===s.feedback);
  $('.composer').dataset.mode=s.composerMode;
  $('.workspace').dataset.composerMode=s.composerMode;
  $$('button[data-composer-mode]').forEach(button=>{const chosen=button.dataset.composerMode===s.composerMode;button.setAttribute('aria-selected',String(chosen));button.tabIndex=chosen?0:-1;});
  $('#composer-panel').setAttribute('aria-labelledby',editing?'revise-tab':'chat-tab');
  $('#quick-edit-presets').hidden=!editing;
  $$('[data-preset]').forEach((button,i)=>{button.setAttribute('aria-pressed',String(s.feedback===rewritePresets[i].instruction));button.disabled=locked;});
  const blank=!s.draft.trim();
  $('#feedback').placeholder=blank?'Add some writing to the document first':editing?(locked?'Unlock the document to revise it':selection?'Describe a change to the selected passage':'Describe a change to your document'):selection?'Ask about the selected passage':'Ask about your writing';
  $('#feedback').setAttribute('aria-label',editing?'Revision request':'Message');
  $('#feedback').setAttribute('aria-describedby','request-status');
  $('#choose-scope').disabled=blank;
  const submit=$('#submit-request'),target=selection?'selection':'document';
  submit.classList.toggle('is-labeled',editing);
  // The scope row above the request names the target, so the button stays short.
  submit.innerHTML=editing?`${icons.revise}<span>${locked?'Locked':preset?.label||'Revise'}</span>`:icons.send;
  submit.setAttribute('aria-label',editing?(locked?'Document locked':`${preset?.label||'Revise'} ${target}`):'Send message');
  submit.title=blank?'The document is empty':editing?'Revise (Enter)':'Send (Enter)';
  submit.disabled=!!generation || (editing&&locked) || !s.feedback.trim() || blank || !!selection?.invalid;
  submit.hidden=!!generation;
}
function newSession() {
  const session = {id:uid(),title:'Untitled document',date:'',source:'',draft:'',history:[],versions:[],status:'draft',feedback:'',createdAt:now(),updatedAt:now()};
  state.sessions.unshift(session); activeId = session.id; selection = null; reviewing = null;
  queueSave(); render(); $('#draft').focus();return session;
}
function render() {
  cleanup?.(); cleanup = null;
  const s = active(); if (!s) return;
  normalize(s);
  if(!selection&&s.editingScope){const scope=s.editingScope;selection={...scope,base:s.draft,plain:E.plainText(scope.text),invalid:scope.invalid||Array.from(s.draft).slice(scope.start,scope.end).join('')!==scope.text};}
  try {sessionStorage.setItem('folio-active', activeId);} catch {}
  $('#app').innerHTML = `
    <header class="app-header">
      <a class="wordmark" href="#" aria-label="Folio home">Folio<span>.</span></a>
      <nav class="header-left" aria-label="Main"><button class="header-button" data-action="documents">Documents</button><button class="header-button" data-action="new" title="New document">${icons.plus}<span>New</span></button></nav>
      <nav class="header-right" aria-label="Tools"><button class="header-button" data-action="style" aria-label="Writing style"><span class="label-long">Writing style</span><span class="label-short">Style</span></button><button class="header-button" data-action="settings" aria-label="Settings"><span class="icon-narrow">${icons.gear}</span><span class="label-long">Settings</span></button><button class="button primary" data-action="export">Export</button><button class="icon-button panel-toggle" data-action="assistant" aria-label="Show or hide the assistant" title="Show or hide the assistant">${icons.panel}</button></nav>
    </header>
    <main class="workspace">
      <section class="writing" aria-label="Document">
        <div class="document-heading"><input id="document-title" aria-label="Document title" maxlength="160" value="${esc(s.title)}"></div>
        <div class="editor-toolbar" role="toolbar" aria-label="Text formatting">
          <div class="format-buttons"><button class="icon-button" data-format="undo" aria-label="Undo" title="Undo (⌘Z)">${icons.undo}</button><button class="icon-button" data-format="redo" aria-label="Redo" title="Redo (⌘⇧Z)">${icons.redo}</button><span class="divider"></span><button class="icon-button" data-format="heading" aria-label="Heading" title="Heading">${icons.heading}</button><button class="icon-button" data-format="bold" aria-label="Bold" title="Bold (⌘B)">${icons.bold}</button><button class="icon-button" data-format="italic" aria-label="Italic" title="Italic (⌘I)">${icons.italic}</button><button class="icon-button" data-format="bullet" aria-label="Bulleted list" title="Bulleted list">${icons.list}</button></div>
          <div class="document-tools"><button class="tool-button" data-action="import" aria-label="Import" title="Import a Word, PDF, text, or Markdown file">${icons.upload}<span>Import</span></button><button class="tool-button" data-action="copy" aria-label="Copy" title="Copy the text">${icons.copy}<span>Copy</span></button><button class="icon-button" data-action="details" aria-label="Document options" title="Document options">${icons.more}</button></div>
        </div>
        <div id="document-notice" role="status"></div>
        <div id="review-bar" class="review-bar" role="region" aria-label="Changes" hidden></div>
        <div class="editor-scroll">
          <div id="draft" class="document-editor" contenteditable="${s.status !== 'final'}" role="textbox" aria-label="Document text" aria-multiline="true" spellcheck="false">${E.render(s.draft)}</div>
          <div id="empty-start" class="empty-start" hidden><button class="button secondary" data-action="import">${icons.upload}<span>Import a file</span></button><span>Word, PDF, text, or Markdown. You can also drop a file here.</span></div>
          <article id="change-view" class="document-editor change-view" aria-label="Changes in the document" hidden></article>
        </div>
        <footer class="document-footer"><span id="word-count">${words(s.draft)} words</span><span id="document-activity" role="status"></span><button class="save-status" id="save-status" data-action="save" title="Changes save automatically on this Mac">${statusText}</button><button class="mobile-assistant-toggle" data-action="assistant">${icons.chat}<span>Assistant</span></button></footer>
      </section>
      <div class="splitter" role="separator" aria-orientation="vertical" aria-label="Resize assistant" tabindex="0" title="Drag to resize. Double-click to reset."></div>
      <aside id="assistant" class="assistant" aria-label="Writing assistant">
        <div class="assistant-heading">
          <div class="panel-tabs" role="tablist" aria-label="Assistant view"><button role="tab" id="panel-chat" data-panel="chat" aria-controls="conversation">Conversation</button><button role="tab" id="panel-history" data-panel="history" aria-controls="history-panel">History</button></div>
          <button class="header-button subtle" data-action="clear-chat" aria-label="Clear conversation">Clear</button>
          <button class="icon-button assistant-close" data-action="assistant" aria-label="Close assistant">${icons.close}</button>
        </div>
        <div id="conversation" class="conversation" role="tabpanel" aria-labelledby="panel-chat" aria-live="polite"></div>
        <div id="history-panel" class="history-panel" role="tabpanel" aria-labelledby="panel-history" hidden></div>
        <div class="composer">
          <div id="quick-edit-presets" class="quick-edit-presets" role="group" aria-label="Revision presets" hidden>${rewritePresets.map((p,i)=>`<button data-preset="${i}" aria-pressed="false" title="${esc(p.instruction)}">${esc(p.label)}</button>`).join('')}</div>
          <div id="composer-panel" class="composer-box" role="tabpanel">
            <div class="composer-scope">
              <button id="choose-scope" class="scope-button" title="Work on one section">${icons.doc}<span>Whole document</span>${icons.chevron}</button>
              <div id="selection-context" hidden></div>
            </div>
            <textarea id="feedback" aria-label="Message" placeholder="Ask about your writing" rows="1">${esc(s.feedback)}</textarea>
            <div class="composer-row">
              <div class="composer-modes" role="tablist" aria-label="Assistant mode">
                <button id="chat-tab" role="tab" data-composer-mode="discuss" aria-controls="composer-panel" title="Talk about your writing. The document stays as it is.">${icons.chat}<span>Chat</span></button>
                <button id="revise-tab" role="tab" data-composer-mode="revise" aria-controls="composer-panel" title="Change the document. Every edit can be undone.">${icons.revise}<span>Revise</span></button>
              </div>
              <button class="send-button" id="submit-request"></button>
              <button class="send-button stop" id="stop-button" aria-label="Stop" title="Stop" hidden>${icons.stop}</button>
            </div>
          </div>
          <div id="request-status" role="status" aria-live="polite"></div>
        </div>
      </aside>
    </main>`;
  $('.wordmark').onclick = event => {event.preventDefault(); closeReview(); $('#draft').focus();};
  $$('[data-action]').forEach(button => button.onclick = () => action(button.dataset.action));
  $('#document-title').oninput = event => {s.title = event.target.value; queueSave();};
  $('#document-title').onblur = event => {s.title = s.title.trim() || 'Untitled document'; event.target.value = s.title; queueSave();};
  $('#document-title').onkeydown = event => {if (event.key === 'Enter') {event.preventDefault(); $('#draft').focus();}};
  const editor = $('#draft');
  if (!histories.has(s.id)) histories.set(s.id, {past:[],future:[]});
  cleanup = E.mount(editor, {markdown:s.draft,history:histories.get(s.id),getMetadata:()=>({title:s.title,date:s.date}),restoreMetadata:meta=>{s.title=meta.title;s.date=meta.date;$('#document-title').value=s.title;queueSave();},onChange:text => {
    s.draft = text;
    if (selection) selection = {...selection,invalid:true};
    queueSave(); updateContext(); updateDocument(); updateEditCards();
  },onSelection:plain => {
    if (plain) selection = E.selectionRange(editor) || {plain,invalid:true};
    else selection = null;
    updateContext();
  },onHistory:updateDocument});
  $$('[data-format]').forEach(button => {
    button.onmousedown = event => event.preventDefault();
    button.onclick = () => {
      if(reviewing&&!['undo','redo'].includes(button.dataset.format))closeReview();
      const travel=['undo','redo'].includes(button.dataset.format),before=travel?s.edits.map(edit=>editState(s,edit)):null;
      const changed=E.command(editor,button.dataset.format);
      if(changed&&travel){
        // Typing undo is silent, as in any editor. Moving across an AI revision is worth naming.
        const moved=s.edits.findIndex((edit,i)=>editState(s,edit)!==before[i]);
        if(moved>=0)notice(editState(s,s.edits[moved])==='current'?'AI revision reapplied.':'AI revision undone.');
      }
      updateDocument();
    };
  });
  $('#change-view').onclick = event => {if(!event.target.closest('button'))closeReview({x:event.clientX,y:event.clientY});};
  // Clicking the blank page below the text continues writing at the end. A drag that
  // selects text and ends in the margin also "clicks" here, so only a press that began
  // on the blank page, with nothing selected, counts.
  let pressedBlank=false;
  $('.editor-scroll').onpointerdown = event => {pressedBlank=event.target===event.currentTarget;};
  $('.editor-scroll').onclick = event => {
    if(!pressedBlank||event.target!==event.currentTarget||!getSelection().isCollapsed||reviewing||s.status==='final')return;
    editor.focus();const range=document.createRange();range.selectNodeContents(editor);range.collapse(false);
    const selected=getSelection();selected.removeAllRanges();selected.addRange(range);
  };
  $('#feedback').oninput = event => {setComposerText(s,s.composerMode,event.target.value);fitComposer();queueSave();updateComposer();if(active().lastError){active().lastError='';updateGeneration();}};
  $('#feedback').onkeydown = event => {
    if (event.key !== 'Enter' || event.isComposing || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (!$('#submit-request').disabled) generate(s.composerMode);
    else if (!s.draft.trim() && s.feedback.trim()) notice('Add some writing to the document first.');
  };
  $('#choose-scope').onclick = scopeModal;
  $('#submit-request').onclick = () => generate(s.composerMode);
  $('#stop-button').onclick = cancelGeneration;
  $$('button[data-composer-mode]').forEach(button=>button.onclick=()=>setComposerMode(button.dataset.composerMode));
  const arrows=(list,select)=>event=>{
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    event.preventDefault();const tabs=$$('button[role=tab]',list),i=tabs.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(i+(event.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
    select(tabs[next]);tabs[next].focus();
  };
  $('.composer-modes').onkeydown=arrows($('.composer-modes'),tab=>setComposerMode(tab.dataset.composerMode));
  $('.panel-tabs').onkeydown=arrows($('.panel-tabs'),tab=>showPanel(tab.dataset.panel));
  $$('[data-panel]').forEach(button=>button.onclick=()=>showPanel(button.dataset.panel));
  $$('[data-preset]').forEach(button=>button.onclick=()=>{
    const preset=rewritePresets[Number(button.dataset.preset)];
    if(s.feedback===preset.instruction){setComposerText(s,'revise',s.revisionBeforePreset||'');delete s.revisionBeforePreset;}
    else {if(!rewritePresets.some(p=>p.instruction===s.feedback))s.revisionBeforePreset=s.feedback;setComposerText(s,'revise',preset.instruction);}
    queueSave();updateComposer();$('#feedback').focus();
  });
  editor.addEventListener('dragover',event => {if (event.dataTransfer.types.includes('Files')) event.preventDefault();});
  editor.addEventListener('drop',event => {if (event.dataTransfer.files.length) {event.preventDefault(); importFile(event.dataTransfer.files[0]).catch(e => notice(e.message));}});
  bindSplitter();
  // When the composer grows (a selection, presets, a longer request), keep the latest turn in view.
  const conversation=$('#conversation');let pinned=true;
  conversation.addEventListener('scroll',()=>{pinned=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<60;},{passive:true});
  const resizer=new ResizeObserver(()=>{if(pinned)conversation.scrollTop=conversation.scrollHeight;});resizer.observe(conversation);
  const unmount=cleanup;cleanup=()=>{unmount?.();resizer.disconnect();};
  updateContext(); renderConversation(); showPanel(panelView); updateDocument(); updateGeneration(); updateAssistantPanel(); fitComposer();
}
function bindSplitter() {
  const handle=$('.splitter'),workspace=$('.workspace');
  const apply=px=>{
    if(px===null){workspace.style.removeProperty('--assistant-width');return null;}
    const width=Math.round(Math.min(workspace.clientWidth-420,Math.max(340,px)));
    workspace.style.setProperty('--assistant-width',width+'px');return width;
  };
  let width=apply(pref.get('assistant-width',null));
  handle.onpointerdown=event=>{
    event.preventDefault();handle.setPointerCapture(event.pointerId);workspace.classList.add('is-resizing');
    handle.onpointermove=move=>{width=apply(workspace.getBoundingClientRect().right-move.clientX);};
    handle.onpointerup=()=>{handle.onpointermove=null;workspace.classList.remove('is-resizing');pref.set('assistant-width',width);};
  };
  handle.onkeydown=event=>{
    if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
    event.preventDefault();width=apply($('#assistant').getBoundingClientRect().width+(event.key==='ArrowLeft'?32:-32));pref.set('assistant-width',width);
  };
  handle.ondblclick=()=>{width=apply(null);pref.set('assistant-width',null);};
}
function showPanel(view) {
  panelView=view;
  $$('[data-panel]').forEach(tab=>{const chosen=tab.dataset.panel===view;tab.setAttribute('aria-selected',String(chosen));tab.tabIndex=chosen?0:-1;});
  $('#conversation').hidden=view!=='chat';$('.composer').hidden=view!=='chat';
  $('#history-panel').hidden=view!=='history';$('[data-action="clear-chat"]').hidden=view!=='chat'||!active()?.history.length;
  if(view==='history')renderHistory();
}
function updateDocument() {
  const s = active(); if (!s || !$('#draft')) return;
  $('#word-count').textContent = `${words(s.draft)} ${words(s.draft)===1?'word':'words'}`;
  $('#draft').classList.toggle('is-empty', !s.draft.trim());
  $('#empty-start').hidden = !!s.draft.trim() || s.status === 'final';
  const history = histories.get(s.id);
  $('[data-format="undo"]').disabled = s.status === 'final' || !history?.past.length;
  $('[data-format="redo"]').disabled = s.status === 'final' || !history?.future.length;
  $$('[data-format]').filter(b => !['undo','redo'].includes(b.dataset.format)).forEach(b => b.disabled = s.status === 'final');
  $('#draft').contentEditable = String(s.status !== 'final');
  $('#document-title').readOnly = s.status === 'final';
  const box = $('#document-notice');
  box.innerHTML = s.status === 'final' ? '<span>Locked</span><button data-unlock>Unlock to edit</button>' : '';
  box.hidden = s.status !== 'final';
  $('[data-unlock]')?.addEventListener('click', () => action('unlock'));
  renderReview();
  updateGeneration();
  if(!s.history.length&&!generation&&emptyStateKey!==[s.id,s.composerMode,!s.draft.trim(),s.status].join())renderConversation();
}
function updateContext() {
  const box = $('#selection-context'); if (!box) return;
  const text = selection ? (selection.plain || selection.text || '').replace(/\s+/g,' ').trim() : '';
  box.innerHTML = selection ? `<div class="scope-chip ${selection.invalid?'is-invalid':''}">${icons.target}<span class="scope-chip-label">${selection.invalid ? 'Selection changed' : esc(selection.label || 'Selection')}</span><span class="scope-chip-text">${selection.invalid ? 'Select it again, or clear it' : esc(clip(text,140))}</span><button class="icon-button" aria-label="Clear selection" title="Use the whole document">${icons.close}</button></div>` : '';
  box.hidden = !selection;
  if ($('#choose-scope')) $('#choose-scope').hidden = !!selection;
  $('button',box)?.addEventListener('click', () => {selection = null; updateContext(); $('#feedback').focus();});
  E.highlight?.($('#draft'),selection);
  const savedScope=selection?{start:selection.start,end:selection.end,text:selection.text||selection.plain||'',label:selection.label||'',invalid:!!selection.invalid}:null;
  if(JSON.stringify(active().editingScope||null)!==JSON.stringify(savedScope)){active().editingScope=savedScope;queueSave();}
  updateGeneration();
}
function scopeModal() {
  const draft=active().draft, headings=[...draft.matchAll(/^(#{1,3})[ \t]+(.+)$/gm)];
  modal('Work on a section',`<div class="document-list"><button class="document-row" id="scope-all"><strong>Whole document</strong><span>${words(draft)} words</span></button>${headings.map((h,i)=>`<button class="document-row ${h[1].length>1?'is-nested':''}" data-section="${i}"><strong>${esc(h[2])}</strong><span>Heading and everything under it</span></button>`).join('')}</div>${headings.length?'<p class="muted">You can also highlight any passage in the document.</p>':'<p class="muted">This document has no headings. Highlight any passage in the document to work on just that part.</p>'}`);
  $('#scope-all').onclick=()=>{selection=null;closeModal();updateContext();$('#feedback').focus();};
  $$('[data-section]').forEach(b=>b.onclick=()=>{
    const i=Number(b.dataset.section),h=headings[i],next=headings.slice(i+1).find(n=>n[1].length<=h[1].length);
    const text=draft.slice(h.index,next?.index??draft.length).trimEnd(),start=Array.from(draft.slice(0,h.index)).length;
    selection={base:draft,start,end:start+Array.from(text).length,text,plain:E.plainText(text),label:h[2]};
    closeModal();updateContext();$('#feedback').focus();
  });
}
function formatDetails(before,after) {
  const count=text=>{const node=document.createElement('div');node.innerHTML=E.render(text);return Object.fromEntries(['h1','h2','h3','ul li','ol li','strong','em'].map(tag=>[tag,node.querySelectorAll(tag).length]));};
  const a=count(before),b=count(after),labels={'h1':'title heading','h2':'section heading','h3':'subheading','ul li':'bullet point','ol li':'numbered item','strong':'bold passage','em':'italic passage'};
  const details=Object.keys(a).filter(key=>a[key]!==b[key]).map(key=>{const delta=b[key]-a[key],n=Math.abs(delta);return `${n} ${labels[key]}${n===1?'':'s'} ${delta>0?'added':'removed'}`;});
  return details.length?details.join(' · '):'Spacing or emphasis updated';
}
function comparison(s,edit) {
  if(comparisonCache.has(edit.id))return comparisonCache.get(edit.id);
  const {before,after}=W.editTexts(s,edit);
  if(before===undefined||after===undefined)return null;
  const parts=D.diff(before,after),counts=D.summary(parts);
  const visible=text=>E.plainText(text,{lists:false}).replace(/\s+/g,' ').trim();
  const formatting=visible(before)===visible(after);
  const data={before,after,parts,counts,formatting,formatDetails:formatting?formatDetails(before,after):'',summary:formatting?'Formatting only · wording unchanged':`${counts.added} ${counts.added===1?'word':'words'} added · ${counts.removed} removed`};
  comparisonCache.set(edit.id,data);return data;
}
function editState(s,edit) {
  const texts=W.editTexts(s,edit);
  return s.draft===texts.after?'current':s.draft===texts.before?'undone':'later';
}
function editTarget(edit) {return edit.scope==='selection'?(edit.scopeLabel?`“${edit.scopeLabel}”`:'the selection'):'the document';}
function changeCounts(c) {
  return c.formatting?`<span>${esc(c.formatDetails)}</span>`:`<span class="count-add">+${c.counts.added}</span><span class="count-remove">−${c.counts.removed}</span><span>words</span>`;
}
function editCard(s,edit) {
  const c=comparison(s,edit);if(!c)return '';
  const current=editState(s,edit),showing=reviewing?.kind==='edit'&&reviewing.id===edit.id;
  const badge=current==='undone'?'<span class="badge">Undone</span>':current==='later'?'<span class="badge" title="You have changed the document since this edit">Edited since</span>':'';
  return `<div class="edit-card is-${current}" data-receipt="${esc(edit.id)}"><div class="edit-card-head">${icons.revise}<strong>Revised ${esc(editTarget(edit))}</strong>${badge}</div><div class="change-counts">${changeCounts(c)}</div><div class="edit-card-actions"><button class="chip-button ${showing?'is-active':''}" data-review="${esc(edit.id)}" aria-pressed="${showing}">${showing?'Showing changes':'Show changes'}</button><button class="chip-button" data-revert="${esc(edit.id)}" ${s.status==='final'||generation?'disabled':''} ${current==='later'?'title="You have written since this edit. Opens the changes, where you can restore the version from before it."':''}>${current==='undone'?'Reapply edit':current==='later'?'Undo…':'Undo edit'}</button></div></div>`;
}
function bindEditActions(root=document) {
  $$('[data-review]',root).forEach(b=>b.onclick=()=>{
    const id=b.dataset.review;
    if(reviewing?.kind==='edit'&&reviewing.id===id){closeReview();return;}
    openReview({kind:'edit',id});
  });
  $$('[data-revert]',root).forEach(b=>b.onclick=()=>revertEdit(b.dataset.revert));
}
let historyFrame;
function updateEditCards() {
  const s=active();if(!s)return;
  $$('[data-receipt]').forEach(el=>{const edit=s.edits.find(e=>e.id===el.dataset.receipt);if(edit)el.outerHTML=editCard(s,edit);});
  bindEditActions($('#conversation'));
  cancelAnimationFrame(historyFrame);historyFrame=requestAnimationFrame(renderHistory);
}
// The passage a request was about, shown as a small formatted excerpt with its own paragraphs.
function quoteMarkup(text) {
  const long=E.plainText(text).length>220||(text.match(/\n\s*\n/g)||[]).length>1;
  return `<figure class="request-quote ${long?'is-clamped':''}"><figcaption>Selected passage</figcaption><div class="request-quote-text">${E.render(text)}</div><button class="quote-toggle" data-quote-toggle aria-expanded="false" ${long?'':'hidden'}>Show all</button></figure>`;
}
function turnMarkup(s,message,index) {
  const time=message.at?`<time datetime="${esc(message.at)}">${clock(message.at)}</time>`:'';
  if(message.role==='user') {
    const mode=message.mode==='discuss'?'Chat':message.mode==='revise'?'Revise':'';
    const target=message.scope==='selection'?'selection':message.scope?'document':'';
    return `<div class="turn turn-user">${message.selection?quoteMarkup(message.selection):''}<div class="bubble">${esc(message.content)}</div><div class="turn-meta">${[mode&&target?`${mode} · ${target}`:mode,time].filter(Boolean).join(' · ')}</div></div>`;
  }
  const took=Number.isFinite(message.durationMs)?`<span class="took">${tookText(message.durationMs,message.status==='failed'?'after':'took')}</span>`:'';
  const meta=[took,time].filter(Boolean).join('<span aria-hidden="true"> · </span>');
  const plan=message.plan?`<p class="plan-note"><strong>Folio decided:</strong> ${esc(message.plan)}</p>`:'';
  // A request you stopped yourself is not a problem, and its text is already back in the composer.
  if(message.stopped)return `<div class="turn turn-assistant">${plan}<p class="stopped-note">${esc(message.content)}</p><div class="turn-meta">${meta}</div></div>`;
  if(message.status==='failed'||message.status==='stale') {
    const last=index===s.history.length-1;
    return `<div class="turn turn-assistant">${plan}<div class="problem-card"><p>${esc(message.content)}</p>${last&&!generation?`<button class="chip-button" data-retry="${index}">Try again</button>`:''}</div><div class="turn-meta">${meta}</div></div>`;
  }
  if(message.unchanged||/^No changes\. The result matched your current text/.test(message.content))return `<div class="turn turn-assistant">${plan}<p class="outcome-note">${esc(message.unchanged?message.content:'Folio\'s revision matched your current text, so nothing was changed.')}</p><div class="turn-meta">${meta}</div></div>`;
  const edit=message.editId&&s.edits.find(e=>e.id===message.editId);
  const body=edit?editCard(s,edit):`<div class="message-body">${E.render(message.content)}</div>`;
  const copy=edit?'':`<button class="meta-button" data-copy="${index}">Copy</button>`;
  return `<div class="turn turn-assistant">${plan}${body}<div class="turn-meta">${meta}${copy}</div></div>`;
}
function liveMarkup() {
  const discuss=generation.mode==='discuss';
  return `<div class="turn turn-assistant live-message"><div class="live-status"><span class="working-dot"></span><strong id="live-status"></strong><span class="elapsed" id="live-elapsed"></span></div>${discuss?`<div class="message-body live-answer" id="live-response">${esc(generation.live)}</div>`:`<details class="live-preview"><summary id="live-summary">Preview</summary><div id="live-response">${esc(generation.live)}</div></details>`}<p class="live-note" id="live-note"></p></div>`;
}
function renderConversation() {
  const box = $('#conversation'); if (!box) return;
  const s=active(),mode=s.composerMode,blank=!s.draft.trim(),locked=mode==='revise'&&s.status==='final';
  emptyStateKey=[s.id,mode,blank,s.status].join();
  const intro=blank?'Write, paste, or import something, then ask about it or revise it here.':locked?'This document is locked. Unlock it to revise.':mode==='revise'?'Changes appear marked in your document. Any edit can be undone.':'Highlight a passage to ask about just that part.';
  box.innerHTML = s.history.map((message,index)=>turnMarkup(s,message,index)).join('') || `<div class="assistant-empty"><h3>${mode==='revise'?'What should change?':'Ask about your writing'}</h3><p>${intro}</p>${blank?'':`<div class="starter-prompts">${starters[mode].map(text=>`<button data-starter="${esc(text)}" ${locked?'disabled':''}>${esc(text)}</button>`).join('')}</div>`}</div>`;
  if (generation?.sessionId === activeId) box.insertAdjacentHTML('beforeend',liveMarkup());
  bindEditActions(box);
  $$('[data-starter]',box).forEach(b=>b.onclick=()=>{setComposerText(s,s.composerMode,b.dataset.starter);queueSave();updateComposer();$('#feedback').focus();});
  $$('[data-copy]',box).forEach(b=>b.onclick=async()=>{try{await navigator.clipboard.writeText(E.plainText(s.history[Number(b.dataset.copy)].content));b.textContent='Copied';setTimeout(()=>{if(b.isConnected)b.textContent='Copy';},1500);}catch(e){notice(e.message);}});
  $$('[data-retry]',box).forEach(b=>b.onclick=()=>retry(Number(b.dataset.retry)));
  // Offer "Show all" only when the quote is actually cut off at this panel width.
  $$('.request-quote',box).forEach(quote=>{
    const text=$('.request-quote-text',quote);if(!text.getClientRects().length)return;
    quote.classList.add('is-clamped');const cut=text.scrollHeight>text.clientHeight+2;
    quote.classList.toggle('is-clamped',cut);$('[data-quote-toggle]',quote).hidden=!cut;
  });
  $$('[data-quote-toggle]',box).forEach(b=>b.onclick=()=>{const open=b.closest('.request-quote').classList.toggle('is-open');b.textContent=open?'Show less':'Show all';b.setAttribute('aria-expanded',String(open));});
  if($('[data-action="clear-chat"]'))$('[data-action="clear-chat"]').hidden=panelView!=='chat'||!s.history.length;
  box.scrollTop = s.history.length||generation?box.scrollHeight:0;
  updateGeneration();
}
function retry(index) {
  const s=active(),request=s.history[index-1];if(!request||request.role!=='user')return;
  const wantsSelection=request.scope==='selection';
  if(wantsSelection&&(!selection||selection.invalid||selection.base!==s.draft)){notice('Highlight the passage again, then try again.');return;}
  generate(request.mode==='discuss'?'discuss':'revise',request.content,wantsSelection?selection:null);
}
function updateGeneration() {
  if (!$('#submit-request')) return;
  const busy = !!generation, s=active();
  updateComposer();$('#stop-button').hidden=!busy;
  $('#stop-button').disabled=!!generation?.cancelled;
  const status = $('#request-status');
  if (generation) {
    const elapsed=Date.now()-generation.startedAt,own=generation.sessionId===activeId;
    const title=generation.cancelled?'Stopping…':generation.status;
    const note=generation.cancelled?'Nothing will be applied.':generation.plan&&!generation.live?`Plan: ${generation.plan}`:generation.live?(generation.mode==='discuss'?'':'Your document updates when the revision is complete.'):elapsed>=20000?'Local revisions often take a minute or two. The first request of a session also loads the model.':'';
    if($('#live-status')){
      $('#live-status').textContent=title;$('#live-elapsed').textContent=duration(elapsed);$('#live-note').textContent=note;
      if($('#live-summary'))$('#live-summary').textContent=generation.live?`Preview · ${words(generation.live)} words so far`:'Preview';
    }
    status.innerHTML=own?'':`<span class="working-dot"></span><span>Working on “${esc(state.sessions.find(doc=>doc.id===generation.sessionId)?.title || 'another document')}” · ${duration(elapsed)}</span>`;
    $('#document-activity').innerHTML=own?`<span class="working-dot"></span>${generation.mode==='discuss'?'Answering':'Revising'} · ${duration(elapsed)}`:'';
  } else {
    status.innerHTML=s?.lastError?`<span>${esc(s.lastError)}</span>`:'';
    $('#document-activity').textContent='';
  }
  status.hidden = !status.textContent;
}
async function generate(mode, instruction = active()?.composerDrafts?.[mode] || '', selected = selection) {
  if (generation) return;
  const s = active(); let request;
  try {request = W.capture(s,mode,instruction,selected);} catch (e) {s.lastError=e.message;updateGeneration();$('#feedback').focus();return;}
  if (!state.settings.model) {notice('Choose a downloaded model in Settings.'); settingsModal(); return;}
  const history=W.conversation(s);
  const userMessage={role:'user',content:instruction,mode,scope:request.scope,selection:request.selection||'',status:'pending',at:now()};
  s.history.push(userMessage);
  const job = {...request,id:uid(),cancelled:false,status:'Getting ready…',live:'',initialFeedback:s.composerDrafts[mode]||'',startedAt:Date.now()};
  generation = job; s.lastError = '';
  if (!s.source) s.source = request.base;
  if (instruction===s.composerDrafts[mode]) {const next=mode==='revise'&&rewritePresets.some(p=>p.instruction===instruction)?s.revisionBeforePreset||'':'';setComposerText(s,mode,next);delete s.revisionBeforePreset;}
  if (panelView!=='chat') showPanel('chat');
  queueSave(); renderConversation(); updateEditCards();
  generationTimer=setInterval(updateGeneration,1000);
  const finished=()=>({at:now(),durationMs:Date.now()-job.startedAt,...(job.plan?{plan:job.plan}:{})});
  try {
    await saveState();
    if (job.cancelled) throw new Error('Stopped. Your document is unchanged.');
    const body=(requestMode,text)=>({requestId:job.id,model:state.settings.model,mode:requestMode,scope:request.scope,selection:request.selection || '',selectionRange:request.selectionRange,source:'',draft:request.base,instruction:text,examples:state.examples.filter(e=>e.enabled!==false),history,settings:state.settings});
    let instructionUsed=instruction;
    if (mode==='revise'&&rewritePresets.some(p=>p.auto&&p.instruction===instruction)) {
      job.status='Deciding what to improve…';updateGeneration();
      const planResponse=await api('/api/generate',body('discuss',planInstruction(request.scope)));
      if (job.cancelled) await api('/api/cancel',{requestId:job.id});
      const planned=await W.readStream(planResponse,event=>{if(event.type==='status'){job.status='Deciding what to improve…';updateGeneration();}},()=>job.cancelled);
      instructionUsed=job.plan=request.instruction=cleanPlan(planned.text);
      if (job.cancelled) throw new Error('Stopped. Your document is unchanged.');
      job.status='Applying its plan…';updateGeneration();
    }
    const response = await api('/api/generate',body(mode,instructionUsed));
    if (job.cancelled) await api('/api/cancel',{requestId:job.id});
    const result = await W.readStream(response,event => {
      if (event.type==='status') {job.status=event.text || 'Working…';updateGeneration();}
      if (event.type==='delta') {
        job.live += event.text || '';job.status=mode==='discuss'?'Writing an answer…':'Writing the revision…';
        if (activeId===s.id && $('#live-response')) {
          const box=$('#conversation'),atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<80;
          $('#live-response').textContent=job.live;updateGeneration();if(atBottom)box.scrollTop=box.scrollHeight;
        }
      }
    }, () => job.cancelled);
    const applied = W.applyResult(s,request,result.text);
    if (applied.kind==='stale') {
      userMessage.status='stale';
      s.history.push({role:'assistant',content:s.status==='final'?'The document was locked while Folio was working, so this revision was not applied. Your writing is as you left it.':'You changed the document while Folio was working, so this revision was not applied. Your writing is as you left it.',status:'stale',...finished()});
    } else {
      let edit;
      if (applied.kind==='edit') {
        edit=W.recordEdit(s,request,applied.text);edit.durationMs=Date.now()-job.startedAt;
        if (activeId===s.id) {
          const keepScope=selection===selected, nextScope=selection;
          selection=null;E.replace($('#draft'),applied.text);
          if(request.scope==='selection' && keepScope) {
            const start=request.selectionRange.start,text=result.text;
            selection={base:applied.text,start,end:start+Array.from(text).length,text,plain:E.plainText(text),label:selected?.label};
          } else if(nextScope&&!keepScope)selection={...nextScope,invalid:true};
          reviewing={kind:'edit',id:edit.id};
          // On a phone the assistant covers the page; step aside so the marked changes are visible.
          if(narrow()&&mobileAssistant){mobileAssistant=false;updateAssistantPanel();}
          updateContext();
        } else {const h=histories.get(s.id);h?.past.push({text:s.draft,caret:null});if(h)h.future.length=0;s.draft=applied.text;}
      }
      userMessage.status='complete';
      const content=applied.kind==='answer'?result.text:applied.kind==='unchanged'?unchangedMessage(instruction,request.scope):request.scope==='selection'?'Updated only the selected passage.':'Updated the document.';
      s.history.push({role:'assistant',content,...(edit?{editId:edit.id}:{}),...(applied.kind==='unchanged'?{unchanged:true}:{}),status:'complete',...finished()});
      s.lastStats=result.stats; s.lastReferenceInfo=result.referenceInfo;
      if(applied.kind==='edit'&&activeId!==s.id)notice(`Revised “${s.title}”.`);
    }
    queueSave();
  } catch (error) {
    userMessage.status='failed';
    s.history.push({role:'assistant',content:error.message,status:'failed',...(job.cancelled?{stopped:true}:{}),...finished()});
    if(!s.composerDrafts[mode])setComposerText(s,mode,job.initialFeedback || instruction);
    queueSave();if(activeId!==s.id)notice(error.message);
  }
  finally {clearInterval(generationTimer);generation=null;renderConversation();updateDocument();await saveState().catch(e=>notice(e.message));}
}
// A revision that comes back identical is good news after Proofread, and only a
// hint to be more specific after a request the writer typed themselves.
function unchangedMessage(instruction,scope) {
  const preset=rewritePresets.find(p=>p.instruction===instruction),target=scope==='selection'?'the selected passage':'your document';
  if(preset?.label==='Proofread')return `No errors found in ${target}. Nothing was changed.`;
  if(preset?.auto)return `Folio's revision matched your current text, so ${target} is unchanged.`;
  if(preset)return `Folio found nothing to ${preset.label.toLowerCase()} in ${target}. Nothing was changed.`;
  return `Folio's revision matched your current text, so ${target} is unchanged. If you expected a change, try describing it more specifically.`;
}
async function cancelGeneration() {
  if (!generation || generation.cancelled) return;
  generation.cancelled=true; updateGeneration();
  try {await api('/api/cancel',{requestId:generation.id});} catch (e) {notice(e.message);}
}
async function action(name) {
  try {
    if (name==='new') {await saveState();const s=active();if(s && !s.draft.trim() && !Object.values(s.composerDrafts||{}).some(text=>text.trim()) && s.title==='Untitled document' && s.status!=='final')$('#draft').focus();else newSession();}
    if (name==='documents') documentsModal();
    if (name==='style') styleModal();
    if (name==='settings') settingsModal();
    if (name==='history') {openAssistant();showPanel('history');}
    if (name==='details') detailsModal();
    if (name==='export') exportModal();
    if (name==='save') await saveState();
    if (name==='copy') {await navigator.clipboard.writeText(E.plainText(active().draft));notice('Copied.');}
    if (name==='import') {const input=document.createElement('input');input.type='file';input.accept='.docx,.pdf,.txt,.md';input.onchange=()=>{if(input.files[0])importFile(input.files[0]).catch(e=>notice(e.message));};input.click();}
    if (name==='assistant') {
      if(narrow()){mobileAssistant=!mobileAssistant;updateAssistantPanel();if(mobileAssistant){$('#conversation').scrollTop=$('#conversation').scrollHeight;$('#feedback').focus();}else $('.mobile-assistant-toggle').focus();}
      else {assistantHidden=!assistantHidden;pref.set('assistant-hidden',assistantHidden);updateAssistantPanel();if(!assistantHidden)$('#conversation').scrollTop=$('#conversation').scrollHeight;}
    }
    if (name==='unlock') {active().status='draft';queueSave();updateDocument();updateEditCards();}
    if (name==='clear-chat') {if(generation)throw new Error('Stop the current request before clearing the conversation.');modal('Clear conversation?','<p>The document and its history stay as they are.</p>',[{label:'Cancel',run:closeModal},{label:'Clear',run:()=>{active().history=[];active().lastError='';queueSave();closeModal();renderConversation();updateGeneration();}}]);}
  } catch (e) {notice(e.message);}
}
function openAssistant() {
  if(narrow())mobileAssistant=true;else{assistantHidden=false;pref.set('assistant-hidden',false);}
  updateAssistantPanel();
}
function updateAssistantPanel() {
  const workspace=$('.workspace');if(!workspace||!$('#assistant'))return;
  const small=narrow(),open=small?mobileAssistant:!assistantHidden;
  workspace.classList.toggle('assistant-open',small&&open);
  workspace.classList.toggle('assistant-hidden',!small&&!open);
  $('.panel-toggle').setAttribute('aria-pressed',String(open));
  $('#assistant').setAttribute('role',small&&open?'dialog':'complementary');
  if(small&&open)$('#assistant').setAttribute('aria-modal','true');else $('#assistant').removeAttribute('aria-modal');
  $('.writing').inert=small&&open;
}
window.addEventListener('resize',updateAssistantPanel);
function modal(title,content,buttons=[]) {
  if (!$('#modal-root').firstChild) modalFocus=document.activeElement;
  $('#app').inert=true;
  $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><header><h2 id="modal-title">${esc(title)}</h2><button id="modal-close" aria-label="Close dialog">×</button></header><div class="modal-content">${content}<p class="modal-error" id="modal-error" role="alert" hidden></p></div><footer>${buttons.map((b,i)=>`<button class="button ${b.primary?'primary':'secondary'}" data-modal-button="${i}">${esc(b.label)}</button>`).join('')}</footer></section></div>`;
  $('#modal-close').onclick=closeModal;
  // Problems with a dialog's action are shown inside the dialog, next to what caused them.
  $$('[data-modal-button]').forEach(b=>b.onclick=async()=>{try{await buttons[Number(b.dataset.modalButton)].run();}catch(e){const box=$('#modal-error');if(box){box.textContent=e.message;box.hidden=false;}else notice(e.message);}});
  $('#modal-close').focus();$('#app').setAttribute('aria-hidden','true');
}
function closeModal() {if(exporting||documentMutation)return;$('#modal-root').innerHTML='';$('#app').inert=false;$('#app').removeAttribute('aria-hidden');if(modalFocus?.isConnected)modalFocus.focus();else $('[data-action="documents"]')?.focus();}
function documentsModal(showTrash=false, feedback=null) {
  const docs=state.sessions.filter(s=>Boolean(s.deletedAt)===showTrash),trashCount=state.sessions.filter(s=>s.deletedAt).length;
  modal(showTrash?'Trash':'Documents',`<div class="library-heading"><label class="field library-search"><span class="sr-only">${showTrash?'Search Trash':'Search documents'}</span><input id="document-search" type="search" placeholder="${showTrash?'Search Trash':'Search documents'}"></label><button class="button secondary" id="library-switch">${showTrash?'Back to documents':`Trash (${trashCount})`}</button></div>${feedback?`<div class="library-feedback ${feedback.error?'is-error':''}" role="${feedback.error?'alert':'status'}"><span>${esc(feedback.text)}</span>${feedback.undoId?'<button class="text-link" id="undo-trash">Undo</button>':''}</div>`:''}<div class="document-list">${docs.map(s=>`<div class="library-row ${!showTrash&&s.id===activeId?'current':''}" data-library-row="${esc(s.id)}">${showTrash?`<div class="document-row"><strong>${esc(s.title)}</strong><span>${words(s.draft)} words · Moved to Trash ${new Date(s.deletedAt).toLocaleDateString()}${s.status==='final'?' · Locked':''}</span></div>`:`<button data-open="${esc(s.id)}" class="document-row"><strong>${esc(s.title)}</strong><span>${words(s.draft)} words${s.updatedAt?' · Edited '+esc(clock(s.updatedAt)):''}${s.id===activeId?' · Open now':''}${s.status==='final'?' · Locked':''}</span></button>`}<div class="library-row-actions">${showTrash?`<button data-restore-document="${esc(s.id)}" aria-label="Restore ${esc(s.title)}">Restore</button><button class="danger-link" data-delete-document="${esc(s.id)}" aria-label="Delete ${esc(s.title)} permanently">Delete permanently…</button>`:`<button class="trash-link" data-trash-document="${esc(s.id)}" aria-label="Move ${esc(s.title)} to Trash">Move to Trash</button>`}</div></div>`).join('')}</div><p class="library-empty muted" ${docs.length?'hidden':''}>${showTrash?'Trash is empty. Documents stay here until you delete them permanently.':'No documents yet.'}</p><p class="muted" id="library-no-results" hidden>No matching documents.</p><p class="muted" id="library-save-status" role="status"></p>`,[{label:'Done',run:closeModal},...(!showTrash?[{label:'New document',primary:true,run:async()=>{await saveState();closeModal();await action('new');}}]:[])]);
  $('#library-switch').onclick=()=>documentsModal(!showTrash);
  $('#document-search').oninput=event=>{
    const query=event.target.value.trim().toLocaleLowerCase();let matches=0;
    $$('[data-library-row]').forEach(row=>{const doc=docs.find(s=>s.id===row.dataset.libraryRow);row.hidden=!doc.title.toLocaleLowerCase().includes(query);if(!row.hidden)matches++;});
    $('#library-no-results').hidden=!docs.length||matches>0;
  };
  $$('[data-open]').forEach(b=>b.onclick=async()=>{try{await saveState();const s=state.sessions.find(s=>s.id===b.dataset.open&&!s.deletedAt);if(!s)return;activeId=s.id;selection=null;closeModal();render();$('#draft').focus();}catch(e){notice(e.message);}});
  $$('[data-trash-document]').forEach(b=>b.onclick=()=>manageDocument(b.dataset.trashDocument,'trash'));
  $$('[data-restore-document]').forEach(b=>b.onclick=()=>manageDocument(b.dataset.restoreDocument,'restore'));
  $$('[data-delete-document]').forEach(b=>b.onclick=()=>confirmDeleteDocument(b.dataset.deleteDocument));
  $('#undo-trash')?.addEventListener('click',()=>manageDocument(feedback.undoId,'restore'));
}
function confirmDeleteDocument(id) {
  const s=state.sessions.find(s=>s.id===id&&s.deletedAt);if(!s)return;
  modal('Delete permanently?',`<p>Permanently delete <strong>${esc(s.title)}</strong>?</p><p>Its writing, conversation, and saved versions will be removed from this workspace. This cannot be undone here. Original files, exports, and backups are not affected.</p><p id="library-save-status" class="muted" role="status"></p>`,[{label:'Cancel',run:()=>documentsModal(true)},{label:'Delete permanently',run:()=>manageDocument(id,'delete')}]);
  $('[data-modal-button="1"]').classList.add('danger-button');
}
async function manageDocument(id,operation) {
  if(documentMutation)return;
  const s=state.sessions.find(s=>s.id===id);if(!s)return;
  if(operation==='trash'&&s.deletedAt || operation!=='trash'&&!s.deletedAt)return;
  if(operation==='delete'&&generation?.sessionId===id){notice('Wait for the stopped request to finish before deleting permanently.');return;}
  documentMutation=true;
  $$('button,input',$('.modal')).forEach(b=>b.disabled=true);
  if($('#library-save-status'))$('#library-save-status').textContent='Saving changes…';
  const previousActive=activeId,previousDeletedAt=s.deletedAt,index=state.sessions.indexOf(s),stoppedRequest=operation==='trash'&&generation?.sessionId===id;
  let mutated=false,placeholder=null,error=null;
  try {
    if(stoppedRequest)await cancelGeneration();
    await saveState();
    if(operation==='trash')s.deletedAt=now();
    else if(operation==='restore')delete s.deletedAt;
    else state.sessions.splice(index,1);
    mutated=true;
    if(operation==='trash'&&activeId===id){
      activeId=state.sessions.find(doc=>!doc.deletedAt)?.id;selection=null;
      if(!activeId)placeholder=newSession();else render();
    }
    queueSave();await saveState();
    if(operation==='delete'){
      histories.delete(id);for(const edit of s.edits||[])comparisonCache.delete(edit.id);
    }
  } catch(e) {
    error=e;
    if(mutated){
      if(operation==='delete')state.sessions.splice(index,0,s);
      if(previousDeletedAt===undefined)delete s.deletedAt;else s.deletedAt=previousDeletedAt;
      if(placeholder)state.sessions=state.sessions.filter(doc=>doc.id!==placeholder.id);
      activeId=previousActive;selection=null;render();queueSave();
    }
  } finally {documentMutation=false;}
  if(error){documentsModal(operation!=='trash',{error:true,text:`The change was not saved. Your document is still available. ${error.message}`});return;}
  const text=operation==='trash'?`“${s.title}” moved to Trash.${stoppedRequest?' Its current request was stopped.':''}${placeholder?' A new blank document is ready.':''}`:operation==='restore'?`“${s.title}” restored to Documents.`:`“${s.title}” permanently deleted.`;
  documentsModal(operation==='delete',{text,...(operation==='trash'?{undoId:id}:{})});notice(text);
}
// Changes are shown inside the document itself: the rendered text with removed
// wording struck through and new wording marked, block by block.
function blocks(markdown) {
  const node=document.createElement('div');node.innerHTML=E.render(markdown);
  const text=element=>{const copy=element.cloneNode(true);$$('br',copy).forEach(br=>br.replaceWith('\n'));return copy.textContent;};
  return [...node.children].flatMap(element=>/^(UL|OL)$/.test(element.tagName)
    ?[...element.children].map(item=>({key:element.tagName+item.outerHTML,tag:'li',list:element.tagName.toLowerCase(),html:item.innerHTML,text:text(item)}))
    :[{key:element.outerHTML,tag:element.tagName.toLowerCase(),html:element.innerHTML,text:text(element)}]);
}
function changeMarkup(before,after) {
  const a=blocks(before),b=blocks(after),ops=D.align(a.map(unit=>unit.key),b.map(unit=>unit.key));
  let html='',list=null,count=0,inChange=false;
  const open=(unit,classes,inner)=>{
    let prefix='';
    if(unit.tag==='li'&&list!==unit.list){prefix=(list?`</${list}>`:'')+`<${unit.list}>`;list=unit.list;}
    else if(unit.tag!=='li'&&list){prefix=`</${list}>`;list=null;}
    const hunk=classes&&!inChange?` data-hunk="${count++}"`:'';inChange=!!classes;
    return prefix+`<${unit.tag}${classes?` class="${classes}"`:''}${hunk}>${inner}</${unit.tag}>`;
  };
  // Each separate wording change inside a paragraph is its own stop for the change arrows.
  // A replacement (removed words next to added words) counts once.
  const wording=(from,to)=>{
    let out='',group='';
    const flush=()=>{if(group){out+=`<span class="change-hunk" data-hunk="${count++}">${group}</span>`;group='';}};
    for(const part of D.diff(from,to)){
      const value=esc(part.text).replace(/\n/g,'<br>');
      if(part.type==='equal'){if(group&&!part.text.trim())group+=value;else{flush();out+=value;}}
      else group+=part.type==='add'?`<ins>${value}</ins>`:`<del>${value}</del>`;
    }
    flush();return out;
  };
  for(const op of ops) {
    if(op.type==='equal')html+=open(b[op.b],'',b[op.b].html);
    else if(op.type==='add')html+=open(b[op.b],'change change-added',b[op.b].html);
    else if(op.type==='remove')html+=open(a[op.a],'change change-removed',a[op.a].html);
    else {
      const from=a[op.a],to=b[op.b];
      if(from.text===to.text)html+=open(to,'change change-format',to.html);
      // A heading that became a paragraph (or the reverse) shows both blocks in their own style.
      else if(from.tag!==to.tag)html+=open(from,'change change-removed',from.html)+open(to,'change change-added',to.html);
      else {const inner=wording(from.text,to.text);inChange=true;html+=open(to,'change',inner);inChange=false;}
    }
  }
  if(list)html+=`</${list}>`;
  return {html,count};
}
function reviewTexts(s) {
  if(reviewing?.kind==='edit'){
    const edit=s.edits.find(e=>e.id===reviewing.id);if(!edit)return null;
    const {before,after}=W.editTexts(s,edit);
    return before===undefined||after===undefined?null:{edit,before,after};
  }
  // Versions read like edits: the older text is struck through, the newer text is marked as added.
  if(reviewing?.kind==='version'){const version=s.versions.find(v=>v.id===reviewing.id);return version?{version,before:version.text,after:s.draft}:null;}
  if(reviewing?.kind==='original')return s.source?{original:true,before:s.source,after:s.draft}:null;
  return null;
}
let shownReview='';
function openReview(target) {
  reviewing=target;shownReview='';
  if(narrow()&&mobileAssistant){mobileAssistant=false;updateAssistantPanel();}
  renderReview();updateEditCards();
  const first=$('#change-view [data-hunk]');
  if(first)first.scrollIntoView({block:'center'});else $('.editor-scroll').scrollTop=0;
}
// Clicking into the marked-up text returns to editing with the caret near the click.
function closeReview(point=null) {
  if(!reviewing)return;
  reviewing=null;renderReview();updateEditCards();
  if(!point)return;
  const editor=$('#draft'),range=document.caretRangeFromPoint?.(point.x,point.y);
  editor.focus();
  if(range&&editor.contains(range.startContainer)){const selected=getSelection();selected.removeAllRanges();selected.addRange(range);}
}
function renderReview() {
  const s=active(),bar=$('#review-bar'),view=$('#change-view');if(!bar||!s)return;
  const review=reviewing&&reviewTexts(s);
  if(reviewing&&!review)reviewing=null;
  $('.writing').classList.toggle('is-reviewing',!!review);
  bar.hidden=view.hidden=!review;$('#draft').hidden=!!review;
  if(!review){bar.innerHTML='';view.innerHTML='';shownReview='';E.highlight?.($('#draft'),selection);return;}
  $('#empty-start').hidden=true;
  const key=JSON.stringify([reviewing,review.before,review.after]);
  let count=Number(view.dataset.count||0);
  if(key!==shownReview){
    const markup=changeMarkup(review.before,review.after);count=markup.count;
    view.innerHTML=markup.html||'<p class="muted">No differences.</p>';view.dataset.count=count;shownReview=key;
  }
  const blocked=s.status==='final'||!!generation;
  let title,detail,actions;
  if(review.edit){
    const edit=review.edit,c=comparison(s,edit),current=editState(s,edit);
    title=current==='undone'?`Undone: revision of ${editTarget(edit)}`:`Revised ${editTarget(edit)}`;
    detail=`${changeCounts(c)}${Number.isFinite(edit.durationMs)?`<span>· ${tookText(edit.durationMs)}</span>`:''}<span>· ${clock(edit.createdAt)}</span>`;
    actions=current==='current'?`<button class="button secondary" data-review-action="undo" ${blocked?'disabled':''}>${icons.undo}<span>Undo edit</span></button>`
      :current==='undone'?`<button class="button secondary" data-review-action="undo" ${blocked?'disabled':''}>${icons.redo}<span>Reapply edit</span></button>`
      :`<button class="button secondary" data-review-action="restore-before" ${blocked?'disabled':''} title="Your document has changed since this edit">Restore version before this edit</button>`;
  } else {
    const version=review.version,label=version?friendlyLabel(version.label):'Original text';
    title=review.original?'Original text':label;
    detail=`<span>${version?clock(version.createdAt)+' · ':''}${words(review.before)} words</span><span class="legend"><del>only in this version</del> <ins>added since</ins></span>`;
    actions=review.before===review.after?'<span class="muted">Same as your current text</span>':`<button class="button secondary" data-review-action="restore" ${blocked?'disabled':''}>Restore this version</button>`;
  }
  const nav=count>1?`<div class="review-nav" role="group" aria-label="Move between changes"><button class="icon-button" data-review-action="prev" aria-label="Previous change">${icons.up}</button><span id="review-position">${count} changes</span><button class="icon-button" data-review-action="next" aria-label="Next change">${icons.down}</button></div>`:'';
  bar.innerHTML=`<div class="review-summary"><strong>${esc(title)}</strong><div class="review-detail">${detail}</div></div>${nav}<div class="review-actions">${actions}<button class="button primary" data-review-action="done">Done</button></div>`;
  let position=-1;
  $$('[data-review-action]',bar).forEach(button=>button.onclick=()=>{
    const act=button.dataset.reviewAction;
    if(act==='done')return closeReview();
    if(act==='prev'||act==='next'){
      const hunks=$$('[data-hunk]',view);if(!hunks.length)return;
      position=(position+(act==='next'?1:-1)+hunks.length)%hunks.length;
      hunks.forEach((h,i)=>h.classList.toggle('is-current',i===position));
      hunks[position].scrollIntoView({block:'center',behavior:'smooth'});
      $('#review-position').textContent=`${position+1} of ${hunks.length}`;return;
    }
    try{
      if(act==='undo')revertEdit(review.edit.id);
      if(act==='restore-before')restoreVersion(review.before,'Before an earlier edit',s.versions.find(v=>v.id===review.edit.beforeId));
      if(act==='restore')restoreVersion(review.before,review.original?'Original text':friendlyLabel(review.version.label),review.version);
    }catch(e){notice(e.message);}
  });
}
function revertEdit(id) {
  const s=active(),edit=s.edits.find(e=>e.id===id);if(!edit)return;
  if(generation){notice('Wait for the current request to finish, or stop it, before undoing an edit.');return;}
  if(s.status==='final'){notice('Unlock the document before undoing an edit.');return;}
  const current=editState(s,edit),texts=W.editTexts(s,edit);
  if(current==='later'){openReview({kind:'edit',id});return;}
  W.snapshot(s,current==='current'?'Before undoing AI edit':'Before reapplying AI edit');
  selection=null;E.replace($('#draft'),current==='current'?texts.before:texts.after);
  if(edit.scope==='selection'){const start=edit.selectionRange.start,count=current==='current'?edit.selectionRange.end-start:Array.from(texts.after).length-Array.from(texts.before).length+edit.selectionRange.end-start;const text=Array.from(s.draft).slice(start,start+count).join('');selection={base:s.draft,start,end:start+count,text,plain:E.plainText(text),label:edit.scopeLabel};}
  W.snapshot(s,current==='current'?'Edit undone':'Edit reapplied');
  reviewing=current==='current'?null:{kind:'edit',id};
  queueSave();updateContext();updateDocument();renderConversation();notice(current==='current'?'Edit undone.':'Edit reapplied.');
}
function restoreVersion(text,label,metadata) {
  const s=active();if(generation)throw new Error('Finish or stop the current request before restoring.');
  if(s.status==='final')throw new Error('Unlock the document before restoring a version.');
  W.snapshot(s,'Before restore');selection=null;reviewing=null;E.replace($('#draft'),text,{metadata:{title:s.title,date:s.date}});
  if(metadata){s.title=metadata.title||s.title;s.date=metadata.date??s.date;$('#document-title').value=s.title;}
  W.snapshot(s,'Restored: '+label);
  queueSave();closeModal();updateContext();updateDocument();renderConversation();notice('Version restored. Undo brings back what you had.');
}
function friendlyLabel(label='') {
  const names={'Imported notes':'Imported','Exported document':'Exported','Before restore':'Before restoring','Before locking':'Before locking',
    'Before undoing AI edit':'Before undoing an edit','Before reapplying AI edit':'Before reapplying an edit','Edit undone':'Undid an edit','Edit reapplied':'Reapplied an edit',
    'Edit undone · previous wording restored':'Undid an edit','Before AI edit':'Before an edit','AI edit':'After an edit',
    // Written when an older Folio's pending AI draft became the working text.
    'Restored suggestion':'Earlier AI draft','Before restored suggestion':'Before the earlier AI draft'};
  if(label.startsWith('Restored: '))return 'Restored “'+label.slice(10)+'”';
  return names[label]||label||'Saved version';
}
function renderHistory() {
  const box=$('#history-panel'),s=active();if(!box||box.hidden||!s)return;
  const fromEdits=new Set(s.edits.flatMap(e=>[e.beforeId,e.afterId]));
  const entries=[
    ...s.edits.map(edit=>({kind:'edit',id:edit.id,at:edit.createdAt,edit})),
    ...s.versions.filter(v=>!fromEdits.has(v.id)).map(version=>({kind:'version',id:version.id,at:version.createdAt,version})),
  ].sort((x,y)=>String(y.at).localeCompare(String(x.at)));
  const selected=entry=>reviewing?.kind===entry.kind&&reviewing.id===entry.id;
  const latestCurrent=[...s.edits].reverse().find(edit=>editState(s,edit)==='current')?.id;
  let day='',html=`<div class="history-current"><strong>Current text</strong><span>${words(s.draft)} words${s.status==='final'?' · Locked':''}</span></div>`;
  for(const entry of entries){
    const label=dayLabel(entry.at);if(label!==day){day=label;html+=`<h3 class="history-day">${esc(label)}</h3>`;}
    if(entry.kind==='edit'){
      const edit=entry.edit,c=comparison(s,edit),current=editState(s,edit);
      const meta=[edit.scope==='selection'?'Selection':'Whole document',Number.isFinite(edit.durationMs)?tookText(edit.durationMs):'',clock(edit.createdAt)].filter(Boolean).join(' · ');
      html+=`<button class="history-item ${selected(entry)?'is-selected':''}" data-history-edit="${esc(edit.id)}" aria-pressed="${selected(entry)}">${icons.revise}<span class="history-text"><strong>${esc(edit.instruction)}</strong><span class="change-counts">${c?changeCounts(c):''}</span><span>${esc(meta)}</span></span>${current==='undone'?'<span class="badge">Undone</span>':edit.id===latestCurrent?'<span class="badge is-current">Current</span>':''}</button>`;
    } else {
      const version=entry.version;
      html+=`<button class="history-item ${selected(entry)?'is-selected':''}" data-history-version="${esc(version.id)}" aria-pressed="${selected(entry)}">${icons.clock}<span class="history-text"><strong>${esc(friendlyLabel(version.label))}</strong><span>${words(version.text)} words · ${esc(clock(version.createdAt))}</span></span></button>`;
    }
  }
  if(s.source.trim()&&s.source!==s.draft)html+=`<h3 class="history-day">Where you started</h3><button class="history-item ${reviewing?.kind==='original'?'is-selected':''}" data-history-original>${icons.doc}<span class="history-text"><strong>Original text</strong><span>${words(s.source)} words</span></span></button>`;
  if(!entries.length&&!(s.source.trim()&&s.source!==s.draft))html+='<p class="history-empty">Revisions, restores, and imports will appear here.</p>';
  const scroll=box.scrollTop;box.innerHTML=html;box.scrollTop=scroll;
  const toggle=target=>{if(reviewing?.kind===target.kind&&reviewing.id===target.id)closeReview();else openReview(target);renderHistory();};
  $$('[data-history-edit]',box).forEach(b=>b.onclick=()=>toggle({kind:'edit',id:b.dataset.historyEdit}));
  $$('[data-history-version]',box).forEach(b=>b.onclick=()=>toggle({kind:'version',id:b.dataset.historyVersion}));
  $('[data-history-original]',box)?.addEventListener('click',()=>toggle({kind:'original',id:undefined}));
}

function detailsModal() {
  const s=active();
  const locked=s.status==='final';
  modal('Document options',`<label class="field">Document date (optional)<input id="document-date" type="date" value="${esc(s.date)}" ${locked?'disabled':''} aria-describedby="date-help"><span class="field-help" id="date-help">Printed under the title in Word exports when “Include document date” is on in Export.</span></label><div class="document-removal"><h3>${locked?'Locked':'Lock this document'}</h3><p class="muted">${locked?'Editing and AI revisions are off. Unlock to make changes.':'Turns off editing and AI revisions so a finished document stays as it is. You can unlock it any time.'}</p><button class="button secondary" id="toggle-lock">${locked?'Unlock document':'Lock document'}</button></div><div class="document-removal"><h3>Remove this document</h3><p class="muted">You can restore it from Trash later.</p><button class="button secondary trash-link" id="trash-current-document">Move to Trash</button><p id="library-save-status" class="muted" role="status"></p></div>`,[{label:'Done',primary:true,run:closeModal}]);
  $('#toggle-lock').onclick=()=>{W.snapshot(s,'Before locking');s.status=locked?'draft':'final';queueSave();closeModal();updateDocument();updateEditCards();notice(locked?'Unlocked.':'Locked. Unlock it from the banner above the text.');};
  $('#trash-current-document').onclick=()=>manageDocument(s.id,'trash');
  $('#document-date').onchange=e=>{s.date=e.target.value;queueSave();};
}
async function fileText(file) {
  if(file.size>15*1024*1024)throw new Error('Choose a file smaller than 15 MB.');
  const bytes=new Uint8Array(await file.arrayBuffer()); let binary='';
  for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return (await (await api('/api/import',{name:file.name,data:btoa(binary)})).json()).text;
}
async function importFile(file) {
  if(importing){notice('A file is already being read.');return;}
  const originalId=activeId;let text;
  importing=true;notice('Reading '+file.name+'…');
  $$('[data-action="import"]').forEach(b=>{b.disabled=true;b.dataset.label=b.innerHTML;b.innerHTML='<span>Reading…</span>';});
  try{text=await fileText(file);if(!text.trim())throw new Error('No readable text was found in that file. Paste the text, or import a Word, text, or text-based PDF file.');}
  finally{importing=false;$('#toast').hidden=true;$$('[data-action="import"]').forEach(b=>{b.disabled=false;if(b.dataset.label)b.innerHTML=b.dataset.label;});}
  const install=()=>{if(activeId!==originalId || active().draft.trim() || active().status==='final')newSession();const s=active();s.title=file.name.replace(/\.[^.]+$/,'').slice(0,160);s.source=text;selection=null;E.replace($('#draft'),text);$('#document-title').value=s.title;W.snapshot(s,'Imported notes');queueSave();closeModal();updateGeneration();notice('Imported “'+file.name+'”.');};
  const append=()=>{
    const s=active();if(activeId!==originalId||s.status==='final'){install();return;}
    closeReview();selection=null;E.replace($('#draft'),s.draft.replace(/\s+$/,'')+'\n\n'+text);
    W.snapshot(s,'Imported notes');queueSave();closeModal();updateContext();updateGeneration();notice('Added “'+file.name+'” to the end. Undo removes it.');
  };
  const s=active();
  if(s.draft.trim())modal('Import “'+file.name+'”',s.status==='final'?'<p>This document is locked, so the file will open as a new document.</p>':'<p>Add the file to the end of this document, or open it as a new document.</p>',[{label:'Cancel',run:closeModal},...(s.status==='final'?[]:[{label:'Add to this document',run:append}]),{label:'New document',primary:true,run:install}]);else install();
}
function field(label,key,options) {return `<label class="field">${label}<select aria-label="${esc(label)}" data-setting="${key}">${options.map(option=>{const [value,text]=Array.isArray(option)?option:[option,option];return `<option value="${value}" ${String(state.settings[key])===String(value)?'selected':''}>${text}</option>`;}).join('')}</select></label>`;}
function exportFields() {
  return `<div class="field-grid">${field('Font','font',['Aptos','Calibri','Georgia','Times New Roman'])}${field('Size','fontSize',[10,11,12,13,14])}${field('Line spacing','lineSpacing',[1,1.15,1.3,1.5,1.6])}${field('Page size','pageSize',[['letter','Letter'],['a4','A4']])}${field('Margins','margins',[['standard','1 inch'],['compact','¾ inch']])}</div><label class="check-field"><input type="checkbox" data-setting="includeDate" ${state.settings.includeDate?'checked':''}> Include document date</label><label class="check-field"><input type="checkbox" data-setting="confidentiality" ${state.settings.confidentiality?'checked':''}> Confidential footer</label>`;
}
function bindExportFields(changed) {
  $$('[data-setting]').forEach(input=>input.onchange=()=>{const key=input.dataset.setting;state.settings[key]=input.type==='checkbox'?input.checked:['fontSize','lineSpacing'].includes(key)?Number(input.value):input.value;queueSave();if($('#export-summary'))$('#export-summary').textContent=`${state.settings.font} · ${state.settings.fontSize} pt · ${state.settings.pageSize==='a4'?'A4':'Letter'} · ${state.settings.lineSpacing} line spacing`;changed?.();});
}
function settingsModal() {
  modal('Settings',`<h3>Local model</h3><label class="field">Model<select id="model-select" aria-label="Model">${models.length?models.map(m=>`<option value="${m.id}" ${state.settings.model===m.id?'selected':''}>${esc(m.name)}</option>`).join(''):'<option value="">No downloaded models found</option>'}</select></label><button class="text-link" id="refresh-models">Refresh models</button><p class="muted">Runs entirely on this Mac. Nothing is sent over the internet.</p><h3>Word export</h3>${exportFields()}<details class="privacy-details"><summary>Privacy and storage</summary><p>Writing and examples are stored locally in Folio’s private folder. They are not encrypted by Folio and are excluded from the GitHub source backup. Document contents never leave this Mac through Folio. Exported files follow your browser’s download settings.</p></details>`,[{label:'Done',primary:true,run:closeModal}]);
  bindExportFields();
  $('#model-select').onchange=e=>{if(generation){e.target.value=state.settings.model;notice('Stop the current request before changing models.');return;}state.settings.model=e.target.value;queueSave();};
  $('#refresh-models').onclick=async()=>{try{await refreshModels();settingsModal();}catch(e){notice(e.message);}};
}
async function refreshModels() {
  const data=await(await api('/api/models')).json();models=data.models || [];runtime=data.runtime || {};
  if(!models.some(m=>m.id===state.settings.model)){const model=models.find(m=>m.recommended)||models[0];if(model){state.settings.model=model.id;queueSave();}}
}
function styleModal() {
  modal('Writing style',`<label class="field">Writing preferences<textarea id="voice" rows="5" placeholder="Describe how you write: voice, rhythm, words you use and avoid. Guidance for specific kinds of writing (stories, essays, emails) is applied only when it fits.">${esc(state.settings.voice)}</textarea></label><h3>Examples</h3><p class="muted">Checked examples teach Folio your style. Their content never ends up in your document.</p><div class="example-list">${state.examples.map(e=>`<div class="example-row"><label><input type="checkbox" data-example-toggle="${e.id}" ${e.enabled!==false?'checked':''}><span>${esc(e.name || 'Untitled example')}<small>${e.type==='pair'?'Before and after':'Writing sample'}${state.settings.exampleDrafts?.[e.id]?' · Unfinished changes':''}</small></span></label><button data-example-edit="${e.id}">Edit</button><button data-example-remove="${e.id}">Remove</button></div>`).join('') || '<p class="muted">No examples yet.</p>'}</div><div class="inline-actions"><button class="button secondary" id="add-writing">${state.settings.exampleDrafts?.['new-writing']?'Continue sample':'Add sample'}</button><button class="button secondary" id="add-pair">${state.settings.exampleDrafts?.['new-pair']?'Continue before & after':'Add before & after'}</button></div>${['new-writing','new-pair'].filter(slot=>state.settings.exampleDrafts?.[slot]).map(slot=>`<p class="draft-note">Unfinished ${slot==='new-pair'?'before & after':'sample'} saved. <button class="text-link" data-discard-draft="${slot}">Discard it</button></p>`).join('')}`,[{label:'Done',primary:true,run:closeModal}]);
  $('#voice').oninput=e=>{state.settings.voice=e.target.value;queueSave();};
  $('#add-writing').onclick=()=>exampleModal(null,'writing');$('#add-pair').onclick=()=>exampleModal(null,'pair');
  $$('[data-discard-draft]').forEach(b=>b.onclick=()=>{delete state.settings.exampleDrafts[b.dataset.discardDraft];queueSave();styleModal();notice('Draft discarded.');});
  $$('[data-example-toggle]').forEach(input=>input.onchange=()=>{state.examples.find(e=>e.id===input.dataset.exampleToggle).enabled=input.checked;queueSave();});
  $$('[data-example-edit]').forEach(b=>b.onclick=()=>exampleModal(b.dataset.exampleEdit));
  $$('[data-example-remove]').forEach(b=>b.onclick=()=>{const e=state.examples.find(e=>e.id===b.dataset.exampleRemove);modal('Remove example?',`<p>${esc(e.name)} will be removed from this library.</p>`,[{label:'Cancel',run:styleModal},{label:'Remove',run:()=>{state.examples=state.examples.filter(x=>x.id!==e.id);if(state.settings.exampleDrafts)delete state.settings.exampleDrafts[e.id];queueSave();styleModal();}}]);});
}
function exampleModal(id,type='writing') {
  const existing=state.examples.find(e=>e.id===id), slot=id || 'new-'+type;
  const example={...(existing || {id:uid(),type,name:'',enabled:true}),...state.settings.exampleDrafts?.[slot]};
  const values=()=>({name:$('#example-name').value,...Object.fromEntries($$('[data-example-field]').map(input=>[input.dataset.exampleField,input.value]))});
  const saveDraft=()=>{state.settings.exampleDrafts ||= {};state.settings.exampleDrafts[slot]={...example,...values()};queueSave();updateStatus();};
  modal(existing?'Edit example':example.type==='pair'?'Before and after':'Writing sample',`<label class="field">Name<input id="example-name" value="${esc(example.name)}" maxlength="200"></label>${(example.type==='pair'?['before','after']:['text']).map(key=>`<div class="field"><label for="example-${key}">${key==='text'?'Sample':key==='before'?'Before':'After'}</label><textarea id="example-${key}" data-example-field="${key}" rows="7">${esc(example[key] || '')}</textarea></div><button class="text-link" data-import-example="${key}">Import ${key==='text'?'sample':key}</button>`).join('')}<p class="muted" id="example-save-status" role="status"></p>`, [{label:'Back',run:styleModal},{label:'Save example',primary:true,run:()=>{
    const missing=$$('[data-example-field]').find(input=>!input.value.trim());
    if(missing){missing.setAttribute('aria-invalid','true');missing.focus();throw new Error('Add text to each example field.');}
    Object.assign(example,values(),{name:$('#example-name').value.trim() || 'Untitled example'});
    if(existing)Object.assign(existing,example);else state.examples.push(example);
    if(state.settings.exampleDrafts)delete state.settings.exampleDrafts[slot];
    queueSave();styleModal();
  }}]);
  $('#example-name').focus();
  if(state.settings.exampleDrafts?.[slot])updateStatus();
  $$('#example-name,[data-example-field]').forEach(input=>input.oninput=()=>{input.removeAttribute('aria-invalid');$('#modal-error').hidden=true;saveDraft();});
  $$('[data-import-example]').forEach(button=>button.onclick=()=>{
    const input=document.createElement('input');input.type='file';input.accept='.txt,.md,.docx,.pdf';
    input.onchange=async()=>{try{
      if(!input.files[0])return;
      const field=$(`[data-example-field="${button.dataset.importExample}"]`),draft={...example,...values()};
      const text=await fileText(input.files[0]);
      if(field.isConnected){field.value=text;saveDraft();}
      else {state.settings.exampleDrafts ||= {};state.settings.exampleDrafts[slot]={...draft,[button.dataset.importExample]:text};queueSave();}
    }catch(e){notice(e.message);}};input.click();
  });
}

// Mirrors export_docx: a leading "# Heading", or a "##"/"###" heading that repeats the title,
// becomes the printed title. Otherwise the document title prints, unless it is still untitled.
function exportParts(copy) {
  const text=copy.text.trimStart(),[first,...rest]=text.split('\n'),untitled=copy.title.trim()==='Untitled document';
  const heading=first.match(/^ {0,3}(#{1,3})\s+(.+?)(?:\s+#+)?\s*$/),same=(a,b)=>a.replace(/\s+/g,' ').trim().toLocaleLowerCase()===b.replace(/\s+/g,' ').trim().toLocaleLowerCase();
  if(heading&&(heading[1]==='#'||!untitled&&same(heading[2],copy.title)))return {title:heading[2],body:rest.join('\n')};
  return {title:untitled?'':copy.title.trim(),body:text};
}
function exportPreview(copy) {
  const {title,body}=exportParts(copy);
  const date=state.settings.includeDate&&copy.date?new Date(copy.date+'T12:00').toLocaleDateString([], {month:'long',day:'numeric',year:'numeric'}):'';
  return `${title?`<h1>${E.render(title).replace(/^<p>|<\/p>$/g,'')}</h1>`:''}${date?`<p class="export-date">${esc(date)}</p>`:''}${E.render(body)}${state.settings.confidentiality?'<p class="export-footer">Confidential</p>':''}`;
}
function exportModal() {
  const s=active();if(!s.draft.trim()){notice('Add some writing before exporting.');return;}
  const exportCopy={text:s.draft,title:s.title,date:s.date};
  modal('Export',`<div class="export-layout"><article class="export-preview" id="export-preview">${exportPreview(exportCopy)}</article><div><label class="field">File type<select id="export-format" aria-label="File type"><option value="docx">Word (.docx)</option><option value="txt">Plain text (.txt)</option></select></label><p class="muted" id="export-summary">${esc(state.settings.font)} · ${state.settings.fontSize} pt<br>${state.settings.pageSize==='a4'?'A4':'Letter'} · ${state.settings.lineSpacing} line spacing</p></div></div><details class="export-options"><summary>Word formatting</summary>${exportFields()}</details>`,[{label:'Cancel',run:closeModal},{label:'Download',primary:true,run:async()=>{
    const format=$('#export-format').value;exporting=true;$$('button',$('.modal')).forEach(b=>b.disabled=true);
    try {await saveState();const response=await api('/api/export',{title:exportCopy.title.trim()==='Untitled document'?'':exportCopy.title,text:format==='txt'?E.plainText(exportCopy.text):exportCopy.text,date:exportCopy.date || null,settings:state.settings,format});const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=(exportCopy.title.replace(/[\/\\:*?"<>|\x00-\x1f]/g,'').trim().replace(/^[. ]+|[. ]+$/g,'')||'Document')+'.'+format;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);W.snapshot(s,'Exported document',exportCopy.text);queueSave();exporting=false;closeModal();notice('Download started.');}finally{exporting=false;if($('.modal'))$$('button',$('.modal')).forEach(b=>b.disabled=false);}
  }}]);
  bindExportFields(()=>{if($('#export-format').value==='docx')$('#export-preview').innerHTML=exportPreview(exportCopy);});
  $('#export-format').onchange=()=>{const word=$('#export-format').value==='docx';$('.export-options').hidden=!word;$('#export-summary').hidden=!word;$('#export-preview').innerHTML=word?exportPreview(exportCopy):`<pre>${esc(E.plainText(exportCopy.text))}</pre>`;};
}
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){if($('.modal'))closeModal();else if(mobileAssistant&&narrow())action('assistant');else if(reviewing)closeReview();}
  const trap=$('.modal') || (mobileAssistant&&matchMedia('(max-width:900px)').matches?$('#assistant'):null);
  if(event.key==='Tab'&&trap){const items=$$('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href]',trap).filter(el=>el.getClientRects().length);const first=items[0],last=items.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
});
window.addEventListener('beforeunload',event=>{if(saver.dirty||saver.pending||generation||exporting||documentMutation){event.preventDefault();event.returnValue='';}});
async function init() {
  try {
    const data=await(await api('/api/bootstrap')).json();token=data.token;state={sessions:data.state.sessions || [],examples:data.state.examples || [],settings:{...defaults,...data.state.settings}};models=data.models || [];runtime=data.runtime || {};
    let savedId;try{savedId=sessionStorage.getItem('folio-active');}catch{}
    activeId=state.sessions.find(s=>s.id===savedId&&!s.deletedAt)?.id || state.sessions.find(s=>!s.deletedAt)?.id;
    let recovered=false;state.sessions.forEach(s=>{normalize(s);s.history.forEach(m=>{if(m.status==='pending'){recovered=true;m.status='failed';const mode=m.mode==='discuss'?'discuss':'revise';if(!s.feedback)s.composerMode=mode;if(!s.composerDrafts[mode])setComposerText(s,mode,m.content);s.lastError='The previous request was interrupted. Your saved writing is intact. Send the request again to continue.';}});});
    if(!activeId)newSession();else render();
    if(recovered)queueSave();
    await refreshModels().catch(e=>notice(e.message));
  } catch(e){$('#app').innerHTML=`<main class="boot"><h1>Folio</h1><p>${esc(e.message)}</p><button class="button primary" id="retry-connection">Try again</button></main>`;$('#retry-connection').onclick=init;}
}
init();
