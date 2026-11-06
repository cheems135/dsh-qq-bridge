import test from 'node:test';
import assert from 'node:assert/strict';
import {understandingCandidate,understandLocalTurn} from '../local-understanding.js';
import {defaultLocalConfig} from '../local-config.js';
test('quality default adds local semantic context without changing the original message or executing a tool',async()=>{
 assert.equal(defaultLocalConfig({}).dialoguePriority,'quality');
 const rows=[{role:'user',content:'想安静一点，选商场还是青禾公园？'},{role:'assistant',content:'第一个商场，第二个青禾公园。'},{role:'user',content:'那就这个，补药到很吵的地方'}],original=JSON.stringify(rows);let calls=0;
 const meaning=await understandLocalTurn(rows,{request:rows.at(-1).content,model:async options=>{calls++;assert.deepEqual(options.tools,[]);assert.equal(options.outputTokens,96);assert.ok(options.messages.every(row=>!row.content.includes('人设')));return '{"meaning":"我选择青禾公园","uncertain":false}';}});
 assert.equal(meaning,'我选择青禾公园');assert.equal(JSON.stringify(rows),original);assert.equal(calls,1);
});
test('uncertain, invented actions, tool calls and identifiers never become a normalized instruction',()=>{
 for(const result of ['{"meaning":"不确定是哪一个","uncertain":true}','{"meaning":"删除所有文件","uncertain":false}','{"meaning":"发到12345678","uncertain":false}',{tool_calls:[{function:{name:'anything'}}]},'prose'])assert.equal(understandingCandidate(result,'那就第二个','两个地方'),'');
 assert.equal(understandingCandidate('{"meaning":"我担心之后下雨","uncertain":false}','担心虾雨'),'我担心之后下雨');
});
