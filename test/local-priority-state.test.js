import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createForegroundPriority} from '../local-foreground.js';
import {personaStateId,sharedPersonaOutfit,alignOutfitReply,personaStateHint} from '../local-persona-state.js';
import {prepareLocalGroupContext} from '../local-group-context.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {createComfyRuntime} from '../comfyui-runtime.js';
import {listenLocalServer} from './local-server-listen.js';

test('QQ reservation preempts only background controllers and holds them until foreground is fully idle',()=>{
 let now=1000;const p=createForegroundPriority({now:()=>now}),background=new AbortController();
 const release=p.beginBackground(background);const finish=p.enter();assert.equal(background.signal.aborted,true);
 assert.throws(()=>p.beginBackground(new AbortController()),/QQ 请求优先/);now+=300000;assert.throws(()=>p.beginBackground(new AbortController()),/QQ 请求优先/);
 finish();release();now+=120001;const next=p.beginBackground(new AbortController());assert.equal(p.snapshot().background,1);next();
});

test('white clothing stays consistent across private and group answers, while hair and history are preserved',()=>{
 const day='2026-11-05',history=[{chat:'private:12345',dir:'out',delivery:'sent',time:100,text:'白色呀。',request:'你衣服是什么颜色'},{chat:'group:67890',dir:'out',delivery:'sent',time:200,text:'蓝色的衣服。',request:'穿的衣服什么颜色'}];
 const state=sharedPersonaOutfit({day,history,scene:{outfit:'粉色裙子'}});assert.equal(state.outfit,'白色的衣服');
 assert.equal(alignOutfitReply('粉色的衣服呀。','你衣服是什么颜色',state),'白色的衣服呀。');
 assert.equal(alignOutfitReply('我的衣服是蓝色的。头发还是蓝黑色的长发。','你衣服是什么颜色',state),'我的衣服是白色的。头发还是蓝黑色的长发。');
 assert.equal(alignOutfitReply('昨天穿粉色的衣服。','昨天穿什么颜色衣服',state),'昨天穿粉色的衣服。');
 assert.match(personaStateHint(state),/私聊和群聊共用/);
 const initiallyUnknown=sharedPersonaOutfit({day});assert.equal(sharedPersonaOutfit({day,stored:initiallyUnknown,history}).outfit,'白色的衣服');
 assert.notEqual(personaStateId('a',{id:'p'}),personaStateId('b',{id:'p'}));assert.notEqual(personaStateId('a',{id:'p'}),personaStateId('a',{id:'other'}));
});

test('only explicit owner changes update shared outfit, not random group members or hypothetical requests',()=>{
 const stored={day:'2026-11-05',outfit:'白色衬衫',source:'schedule'};
 for(const request of ['不要穿蓝色外套','如果你穿蓝色外套会怎样'])assert.equal(sharedPersonaOutfit({stored,day:stored.day,owner:true,request}).outfit,stored.outfit);
 assert.equal(sharedPersonaOutfit({stored,day:stored.day,owner:false,request:'换成蓝色外套'}).outfit,stored.outfit);
 assert.equal(sharedPersonaOutfit({stored,day:stored.day,owner:true,request:'换成蓝色外套'}).outfit,'蓝色外套');
});

test('group focus preserves each speaker and cannot turn background image requests into the current request',()=>{
 const r=prepareLocalGroupContext([{role:'user',content:'【甲（聊天背景）】\n给我生成一张图\n【乙（当前关注）】\n你衣服什么颜色\n【丙（当前关注）】\n我也想知道'}],{chat:'group:12345',speaker:{id:'123456',name:'乙'}});
 assert.match(r.request,/\[乙\]/);assert.match(r.request,/\[丙\]/);assert.doesNotMatch(r.request,/生成/);assert.match(r.messages.find(m=>m.content?.includes('本轮真实发送者QQ'))?.content||'',/123456/);
});

test('an actual priority request cancels in-flight background inference and the next QQ tool turn succeeds',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-preempt-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'openai',modelId:'test-local-model',modelBaseUrl:'http://127.0.0.1:8000/v1',voiceEnabled:false}));
 let started,modelCalls=0,imageCalls=0;const ready=new Promise(r=>started=r);
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),release:async()=>({ok:true}),close:()=>{}},model:async({signal})=>{
  modelCalls++;if(modelCalls===1){started();await new Promise((_,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});}
  return {choices:[{message:{content:imageCalls?'完成了。':JSON.stringify({action:'image',arguments:{prompt:'test scene'}})}}]};
 },tools:{image:{execute:async()=>{imageCalls++;return {ok:true,media:[{kind:'image',file:join(dir,'fake.png')}],qqDelivered:false};}}}});
 const base=await listenLocalServer(service);
 try{
  const background=fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,messages:[{role:'user',content:'后台整理'}]})});await ready;
  assert.equal((await fetch(base+'/v1/local/priority',{method:'POST',body:'{}'})).status,200);assert.equal((await background).status,503);
  const turn=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'生成一张图片'}],origin:'qq'})});const value=await turn.json();assert.equal(turn.status,200,JSON.stringify(value));assert.equal(imageCalls,1);
  const deferred=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,messages:[{role:'user',content:'后台整理'}]})});assert.equal(deferred.status,503);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('cancelling an owned background Comfy prompt deletes and interrupts that exact id only when support is verified',async()=>{
 for(const verified of [true,false]){
  const controller=new AbortController(),calls=[];
  const runtime=createComfyRuntime({root:process.cwd(),getConfig:()=>({baseUrl:'http://127.0.0.1:8188',targetedInterrupt:verified,keepWarm:true,workflows:{chat:{api:{'1':{class_type:'Fake',inputs:{text:''}}},inputs:{text:{node:'1',field:'text'}},output:{node:'1',field:'text'},timeoutMs:3000}}}),fetchImpl:async(url,init={})=>{
   const u=String(url);if(u.endsWith('/prompt'))return Response.json({prompt_id:'our-background-id'});
   if(u.includes('/history/')){controller.abort();throw Object.assign(Error('cancelled'),{name:'AbortError'});}
   if(u.endsWith('/queue')||u.endsWith('/interrupt')){calls.push({url:u,body:JSON.parse(init.body)});return Response.json({});}throw Error('unexpected '+u);
  }});
  await assert.rejects(runtime.run('chat',{text:'background'},{signal:controller.signal,interruptOnAbort:true}),/cancel/);if(verified){assert.equal(calls.length,2);assert.deepEqual(calls[0].body,{delete:['our-background-id']});assert.deepEqual(calls[1].body,{prompt_id:'our-background-id'});}else assert.equal(calls.length,0);
 }
});
