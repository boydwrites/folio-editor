'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const W = require('../static/workspace.js');
const session = (draft='The team discussed the plan. No decision was made.') => ({id:'synthetic',title:'Synthetic document',date:'',draft,source:'',history:[],versions:[],status:'draft'});
const tick = () => new Promise(resolve => setImmediate(resolve));

test('first edit immediately becomes the working draft and allows Ask and another Edit', () => {
  const s=session();
  const r=W.capture(s,'revise','Make it clearer.',null);
  const result=W.applyResult(s,r,'The team discussed the plan without deciding.');
  s.draft=result.text;
  assert.equal(result.kind,'edit');
  assert.equal(s.versions[0].text,r.base);
  assert.equal(W.capture(s,'discuss','Is this clear?',null).base,s.draft);
  const second=W.capture(s,'revise','Make it shorter.',null);
  assert.equal(W.applyResult(s,second,'No decision was made.').kind,'edit');
  assert.equal(s.proposal,undefined);
});
test('Ask leaves document, history versions, and selection unchanged, including locked documents', () => {
  const s=session();s.status='final';const selected={base:s.draft,start:0,end:8,text:'The team'};
  const before=structuredClone({s,selected});
  assert.deepEqual(W.applyResult(s,W.capture(s,'discuss','Who?',selected),'The team.'),{kind:'answer',text:'The team.'});
  assert.deepEqual({s,selected},before);
  assert.throws(()=>W.capture(s,'revise','Edit',null),/Unlock/);
});
test('selection edits use the exact occurrence and preserve all outside characters', () => {
  const text='Résumé 😀\r\n\r\n- Same words.\n- Same words.\n\nEnd **unchanged**.';
  const chars=Array.from(text),start=Array.from(text.slice(0,text.lastIndexOf('Same words.'))).length;
  const selected={base:text,start,end:start+11,text:'Same words.'};
  const s=session(text),request=W.capture(s,'revise','Shorter',selected);
  const result=W.applyResult(s,request,'New words.');
  assert.equal(result.text,chars.slice(0,start).join('')+'New words.'+chars.slice(start+11).join(''));
  assert.equal(result.text.indexOf('Same words.'),text.indexOf('Same words.'));
});
test('replacement of partial bold and italic preserves surrounding markup exactly',()=>{
  for(const text of ['The **bright red** balloon.','A *very long* story.','- First\n- Second\n\nFinal.']){
    const fragment=text.includes('red')?'red':text.includes('long')?'long':'First\n- Second';
    const start=Array.from(text.slice(0,text.indexOf(fragment))).length;
    const s=session(text),r=W.capture(s,'revise','Change wording',{base:text,start,end:start+Array.from(fragment).length,text:fragment});
    assert.equal(W.applyResult(s,r,'new').text,text.replace(fragment,'new'));
  }
});
test('changed document, lock, or stale selection never gets an outdated edit',()=>{
  const s=session(),r=W.capture(s,'revise','Edit',null);s.draft+=' My new sentence.';
  const before=structuredClone(s);assert.deepEqual(W.applyResult(s,r,'Outdated'),{kind:'stale'});assert.deepEqual(s,before);
  assert.throws(()=>W.capture(s,'revise','Edit',{base:r.base,start:0,end:3,text:'The'}),/selection changed/);
  assert.throws(()=>W.capture(s,'revise','Edit',{base:s.draft,start:1,end:4,text:'The'}),/selection changed/);
  s.draft=r.base;s.status='final';assert.equal(W.applyResult(s,r,'Outdated').kind,'stale');
});
test('Trash blocks new requests and a late edit cannot change the removed writing',()=>{
  const s=session(),request=W.capture(s,'revise','Edit',null);
  s.deletedAt='2026-09-29T12:00:00Z';const before=structuredClone(s);
  assert.throws(()=>W.capture(s,'revise','Edit',null),/Restore this document from Trash/);
  assert.throws(()=>W.capture(s,'discuss','Explain',null),/Restore this document from Trash/);
  assert.deepEqual(W.applyResult(s,request,'Late replacement'),{kind:'stale'});
  assert.deepEqual(s,before);
  delete s.deletedAt;assert.equal(W.capture(s,'revise','Edit',null).base,before.draft);
});
test('empty responses and wrong-document responses are rejected without mutations',()=>{
  const s=session(),r=W.capture(s,'revise','Edit',null),before=structuredClone(s);
  assert.throws(()=>W.applyResult(s,r,''),/empty/);assert.throws(()=>W.applyResult({...s,id:'different'},r,'text'),/different document/);assert.deepEqual(s,before);
});
test('save worker serializes changes and persists edits made during writes',async()=>{
  let state={draft:'One'},pending=[],statuses=[];
  const saver=W.createSaver(()=>state,body=>new Promise((resolve,reject)=>pending.push({body,resolve,reject})),s=>statuses.push(s));
  saver.change();const first=saver.flush();state.draft='Two';saver.change();const second=saver.flush();assert.equal(first,second);assert.equal(pending.length,1);
  pending[0].resolve();await tick();assert.equal(pending.length,2);assert.equal(pending[1].body.draft,'Two');assert.equal(saver.dirty,true);
  pending[1].resolve();await first;assert.equal(saver.dirty,false);assert.equal(saver.pending,false);assert.equal(statuses.at(-1),'Saved');
});
test('failed saves retain dirty state and can retry the latest writing',async()=>{
  let state={draft:'One'},fail=true,seen=[];
  const saver=W.createSaver(()=>state,async body=>{seen.push(body);if(fail)throw new Error('Disk full');});
  saver.change();await assert.rejects(saver.flush(),/Disk full/);assert.equal(saver.dirty,true);
  state.draft='Two';saver.change();fail=false;await saver.flush();assert.equal(seen.at(-1).draft,'Two');assert.equal(saver.dirty,false);
});
function stream(lines) {const chunks=lines.map(x=>Buffer.from(x));return {body:{getReader:()=>({read:async()=>chunks.length?{done:false,value:chunks.shift()}:{done:true},releaseLock(){}})}};}
test('stream parser handles split unicode and fragmented complete events',async()=>{
  const bytes=Buffer.from(JSON.stringify({type:'complete',text:'Café 😀'})+'\n');let index=0;
  const response={body:{getReader:()=>({read:async()=>index<bytes.length?{done:false,value:bytes.subarray(index,index+=1)}:{done:true},releaseLock(){}})}};
  assert.equal((await W.readStream(response,()=>{},()=>false)).text,'Café 😀');
});
test('cancelled and partial streams cannot produce an applied result',async()=>{
  await assert.rejects(W.readStream(stream(['{"type":"delta","text":"Partial"}\n']),()=>{},()=>false),/ended early/);
  await assert.rejects(W.readStream(stream(['{"type":"complete","text":"Late"}\n']),()=>{},()=>true),/Stopped/);
  await assert.rejects(W.readStream(stream(['{"type":"error","message":"Model unavailable"}\n']),()=>{},()=>false),/Model unavailable/);
});

test('identical output is an honest no-op with no undo step or saved version',()=>{
  const s=session(),r=W.capture(s,'revise','Keep it',null);
  assert.deepEqual(W.applyResult(s,r,s.draft),{kind:'unchanged',text:s.draft});
  assert.equal(s.versions.length,0);
});
test('edit receipts survive serialization and preserve exact selected wording for follow-ups',()=>{
  const original='Café 😀. Same words. Same words. Ending.';
  const s=session(original),start=Array.from(original.slice(0,original.lastIndexOf('Same words.'))).length;
  const r=W.capture(s,'revise','Use a calmer verb',{base:original,start,end:start+11,text:'Same words.'});
  const applied=W.applyResult(s,r,'Different wording.');
  const edit=W.recordEdit(s,r,applied.text);s.draft=applied.text;
  s.history=[{role:'user',content:r.instruction,status:'complete'},{role:'assistant',content:'Edited.',editId:edit.id,status:'complete'},{role:'user',content:'Failed request',status:'failed'},{role:'user',content:'In flight',status:'pending'}];
  const saved=JSON.parse(JSON.stringify(s));
  assert.deepEqual(W.editTexts(saved,saved.edits[0]),{before:original,after:applied.text});
  const context=W.conversation(saved);assert.equal(context.length,2);
  // History moves forward: the new wording is kept, the removed wording is not.
  assert.doesNotMatch(context[1].content,/Same words/);
  assert.match(context[1].content,/Replacement: Different wording\./);
  saved.draft=applied.text+' My own addition.';assert.match(W.conversation(saved)[1].content,/author has edited the document since/);
  saved.draft=original;assert.match(W.conversation(saved)[1].content,/since been undone/);
  assert.ok(context.every(m=>Object.keys(m).length===2));
});
const D=require('../static/changes.js');
test('diff preserves every original and revised character, including repeated words and formatting',()=>{
  for(const [before,after] of [
    ['One two one.','One one two.'],['# Title\n\nA **good** idea.','## Title\n\nA *better* idea.'],
    ['Café 😀 résumé','Café 😄 résumé'],['','Added'],['Deleted',''],['same','same'],
    ['word '.repeat(1000),'new '.repeat(1000)]
  ]){
    const parts=D.diff(before,after);
    assert.equal(parts.filter(p=>p.type!=='add').map(p=>p.text).join(''),before);
    assert.equal(parts.filter(p=>p.type!=='remove').map(p=>p.text).join(''),after);
  }
  assert.deepEqual(D.summary(D.diff('a clear choice','a better choice')),{added:1,removed:1,passages:1});
  assert.deepEqual(D.summary(D.diff('# Title','## Title')),{added:0,removed:0,passages:1});
});

test('block alignment keeps unchanged blocks, pairs edited blocks, and isolates pure additions and removals',()=>{
  const types=ops=>ops.map(op=>op.type).join(',');
  assert.equal(types(D.align(['a','b','c'],['a','b','c'])),'equal,equal,equal');
  assert.deepEqual(D.align(['a','b','c'],['a','B','c']),[{type:'equal',a:0,b:0},{type:'change',a:1,b:1},{type:'equal',a:2,b:2}]);
  assert.equal(types(D.align(['a','c'],['a','new','c'])),'equal,add,equal');
  assert.equal(types(D.align(['a','gone','c'],['a','c'])),'equal,remove,equal');
  assert.equal(types(D.align(['a','x','y','c'],['a','X','c'])),'equal,change,remove,equal');
  assert.equal(types(D.align([],['only'])),'add');
  const large=Array.from({length:600},(_,i)=>'block '+i);
  const ops=D.align(large,large.map((b,i)=>i%2?b:b+' edited'));
  assert.equal(ops.filter(op=>op.type==='change').length,300);
  assert.equal(ops.filter(op=>op.type==='equal').length,300);
  const huge=Array.from({length:1200},(_,i)=>'block '+i),fallback=D.align(huge,huge.map((b,i)=>i%100===0?b+' edited':b));
  assert.equal(fallback.filter(op=>op.type==='change').length,12);
  assert.equal(fallback.filter(op=>op.type==='equal').length,1188);
});
