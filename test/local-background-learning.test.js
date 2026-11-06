import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemeStudy} from '../meme-study.js';
import {localAnalysisInput} from '../local-chat-context.js';
import {createLearningMemory} from '../learning-memory.js';

test('local meme batches are single and deferred service work does not mark sources failed',async()=>{
 const files=new Map(),sources=Array.from({length:5},(_,i)=>({id:'s'+i,text:JSON.stringify({name:'词条'+i,meaning:'这是一段用于核对的公开原文',usage:'适合轻松聊天'}),title:'测试词条',url:'https://example.com/'+i}));
 let calls=0;
 const study=createMemeStudy({storage:{list:()=>[...files.keys()],read:key=>{if(!files.has(key))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(key));},write:(key,value)=>files.set(key,structuredClone(value))},library:{allSources:()=>sources},limits:()=>({batchSize:1,workers:1}),ask:async(_system,input)=>{calls++;assert.equal(JSON.parse(input).sources.length,1);throw Object.assign(Error('本地聊天优先'),{code:'LOCAL_ANALYSIS_DEFERRED'});}});
 const meta={accountId:'a',personaId:'p'};
 try{const result=await study.process(meta);assert.equal(calls,1);assert.equal(result.failed,0);assert.equal(result.status,'waiting_service');assert.ok(result.nextRetryAt>Date.now());}finally{study.close();}
});

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
