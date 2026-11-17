import test from 'node:test';import assert from 'node:assert/strict';
import {createLocalAgent} from '../local-agent.js';import {CONTEXT_PARAMETERS} from '../context-demand.js';
import {localRequiredDataTools} from '../local-search-task.js';
const router={kind:'data',repeatable:true,parameters:{type:'object',properties:{action:{type:'string',enum:['list','schema','call']},name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false}};
async function run(actions){const calls=[],traces=[];let i=0,remote=0;const agent=createLocalAgent({model:async()=>JSON.stringify(actions[i++]||{action:'final',text:'已核对'}),tools:{bridge_tools:{...router,execute:async args=>{remote++;if(args.action==='list')return {ok:true,tools:[]};throw Error('Direct local tools must not be sent to remote router');}},bridge_context:{kind:'data',repeatable:true,description:'读取当前会话的资料',parameters:CONTEXT_PARAMETERS,execute:async args=>{calls.push(args);return {ok:true,topics:args.topics};}}}});const result=await agent.run({messages:[{role:'user',content:'查看当前日程'}],onProgress:event=>{if(event.invocation)traces.push(event.invocation);}});return {result,calls,traces,remote};}
test('flattened context topics are restored then checked and executed under the actual tool schema',async()=>{
 const h=await run([{action:'bridge_tools',arguments:{action:'call',name:'bridge_context',topics:['schedule'],query:'日程'}}]);assert.equal(h.remote,0);assert.deepEqual(h.calls,[{action:'get',topics:['schedule'],query:'日程'}]);assert.equal(h.result.receipts[0].ok,true);
});
test('direct-tool schema can be discovered through router without executing the context read',async()=>{
 const h=await run([{action:'bridge_tools',arguments:{action:'schema',name:'bridge_context'}}]);assert.equal(h.calls.length,0);assert.equal(h.remote,0);assert.equal(h.result.receipts[0].informational,true);assert.deepEqual(h.result.receipts[0].data.parameters,CONTEXT_PARAMETERS);
});
test('mixed nested and flattened arguments are rejected, unknown context fields and other peoples targets remain rejected',async()=>{
 for(const arguments_ of [{action:'call',name:'bridge_context',arguments:{action:'get'},topics:['schedule']},{action:'call',name:'bridge_context',arguments:{action:'get',topics:['schedule'],target:'private:other'}},{action:'call',name:'bridge_context',topics:['unknown']}]){const h=await run([{action:'bridge_tools',arguments:arguments_}]);assert.equal(h.calls.length,0);assert.ok(h.result.receipts.some(r=>r.rejected));}
});
test('router discovery includes already exposed direct tools',async()=>{const h=await run([{action:'bridge_tools',arguments:{action:'list'}}]);assert.ok(h.result.receipts[0].data.tools.some(t=>t.name==='bridge_context'));assert.equal(h.calls.length,0);});
test('an explicit context read needs actual get, not a tool directory or a spoken promise',async()=>{
 assert.deepEqual(localRequiredDataTools('读取今天的日程资料'),['bridge_context']);assert.deepEqual(localRequiredDataTools('不要读取今天的日程资料'),[]);
 let turn=0,gets=0;const actions=[{action:'bridge_context',arguments:{action:'list'}},{action:'final',text:'已经看过了。'},{action:'bridge_context',arguments:{action:'get',topics:['schedule']}},{action:'final',text:'已取得实际日程。'}];
 const agent=createLocalAgent({requiredDataTools:['bridge_context'],maxToolRounds:5,model:async()=>JSON.stringify(actions[turn++]||actions.at(-1)),tools:{bridge_context:{kind:'data',repeatable:true,parameters:CONTEXT_PARAMETERS,execute:async args=>{if(args.action==='get')gets++;return {ok:true,topics:args.topics||['schedule']};}}}});
 const result=await agent.run({messages:[{role:'user',content:'读取今天的日程资料'}]});assert.equal(gets,1);assert.equal(result.receipts[0].informational,true);assert.ok(result.receipts.some(r=>r.tool==='bridge_context'&&r.ok&&!r.informational));
});

test('a rejected context request gets a context-specific repair instead of more router discovery',async()=>{
 let turn=0,gets=0,repair;
 const agent=createLocalAgent({requiredDataTools:['bridge_context'],maxToolRounds:5,model:async request=>{
  turn++;if(turn===1)return JSON.stringify({action:'bridge_tools',arguments:{action:'list',topics:['schedule']}});
  if(turn===2){repair=request;return JSON.stringify({action:'bridge_context',arguments:{action:'get',topics:['schedule']}});}
  return JSON.stringify({action:'final',text:'已取得实际日程。'});
 },tools:{bridge_tools:{...router,execute:async()=>{throw Error('Must not execute malformed router arguments');}},bridge_context:{kind:'data',repeatable:true,parameters:CONTEXT_PARAMETERS,execute:async args=>{gets++;return {ok:true,topics:args.topics};}}}});
 const result=await agent.run({messages:[{role:'user',content:'读取今天的日程资料'}]});
 assert.equal(gets,1);assert.deepEqual(repair.tools,[]);assert.match(repair.protocol,/只调用 bridge_context/);assert.match(repair.protocol,/"action":"get","topics":\["schedule"\]/);assert.ok(result.receipts.some(r=>r.tool==='bridge_context'&&r.ok&&!r.informational));
});
