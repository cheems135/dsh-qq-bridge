import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent} from '../local-agent.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';
import {runWithHostTools} from '../local-tool-broker.js';
import {listenLocalServer} from './local-server-listen.js';

const router=execute=>({bridge_tools:{kind:'data',repeatable:true,parameters:{type:'object',properties:{action:{type:'string'},name:{type:'string'},arguments:{type:'object'}},required:['action'],additionalProperties:false},execute}});
test('a bare router label is repaired into a validated ordinary search and never becomes QQ prose',async()=>{
 let calls=0,executed=0;const waiting=[],progress=[];
 const agent=createLocalAgent({acceptMixedActions:true,maxToolRounds:5,onWaitText:t=>waiting.push(t),onProgress:e=>progress.push(e),tools:router(async args=>{executed++;assert.equal(args.action,'call');assert.equal(args.name,'bridge_search');assert.equal(args.arguments.query,'绿萝养护');return {ok:true,text:'实际搜索结果：绿萝养护指南'};}),model:async options=>{
  calls++;if(calls===1)return '[bridge_tools]';if(calls===2){assert.match(options.messages.at(-1).content,/格式修正/);return JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'绿萝养护'}}});}assert.ok(options.messages.some(r=>r._localReceipt&&r.content.includes('实际搜索结果')));return '查到了一份绿萝养护指南。';
 }});
 const result=await agent.run({messages:[{role:'user',content:'帮我搜索绿萝养护'}]});assert.equal(executed,1);assert.equal(calls,3);assert.equal(result.receipts[0].ok,true);assert.doesNotMatch(result.text,/bridge_tools/);assert.ok(progress.some(e=>e.reason==='tool-protocol'));assert.deepEqual(waiting,[]);
});
test('persistent labels or a promise after a malformed call cannot claim that a search actually ran',async()=>{
 for(const second of ['[bridge_tools]','已经搜索完了。']){let calls=0,executed=0;const agent=createLocalAgent({acceptMixedActions:true,tools:router(async()=>{executed++;return {ok:true};}),model:async()=>++calls===1?'[bridge_tools]':second});await assert.rejects(agent.run({messages:[{role:'user',content:'帮我搜索园艺资料'}]}),/没有有效工具参数|没有实际执行记录/);assert.equal(executed,0);assert.equal(calls,2);}
});
test('a label next to a complete strict action needs no extra repair inference',async()=>{
 let calls=0,executed=0;const agent=createLocalAgent({acceptMixedActions:true,tools:router(async args=>{executed++;assert.equal(args.action,'call');return {ok:true,text:'取得实际资料'};}),model:async()=>++calls===1?'[bridge_tools]\n'+JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'浇水'}}}):'找到资料了。'});
 const result=await agent.run({messages:[{role:'user',content:'搜索浇水资料'}]});assert.equal(executed,1);assert.equal(calls,2);assert.equal(result.receipts[0].ok,true);
});
test('native calls do not leak their redundant label as a waiting line; explicit literal output remains literal',async()=>{
 let calls=0,executed=0;const waiting=[];const agent=createLocalAgent({acceptMixedActions:true,onWaitText:t=>waiting.push(t),tools:router(async()=>{executed++;return {ok:true,text:'实际内容'};}),model:async()=>++calls===1?{content:'[bridge_tools]',tool_calls:[{id:'call',function:{name:'bridge_tools',arguments:JSON.stringify({action:'call',name:'bridge_search',arguments:{query:'园艺'}})}}]}:'查到了。'});
 await agent.run({messages:[{role:'user',content:'搜索园艺资料'}]});assert.equal(executed,1);assert.deepEqual(waiting,[]);
 const literal=createLocalAgent({acceptMixedActions:false,model:async()=>'[bridge_tools]'});assert.equal((await literal.run({messages:[{role:'user',content:'原样输出 [bridge_tools]'}]})).text,'[bridge_tools]');
});

test('owner tool broker and actual gateway require a real search instead of accepting a knowledge-only answer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'tool-label-broker-')),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,mediaDir:dir}));
 let models=0,searches=0,schemas=0;const events=[];
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async options=>{
  models++;if(models===1)return '绿萝应该按盆土干湿浇水。';
  if(models===2){assert.match(options.messages.at(-1).content,/搜索执行核对/);return JSON.stringify({action:'bridge_tools',arguments:{action:'schema',name:'bridge_search'}});}
  if(models===3)return JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'绿萝浇水频率'}}});
  assert.ok(options.messages.some(row=>String(row.content).includes('测试资料：按盆土干湿浇水')));return '查到的资料建议按盆土干湿浇水。';
 }});
 const baseUrl=await listenLocalServer(service);
 const tools=router(async args=>{assert.equal(args.name,'bridge_search');if(args.action==='schema'){schemas++;return {ok:true,parameters:{type:'object',properties:{query:{type:'string'}},required:['query']}};}assert.equal(args.action,'call');assert.deepEqual(args.arguments,{query:'绿萝浇水频率'});searches++;return {ok:true,text:'测试资料：按盆土干湿浇水',url:'https://example.com/gardening'};});
 try{
  const response=await runWithHostTools({baseUrl,messages:[{role:'user',content:'帮我搜索绿萝浇水频率'}],tools,onEvent:e=>events.push(e)});
  assert.equal(searches,1);assert.equal(schemas,1);assert.equal(models,4);assert.doesNotMatch(response.body.text,/bridge_tools/);assert.equal(response.body.qqDelivered,false);
  assert.ok(response.body.receipts.some(r=>r.ok&&r.data?.text==='测试资料：按盆土干湿浇水'));assert.ok(response.body.invocations.some(r=>r.tool==='bridge_search'&&r.status==='returned'&&r.arguments.query==='绿萝浇水频率'));
  assert.ok(events.every(e=>!['notice','text'].includes(e.type||e.event)||!String(e.text).includes('[bridge_tools]')));
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
