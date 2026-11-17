import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {executeLocalAutonomy} from '../local-autonomy.js';
import {createLocalInitiative} from '../local-initiative.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {runWithHostTools} from '../local-tool-broker.js';
import {listenLocalServer} from './local-server-listen.js';

test('autonomous cue uses checked tools and records results without impersonating incoming QQ',async()=>{
 const records=[],ended=[],delivered=[];let calls=0;
 await executeLocalAutonomy({context:{id:'a',persona:'角色',cue:'看看感兴趣的内容',history:[]},assertCurrent:()=>{},guardTool:async(n,a,run)=>{calls++;return run();},record:r=>records.push(r),finish:r=>ended.push(r),deliver:r=>delivered.push(r),run:async o=>{
  assert.equal(o.origin,'initiative');assert.match(o.messages.at(-1).content,/不是用户消息/);assert.equal(o.turnContext.toolsEnabled,true);
  await o.guardTool('bridge_watch',{},()=>({ok:true}));o.onEvent({event:'invocation',record:{tool:'bridge_watch',status:'returned',result:{coverage:'实际画面'}}});return {ok:true,body:{text:'[skip]',receipts:[{tool:'bridge_watch',ok:true}]}};
 }});
 assert.equal(calls,1);assert.equal(delivered.length,1);assert.deepEqual(ended,['completed']);assert.ok(records.some(r=>r.tool==='bridge_watch'));assert.equal(records.at(-1).status,'returned');
});

test('scope changes or a QQ preemption prevent stale tools and delivery',async()=>{
 for(const phase of ['before','tool','after']){
  let valid=phase!=='before',executed=0,delivered=0,finished='';
  await assert.rejects(executeLocalAutonomy({context:{id:'a',persona:'角色',cue:'活动'},assertCurrent:()=>{if(!valid)throw Object.assign(Error('QQ priority'),{name:'AbortError'});},guardTool:async(n,a,execute)=>execute(),deliver:()=>{delivered++;},finish:r=>finished=r,run:async o=>{if(phase==='tool'){valid=false;await o.guardTool('bridge_watch',{},()=>{executed++;});}valid=false;return {ok:true,body:{text:'不应送达'}};}}),/QQ priority/);
  assert.equal(delivered,0);assert.equal(executed,0);assert.equal(finished,'cancelled');
 }
});

test('real tool failure remains failed and cannot become a completed memory or QQ claim',async()=>{
 let finished,delivered=false;const records=[];
 await assert.rejects(executeLocalAutonomy({context:{id:'a',persona:'角色',cue:'活动'},assertCurrent:()=>{},guardTool:()=>{},record:r=>records.push(r),deliver:()=>delivered=true,finish:r=>finished=r,run:async()=>({ok:true,body:{text:'已经看完了',receipts:[{tool:'bridge_watch',ok:false,error:'video unavailable'}]}})}),/video unavailable/);
 assert.equal(finished,'failed');assert.equal(delivered,false);assert.equal(records.at(-1).status,'failed');
});

test('idle decision can choose a real activity without sending a task report',async()=>{
 const stamp=Date.now(),states={},actions=[],deliveries=[];
 const context={allowed:true,activitiesEnabled:true,unrestricted:true,id:'p',signature:'same',day:'2026-11-08',lastIncoming:stamp-3600000,persona:'角色',clock:'下午',history:[]};
 const engine=createLocalInitiative({context:()=>context,now:()=>stamp,load:id=>states[id],save:(id,s)=>states[id]={...s},probe:async()=>({contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}}),infer:async()=>JSON.stringify({speak:false,activity:'找一个摄影视频，观察实际画面'}),act:async a=>{actions.push(a);return true;},deliver:d=>deliveries.push(d)});
 assert.equal((await engine.tick()).status,'activity');assert.equal(actions.length,1);assert.equal(deliveries.length,0);assert.equal(states.p.lastResult,'activity');
 await engine.tick();assert.equal(actions.length,1);
});

test('actual gateway and reverse tool broker execute one local autonomous tool with a receipt',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'autonomy-test-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'openai',modelId:'isolated-test-model',modelBaseUrl:'http://127.0.0.1:8000/v1',voiceEnabled:false}));let modelCalls=0,toolCalls=0;
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),close:()=>{}},model:async options=>options.messages.at(-1)?.content==='helper text'?{choices:[{message:{content:'本地辅助提示词'}}]}:({choices:[{message:{content:++modelCalls===1?JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_watch',arguments:{url:'https://example.org/video'}}}):'[skip]'}}]})});
 const base=await listenLocalServer(service);
 try{
  const result=await runWithHostTools({baseUrl:base,origin:'initiative',messages:[{role:'user',content:'完成一个小目标'}],turnContext:{toolsEnabled:true,autonomous:true,autonomyId:'owned-test'},tools:{bridge_tools:{repeatable:true,parameters:{type:'object',properties:{action:{type:'string'},name:{type:'string'},arguments:{type:'object',additionalProperties:true}},required:['action']},execute:async args=>{toolCalls++;assert.equal(args.name,'bridge_watch');const helper=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({initiativeParent:'owned-test',messages:[{role:'user',content:'helper text'}]})});assert.equal(helper.status,200);return {ok:true,coverage:'已观察实际画面',substantive:true};}}}});
  assert.equal(result.ok,true);assert.equal(toolCalls,1);assert.ok(result.body.receipts.some(r=>r.ok&&r.routedTool==='bridge_watch'));const stale=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({initiativeParent:'owned-test',messages:[{role:'user',content:'helper text'}]})});assert.equal(stale.status,503);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('actual QQ priority request cancels an autonomous gateway turn',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'autonomy-priority-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'openai',modelId:'isolated-test-model',modelBaseUrl:'http://127.0.0.1:8000/v1',voiceEnabled:false}));let start;const ready=new Promise(r=>start=r);
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),close:()=>{}},model:async({signal})=>{start();return await new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}});
 const base=await listenLocalServer(service);
 try{const background=fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({origin:'initiative',messages:[{role:'user',content:'做自己的小事'}]})});await ready;await fetch(base+'/v1/local/priority',{method:'POST',body:'{}'});const response=await background;assert.equal(response.status,499);const status=await (await fetch(base+'/v1/local/status')).json();assert.equal(status.execution.active.length,0);}
 finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});


test('missing-action failure details reach schedule finalization and gateway metadata',async()=>{
 let ended;
 await assert.rejects(executeLocalAutonomy({context:{id:'a',persona:'角色',cue:'实际读文章',expectAction:true},assertCurrent:()=>{},finish:(reason,error)=>ended={reason,error},run:async options=>{assert.equal(options.turnContext.expectAction,true);return {ok:true,body:{text:'我去看看',receipts:[]}};}}),error=>error.code==='LOCAL_ACTION_MISSING');
 assert.equal(ended.reason,'failed');assert.equal(ended.error.code,'LOCAL_ACTION_MISSING');
});


test('missing-action error code survives the actual HTTP gateway and reverse broker',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'autonomy-code-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'openai',modelId:'isolated-test-model',modelBaseUrl:'http://127.0.0.1:8000/v1',voiceEnabled:false}));
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),close:()=>{}},model:async()=>({choices:[{message:{content:'我准备读文章'}}]})});const base=await listenLocalServer(service);
 try{await assert.rejects(runWithHostTools({baseUrl:base,origin:'initiative',messages:[{role:'user',content:'读文章'}],turnContext:{toolsEnabled:true,autonomous:true,expectAction:true},tools:{bridge_tools:{parameters:{type:'object',properties:{action:{type:'string'}}},execute:async()=>{throw Error('unexpected tool');}}}}),e=>e.code==='LOCAL_ACTION_MISSING'&&e.status===500);}
 finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});


test('QQ preemption remains cancellation through the real HTTP broker, without counting an activity failure',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'autonomy-cancel-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'openai',modelId:'isolated-test-model',modelBaseUrl:'http://127.0.0.1:8000/v1',voiceEnabled:false}));let ready;const started=new Promise(r=>ready=r);
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),close:()=>{}},model:async({signal})=>{ready();return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});const base=await listenLocalServer(service);let reason;
 try{const task=assert.rejects(executeLocalAutonomy({context:{id:'cancel',persona:'角色',cue:'活动',expectAction:true},assertCurrent:()=>{},finish:r=>reason=r,run:input=>runWithHostTools({...input,baseUrl:base,tools:{}})}),e=>e.name==='AbortError');await started;await fetch(base+'/v1/local/priority',{method:'POST',body:'{}'});await task;assert.equal(reason,'cancelled');}
 finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
