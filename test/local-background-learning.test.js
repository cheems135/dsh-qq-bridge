import test from 'node:test';
import assert from 'node:assert/strict';
import {localAnalysisInput} from '../local-chat-context.js';
import {createLearningMemory} from '../learning-memory.js';

test('local analysis excerpts preserve source identifiers and only bound background input',()=>{
 const input=JSON.stringify({sources:[{id:'s1',text:'原文'.repeat(5000),url:'https://example.com/a'},{id:'s2',text:'其他资料'}]});
 const output=JSON.parse(localAnalysisInput(input));assert.equal(output.sources.length,1);assert.equal(output.sources[0].id,'s1');assert.equal(output.sources[0].url,'https://example.com/a');assert.equal(output.sources[0].text.length,900);assert.ok(JSON.parse(input).sources[0].text.length>900);
});

test('intentional local deferral retains passive jobs and refunds passive and active quotas',async()=>{
 const files=new Map(),meta={key:'private:12345',accountId:'a',personaId:'p'};
 const learning=createLearningMemory({storage:{list:()=>[...files.keys()],read:key=>{if(!files.has(key))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(key));},write:(key,value)=>files.set(key,structuredClone(value))},config:()=>({enabled:true,passive:true,active:true}),allowed:()=>true,signature:()=> 'v',roles:()=>[],ask:async()=>{throw Object.assign(Error('chat busy'),{code:'LOCAL_ANALYSIS_DEFERRED'});},research:async()=>[]});
 try{
  learning.observe(meta,{id:'test',userWords:'以后讲解时请先说具体的原因。'});
  assert.equal((await learning.process(meta)).skipped,'busy');const snapshot=learning.snapshot(meta);assert.equal(snapshot.pending.length,1);assert.equal(snapshot.pending[0].attempts,0);assert.ok(snapshot.pending[0].nextRetryAt>Date.now());
  assert.equal((await learning.active(meta,{manual:true})).skipped,'busy');
  const quota=[...files.entries()].find(([key])=>key.startsWith('limit-'))[1];assert.equal(quota.passive,0);assert.equal(quota.active,0);assert.equal(quota.lastActiveAt,0);
 }finally{learning.close();}
});
