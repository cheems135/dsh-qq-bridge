import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function boundary(budget={request:()=>({changed:false})}){
  let hook;
  const ctx={get:()=>{throw Error('request middleware must not reassemble the persona');},on:(_event,listener)=>{hook=listener;}};
  const start=source.indexOf("  ctx.on('llm/stream',"),end=source.indexOf("  {const server=ctx.get('webServer');",start);
  assert(start>=0&&end>start);
  Function('ctx','promptBudget',"'use strict';\n"+source.slice(start,end))(ctx,budget);
  return hook;
}
async function consume(stream){const chunks=[];for await(const chunk of stream)chunks.push(chunk);return chunks;}

test('frozen native requests with no system property reach dispatch unchanged',async()=>{
  const text=Object.freeze({type:'text',text:'你好'}),message=Object.freeze({role:'user',content:Object.freeze([text])});
  const options=Object.freeze({sessionId:'qq',messages:Object.freeze([message])});let dispatches=0;
  const hook=boundary({request:()=>{throw Error('a frozen request cannot be rewritten');}});
  const result=await consume(hook(options,async function*(){dispatches++;assert.equal(options.messages[0],message);yield {type:'text-delta',text:'你好呀'};}));
  assert.equal(dispatches,1);assert.equal(result[0].text,'你好呀');assert.equal(Object.hasOwn(options,'system'),false);
});

test('frozen requests that already contain system text also reach dispatch',async()=>{
  const options=Object.freeze({sessionId:'qq',system:'GLOBAL PERSONA',messages:Object.freeze([])});
  const result=await consume(boundary()(options,async function*(){yield {type:'text-delta',text:'ok'};}));
  assert.equal(result[0].text,'ok');assert.equal(options.system,'GLOBAL PERSONA');
});

test('a mutable request can prune signed context and restores its original messages even if dispatch fails',async()=>{
  const original=[{role:'user',content:'original'}],pruned=[{role:'user',content:'pruned'}],options={messages:original};
  const hook=boundary({request:()=>({changed:true,messages:pruned})});
  await assert.rejects(consume(hook(options,async function*(){assert.equal(options.messages,pruned);throw Error('provider failure');})),/provider failure/);
  assert.equal(options.messages,original);assert.equal(Object.hasOwn(options,'system'),false);
});
