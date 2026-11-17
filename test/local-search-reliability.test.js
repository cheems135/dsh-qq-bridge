import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRouterArguments} from '../local-tool-call.js';
import {checkSearchEvidence,quotedSearchRetry} from '../local-search-evidence.js';
import {createLocalAgent} from '../local-agent.js';
import {createTaskWaitMonitor} from '../local-wait-notice.js';
const params={type:'object',properties:{action:{type:'string',enum:['schema','call','list']},name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false};
const tool=execute=>({kind:'data',repeatable:true,parameters:params,execute});
const bad={ok:true,title:'铁人崛起 梗 - 搜索',query:'铁人崛起 梗',links:[{title:'日向雏田 - 百科',url:'https://example.com/hinata'}],text:'日向雏田是火影忍者中的角色。'};
const good={ok:true,links:[{title:'铁人崛起这个梗的讨论',url:'https://example.com/discussion'}],text:'该页面实际讨论了铁人崛起。'};
test('real malformed read-only router envelopes normalize without changing business args',()=>{
 for(const input of [{action:'bridge_search',name:'bridge_search',arguments:{query:'铁人崛起'}},{action:'bridge_search',query:'铁人崛起'},{name:'bridge_search',arguments:{query:'铁人崛起'}}])assert.deepEqual(normalizeRouterArguments('bridge_tools',input),{action:'call',name:'bridge_search',arguments:{query:'铁人崛起'}});
 assert.throws(()=>normalizeRouterArguments('bridge_tools',{action:'bridge_search',name:'bridge_browser',arguments:{}}),/冲突/);
 assert.deepEqual(normalizeRouterArguments('bridge_tools',{action:'bridge_qq_api',arguments:{action:'send'}}),{action:'bridge_qq_api',arguments:{action:'send'}});
 assert.throws(()=>normalizeRouterArguments('bridge_tools',{action:'bridge_search',arguments:{query:'x'},query:'y'}),/同时/);
});
test('same rejected parameters stop before another model or any business execution',async()=>{
 let models=0,calls=0;const a=createLocalAgent({maxToolRounds:12,model:async()=>{models++;return JSON.stringify({action:'bridge_tools',arguments:{action:'invented',query:'x'}});},tools:{bridge_tools:tool(async()=>calls++)}});
 await assert.rejects(a.run({messages:[{role:'user',content:'查资料'}]}),/连续两次/);assert.equal(models,2);assert.equal(calls,0);
});
test('repeated schema discovery cannot consume all twelve rounds',async()=>{
 let calls=0,models=0;const a=createLocalAgent({maxToolRounds:12,model:async()=>{models++;return JSON.stringify({action:'bridge_tools',arguments:{action:'schema',name:'bridge_search'}});},tools:{bridge_tools:tool(async()=>{calls++;return {ok:true,name:'bridge_search',parameters:{}};})}});
 await assert.rejects(a.run({messages:[{role:'user',content:'查资料'}]}),/空转/);assert.equal(models,3);assert.equal(calls,2);
});
test('search title and echoed query do not validate unrelated candidates',()=>{
 assert.throws(()=>checkSearchEvidence({...bad,text:'铁人崛起 梗\n日向雏田是角色。'},'铁人崛起 梗'),e=>e.code==='SEARCH_UNRELATED'&&e.evidence.links.length===1);
 assert.equal(checkSearchEvidence(good,'铁人崛起 梗').relevance.status,'literal-match');
 assert.equal(checkSearchEvidence({ok:true,links:[{title:'Python documentation'}],text:'Python is a programming language.'},'Python 官方新手入门教程').relevance.status,'literal-match');
 assert.equal(quotedSearchRetry('铁人崛起 梗'),'"铁人崛起" 梗');assert.equal(quotedSearchRetry('"铁人崛起" 梗'),'');
});
test('unrelated search retries a quoted original once, records both attempts, and uses successful real evidence',async()=>{
 let calls=0,models=0;const attempts=[];const a=createLocalAgent({maxToolRounds:5,model:async()=>++models===1?JSON.stringify({action:'bridge_tools',arguments:{action:'bridge_search',query:'铁人崛起 梗'}}):JSON.stringify({action:'final',text:'已取得匹配原词的讨论页面。'}),tools:{bridge_tools:tool(async args=>{calls++;attempts.push(args.arguments.query);return calls===1?bad:good;})}});
 const result=await a.run({messages:[{role:'user',content:'搜索铁人崛起这个梗'}]});assert.equal(calls,2);assert.deepEqual(attempts,['铁人崛起 梗','"铁人崛起" 梗']);assert.equal(result.receipts[0].ok,false);assert.equal(result.receipts[1].ok,true);assert.equal(result.receipts[1].data.relevance.status,'literal-match');
});
test('two unrelated search pages cannot turn into a fabricated correction',async()=>{
 let calls=0,models=0;const a=createLocalAgent({maxToolRounds:5,model:async()=>++models===1?JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'铁人崛起 梗'}}}):'你打错字了，是日向雏田。',tools:{bridge_tools:tool(async()=>{calls++;return bad;})}});
 const result=await a.run({messages:[{role:'user',content:'搜索铁人崛起这个梗'}]});assert.equal(calls,2);assert.match(result.text,/没对上/);assert.doesNotMatch(result.text,/日向雏田/);assert.ok(result.receipts.every(r=>!r.ok));
});
test('180 second monitor checks current state only at the deadline and sends once',async()=>{
 let fire,delay,checks=0;const events=[];const m=createTaskWaitMonitor({getStatus:async()=>{checks++;return {state:'queued'};},emit:e=>events.push(e),setTimer:(fn,ms)=>{fire=fn;delay=ms;return 1;}});m.start();m.start();assert.equal(delay,180000);assert.equal(checks,0);assert.equal(events.length,0);await fire();assert.equal(checks,1);assert.equal(events[0].status,'queued');assert.match(events[0].text,/排队/);m.stop();
});
test('deadline status distinguishes failed, running, unknown, and finished tasks',async()=>{
 for(const state of ['failed','running','unknown','done']){let fire;const events=[];const m=createTaskWaitMonitor({getStatus:async()=>({state}),emit:e=>events.push(e),setTimer:fn=>(fire=fn,1)});m.start();await fire();assert.equal(events.length,state==='done'?0:1);if(events.length){assert.equal(events[0].status,state);if(state==='unknown')assert.match(events[0].text,/暂时没能确认/);}m.stop();}
});
test('finishing while the deadline check is pending suppresses stale notices',async()=>{
 let fire,resolve;const events=[];const m=createTaskWaitMonitor({getStatus:()=>new Promise(r=>resolve=r),emit:e=>events.push(e),setTimer:fn=>(fire=fn,1)});m.start();const checking=fire();m.stop();resolve({state:'running'});await checking;assert.deepEqual(events,[]);
});


test('redirecting pages retry observations only, while network failures and continuing redirects stop',async()=>{
 const {stablePageRead}=await import('../browser-controller.js');let reads=0,waits=0;
 const page={waitForLoadState:async()=>waits++,waitForTimeout:async()=>{}};
 assert.equal(await stablePageRead(page,async()=>{if(++reads===1)throw Error('Execution context was destroyed, most likely because of a navigation');return 'actual new document';}),'actual new document');assert.equal(reads,2);assert.equal(waits,1);
 reads=0;await assert.rejects(stablePageRead(page,async()=>{reads++;throw Error('ERR_NETWORK_ACCESS_DENIED');}),/NETWORK_ACCESS/);assert.equal(reads,1);
 reads=0;await assert.rejects(stablePageRead(page,async()=>{reads++;throw Error('Execution context was destroyed');}),/context/);assert.equal(reads,3);
});
