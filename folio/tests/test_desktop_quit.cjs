/* Save-before-quit behavior in WebKit, with synthetic writing only. */
'use strict';
const assert = require('node:assert/strict');
const {test,before,after} = require('node:test');
const {spawn} = require('node:child_process');
const path = require('node:path');
const {webkit} = require(process.env.FOLIO_PLAYWRIGHT || 'playwright');
const python = process.env.FOLIO_PYTHON || 'python3';
let server,browser,url;
before(async()=>{
  server=spawn(python,[path.join(__dirname,'preview_server.py'),'--port','0']);
  url=await new Promise((resolve,reject)=>{let log='';server.stdout.on('data',data=>{log+=data;const m=log.match(/Preview: (http:\/\/\S+)/);if(m)resolve(m[1]);});server.once('error',reject);server.once('exit',code=>reject(Error('Preview exited '+code)));});
  browser=await webkit.launch({headless:true});
});
after(async()=>{await browser?.close();server?.kill('SIGINT');});
async function open(){
  const context=await browser.newContext(),page=await context.newPage();
  const data=await(await context.request.get(url+'/api/bootstrap')).json();
  await context.request.post(url+'/api/state',{headers:{'X-Folio-Token':data.token},data:{sessions:[{id:'test',title:'Synthetic desktop test',draft:'Synthetic writing.',history:[],versions:[],status:'draft'}],examples:[],settings:{editorVersion:2,model:'synthetic'}}});
  await page.goto(url);await page.locator('#draft').waitFor();
  return {context,page,state:async()=>(await(await context.request.get(url+'/api/bootstrap')).json()).state};
}
test('closing flushes writing and dialog drafts before the debounce fires',async()=>{
  const h=await open();try{
    await h.page.locator('#draft').fill('Fresh synthetic writing just before quitting.');
    await h.page.getByRole('button',{name:'Writing style',exact:true}).click();
    await h.page.locator('#voice').fill('A synthetic unsaved preference.');
    assert.equal(await h.page.evaluate(()=>window.FolioDesktop.prepareToQuit()),true);
    const state=await h.state();assert.equal(state.sessions[0].draft,'Fresh synthetic writing just before quitting.');assert.equal(state.settings.voice,'A synthetic unsaved preference.');
    assert.equal(await h.page.evaluate(()=>document.documentElement.inert),true);
  }finally{await h.context.close();}
});
test('a failed final save keeps the writing editable',async()=>{
  const h=await open();try{
    await h.page.route('**/api/state',route=>route.fulfill({status:500,contentType:'application/json',body:'{"error":"Synthetic save failure"}'}));
    await h.page.locator('#draft').fill('Synthetic writing that must stay in the window.');
    const error=await h.page.evaluate(async()=>{try{await window.FolioDesktop.prepareToQuit();}catch(error){return error.message;}});
    assert.equal(error,'Synthetic save failure');assert.equal(await h.page.evaluate(()=>document.documentElement.inert),false);
    assert.equal(await h.page.locator('#draft').innerText(),'Synthetic writing that must stay in the window.');
    await h.page.unroute('**/api/state');assert.equal(await h.page.evaluate(()=>window.FolioDesktop.prepareToQuit()),true);
    assert.equal((await h.state()).sessions[0].draft,'Synthetic writing that must stay in the window.');
  }finally{await h.context.close();}
});
test('quitting cancels an active revision and saves its interrupted request',async()=>{
  const h=await open();try{
    await h.page.getByRole('tab',{name:'Revise',exact:true}).click();await h.page.locator('#feedback').fill('slow synthetic revision');await h.page.locator('#submit-request').click();await h.page.locator('#stop-button').waitFor({state:'visible'});
    assert.equal(await h.page.evaluate(()=>window.FolioDesktop.prepareToQuit()),true);
    const state=await h.state();assert.equal(state.sessions[0].draft,'Synthetic writing.');assert.equal(state.sessions[0].history.at(-1).stopped,true);assert.equal(state.sessions[0].feedback,'slow synthetic revision');
  }finally{await h.context.close();}
});
