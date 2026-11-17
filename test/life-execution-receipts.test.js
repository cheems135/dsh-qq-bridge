import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createAgentCapabilities} from '../agent-capabilities.js';
import {createExecutionRuntime,operationEffect} from '../execution-runtime.js';
import {reconcileDeliveredLifeShares} from '../life-execution.js';

test('the same host execution finishes QQ sends and browser observations',async()=>{
 const definitions=new Map(),journal=[],steps=[];
 const life={beginStep:(_id,_meta,input)=>({step:{id:'step-'+steps.push({input})}}),settleStep:(_id,_meta,id,result)=>{steps[Number(id.slice(5))-1].result=result;}};
 const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>life,journal:row=>journal.push(row)});
 const context={accountId:'a',personaId:'p',key:'private:12345',sessionId:'s',meta:{lifeJobId:'life'}};
 const capabilities=createAgentCapabilities({ctx:{get:key=>key==='tools'?{register:definition=>{definitions.set(definition.name,definition);return()=>{};}}:null},getConfig:()=>({enabled:true}),getContext:()=>context,authorize:()=>true,browser:{status:()=>({}),act:async(args,c)=>{runtime.begin(c.exec,c,{...args,toolName:'bridge_browser'});return {ok:true,status:'read',body:'observed page'};},close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:async()=>({})}),services:{lifeChat:async(args,c)=>{runtime.begin(c.exec,c,{...args,toolName:'bridge_life_qq'});return {ok:true,queued:true,deliveryId:'qq-1'};},lifeShare:async(args,c)=>{runtime.begin(c.exec,c,{...args,toolName:'bridge_life_share'});return {ok:true,queued:true,deliveryId:'qq-2'};},afterTool:async(_args,c,outcome)=>runtime.finish(outcome.exec,c,outcome.result,{error:outcome.error})}});
 capabilities.start();
 await definitions.get('bridge_life_qq').execute({action:'send',target:'private:12345',text:'hello'},{name:'bridge_life_qq'});
 await definitions.get('bridge_life_share').execute({action:'send',target:'private:12345',text:'hello'},{name:'bridge_life_share'});
 await definitions.get('bridge_browser').execute({action:'snapshot'},{name:'bridge_browser'});
 assert.equal(steps.length,3);
 assert.deepEqual(steps.map(step=>step.result?.status),['unknown','unknown','confirmed']);
 assert.equal(journal.filter(row=>row.status==='started').length,3);
 assert.equal(journal.filter(row=>row.status!=='started').length,3);
});

test('only a rejected music input is known to be unsubmitted; a timeout stays unknown',()=>{
 assert.equal(operationEffect({toolName:'bridge_audio',url:'bad link'}),'local');
 const settled=[];
 const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>({beginStep:()=>({step:{id:'step'}}),settleStep:(_job,_meta,_step,result)=>settled.push(result)})});
 const context={accountId:'a',personaId:'p',meta:{lifeJobId:'job'}};
 const rejected={name:'bridge_audio',arguments:{}};
 runtime.begin(rejected,context);runtime.finish(rejected,context,null,{error:'请提供网易云歌曲链接、分享卡片或真实音频地址'});
 assert.equal(settled[0].status,'not_applied');
 const uncertain={name:'bridge_audio',arguments:{url:'https://example.org/song.mp3'}};
 runtime.begin(uncertain,context);runtime.finish(uncertain,context,null,{error:'音频服务请求超时'});
 assert.equal(settled[1].status,'unknown');
});

test('a post-tool accounting error does not run the completion callback twice',async()=>{
 const definitions=new Map(),settled=[];let afterCalls=0;
 const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>({beginStep:()=>({step:{id:'s'}}),settleStep:(_job,_meta,_id,result)=>settled.push(result)})});
 const tools=createAgentCapabilities({ctx:{get:key=>key==='tools'?{register:definition=>{definitions.set(definition.name,definition);return()=>{};}}:null},getConfig:()=>({enabled:true}),getContext:()=>({accountId:'a',personaId:'p',meta:{lifeJobId:'job'}}),authorize:()=>true,browser:{status:()=>({}),close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:async()=>({})}),services:{lifeChat:async(args,context)=>{runtime.begin(context.exec,context,{...args,toolName:'bridge_life_qq'});return {ok:true,queued:true,deliveryId:'delivery'};},afterTool:async(_args,context,outcome)=>{afterCalls++;runtime.finish(outcome.exec,context,outcome.result);throw Error('accounting failed');}}});
 tools.start();
 await assert.rejects(definitions.get('bridge_life_qq').execute({action:'send',target:'private:12345',text:'hello'},{name:'bridge_life_qq'}),/accounting failed/);
 assert.equal(afterCalls,1);
 assert.equal(settled.length,1);
 assert.equal(settled[0].status,'unknown');
});

test('daily accounting failure still closes the actual tool receipt',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=source.indexOf('      afterTool:async(args,context,outcome)=>{'),end=source.indexOf('      operationRequest:',start);
 assert(start>0&&end>start);
 const finished=[];
 const after=Function('commitmentLedger','gameSessions','executionRuntime',`return ({${source.slice(start,end)}}).afterTool;`)({receipt:()=>{throw Error('accounting failed');}},{record:()=>{}},{finish:(...args)=>finished.push(args)});
 await assert.rejects(after({toolName:'bridge_life_qq'},{meta:{commitmentId:'c'}},{exec:{name:'bridge_life_qq'},result:{ok:true,queued:true,deliveryId:'d'}}),/accounting failed/);
 assert.equal(finished.length,1);
 assert.equal(finished[0][2].deliveryId,'d');
});

test('legacy started send is repaired only by a unique same-job QQ readback',()=>{
 const meta={accountId:'a',personaId:'p'},at=Date.parse('2026-11-17T10:00:00+08:00');
 const make=()=>({jobs:[{id:'job',meta,scene:{date:'2026-11-17',end:'11:00'},status:'needs_reconcile',steps:[{id:'step',key:'op',tool:'bridge_life_qq',effect:'send',target:'private:12345',status:'started',idempotent:false,at}],shares:[{target:'private:12345',at:at+300,deliveryId:'delivery'}]}]});
 const op=()=>[{id:'op',tool:'bridge_life_qq',status:'started',target:'private:12345',...meta}];
 const delivered=()=>[{id:'delivery',chat:'private:12345',status:'sent',messageId:'123',verification:{state:'observed'},...meta}];
 for(const changed of [row=>{row.verification.state='pending';},row=>{row.accountId='other';},row=>{delete row.messageId;}]){
  const state=make(),operations=op(),outbox=delivered();changed(outbox[0]);
  assert.equal(reconcileDeliveredLifeShares(state,operations,outbox,at+500),0);
  assert.equal(state.jobs[0].status,'needs_reconcile');
  assert.equal(operations[0].status,'started');
 }
 const state=make(),operations=op();
 assert.equal(reconcileDeliveredLifeShares(state,operations,delivered(),at+500),1);
 assert.equal(state.jobs[0].steps[0].status,'confirmed');
 assert.equal(state.jobs[0].status,'paused');
 assert.equal(state.jobs[0].resumeOnIdle,true);
 assert.equal(operations[0].status,'confirmed');
 assert.equal(reconcileDeliveredLifeShares(state,operations,delivered(),at+500),0);
 const ambiguous=make();ambiguous.jobs[0].shares.push({...ambiguous.jobs[0].shares[0],at:at+400});
 assert.equal(reconcileDeliveredLifeShares(ambiguous,op(),delivered(),at+500),0);
});
