import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent,toOpenAITools} from '../local-agent.js';
import {createAgentCapabilities} from '../agent-capabilities.js';

const schema={type:'object',properties:{query:{type:'string',maxLength:100}},required:['query'],additionalProperties:false};
test('data tools return actual structured information without requiring media',async()=>{
  let calls=0;
  const agent=createLocalAgent({model:async({messages,tools})=>{
    assert.ok(tools.some(t=>t.function.name==='bridge_search'));
    return ++calls===1?{tool_calls:[{id:'s',function:{name:'bridge_search',arguments:{query:'实际搜索'}}}]}:'资料已经取得。';
  },tools:{bridge_search:{kind:'data',parameters:schema,execute:async args=>({ok:true,items:[{title:args.query,url:'https://example.com'}]})}}});
  const result=await agent.run({messages:[{role:'user',content:'搜索一下'}]});
  assert.equal(calls,2);assert.equal(result.receipts[0].kind,'data');assert.equal(result.receipts[0].data.items[0].title,'实际搜索');assert.equal(result.mediaCount,0);assert.equal(result.attachments.length,0);
});
test('data schema rejects extra fields and required argument errors before execution',async()=>{
  let executions=0,round=0;
  const agent=createLocalAgent({model:async()=>++round===1?' {"action":"bridge_search","arguments":{"query":"x","command":"oops"}} ':'参数没有通过检查。',tools:{bridge_search:{kind:'data',parameters:schema,execute:async()=>executions++}}});
  const result=await agent.run({messages:[{role:'user',content:'查资料'}]});
  assert.equal(executions,0);assert.equal(result.receipts[0].rejected,true);
});
test('repeatable observations see fresh state and remain bounded by the tool call budget',async()=>{
  let executions=0;
  const agent=createLocalAgent({maxToolCalls:2,maxToolRounds:3,model:async({tools})=>tools.length?'{"action":"bridge_observe","arguments":{}}':'观察结束',tools:{bridge_observe:{kind:'data',repeatable:true,parameters:{type:'object',additionalProperties:false},execute:async()=>({ok:true,version:++executions})}}});
  const result=await agent.run({messages:[{role:'user',content:'观察变化'}]});
  assert.equal(executions,2);assert.equal(result.receipts[1].data.version,2);
});
test('failed final generation preserves completed data receipts',async()=>{
  let round=0;
  const agent=createLocalAgent({model:async()=>{if(++round===1)return '{"action":"bridge_search","arguments":{"query":"x"}}';throw Error('model disconnected');},tools:{bridge_search:{kind:'data',parameters:schema,execute:async()=>({ok:true,text:'真实资料'})}}});
  const result=await agent.run({messages:[{role:'user',content:'查资料'}]});
  assert.equal(result.partial,true);assert.equal(result.receipts[0].data.text,'真实资料');
});

test('flattened router JSON is normalized without adding any host permission',async()=>{
  let round=0;const executions=[];
  const replies=['{"action":"schema","name":"bridge_bilibili"}','{"action":"call","name":"bridge_bilibili","arguments":{"action":"popular"}}','取得了实际热门视频。'];
  const parameters={type:'object',properties:{action:{type:'string',enum:['list','schema','call']},name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['action'],additionalProperties:false};
  const agent=createLocalAgent({model:async()=>replies[round++],tools:{bridge_tools:{kind:'data',repeatable:true,parameters,execute:async args=>{executions.push(args);return {ok:true,text:'actual result'};}}}});
  const result=await agent.run({messages:[{role:'user',content:'读取热门'}]});
  assert.deepEqual(executions,[{action:'schema',name:'bridge_bilibili'},{action:'call',name:'bridge_bilibili',arguments:{action:'popular'}}]);assert.equal(result.receipts[0].informational,true);assert.equal(result.receipts[1].informational,false);
});
test('failed tools cannot be followed by a fabricated successful answer',async()=>{
  let round=0;
  const agent=createLocalAgent({model:async()=>++round===1?'{"action":"bridge_search","arguments":{"query":"x"}}':'第一条热门视频是一个模型编造的标题。',tools:{bridge_search:{kind:'data',parameters:schema,execute:async()=>({ok:false,error:'网络未连接'})}}});
  const result=await agent.run({messages:[{role:'user',content:'查热门'}]});
  assert.match(result.text,/没能完整接上/);assert.doesNotMatch(result.text,/编造的标题/);
});

test('local tool router executes the registered browser wrapper and preserves permission checks',async()=>{
  const registered=new Map(),events=[];let allowed=true,executions=0;
  const capabilities=createAgentCapabilities({ctx:{get:name=>name==='tools'?{register:definition=>{registered.set(definition.name,definition);return()=>{};}}:null},getConfig:()=>({enabled:true,browser:true}),getContext:()=>{throw Error('local execution must use its bound context');},authorize:()=>allowed,browser:{status:()=>({}),act:async(args,context)=>{assert.equal(context.localTurn,true);executions++;return {ok:true,url:args.url};},close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:async()=>({})}),services:{gate:async()=>events.push('gate')},onActivity:()=>events.push('receipt')});
  assert.equal(capabilities.start(),true);
  const tools=capabilities.localTools({localTurn:true,key:'private:owner'}),router=tools.bridge_tools;
  const listed=await router.execute({action:'list'});assert.ok(listed.tools.some(t=>t.name==='bridge_browser'));assert.ok(!listed.tools.some(t=>t.name==='bridge_native'));
  const result=await router.execute({action:'call',name:'bridge_browser',arguments:{action:'navigate',url:'https://example.com'}},{});
  assert.equal(result.url,'https://example.com');assert.equal(executions,1);assert.deepEqual(events,['gate','receipt']);
  await assert.rejects(router.execute({action:'call',name:'bridge_browser',arguments:{action:'invalid'}},{}),/选项/);
  allowed=false;await assert.rejects(router.execute({action:'list'}),/权限|任务/);assert.equal(executions,1);capabilities.close();
});

test('verified local models discover registered drawing/game tools without native or cloud-account escalation',async()=>{
 let allowed=true,draws=0;const registry=new Map();
 const capabilities=createAgentCapabilities({ctx:{get:()=>({register:d=>{registry.set(d.name,d);return()=>{};}})},getConfig:()=>({enabled:true,browser:true}),getContext:()=>({}),authorize:()=>allowed,browser:{status:()=>({}),close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({}),services:{drawing:async()=>({ok:true,count:++draws}),game:async()=>({ok:true}),native:async()=>{},comfyui:async()=>{},recharge:async()=>{}}});
 capabilities.start();const context={localTurn:true,chat:{kind:'private',isOwner:true},capabilities:{tools:true}},router=capabilities.localTools(context).bridge_tools;
 const names=(await router.execute({action:'list'})).tools.map(t=>t.name);assert.ok(names.includes('bridge_drawing'));assert.ok(names.includes('bridge_game'));assert.ok(!names.includes('bridge_native'));assert.ok(!names.includes('bridge_comfyui'));assert.ok(!names.includes('bridge_recharge'));
 const schema=await router.execute({action:'schema',name:'bridge_drawing'});assert.ok(schema.parameters);allowed=false;await assert.rejects(router.execute({action:'schema',name:'bridge_drawing'}));assert.equal(draws,0);capabilities.close();
});

