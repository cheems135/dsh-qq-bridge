import test from 'node:test';import assert from 'node:assert/strict';import {createServiceConnections} from '../service-connections.js';
import {auditModelCompletion,invocationViewRows} from '../model-invocation-audit.js';import {localIssueReply} from '../local-issue-reply.js';
import {readFileSync} from 'node:fs';
test('choosing local chat preserves independent API media choices and never restores the removed global mode',()=>{
 let state=null,local=false,complement=false;
 const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:v=>state=structuredClone(v)},getLegacyMode:()=>local,getLegacyComplement:()=>complement,onChange:s=>{local=s.routes.enabled?s.routes.chat==='local':s.legacyLocalEnabled;complement=s.routes.enabled?false:s.legacyApiComplement;}});
 c.saveRoutes({enabled:true,chat:'local',image:'legacy',speech:'legacy'});assert.equal(local,true);
 c.saveRoutes({enabled:false,chat:'local'});assert.equal(local,true);
 c.saveRoutes({chat:'local'});assert.equal(local,true);assert.equal(complement,false);assert.deepEqual(c.raw().routes,{enabled:true,chat:'local',image:'legacy',speech:'legacy',video:'legacy'});assert.equal(c.setMode,undefined);
 c.saveRoutes({chat:'host'});assert.equal(local,false);assert.equal(c.route('image'),'legacy');
});
test('model records show purpose, input, output and real returned usage; failure stays a failure',async()=>{
 const rows=[];const result=await auditModelCompletion({record:r=>rows.push(r),backend:'api',system:'You are an image art director',input:'画窗边书桌',run:async usage=>{usage({inputTokens:20,outputTokens:10});return '窗边书桌的描述';}});
 assert.equal(result,'窗边书桌的描述');assert.equal(rows[0].purpose,'编写生图提示词');assert.equal(rows[0].input,'画窗边书桌');assert.equal(rows[1].output,result);assert.equal(rows[1].usage.inputTokens,20);
 await assert.rejects(auditModelCompletion({record:r=>rows.push(r),backend:'local',input:'你好',run:async()=>{throw Error('ECONNREFUSED');}}));assert.equal(rows.at(-1).status,'failed');
});
test('existing chat audits join the records with account and source filtering and no invented thoughts',()=>{
 const audits=[{id:'1',accountId:'a',chat:'private:1',at:10,endedAt:20,input:'你好',answer:'晚上好',local:true,status:'completed',modelExplanation:''},{id:'2',accountId:'b',at:11,input:'其他账号私聊',answer:'private'}];
 const rows=invocationViewRows([],audits,{accountId:'a',backend:'local',kind:'chat'});assert.equal(rows.length,1);assert.equal(rows[0].output,'晚上好');assert.equal(rows[0].modelExplanation,'');assert.equal(rows[0].elapsedMs,10);
});
test('human-readable failure explains a real cause without a model call or claiming success',()=>{
 const text=localIssueReply(Error('ECONNREFUSED'),{style:'gentle'});assert.doesNotMatch(text,/等我一下|跟你说一下|这次未能完成/);assert.match(text,/连不上/);assert.doesNotMatch(text,/已完成|生成好了/);
 assert.match(localIssueReply(Error('HTTP 401'),{backend:'api'}),/账号或密钥验证/);
});
test('pure local API entry is blocked before touching any model transport',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  async function askApiModel(system,');const end=source.indexOf('\n  async function askApiModelRaw',start);
 let called=0;const fn=Function('apiInvocationAllowed','apiChatRoute','auditModelCompletion','return ('+source.slice(start,end)+')')(()=>false,()=>{called++;},()=>{called++;});
 await assert.rejects(fn('system','user'),/纯本地/);assert.equal(called,0);
});
test('switching mode while an image prompt is being prepared prevents the paid image POST',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  async function connectedPhoto('),end=source.indexOf('\n  function routedHostMediaTools',start);
 const featureState={generation:0};let finish,calls=0;const ready=new Promise(resolve=>finish=resolve);
 const deps={serviceConnections:{profile:()=>({name:'mock',imageModel:'mock-image'})},panelOperationKey:()=>'',randomUUID:()=> 'test',invocationScope:()=>({}),featureState,apiModeController:new AbortController(),recordInvocation:()=>{},prepareConnectionVisual:()=>ready,serviceSource:()=> 'local',mediaInvocationAllowed:()=>false,connectionMedia:async()=>{calls++;}};
 const fn=Function(...Object.keys(deps),'return ('+source.slice(start,end)+')')(...Object.values(deps));const pending=fn('test','',{chat:{key:'private:1'}},'profile:example');featureState.generation++;finish({prepared:{prompt:'window'},reference:null});
 await assert.rejects(pending,/没有提交云端/);assert.equal(calls,0);
});
