/* Exact, bounded comparisons. No model-authored claims about what changed. */
(function (root) {
  'use strict';
  function diff(before, after) {
    const tokenize = text => text.match(/\s+|[\p{L}\p{N}\p{M}_]+|[^\s]/gu) || [];
    const a = tokenize(before), b = tokenize(after);
    let start = 0, end = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    while (end < a.length-start && end < b.length-start && a[a.length-1-end] === b[b.length-1-end]) end++;
    const x = a.slice(start, a.length-end), y = b.slice(start, b.length-end), parts = [];
    const add = (type, text) => { if (!text) return; if (parts.at(-1)?.type === type) parts.at(-1).text += text; else parts.push({type,text}); };
    add('equal', a.slice(0,start).join(''));
    // Avoid quadratic memory/time for book-length rewrites. The fallback still
    // shows every changed character; it merely groups a larger changed passage.
    if (x.length * y.length > 300000) {
      add('remove',x.join('')); add('add',y.join(''));
    } else {
      const rows = Array.from({length:x.length+1}, () => new Uint32Array(y.length+1));
      for (let i=x.length-1;i>=0;i--) for (let j=y.length-1;j>=0;j--)
        rows[i][j] = x[i]===y[j] ? rows[i+1][j+1]+1 : Math.max(rows[i+1][j],rows[i][j+1]);
      let i=0,j=0;
      while (i<x.length || j<y.length) {
        if (i<x.length && j<y.length && x[i]===y[j]) {add('equal',x[i++]);j++;}
        else if (i<x.length && (j===y.length || rows[i+1][j]>=rows[i][j+1])) add('remove',x[i++]);
        else add('add',y[j++]);
      }
    }
    add('equal',end?a.slice(a.length-end).join(''):'');
    // Spaces are weak anchors. Keep a rewritten phrase together instead of
    // alternating red/green one word at a time around every shared space.
    const grouped=[];
    for(let i=0;i<parts.length;) {
      if(parts[i].type==='equal'){grouped.push(parts[i++]);continue;}
      let removed='',added='';
      while(i<parts.length) {
        const p=parts[i];
        if(p.type==='equal' && (p.text.trim() || !parts[i+1] || parts[i+1].type==='equal'))break;
        if(p.type!=='add')removed+=p.text;
        if(p.type!=='remove')added+=p.text;
        i++;
      }
      if(removed)grouped.push({type:'remove',text:removed});
      if(added)grouped.push({type:'add',text:added});
    }
    return grouped;
  }
  function summary(parts) {
    let added=0,removed=0,passages=0,changing=false;
    for(const part of parts) {
      const count=(part.text.match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}_]*/gu)||[]).length;
      if(part.type==='add')added+=count;
      if(part.type==='remove')removed+=count;
      if(part.type==='equal' && part.text.trim())changing=false;
      else if(part.type!=='equal' && !changing){passages++;changing=true;}
    }
    return {added,removed,passages};
  }
  // Aligns two sequences of rendered blocks (compared by key) so a revision can
  // be shown inside the document: unchanged blocks, edited blocks paired with
  // their earlier wording, and blocks that were only removed or only added.
  function align(a, b) {
    let start=0,end=0;
    while(start<a.length&&start<b.length&&a[start]===b[start])start++;
    while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
    const x=a.slice(start,a.length-end),y=b.slice(start,b.length-end),raw=[];
    for(let i=0;i<start;i++)raw.push({type:'equal',a:i,b:i});
    if(x.length*y.length>1000000){
      // Very long documents: compare block by block instead of aligning exactly.
      for(let k=0;k<Math.max(x.length,y.length);k++){
        if(k<x.length&&k<y.length&&x[k]===y[k]){raw.push({type:'equal',a:start+k,b:start+k});continue;}
        if(k<x.length)raw.push({type:'remove',a:start+k});
        if(k<y.length)raw.push({type:'add',b:start+k});
      }
    } else {
      const rows=Array.from({length:x.length+1},()=>new Uint32Array(y.length+1));
      for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)
        rows[i][j]=x[i]===y[j]?rows[i+1][j+1]+1:Math.max(rows[i+1][j],rows[i][j+1]);
      let i=0,j=0;
      while(i<x.length||j<y.length){
        if(i<x.length&&j<y.length&&x[i]===y[j])raw.push({type:'equal',a:start+i++,b:start+j++});
        else if(i<x.length&&(j===y.length||rows[i+1][j]>=rows[i][j+1]))raw.push({type:'remove',a:start+i++});
        else raw.push({type:'add',b:start+j++});
      }
    }
    for(let k=0;k<end;k++)raw.push({type:'equal',a:a.length-end+k,b:b.length-end+k});
    // Pair removed and added blocks between the same anchors as edits of one another.
    const ops=[];
    for(let k=0;k<raw.length;){
      if(raw[k].type==='equal'){ops.push(raw[k++]);continue;}
      const removed=[],added=[];
      while(k<raw.length&&raw[k].type!=='equal'){(raw[k].type==='remove'?removed:added).push(raw[k]);k++;}
      const paired=Math.min(removed.length,added.length);
      for(let n=0;n<paired;n++)ops.push({type:'change',a:removed[n].a,b:added[n].b});
      ops.push(...removed.slice(paired),...added.slice(paired));
    }
    return ops;
  }
  const api={diff,summary,align};
  if(typeof module!=='undefined')module.exports=api;else root.FolioChanges=api;
}(typeof window==='undefined'?globalThis:window));
