/* Full UI regression suite. A temporary server and synthetic documents only. */
'use strict';
const assert = require('node:assert/strict');
const {test,before,after} = require('node:test');
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {chromium} = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const python = process.env.FOLIO_PYTHON || 'python3';
let browser,server,url,output,storage;
const initial='## Project update\n\nThe team discussed the plan. No decision was made.\n\nMaría will follow up on October 3.';
const revised=initial.replace('discussed','reviewed');
before(async()=>{
  output=await fs.mkdtemp(path.join(os.tmpdir(),'folio-workflow-'));
  server=spawn(python,[path.join(__dirname,'preview_server.py'),'--port','0']);
  url=await new Promise((resolve,reject)=>{let log='';server.stdout.on('data',data=>{log+=data;const m=log.match(/Preview: (http:\/\/\S+)  Synthetic storage: (.+)/);if(m){storage=m[2];resolve(m[1]);}});server.once('error',reject);server.once('exit',code=>reject(Error('Preview exited '+code)));});
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();server?.kill('SIGINT');});
function document(text=initial,id='one'){return {id,title:'Project update',draft:text,source:'Original project notes.',history:[],versions:[],feedback:'',status:'draft'};}
async function open({docs=[document()],legacy=false,width=1440,height=1000}={}){
  const context=await browser.newContext({viewport:{width,height},acceptDownloads:true,permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[],external=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',r=>{if(!r.url().startsWith(url)&&!r.url().startsWith('blob:'))external.push(r.url());});
  const bootstrap=await (await context.request.get(url+'/api/bootstrap')).json();
  await context.request.post(url+'/api/state',{headers:{'X-Folio-Token':bootstrap.token},data:{sessions:docs,examples:[],settings:{model:'synthetic',...(legacy?{}:{editorVersion:2})}}});
  await page.goto(url);await page.getByRole('textbox',{name:'Document text',exact:true}).waitFor();
  async function saved(){await page.locator('#save-status').filter({hasText:/^Saved$/}).waitFor();}
  async function state(){await saved();return (await(await context.request.get(url+'/api/bootstrap')).json()).state;}
  async function request(instruction,mode='Edit') {await page.getByRole('tab',{name:mode==='Ask'?'Chat':'Revise',exact:true}).click();await page.locator('#feedback').fill(instruction);await page.locator('#submit-request').click();}
  async function complete(){await page.locator('#stop-button').waitFor({state:'hidden'});await saved();}
  return {page,context,errors,external,saved,state,request,complete,close:async()=>{assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();}};
}
async function select(page,paragraph,from,to=from,occurrence=0){
  await page.locator('#draft').evaluate((element,{paragraph,from,to,occurrence})=>{
    const block=element.children[paragraph];const nodes=[];const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);while(walker.nextNode())nodes.push(walker.currentNode);
    const startNode=nodes.find(n=>n.textContent.includes(from)),endNode=nodes.find(n=>n.textContent.includes(to));
    let start=-1;for(let i=0;i<=occurrence;i++)start=startNode.textContent.indexOf(from,start+1);
    const end=endNode===startNode&&from===to?start+to.length:endNode.textContent.indexOf(to)+to.length;
    const r=document.createRange();r.setStart(startNode,start);r.setEnd(endNode,end);getSelection().removeAllRanges();getSelection().addRange(r);
    document.dispatchEvent(new Event('selectionchange'));
  },{paragraph,from,to,occurrence});
}
test('pending first draft migrates; Ask and repeated Edit stay usable without acceptance',async()=>{
  const old={...document(''),proposal:{text:initial}};const h=await open({docs:[old],legacy:true});
  try{
    assert.equal((await h.state()).sessions[0].draft,initial);
    await h.request('Was a decision made?','Ask');await h.complete();
    assert.equal((await h.state()).sessions[0].draft,initial);assert.equal(await h.page.getByRole('button',{name:'Undo',exact:true}).isEnabled(),false);
    await h.request('Make this clearer');await h.complete();assert.equal((await h.state()).sessions[0].draft,revised);
    await h.request('Make it clear again');await h.complete();assert.equal((await h.state()).sessions[0].history.length,6);
    await h.page.reload();assert.equal(await h.page.locator('#draft').innerText(),revised.replace('## ',''));
  }finally{await h.close();}
});
test('exact selection, Ask preservation, AI edit, Undo and Redo with repeated Unicode phrases',async()=>{
  const original='Café 😀 repeated phrase.\n\nCafé 😀 repeated phrase.\n\nKeep **bold words** and *italic words* exactly.';
  const h=await open({docs:[document(original)]});
  try{
    await select(h.page,1,'repeated phrase');
    await h.request('Explain this','Ask');await h.complete();
    assert.match(await h.page.locator('#selection-context').innerText(),/Selection[\s\S]*repeated phrase/);
    assert.equal((await h.state()).sessions[0].draft,original);
    await h.request('Revise this passage');await h.complete();
    const start=original.lastIndexOf('repeated phrase');const expected=original.slice(0,start)+'The team deferred the decision.'+original.slice(start+'repeated phrase'.length);
    assert.equal((await h.state()).sessions[0].draft,expected);
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,original);
    await h.page.getByRole('button',{name:'Redo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,expected);
  }finally{await h.close();}
});
test('formatting, typing and AI changes share Undo and Redo across document switches',async()=>{
  const h=await open({docs:[document('Keep these words.'),document('Other document','two')]});
  try{
    await select(h.page,0,'these');await h.page.getByRole('button',{name:'Bold',exact:true}).click();
    assert.equal((await h.state()).sessions[0].draft,'Keep **these** words.');
    await h.page.getByRole('button',{name:'Clear selection',exact:true}).click();
    await h.request('Improve this');await h.complete();
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,'Keep **these** words.');
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,'Keep these words.');
    await h.page.getByRole('button',{name:'Redo',exact:true}).click();
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.locator('[data-open="two"]').click();await h.page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await h.page.locator('#draft').innerText(),'Other document');
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.locator('[data-open="one"]').click();await h.page.getByRole('dialog').waitFor({state:'hidden'});
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,'Keep these words.');
  }finally{await h.close();}
});
test('new typing survives a late response, Retry applies to current text',async()=>{
  const h=await open();try{
    await h.request('slow edit');await h.page.getByRole('button',{name:'Stop',exact:true}).waitFor();
    await h.page.locator('#draft').fill('Newer manual writing.');
    await h.page.locator('#feedback').fill('My next request');await h.complete();
    assert.equal((await h.state()).sessions[0].draft,'## Newer manual writing.');
    assert.equal(await h.page.locator('#feedback').inputValue(),'My next request');
    assert.match(await h.page.locator('#conversation').innerText(),/was not applied/);
    await h.page.getByRole('button',{name:'Try again'}).click();await h.complete();
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});
test('Stop, failed model, and failed save preserve writing and editable request input',async()=>{
  const h=await open();try{
    await h.request('slow edit');await h.page.getByRole('button',{name:'Stop',exact:true}).click();await h.complete();assert.equal((await h.state()).sessions[0].draft,initial);
    await h.request('test failure');await h.complete();assert.equal((await h.state()).sessions[0].draft,initial);assert.match(await h.page.locator('.problem-card').last().innerText(),/failure/);
    await h.page.route('**/api/state',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic disk full"}'}));
    await h.page.locator('#draft').fill('Unsaved text remains here.');await h.page.getByRole('button',{name:'Not saved · Retry'}).waitFor();
    assert.equal(await h.page.locator('#draft').innerText(),'Unsaved text remains here.');
    await h.page.unroute('**/api/state');await h.page.getByRole('button',{name:'Not saved · Retry'}).click();await h.saved();
    assert.equal((await h.state()).sessions[0].draft,'## Unsaved text remains here.');
  }finally{await h.close();}
});
test('history, original text, locking and unlocking remain explicit and reversible',async()=>{
  const h=await open();try{
    await h.request('Improve');await h.complete();
    await h.page.getByRole('tab',{name:'History',exact:true}).click();await h.page.getByRole('button',{name:/Original text/}).click();
    assert.match(await h.page.locator('#change-view').innerText(),/Original project notes\./);
    assert.equal(await h.page.getByRole('textbox',{name:'Document text',exact:true}).count(),0);
    await h.page.getByRole('button',{name:/^Improve/}).click();
    assert.match(await h.page.locator('#change-view del').first().innerText(),/discussed/);
    await h.page.locator('#review-bar').getByRole('button',{name:'Undo edit'}).click();
    assert.equal((await h.state()).sessions[0].draft,initial);
    await h.page.getByRole('button',{name:/Original text/}).click();await h.page.getByRole('button',{name:'Restore this version'}).click();
    assert.equal((await h.state()).sessions[0].draft,'Original project notes.');
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,initial);
    await h.page.getByRole('button',{name:'Document options'}).click();await h.page.getByRole('button',{name:'Lock document',exact:true}).click();
    assert.equal(await h.page.locator('#draft').getAttribute('contenteditable'),'false');
    await h.page.getByRole('tab',{name:'Conversation',exact:true}).click();await h.request('What happened?','Ask');await h.complete();assert.equal((await h.state()).sessions[0].draft,initial);
    await h.page.reload();await h.page.getByRole('button',{name:'Unlock to edit'}).click();assert.equal(await h.page.locator('#draft').getAttribute('contenteditable'),'true');
  }finally{await h.close();}
});
test('writing samples, paired examples, preferences and model controls persist',async()=>{
  const h=await open();try{
    await h.page.getByRole('button',{name:'Writing style',exact:true}).click();await h.page.getByLabel('Writing preferences').fill('Use concise sentences.');await h.page.getByRole('button',{name:'Add sample',exact:true}).click();
    await h.page.getByLabel('Name',{exact:true}).fill('Synthetic sample');await h.page.getByLabel('Sample',{exact:true}).fill('Write clearly.');await h.page.getByRole('button',{name:'Save example',exact:true}).click();
    await h.page.getByRole('button',{name:'Add before & after',exact:true}).click();await h.page.getByLabel('Name',{exact:true}).fill('Synthetic pair');await h.page.getByLabel('Before',{exact:true}).fill('too wordy');await h.page.getByLabel('After',{exact:true}).fill('concise');await h.page.getByRole('button',{name:'Save example',exact:true}).click();
    await h.page.locator('[data-example-toggle]').first().uncheck();await h.page.getByRole('button',{name:'Done',exact:true}).click();
    await h.page.getByRole('button',{name:'Settings',exact:true}).click();await h.page.getByLabel('Font',{exact:true}).selectOption('Georgia');await h.page.getByLabel('Include document date').check();await h.page.getByRole('button',{name:'Refresh models'}).click();await h.page.getByRole('button',{name:'Done',exact:true}).click();
    const state=await h.state();assert.equal(state.examples.length,2);assert.equal(state.examples[0].enabled,false);assert.equal(state.settings.voice,'Use concise sentences.');assert.equal(state.settings.font,'Georgia');assert.equal(state.settings.model,'synthetic');
    await h.page.reload();await h.page.getByRole('button',{name:'Writing style',exact:true}).click();assert.equal(await h.page.locator('[data-example-edit]').count(),2);
  }finally{await h.close();}
});
test('text import, copy, Word and text downloads retain writing without locking',async()=>{
  const h=await open();try{
    const file=path.join(output,'Imported.txt');await fs.writeFile(file,'Synthetic import.\n\nKeep café and 😀.');
    const chooser=h.page.waitForEvent('filechooser');await h.page.getByRole('button',{name:'Import',exact:true}).click();await(await chooser).setFiles(file);await h.page.getByRole('dialog').getByRole('button',{name:'New document',exact:true}).click();
    assert.equal(await h.page.locator('#draft').innerText(),'Synthetic import.\n\nKeep café and 😀.');
    await h.page.getByRole('button',{name:'Copy',exact:true}).click();assert.equal(await h.page.evaluate(()=>navigator.clipboard.readText()),'Synthetic import.\n\nKeep café and 😀.');
    for(const format of ['txt','docx']){
      await h.page.getByRole('button',{name:'Export',exact:true}).click();await h.page.getByLabel('File type').selectOption(format);
      const download=h.page.waitForEvent('download');await h.page.getByRole('button',{name:'Download',exact:true}).click();const result=await download;const destination=path.join(output,result.suggestedFilename());await result.saveAs(destination);
      const data=await fs.readFile(destination);if(format==='txt')assert.equal(data.toString(),'Synthetic import.\n\nKeep café and 😀.');else assert.equal(data.subarray(0,2).toString(),'PK');
      assert.equal(await h.page.locator('#draft').getAttribute('contenteditable'),'true');
    }
    assert.equal((await h.state()).sessions.length,2);
  }finally{await h.close();}
});
test('mobile drawer preserves selection, request, focus, keyboard escape and no overflow',async()=>{
  const h=await open({width:390,height:844});try{
    await select(h.page,1,'No decision was made.');await h.page.getByRole('button',{name:'Assistant',exact:true}).click();
    await h.page.locator('#feedback').fill('Keep this unfinished request');assert.match(await h.page.locator('#selection-context').innerText(),/Selection/);
    await h.page.keyboard.press('Escape');assert.equal(await h.page.getByRole('button',{name:'Assistant',exact:true}).evaluate(e=>e===document.activeElement),true);
    await h.page.getByRole('button',{name:'Assistant',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'Keep this unfinished request');
    assert.match(await h.page.locator('#selection-context').innerText(),/No decision was made/);await h.page.screenshot({path:path.join(output,'mobile-assistant.png')});
    await h.page.keyboard.press('Escape');assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await h.page.screenshot({path:path.join(output,'mobile.png')});
    await h.page.setViewportSize({width:720,height:500}); // 1440x1000 at 200% browser zoom uses this CSS viewport.
    assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await h.page.getByRole('button',{name:'Settings',exact:true}).click();await h.page.keyboard.press('Shift+Tab');assert.equal(await h.page.getByRole('button',{name:'Done',exact:true}).evaluate(e=>e===document.activeElement),true);
    await h.page.keyboard.press('Escape');assert.equal(await h.page.getByRole('button',{name:'Settings',exact:true}).evaluate(e=>e===document.activeElement),true);
  }finally{await h.close();}
});
test('desktop preview, local fonts and requests stay on loopback',async()=>{
  const h=await open();try{
    await h.page.evaluate(()=>document.fonts.ready);await h.page.screenshot({path:path.join(output,'desktop.png')});
    assert.equal(await h.page.locator('#draft').evaluate(e=>getComputedStyle(e).fontFamily),'"Source Serif 4", Georgia, serif');
    await h.request('Make it clearer');await h.complete();assert.deepEqual(h.external,[]);
    console.log('Synthetic verification artifacts: '+output);
  }finally{await h.close();}
});

test('Markdown, Word, PDF and writing-example imports work through the file picker',async()=>{
  const h=await open();try{
    const {execFileSync}=require('node:child_process');
    execFileSync(python,['-c',`
from pathlib import Path
from docx import Document
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject,NameObject,DecodedStreamObject
import sys
root=Path(sys.argv[1])
(root/'Synthetic.md').write_text('## Imported heading\\n\\nSynthetic markdown.',encoding='utf-8')
doc=Document();doc.add_paragraph('Synthetic Word import.');doc.save(root/'Synthetic.docx')
writer=PdfWriter();page=writer.add_blank_page(width=612,height=792)
font=DictionaryObject({NameObject('/Type'):NameObject('/Font'),NameObject('/Subtype'):NameObject('/Type1'),NameObject('/BaseFont'):NameObject('/Helvetica')})
page[NameObject('/Resources')]=DictionaryObject({NameObject('/Font'):DictionaryObject({NameObject('/F1'):font})})
stream=DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 72 720 Td (Synthetic PDF import.) Tj ET')
page[NameObject('/Contents')]=writer._add_object(stream)
writer.write(root/'Synthetic.pdf')
`,output]);
    for(const ext of ['md','docx','pdf']) {
      const chooser=h.page.waitForEvent('filechooser');await h.page.getByRole('button',{name:'Import',exact:true}).click();await(await chooser).setFiles(path.join(output,'Synthetic.'+ext));await h.page.getByRole('dialog').getByRole('button',{name:'New document',exact:true}).click();
      assert.match(await h.page.locator('#draft').innerText(),ext==='md'?/Synthetic markdown/:ext==='docx'?/Synthetic Word import/:/Synthetic PDF import/);await h.saved();
    }
    await h.page.getByRole('button',{name:'Writing style',exact:true}).click();await h.page.getByRole('button',{name:'Add sample',exact:true}).click();
    const chooser=h.page.waitForEvent('filechooser');await h.page.getByRole('button',{name:'Import sample',exact:true}).click();await(await chooser).setFiles(path.join(output,'Synthetic.docx'));
    await h.page.getByRole('textbox',{name:'Sample',exact:true}).waitFor();
    await h.page.waitForFunction(()=>document.querySelector('[data-example-field="text"]').value.includes('Synthetic Word import.'));
    await h.page.getByRole('button',{name:'Save example',exact:true}).click();await h.page.getByRole('button',{name:'Done',exact:true}).click();
    assert.match((await h.state()).examples[0].text,/Synthetic Word import/);
    await h.page.getByRole('button',{name:'New',exact:true}).click();await h.page.getByRole('textbox',{name:'Document title'}).fill('Keyboard document');await h.page.locator('#draft').fill('A new document.');await h.saved();
    assert.equal((await h.state()).sessions.length,5);
  }finally{await h.close();}
});
test('preset revisions wait for submission; background requests stay with their originating document',async()=>{
  const other={...document('A second document.','two'),title:'Second document'};
  const h=await open({docs:[document(),other]});try{
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'Tighten',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,initial);await h.page.getByRole('button',{name:'Tighten document',exact:true}).click();await h.complete();
    assert.equal((await h.state()).sessions[0].draft,revised);
    await h.request('slow edit');await h.page.getByRole('button',{name:'Documents',exact:true}).click();await h.page.locator('[data-open="two"]').click();await h.page.getByRole('dialog').waitFor({state:'hidden'});
    await h.page.locator('#draft').fill('Second document has newer writing.');await h.complete();
    const state=await h.state();assert.equal(state.sessions[0].draft,revised);assert.equal(state.sessions[1].draft,'Second document has newer writing.');
    assert.equal(await h.page.getByRole('button',{name:'Clear conversation'}).isVisible(),false);assert.equal((await h.state()).sessions[1].history.length,0);
  }finally{await h.close();}
});

test('long conversations remain scrollable while the composer stays visible at 200% zoom',async()=>{
  const doc=document();doc.history=Array.from({length:20},(_,i)=>({role:i%2?'assistant':'user',content:'A longer synthetic message about a document. '.repeat(4)}));
  const h=await open({docs:[doc],width:933,height:594});try{
    const bounds=await h.page.evaluate(()=>({height:innerHeight,ask:document.querySelector('#submit-request').getBoundingClientRect().bottom,footer:document.querySelector('.document-footer').getBoundingClientRect().bottom,conversation:document.querySelector('.conversation').getBoundingClientRect().height}));
    assert.ok(bounds.ask<=bounds.height);assert.ok(bounds.footer<=bounds.height);assert.ok(bounds.conversation>80);
    await h.page.screenshot({path:path.join(output,'zoomed.png')});
    await h.page.setViewportSize({width:390,height:844});await h.page.getByRole('button',{name:'Assistant',exact:true}).click();
    assert.equal(await h.page.locator('.turn').first().evaluate(e=>getComputedStyle(e).position),'static');
    await h.page.locator('#feedback').fill('Mobile request remains reachable');
    await h.page.getByRole('button',{name:'Close assistant'}).click();await h.page.getByRole('button',{name:'Assistant',exact:true}).click();
    await h.page.screenshot({path:path.join(output,'mobile-conversation.png')});
  }finally{await h.close();}
});

test('unfinished writing examples survive Escape and reload without becoming active references',async()=>{
  const h=await open();try{
    await h.page.getByRole('button',{name:'Writing style',exact:true}).click();await h.page.getByRole('button',{name:'Add sample',exact:true}).click();
    assert.equal(await h.page.getByLabel('Name',{exact:true}).evaluate(e=>e===document.activeElement),true);
    await h.page.getByLabel('Name',{exact:true}).fill('Friendly notes');await h.page.getByLabel('Sample',{exact:true}).fill('Thanks for the conversation.');
    await h.page.keyboard.press('Escape');assert.equal((await h.state()).examples.length,0);
    await h.page.reload();await h.page.getByRole('button',{name:'Writing style',exact:true}).click();await h.page.getByRole('button',{name:'Continue sample',exact:true}).click();
    assert.equal(await h.page.getByLabel('Name',{exact:true}).inputValue(),'Friendly notes');assert.equal(await h.page.getByLabel('Sample',{exact:true}).inputValue(),'Thanks for the conversation.');
    await h.page.getByRole('button',{name:'Save example',exact:true}).click();await h.page.getByRole('button',{name:'Done',exact:true}).click();
    const state=await h.state();assert.equal(state.examples.length,1);assert.equal(state.settings.exampleDrafts['new-writing'],undefined);
  }finally{await h.close();}
});
test('export formatting stays in Export; text downloads contain visible writing and keep Unicode names',async()=>{
  const h=await open({docs:[{...document('# Café\n\nA **clear** note.\n\n- First item\n- Second item'),title:'Café notes'}]});try{
    assert.equal(await h.page.locator('#word-count').innerText(),'8 words');
    await h.page.getByRole('button',{name:'Export',exact:true}).click();await h.page.getByText('Word formatting',{exact:true}).click();
    await h.page.getByLabel('Font',{exact:true}).selectOption('Georgia');assert.match(await h.page.locator('#export-summary').innerText(),/Georgia/);
    assert.equal(await h.page.getByRole('dialog').getByRole('heading',{name:'Export',exact:true}).count(),1);
    await h.page.getByLabel('File type',{exact:true}).selectOption('txt');assert.equal(await h.page.locator('.export-options').isVisible(),false);
    const download=h.page.waitForEvent('download');await h.page.getByRole('button',{name:'Download',exact:true}).click();const result=await download;
    assert.equal(result.suggestedFilename(),'Café notes.txt');const destination=path.join(output,'plain-export.txt');await result.saveAs(destination);
    assert.equal(await fs.readFile(destination,'utf8'),'Café\n\nA clear note.\n\n- First item\n- Second item');
    await h.page.getByRole('button',{name:'Copy',exact:true}).click();assert.equal(await h.page.evaluate(()=>navigator.clipboard.readText()),await fs.readFile(destination,'utf8'));
  }finally{await h.close();}
});
test('quick edits keep an unfinished question in the request box',async()=>{
  const h=await open();try{
    await h.page.locator('#feedback').fill('What date is the follow-up?');await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'Clarify',exact:true}).click();await h.page.getByRole('button',{name:'Clarify document',exact:true}).click();await h.complete();await h.page.getByRole('tab',{name:'Chat',exact:true}).click();
    assert.equal(await h.page.locator('#feedback').inputValue(),'What date is the follow-up?');
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});
test('stale selected edits can retry on a newly selected exact range',async()=>{
  const h=await open({docs:[document('Keep this.\n\nChange this.\n\nKeep the ending.')]});try{
    await select(h.page,1,'Change this.');await h.request('slow revision');
    await h.page.locator('#draft').fill('Keep this newer sentence. Change this. Keep the ending.');await h.complete();
    await h.page.getByRole('button',{name:'Try again'}).click();await h.page.locator('#toast').filter({hasText:'Highlight the passage again'}).waitFor();
    assert.equal((await h.state()).sessions[0].draft,'Keep this newer sentence. Change this. Keep the ending.');
    await select(h.page,0,'Change this.');await h.page.getByRole('button',{name:'Try again'}).click();await h.complete();
    assert.equal((await h.state()).sessions[0].draft,'Keep this newer sentence. The team deferred the decision. Keep the ending.');
  }finally{await h.close();}
});
test('New does not create duplicate empty documents; restoring a version restores its title and date',async()=>{
  const h=await open();try{
    await h.page.getByRole('button',{name:'New',exact:true}).click();await h.saved();await h.page.getByRole('button',{name:'New',exact:true}).click();await h.saved();assert.equal((await h.state()).sessions.length,2);
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.getByRole('button',{name:'New document',exact:true}).click();assert.equal((await h.state()).sessions.length,2);
    await h.page.getByRole('button',{name:'Document options'}).click();await h.page.locator('#document-date').fill('2026-09-25');await h.page.getByRole('button',{name:'Done',exact:true}).click();
    await h.page.getByRole('textbox',{name:'Document title'}).fill('First title');await h.page.locator('#draft').fill('First writing.');await h.request('Improve this');await h.complete();
    await h.page.getByRole('button',{name:'Document options'}).click();await h.page.locator('#document-date').fill('2026-10-10');await h.page.getByRole('button',{name:'Done',exact:true}).click();
    await h.page.getByRole('textbox',{name:'Document title'}).fill('Later title');await h.page.locator('#review-bar').getByRole('button',{name:'Done'}).click();await h.page.locator('#draft').fill('Later writing.');await h.saved();
    await h.page.getByRole('button',{name:'Show changes'}).click();await h.page.getByRole('button',{name:'Restore version before this edit'}).click();
    assert.equal(await h.page.getByRole('textbox',{name:'Document title'}).inputValue(),'First title');assert.equal((await h.state()).sessions[0].draft,'First writing.');
    assert.equal((await h.state()).sessions[0].date,'2026-09-25');
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal(await h.page.getByRole('textbox',{name:'Document title'}).inputValue(),'Later title');assert.equal((await h.state()).sessions[0].date,'2026-10-10');
    await h.page.getByRole('button',{name:'Redo',exact:true}).click();
    assert.equal(await h.page.getByRole('textbox',{name:'Document title'}).inputValue(),'First title');assert.equal((await h.state()).sessions[0].date,'2026-09-25');
  }finally{await h.close();}
});

test('edit evidence, exact undo and reapply survive reload and clearing the conversation',async()=>{
  const h=await open();try{
    await h.request('Make this clearer');await h.complete();
    assert.match(await h.page.locator('.edit-card').innerText(),/\+1\s*−1\s*words/);
    assert.equal(await h.page.locator('#review-bar').isVisible(),true);
    assert.match(await h.page.locator('#change-view del').innerText(),/discussed/);
    assert.match(await h.page.locator('#change-view ins').innerText(),/reviewed/);
    assert.match(await h.page.locator('#review-bar').innerText(),/Revised the document[\s\S]*took/);
    await h.page.locator('#review-bar').getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await h.page.locator('#draft').isVisible(),true);assert.equal(await h.page.locator('#review-bar').isVisible(),false);
    await h.page.locator('.edit-card').getByRole('button',{name:'Show changes',exact:true}).click();assert.equal(await h.page.locator('#change-view').isVisible(),true);
    await h.page.keyboard.press('Escape');assert.equal(await h.page.locator('#change-view').isVisible(),false);
    await h.page.reload();
    assert.match(await h.page.locator('.turn-meta').last().innerText(),/took (\d+s|under 1s)/);
    await h.page.locator('.edit-card').getByRole('button',{name:'Undo edit',exact:true}).click();
    assert.equal((await h.state()).sessions[0].draft,initial);
    assert.match(await h.page.locator('.edit-card').innerText(),/Undone/);
    await h.page.locator('.edit-card').getByRole('button',{name:'Reapply edit',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,revised);
    await h.page.locator('#review-bar').getByRole('button',{name:'Done',exact:true}).click();
    await h.page.getByRole('button',{name:'Clear conversation'}).click();await h.page.getByRole('dialog').getByRole('button',{name:'Clear',exact:true}).click();
    await h.page.getByRole('tab',{name:'History',exact:true}).click();await h.page.getByRole('button',{name:/^Make this clearer/}).click();
    await h.page.locator('#review-bar').getByRole('button',{name:'Undo edit'}).click();assert.equal((await h.state()).sessions[0].draft,initial);
  }finally{await h.close();}
});
test('older edit cannot silently replace newer typing; restore saves the newer writing',async()=>{
  const h=await open();try{
    await h.request('Make this clearer');await h.complete();
    await h.page.locator('#change-view').click();assert.equal(await h.page.locator('#draft').evaluate(e=>e===document.activeElement),true);
    await h.page.locator('#draft').fill('My newer writing matters.');await h.saved();
    // Undo can no longer be exact, so it opens the changes instead of silently doing nothing.
    assert.equal(await h.page.locator('.edit-card').getByRole('button',{name:'Undo edit'}).count(),0);
    assert.equal(await h.page.locator('.edit-card').getByRole('button',{name:'Undo…'}).isEnabled(),true);
    assert.match(await h.page.locator('.edit-card').innerText(),/Edited since/);
    const newer=(await h.state()).sessions[0].draft;
    await h.page.locator('.edit-card').getByRole('button',{name:'Show changes'}).click();
    assert.equal((await h.state()).sessions[0].draft,newer);
    await h.page.getByRole('button',{name:'Restore version before this edit',exact:true}).click();
    const s=(await h.state()).sessions[0];assert.equal(s.draft,initial);assert.ok(s.versions.some(v=>v.text===newer));
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();assert.equal((await h.state()).sessions[0].draft,newer);
  }finally{await h.close();}
});
test('section picker, selected edits and follow-up tweaks retain the same exact scope',async()=>{
  const original='# Note\n\n## Opening\n\nCafé 😀 repeats.\n\n## Next steps\n\nKeep **every word** here.';
  const h=await open({docs:[document(original)]});try{
    await h.page.getByRole('button',{name:'Whole document'}).click();await h.page.getByRole('button',{name:'Opening Heading and everything under it'}).click();
    assert.match(await h.page.locator('#selection-context').innerText(),/Opening/);
    await h.request('Make the opening warmer');await h.complete();
    const changed=(await h.state()).sessions[0].draft;
    assert.equal(changed,'# Note\n\nThe team deferred the decision.\n\n## Next steps\n\nKeep **every word** here.');
    assert.match(await h.page.locator('.edit-card').innerText(),/Revised “Opening”/);
    assert.match(await h.page.locator('#selection-context').innerText(),/The team deferred/);
    await h.saved();await h.page.reload();assert.match(await h.page.locator('#selection-context').innerText(),/The team deferred/);
    let payload;h.page.on('request',req=>{if(req.url().endsWith('/api/generate'))payload=req.postDataJSON();});
    await h.request('Can you explain that choice?','Ask');await h.complete();
    assert.equal(payload.scope,'selection');assert.equal(payload.selection,'The team deferred the decision.');
    assert.match(payload.history.at(-1).content,/Replacement: /);assert.doesNotMatch(payload.history.at(-1).content,/Previous selected wording/);assert.equal(payload.source,'');
    assert.equal((await h.state()).sessions[0].draft,changed);
    await h.request('Try once more');await h.complete();
    assert.match(await h.page.locator('.outcome-note').last().innerText(),/matched your current text, so the selected passage is unchanged\. If you expected a change/);
    assert.equal((await h.state()).sessions[0].edits.length,1);
  }finally{await h.close();}
});
test('pending request, progress, cancellation and retry instruction are visible and truthful',async()=>{
  const h=await open();try{
    await h.request('slow edit');await h.page.getByRole('button',{name:'Stop',exact:true}).waitFor();
    assert.match(await h.page.locator('.turn-user').innerText(),/slow edit/);
    assert.equal(await h.page.locator('#feedback').inputValue(),'');
    assert.match(await h.page.locator('#live-status').innerText(),/Preparing|Reading|Working|Getting ready|Writing/);
    assert.equal(await h.page.locator('#live-elapsed').isVisible(),true);
    assert.match(await h.page.locator('#document-activity').innerText(),/Revising · \d+s/);
    await h.page.getByRole('button',{name:'Stop',exact:true}).click();await h.complete();
    assert.match(await h.page.locator('#conversation').innerText(),/Stopped/);
    assert.match(await h.page.locator('.stopped-note').last().locator('..').innerText(),/after (\d+s|under 1s)/);assert.equal(await h.page.locator('.stopped-note').count(),1);
    assert.equal(await h.page.locator('#feedback').inputValue(),'slow edit');
    assert.equal((await h.state()).sessions[0].draft,initial);
    await h.request('Try a clear edit');await h.complete();
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});

test('formatting-only edits explain visible structure and show formatted comparisons',async()=>{
  const h=await open();try{
    await h.request('test formatting only');await h.complete();
    assert.match(await h.page.locator('.edit-card').innerText(),/1 bullet point added/);
    assert.equal(await h.page.getByRole('textbox',{name:'Document text',exact:true}).count(),0);
    assert.equal(await h.page.locator('#change-view h1.change-format').count(),1);
    assert.equal(await h.page.locator('#change-view li.change-format').count(),1);
    assert.equal(await h.page.locator('#change-view ins, #change-view del').count(),0);
    await h.page.screenshot({path:path.join(output,'formatting-review.png')});
    await h.page.locator('#review-bar').getByRole('button',{name:'Undo edit'}).click();
    assert.equal((await h.state()).sessions[0].draft,initial);
  }finally{await h.close();}
});
test('a selected scope stays visible, is saved, and undo/reapply retain that scope',async()=>{
  const h=await open();try{
    await select(h.page,1,'No decision was made.');await h.request('Rewrite just this');await h.complete();
    assert.equal(await h.page.locator('#draft').evaluate(()=>CSS.highlights.has('folio-scope')),true);
    await h.page.locator('.edit-card').getByRole('button',{name:'Undo edit'}).click();
    assert.match(await h.page.locator('#selection-context').innerText(),/No decision was made/);
    await h.page.locator('.edit-card').getByRole('button',{name:'Reapply edit'}).click();await h.page.locator('#review-bar').getByRole('button',{name:'Done'}).click();
    assert.match(await h.page.locator('#selection-context').innerText(),/The team deferred/);
    await h.saved();await h.page.reload();
    assert.match(await h.page.locator('#selection-context').innerText(),/The team deferred/);
    await h.page.getByRole('button',{name:'Clear selection'}).click();await h.saved();await h.page.reload();
    assert.equal(await h.page.locator('#selection-context').isVisible(),false);assert.match(await h.page.locator('#choose-scope').innerText(),/Whole document/);
  }finally{await h.close();}
});

test('interrupted requests restore the instruction with an explanation and no automatic model retry',async()=>{
  const doc=document();doc.history=[{role:'user',content:'Make this clearer',mode:'revise',scope:'document',status:'pending'}];
  const h=await open({docs:[doc]});try{
    assert.match(await h.page.locator('#request-status').innerText(),/previous request was interrupted/);
    assert.equal(await h.page.locator('#feedback').inputValue(),'Make this clearer');
    assert.equal((await h.state()).sessions[0].draft,initial);
    assert.equal((await h.state()).sessions[0].history[0].status,'failed');
    assert.equal(await h.page.locator('#stop-button').isVisible(),false);
  }finally{await h.close();}
});
test('export downloads the reviewed version even if an edit completes while Export is open',async()=>{
  const h=await open();try{
    await h.request('slow edit');await h.page.locator('#stop-button').waitFor({state:'visible'});
    await h.page.getByRole('button',{name:'Export',exact:true}).click();
    assert.match(await h.page.locator('.export-preview').innerText(),/discussed/);
    await h.complete();assert.equal((await h.state()).sessions[0].draft,revised);
    await h.page.getByLabel('File type').selectOption('txt');
    const pending=h.page.waitForEvent('download');await h.page.getByRole('button',{name:'Download',exact:true}).click();
    const download=await pending,destination=path.join(output,'reviewed-export.txt');await download.saveAs(destination);
    assert.match(await fs.readFile(destination,'utf8'),/discussed/);
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});

test('ordinary text redo does not undo a later document rename',async()=>{
  const h=await open();try{
    await h.page.locator('#draft').fill('New manual writing.');await h.saved();
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();
    await h.page.getByRole('textbox',{name:'Document title'}).fill('Renamed after undo');
    await h.page.getByRole('button',{name:'Redo',exact:true}).click();
    assert.equal((await h.state()).sessions[0].title,'Renamed after undo');
    assert.match((await h.state()).sessions[0].draft,/New manual writing/);
  }finally{await h.close();}
});

test('Trash and restore retain locked writing, source, conversations and edit receipts across reload',async()=>{
  const h=await open({docs:[document(),{...document('Other working document.','two'),title:'Other draft'}]});try{
    await h.request('Make the writing clearer');await h.complete();
    await h.page.getByRole('button',{name:'Document options',exact:true}).click();
    await h.page.getByRole('button',{name:'Lock document',exact:true}).click();
    const before=(await h.state()).sessions.find(s=>s.id==='one');
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();
    await h.page.getByRole('button',{name:'Move Project update to Trash',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'moved to Trash'}).waitFor();
    assert.equal(await h.page.locator('[data-open="one"]').count(),0);
    assert.equal(await h.page.locator('#draft').innerText(),'Other working document.');
    assert.ok((await h.state()).sessions.find(s=>s.id==='one').deletedAt);
    await h.page.reload();assert.equal(await h.page.locator('#document-title').inputValue(),'Other draft');
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.getByRole('button',{name:'Trash (1)',exact:true}).click();
    await h.page.getByRole('button',{name:'Restore Project update',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'restored to Documents'}).waitFor();
    const restored=(await h.state()).sessions.find(s=>s.id==='one');
    for(const key of ['draft','source','status','history','versions','edits'])assert.deepEqual(restored[key],before[key]);
    assert.equal(restored.deletedAt,undefined);
    await h.page.locator('[data-open="one"]').click();
    assert.equal(await h.page.locator('#draft').getAttribute('contenteditable'),'false');
    await h.page.getByRole('button',{name:'Unlock to edit',exact:true}).click();
    await h.page.getByRole('button',{name:'Undo edit',exact:true}).click();
    assert.equal((await h.state()).sessions.find(s=>s.id==='one').draft,initial);
    await h.page.getByRole('button',{name:'Reapply edit',exact:true}).click();
    assert.equal((await h.state()).sessions.find(s=>s.id==='one').draft,revised);
  }finally{await h.close();}
});

test('last document can move to Trash from options and Undo restores it without losing writing',async()=>{
  const h=await open();try{
    await h.page.getByRole('button',{name:'Document options',exact:true}).click();
    await h.page.getByRole('button',{name:'Move to Trash',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'A new blank document is ready'}).waitFor();
    assert.equal((await h.page.locator('#draft').innerText()).trim(),'');
    const removed=await h.state();assert.equal(removed.sessions.filter(s=>!s.deletedAt).length,1);
    assert.equal(removed.sessions.find(s=>s.id==='one').draft,initial);
    await h.page.getByRole('dialog').getByRole('button',{name:'Undo',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'restored to Documents'}).waitFor();
    await h.page.locator('[data-open="one"]').click();await h.saved();
    await h.page.reload();assert.equal(await h.page.locator('#draft').innerText(),initial.replace('## ',''));
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.getByRole('button',{name:'Trash (0)',exact:true}).click();
    assert.match(await h.page.locator('.library-empty').innerText(),/^Trash is empty\./);
  }finally{await h.close();}
});

test('document library search, inactive removal and Undo work on narrow screens without overflow',async()=>{
  const title='Older notes: Café 😀 '+('long title '.repeat(12));
  const h=await open({width:390,height:844,docs:[document(),{...document('Keep this old draft.','two'),title}]});try{
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();
    await h.page.getByRole('searchbox',{name:'Search documents'}).fill('café');
    assert.equal(await h.page.locator('[data-library-row="one"]').isVisible(),false);
    assert.equal(await h.page.locator('[data-library-row="two"]').isVisible(),true);
    assert.equal(await h.page.locator('.modal-content').evaluate(e=>e.scrollWidth<=e.clientWidth),true);
    await h.page.getByRole('button',{name:`Move ${title} to Trash`,exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'moved to Trash'}).waitFor();
    assert.equal(await h.page.locator('#document-title').inputValue(),'Project update');
    await h.page.getByRole('dialog').getByRole('button',{name:'Undo',exact:true}).click();
    await h.page.locator('[data-open="two"]').waitFor();
    assert.equal((await h.state()).sessions.find(s=>s.id==='two').deletedAt,undefined);
    await h.page.getByRole('searchbox',{name:'Search documents'}).fill('no match');
    assert.equal(await h.page.locator('#library-no-results').isVisible(),true);
    await h.page.keyboard.press('Escape');
    assert.equal(await h.page.getByRole('button',{name:'Documents',exact:false}).evaluate(e=>e===document.activeElement),true);
    assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  }finally{await h.close();}
});

test('moving a document to Trash stops its pending edit and restores the unchanged draft',async()=>{
  const h=await open({docs:[document(),{...document('Other document.','two'),title:'Other draft'}]});try{
    await h.request('slow edit');await h.page.getByRole('button',{name:'Stop',exact:true}).waitFor();
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();
    await h.page.getByRole('button',{name:'Move Project update to Trash',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'moved to Trash'}).waitFor();await h.complete();
    const trashed=(await h.state()).sessions.find(s=>s.id==='one');
    assert.equal(trashed.draft,initial);assert.equal(trashed.edits.length,0);
    assert.equal(trashed.history[0].status,'failed');assert.equal(trashed.feedback,'slow edit');
    await h.page.getByRole('button',{name:'Trash (1)',exact:true}).click();
    await h.page.getByRole('button',{name:'Restore Project update',exact:true}).click();
    await h.page.locator('[data-open="one"]').click();
    assert.equal(await h.page.locator('#draft').innerText(),initial.replace('## ',''));
    await h.request('Make it clearer');await h.complete();
    assert.equal((await h.state()).sessions.find(s=>s.id==='one').draft,revised);
  }finally{await h.close();}
});

test('permanent deletion requires Trash and confirmation, and cancellation preserves the document',async()=>{
  const removed={...document('Old writing.','old'),title:'Old notes',deletedAt:'2026-09-29T12:00:00Z'};
  const h=await open({docs:[document(),removed]});try{
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();
    assert.equal(await h.page.locator('[data-delete-document]').count(),0);
    await h.page.getByRole('button',{name:'Trash (1)',exact:true}).click();
    await h.page.getByRole('button',{name:'Delete Old notes permanently',exact:true}).click();
    assert.match(await h.page.getByRole('dialog').innerText(),/This cannot be undone/);
    await h.page.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal((await h.state()).sessions.some(s=>s.id==='old'),true);
    await h.page.getByRole('button',{name:'Delete Old notes permanently',exact:true}).click();
    await h.page.getByRole('button',{name:'Delete permanently',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'permanently deleted'}).waitFor();
    assert.equal((await h.state()).sessions.some(s=>s.id==='old'),false);
    assert.equal(await h.page.locator('.library-empty').isVisible(),true);
    await h.page.getByRole('button',{name:'Done',exact:true}).click();await h.page.reload();
    assert.equal(await h.page.locator('#draft').innerText(),initial.replace('## ',''));
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.getByRole('button',{name:'Trash (0)',exact:true}).click();
    assert.equal(await h.page.locator('[data-restore-document]').count(),0);
  }finally{await h.close();}
});

test('failed document removal rolls back the open draft and offers a usable retry',async()=>{
  const h=await open();try{
    await h.saved();await h.page.getByRole('button',{name:'Document options',exact:true}).click();
    await h.page.route('**/api/state',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic disk full"}'}));
    await h.page.getByRole('button',{name:'Move to Trash',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'The change was not saved'}).waitFor();
    assert.equal(await h.page.locator('#draft').innerText(),initial.replace('## ',''));
    assert.equal(await h.page.locator('[data-open="one"]').isVisible(),true);
    await h.page.unroute('**/api/state');
    await h.page.getByRole('button',{name:'Move Project update to Trash',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'moved to Trash'}).waitFor();
    const state=await h.state();assert.equal(state.sessions.length,2);assert.ok(state.sessions.find(s=>s.id==='one').deletedAt);
    await h.page.reload();assert.equal(await h.page.locator('#document-title').inputValue(),'Untitled document');
  }finally{await h.close();}
});

test('loading a workspace containing only Trash opens a blank page and keeps restoration available',async()=>{
  const h=await open({docs:[{...document(),deletedAt:'2026-09-29T12:00:00Z'}]});try{
    assert.equal(await h.page.locator('#document-title').inputValue(),'Untitled document');
    assert.equal((await h.page.locator('#draft').innerText()).trim(),'');await h.saved();
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.getByRole('button',{name:'Trash (1)',exact:true}).click();
    await h.page.getByRole('button',{name:'Restore Project update',exact:true}).click();
    await h.page.locator('[data-open="one"]').click();assert.equal(await h.page.locator('#draft').innerText(),initial.replace('## ',''));
  }finally{await h.close();}
});

for(const operation of ['restore','delete'])test(`failed Trash ${operation} keeps the complete document recoverable`,async()=>{
  const removed={...document('Earlier **draft**.','old'),title:'Old notes',deletedAt:'2026-09-29T12:00:00Z',history:[{role:'user',content:'Keep this conversation',status:'complete'}],versions:[{id:'saved',text:'Original version',title:'Old notes'}]};
  const h=await open({docs:[document(),removed]});try{
    await h.saved();await h.page.getByRole('button',{name:'Documents',exact:false}).click();
    await h.page.getByRole('button',{name:'Trash (1)',exact:true}).click();
    if(operation==='delete')await h.page.getByRole('button',{name:'Delete Old notes permanently',exact:true}).click();
    await h.page.route('**/api/state',r=>r.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic disk full"}'}));
    await h.page.getByRole('button',{name:operation==='restore'?'Restore Old notes':'Delete permanently',exact:true}).click();
    await h.page.locator('.library-feedback').filter({hasText:'The change was not saved'}).waitFor();
    assert.equal(await h.page.getByRole('button',{name:'Restore Old notes',exact:true}).isEnabled(),true);
    await h.page.unroute('**/api/state');
    await h.page.getByRole('button',{name:'Restore Old notes',exact:true}).click();
    await h.page.locator('[data-open="old"]').waitFor();
    const restored=(await h.state()).sessions.find(s=>s.id==='old');
    for(const key of ['draft','history','versions','source'])assert.deepEqual(restored[key],removed[key]);
    assert.equal(restored.deletedAt,undefined);
  }finally{await h.close();}
});

test('Chat is the default with one send action; replies leave the document untouched',async()=>{
  const h=await open();try{
    const requests=[];h.page.on('request',r=>{if(r.url().endsWith('/api/generate'))requests.push(r.postDataJSON());});
    assert.equal(await h.page.getByRole('tab',{name:'Chat',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await h.page.locator('#quick-edit-presets').isVisible(),false);
    assert.equal(await h.page.locator('.composer-row .send-button:visible').count(),1);
    assert.equal(await h.page.getByRole('button',{name:'Send message',exact:true}).isEnabled(),false);
    assert.equal(await h.page.locator('#mode-help').count(),0);
    await h.page.getByRole('textbox',{name:'Message',exact:true}).fill('Could this be clearer?');
    await h.page.getByRole('button',{name:'Send message',exact:true}).click();await h.complete();
    assert.equal(requests.length,1);assert.equal(requests[0].mode,'discuss');
    const state=await h.state();assert.equal(state.sessions[0].draft,initial);assert.equal(state.sessions[0].edits.length,0);
    assert.equal(await h.page.locator('.turn-assistant .message-body').count(),1);assert.match(await h.page.locator('.turn-assistant .turn-meta').innerText(),/took (\d+s|under 1s)/);
  }finally{await h.close();}
});

test('revision presets stage an editable request and explicitly target the selection',async()=>{
  const h=await open();try{
    const requests=[];h.page.on('request',r=>{if(r.url().endsWith('/api/generate'))requests.push(r.postDataJSON());});
    await select(h.page,1,'No decision was made.');
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();
    await h.page.getByRole('button',{name:'Proofread',exact:true}).click();
    assert.equal(await h.page.getByRole('button',{name:'Proofread',exact:true}).getAttribute('aria-pressed'),'true');
    assert.match(await h.page.getByRole('textbox',{name:'Revision request',exact:true}).inputValue(),/grammar/);
    assert.equal(await h.page.getByRole('button',{name:'Proofread selection',exact:true}).isEnabled(),true);
    assert.equal((await h.state()).sessions[0].draft,initial);assert.equal(requests.length,0);
    await h.page.getByRole('textbox',{name:'Revision request',exact:true}).fill('Keep the meaning but change the wording.');
    assert.equal(await h.page.getByRole('button',{name:'Proofread',exact:true}).getAttribute('aria-pressed'),'false');
    await h.page.getByRole('button',{name:'Revise selection',exact:true}).click();await h.complete();
    assert.equal(requests.length,1);assert.equal(requests[0].mode,'revise');assert.equal(requests[0].selection,'No decision was made.');
    assert.equal((await h.state()).sessions[0].draft,initial.replace('No decision was made.','The team deferred the decision.'));
    assert.equal(await h.page.locator('.edit-card').count(),1);
  }finally{await h.close();}
});

test('Chat and Revise keep separate drafts across reload and document switches',async()=>{
  const h=await open({docs:[document(),{...document('Other document.','two'),title:'Other draft'}]});try{
    await h.page.getByRole('textbox',{name:'Message',exact:true}).fill('Why this word?');
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();
    assert.equal(await h.page.locator('#feedback').inputValue(),'');
    await h.page.getByRole('textbox',{name:'Revision request',exact:true}).fill('Use a quieter verb.');await h.saved();
    await h.page.reload();assert.equal(await h.page.getByRole('tab',{name:'Revise',exact:true}).getAttribute('aria-selected'),'true');
    assert.equal(await h.page.locator('#feedback').inputValue(),'Use a quieter verb.');
    await h.page.getByRole('tab',{name:'Chat',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'Why this word?');
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.locator('[data-open="two"]').click();await h.page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await h.page.locator('#feedback').inputValue(),'');
    await h.page.getByRole('button',{name:'Documents',exact:false}).click();await h.page.locator('[data-open="one"]').click();await h.page.getByRole('dialog').waitFor({state:'hidden'});
    assert.equal(await h.page.locator('#feedback').inputValue(),'Why this word?');
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'Use a quieter verb.');
  }finally{await h.close();}
});

test('stopping a request after changing modes restores only its own draft',async()=>{
  const h=await open();try{
    await h.request('slow discussion','Ask');await h.page.getByRole('button',{name:'Stop',exact:true}).waitFor();
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.locator('#feedback').fill('Keep this next revision.');
    await h.page.getByRole('button',{name:'Stop',exact:true}).click();await h.complete();
    assert.equal(await h.page.locator('#feedback').inputValue(),'Keep this next revision.');
    await h.page.getByRole('tab',{name:'Chat',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'slow discussion');
    await h.saved();await h.page.reload();assert.equal(await h.page.locator('#feedback').inputValue(),'slow discussion');
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'Keep this next revision.');
    assert.equal((await h.state()).sessions[0].draft,initial);
  }finally{await h.close();}
});

test('mode tabs support keyboard navigation and Command Enter follows the visible action',async()=>{
  const h=await open();try{
    const requests=[];h.page.on('request',r=>{if(r.url().endsWith('/api/generate'))requests.push(r.postDataJSON());});
    await h.page.getByRole('tab',{name:'Chat',exact:true}).focus();await h.page.keyboard.press('ArrowRight');
    assert.equal(await h.page.getByRole('tab',{name:'Revise',exact:true}).getAttribute('aria-selected'),'true');
    await h.page.keyboard.press('Home');assert.equal(await h.page.getByRole('tab',{name:'Chat',exact:true}).getAttribute('aria-selected'),'true');
    await h.page.getByRole('textbox',{name:'Message',exact:true}).fill('Explain the decision.');await h.page.keyboard.press('ControlOrMeta+Enter');await h.complete();
    assert.equal(requests[0].mode,'discuss');assert.equal((await h.state()).sessions[0].draft,initial);
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.locator('#feedback').fill('Make this clearer.');
    await h.page.keyboard.press('ControlOrMeta+Enter');await h.complete();assert.equal(requests[1].mode,'revise');
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});

test('presets can be deselected and submitting one preserves an unfinished custom revision',async()=>{
  const h=await open();try{
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.locator('#feedback').fill('A custom request for later.');
    await h.page.getByRole('button',{name:'Tighten',exact:true}).click();await h.page.getByRole('button',{name:'Clarify',exact:true}).click();
    await h.page.getByRole('button',{name:'Clarify',exact:true}).click();assert.equal(await h.page.locator('#feedback').inputValue(),'A custom request for later.');
    await h.page.getByRole('button',{name:'Tighten',exact:true}).click();await h.page.getByRole('button',{name:'Tighten document',exact:true}).click();await h.complete();
    assert.equal(await h.page.locator('#feedback').inputValue(),'A custom request for later.');
    assert.equal((await h.state()).sessions[0].draft,revised);
  }finally{await h.close();}
});

test('a locked document allows Chat while revision presets and submission remain disabled',async()=>{
  const h=await open({docs:[{...document(),status:'final'}]});try{
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.locator('#feedback').fill('Keep this revision until unlocked.');
    assert.equal(await h.page.getByRole('button',{name:'Tighten',exact:true}).isEnabled(),false);
    assert.equal(await h.page.getByRole('button',{name:'Document locked',exact:true}).isEnabled(),false);
    await h.request('Explain the decision.','Ask');await h.complete();assert.equal((await h.state()).sessions[0].draft,initial);
    await h.page.getByRole('button',{name:'Unlock to edit',exact:true}).click();await h.page.getByRole('tab',{name:'Revise',exact:true}).click();
    assert.equal(await h.page.locator('#feedback').inputValue(),'Keep this revision until unlocked.');
    assert.equal(await h.page.getByRole('button',{name:'Revise document',exact:true}).isEnabled(),true);
  }finally{await h.close();}
});

test('revision controls and selected target remain reachable on mobile and short screens',async()=>{
  const h=await open({width:390,height:844});try{
    await select(h.page,1,'No decision was made.');await h.page.getByRole('button',{name:'Assistant',exact:true}).click();
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'Clarify',exact:true}).click();
    for(const height of [844,600]){
      await h.page.setViewportSize({width:390,height});
      assert.equal(await h.page.locator('#submit-request').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),true);
      assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      assert.equal(await h.page.locator('.conversation').evaluate(e=>e.clientHeight>50),true);
    }
    await h.page.getByRole('button',{name:'Clarify selection',exact:true}).click();await h.complete();
    assert.equal((await h.state()).sessions[0].draft,initial.replace('No decision was made.','The team deferred the decision.'));
  }finally{await h.close();}
});

test('Enter sends, Shift+Enter adds a line, and the assistant panel can be resized and hidden across reloads',async()=>{
  const h=await open();try{
    const requests=[];h.page.on('request',r=>{if(r.url().endsWith('/api/generate'))requests.push(r.postDataJSON());});
    await h.page.locator('#feedback').click();await h.page.keyboard.type('First line');await h.page.keyboard.press('Shift+Enter');await h.page.keyboard.type('second line');
    assert.equal(await h.page.locator('#feedback').inputValue(),'First line\nsecond line');assert.equal(requests.length,0);
    await h.page.keyboard.press('Enter');await h.complete();assert.equal(requests.length,1);assert.equal(requests[0].instruction,'First line\nsecond line');
    const width=()=>h.page.locator('#assistant').evaluate(e=>Math.round(e.getBoundingClientRect().width));
    const start=await width();
    await h.page.getByRole('separator',{name:'Resize assistant'}).focus();for(let i=0;i<3;i++)await h.page.keyboard.press('ArrowLeft');
    assert.ok(await width()>start+60);const wider=await width();
    await h.page.reload();assert.equal(await width(),wider);
    await h.page.getByRole('button',{name:'Show or hide the assistant'}).click();assert.equal(await h.page.locator('#assistant').isVisible(),false);
    assert.ok(await h.page.locator('#draft').evaluate(e=>e.closest('.writing').getBoundingClientRect().width)>1300);
    await h.page.reload();assert.equal(await h.page.locator('#assistant').isVisible(),false);
    await h.page.getByRole('button',{name:'Show or hide the assistant'}).click();assert.equal(await h.page.locator('#assistant').isVisible(),true);
  }finally{await h.close();}
});
test('changes appear inside the document with navigation, and History lists edits with their timing',async()=>{
  const draft='## Plan\n\nThe team discussed the plan.\n\nKeep this line.\n\nThe team discussed the budget.';
  const h=await open({docs:[document(draft)]});try{
    await h.page.route('**/api/generate',async route=>{
      const body=['{"type":"delta","text":"..."}','{"type":"complete","text":"## Plan\\n\\nThe team reviewed the plan.\\n\\nKeep this line.\\n\\nThe team reviewed the budget.\\n\\nA new closing line.","stats":{"stopReason":"eosFound"}}'].join('\n');
      await route.fulfill({status:200,contentType:'application/x-ndjson',body});
    });
    await h.request('Use a better verb');await h.complete();
    // Each verb swap is its own stop, even in separate paragraphs, plus the new closing line.
    assert.equal(await h.page.locator('#change-view [data-hunk]').count(),3);
    assert.equal(await h.page.locator('#change-view .change-added').count(),1);
    assert.match(await h.page.locator('#review-position').innerText(),/3 changes/);
    await h.page.getByRole('button',{name:'Next change'}).click();assert.match(await h.page.locator('#review-position').innerText(),/1 of 3/);
    await h.page.getByRole('button',{name:'Previous change'}).click();assert.match(await h.page.locator('#review-position').innerText(),/3 of 3/);
    assert.match(await h.page.locator('#change-view').innerText(),/Keep this line\./);
    await h.page.getByRole('tab',{name:'History',exact:true}).click();
    const item=h.page.getByRole('button',{name:/^Use a better verb/});
    assert.match(await item.innerText(),/Whole document · took (\d+s|under 1s)/);assert.match(await item.innerText(),/Current/);
    assert.equal(await item.getAttribute('aria-pressed'),'true');
    await item.click();assert.equal(await h.page.locator('#change-view').isVisible(),false);assert.equal(await h.page.locator('#draft').isVisible(),true);
  }finally{await h.close();}
});
test('importing into a written document can add to it, and Undo removes the addition',async()=>{
  const h=await open();try{
    const file=path.join(output,'Addition.txt');await fs.writeFile(file,'An added paragraph.');
    const chooser=h.page.waitForEvent('filechooser');await h.page.getByRole('button',{name:'Import',exact:true}).click();await(await chooser).setFiles(file);
    await h.page.getByRole('dialog').getByRole('button',{name:'Add to this document',exact:true}).click();
    assert.equal((await h.state()).sessions.length,1);
    assert.equal((await h.state()).sessions[0].draft,initial+'\n\nAn added paragraph.');
    await h.page.getByRole('button',{name:'Undo',exact:true}).click();
    assert.equal((await h.state()).sessions[0].draft,initial);
  }finally{await h.close();}
});
test('an empty document explains why the assistant cannot send yet',async()=>{
  const h=await open({docs:[{...document(''),title:'Untitled document',source:''}]});try{
    assert.match(await h.page.locator('.assistant-empty').innerText(),/Write, paste, or import something/);
    assert.equal(await h.page.locator('[data-starter]').count(),0);
    assert.equal(await h.page.locator('#feedback').getAttribute('placeholder'),'Add some writing to the document first');
    await h.page.locator('#feedback').fill('What works?');assert.equal(await h.page.locator('#submit-request').isDisabled(),true);
    await h.page.locator('#feedback').press('Enter');await h.page.locator('#toast').filter({hasText:'Add some writing to the document first.'}).waitFor();
    await h.page.locator('#draft').click();await h.page.keyboard.type('A first line.');
    await h.page.locator('[data-starter]').first().waitFor();assert.equal(await h.page.locator('#submit-request').isDisabled(),false);
  }finally{await h.close();}
});
test('the revise scope stays labelled and clear of the action button on a phone',async()=>{
  const h=await open({width:375,height:812});try{
    await h.page.getByRole('button',{name:'Assistant',exact:true}).click();
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'Proofread',exact:true}).click();
    const scope=await h.page.locator('#choose-scope').boundingBox(),submit=await h.page.locator('#submit-request').boundingBox();
    assert.ok(scope.width>=100,'scope label is visible');assert.ok(scope.y+scope.height<=submit.y,'scope sits above the action row');
    assert.equal(await h.page.locator('#choose-scope span').isVisible(),true);
    assert.equal(await h.page.locator('#submit-request').getAttribute('aria-label'),'Proofread document');
    assert.equal(await h.page.evaluate(()=>document.documentElement.scrollWidth),375);
  }finally{await h.close();}
});
test('History compares a version like an edit: older text struck, newer text marked',async()=>{
  const h=await open({docs:[{...document(),source:'## Project update\n\nThe team met.'}]});try{
    await h.page.getByRole('tab',{name:'History',exact:true}).click();await h.page.locator('[data-history-original]').click();
    assert.match(await h.page.locator('#change-view del').first().innerText(),/met/);
    assert.match(await h.page.locator('#change-view ins').first().innerText(),/discussed the plan/);
    await h.page.getByRole('button',{name:'Restore this version',exact:true}).click();
    assert.equal((await h.state()).sessions[0].draft,'## Project update\n\nThe team met.');
  }finally{await h.close();}
});
test('the export preview prints the same title Word will',async()=>{
  const h=await open();try{
    const parts=await h.page.evaluate(()=>[exportParts({title:'Project update',text:'## Project update\n\nText'}),exportParts({title:'Untitled document',text:'Text'}),exportParts({title:'Notes',text:'## Other\n\nText'})]);
    assert.deepEqual(parts.map(p=>p.title),['Project update','','Notes']);
    await h.page.getByRole('button',{name:'Export',exact:true}).click();
    assert.equal(await h.page.locator('#export-preview h1').innerText(),'Project update');
    assert.equal(await h.page.locator('#export-preview h2').count(),0);
  }finally{await h.close();}
});
test('selections still work after typing, including drags that end in the page margin',async()=>{
  const h=await open();try{
    const paragraph=h.page.locator('#draft p').first();
    await paragraph.click();await h.page.keyboard.press('End');await h.page.keyboard.type(' We  agreed ');await h.saved();
    await select(h.page,1,'team','plan');
    assert.equal(await h.page.evaluate(()=>!!selection&&!selection.invalid),true,'selection is accepted after typing spaces');
    assert.equal(await h.page.evaluate(()=>selection.text),'team discussed the plan');
    const box=await paragraph.boundingBox(),scroll=await h.page.locator('.editor-scroll').boundingBox();
    await h.page.mouse.move(box.x+2,box.y+box.height/2);await h.page.mouse.down();
    await h.page.mouse.move(box.x+box.width/2,scroll.y+scroll.height-20,{steps:8});await h.page.mouse.up();
    assert.equal(await h.page.evaluate(()=>getSelection().isCollapsed),false,'a drag ending on the blank page keeps its selection');
    await h.page.locator('#feedback').click();
    assert.equal(await h.page.evaluate(()=>!!selection&&!selection.invalid),true,'clicking into the request keeps the selection');
    assert.equal(await h.page.locator('.scope-chip-label').innerText(),'Selection');
  }finally{await h.close();}
});
test('a selected passage is quoted with its paragraphs and formatting, and long quotes expand',async()=>{
  const long='First paragraph with **bold** words that runs on long enough to need clamping in the conversation view, well past two hundred and twenty characters of visible text in total.\n\nSecond paragraph.';
  const h=await open({docs:[{...document(),history:[{role:'user',content:'Clarify.',mode:'revise',scope:'selection',selection:long,status:'complete',at:new Date().toISOString()}]}]});try{
    const quote=h.page.locator('.request-quote');
    assert.equal(await quote.locator('p').count(),2);assert.equal(await quote.locator('strong').innerText(),'bold');
    assert.equal(await quote.evaluate(el=>getComputedStyle(el).textAlign),'left');
    await quote.getByRole('button',{name:'Show all'}).click();
    assert.equal(await quote.getByRole('button',{name:'Show less'}).getAttribute('aria-expanded'),'true');
  }finally{await h.close();}
});
test('You decide asks the model for a plan, applies it, and shows what it chose',async()=>{
  const h=await open();const bodies=[];try{
    await h.page.route('**/api/generate',async route=>{
      const body=route.request().postDataJSON();bodies.push(body);
      const text=body.mode==='discuss'?'Instruction: "Replace the vague verb in the first sentence."':initial.replace('discussed','reviewed');
      await route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'complete',text,stats:{stopReason:'eosFound'}})+'\n'});
    });
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'You decide',exact:true}).click();
    assert.equal(await h.page.locator('#submit-request').getAttribute('aria-label'),'You decide document');
    await h.page.locator('#submit-request').click();await h.complete();
    assert.deepEqual(bodies.map(b=>b.mode),['discuss','revise']);
    assert.match(bodies[0].instruction,/decide the single change/);
    assert.equal(bodies[1].instruction,'Replace the vague verb in the first sentence.');
    assert.match(await h.page.locator('.plan-note').innerText(),/The assistant decided: Replace the vague verb in the first sentence\./);
    const saved=await h.state();assert.equal(saved.sessions[0].draft,initial.replace('discussed','reviewed'));
    assert.equal(saved.sessions[0].edits[0].instruction,'Replace the vague verb in the first sentence.');
  }finally{await h.close();}
});
test('an unchanged Proofread reports no errors, without a Copy button',async()=>{
  const h=await open();try{
    await h.page.route('**/api/generate',route=>route.fulfill({status:200,contentType:'application/x-ndjson',body:JSON.stringify({type:'complete',text:initial,stats:{stopReason:'eosFound'}})+'\n'}));
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.getByRole('button',{name:'Proofread',exact:true}).click();
    await h.page.locator('#submit-request').click();await h.complete();
    assert.equal(await h.page.locator('.outcome-note').innerText(),'No errors found in your document. Nothing was changed.');
    assert.equal(await h.page.locator('.turn-assistant [data-copy]').count(),0);
    assert.equal((await h.state()).sessions[0].edits.length,0);
  }finally{await h.close();}
});
