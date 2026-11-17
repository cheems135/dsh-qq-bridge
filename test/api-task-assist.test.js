import test from 'node:test';import assert from 'node:assert/strict';
import {apiAssistCandidate,assertAssistRoute,runApiTaskAssist} from '../api-task-assist.js';
const route={provider:'configured-provider',model:'configured-model'};
test('delegation is limited to read tasks and never chooses a hard-coded cloud model',()=>{
 assertAssistRoute(route);assert.throws(()=>assertAssistRoute({provider:'deepseek-account',model:'v4'}),/不会调用/);assert.throws(()=>assertAssistRoute({provider:'x',model:'DeepSeek-chat'}),/不会调用/);
 for(const t of ['搜索这个消息','读取网页 https://example.test','看看这个https://example.test/v','看视频'])assert(apiAssistCandidate(t),t);
 for(const t of ['生成视频','去群里发你好','看看我的衣服','你好'])assert.equal(apiAssistCandidate(t),false,t);
});
test('API reads a real tool result, sees actual visual observations, returns evidence to local without any QQ send',async()=>{
 let n=0;const calls=[],images=[{url:'data:image/png;base64,MOCK'}];
 const result=await runApiTaskAssist({task:'观察视频',route,router:async call=>{calls.push(call);return call.action==='schema'?{ok:true,parameters:{type:'object'}}:{ok:true,url:'https://example.test/v',coverage:'只观察0-5秒',localObservations:images};},complete:async(_s,input,observations)=>{n++;assert.match(input,/观察视频/);if(n===1)return JSON.stringify({tool:'bridge_watch',arguments:{action:'start',url:'https://example.test/v'}});assert.deepEqual(observations,images);assert.doesNotMatch(input,/data:image/);return JSON.stringify({done:true,summary:'前五秒有人走过',limitations:['后续未知']});}});
 assert.equal(result.ok,true);assert.equal(result.evidence.length,1);assert.equal(result.evidence[0].tool,'bridge_watch');assert(!calls.some(c=>/qq|send|comment/.test(c.name||'')));assert.equal(result.limitations[0],'后续未知');
});
test('off, forbidden API, cancelled scope and invented tools never perform a side effect',async()=>{
 let models=0,tools=0;const common={task:'看视频',route,complete:async()=>{models++;return '{"tool":"bridge_life_qq","arguments":{"action":"send"}}';},router:async call=>{tools++;return {ok:true,parameters:{type:'object'}};}};
 await assert.rejects(runApiTaskAssist({...common,current:()=>false}),/关闭/);assert.equal(models,0);assert.equal(tools,0);
 await assert.rejects(runApiTaskAssist({...common,route:{provider:'deepseek',model:'x'}}),/不会调用/);assert.equal(models,0);assert.equal(tools,0);
 await assert.rejects(runApiTaskAssist(common),/未开放/);assert.equal(tools,3,'schema only');
 let valid=true;await assert.rejects(runApiTaskAssist({...common,current:()=>valid,complete:async()=>{valid=false;return '{"tool":"bridge_read","arguments":{"url":"https://example.test"}}';}}),/关闭/);assert.equal(tools,6,'cancelled before real call');
});
test('a fabricated summary with no read receipt is rejected, failures are capped and results never replay writes',async()=>{
 const router=async call=>{if(call.action==='schema')return {ok:true,parameters:{type:'object'}};throw Error('read failed');};
 await assert.rejects(runApiTaskAssist({task:'读网页',route,router,complete:async()=>'{"done":true,"summary":"看过了"}'}),/实际读取/);
 let calls=0;await assert.rejects(runApiTaskAssist({task:'读网页',route,router:async c=>{if(c.action==='call')calls++;return router(c);},complete:async()=>'{"tool":"bridge_read","arguments":{"url":"https://example.test"}}'}),/三次/);assert.equal(calls,3);
});
