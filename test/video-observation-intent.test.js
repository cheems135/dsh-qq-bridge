import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {localVideoObservationRequest,planLocalMediaTask,localMediaPlanningCandidate} from '../local-media-planner.js';
import {resolveLocalMediaTask} from '../local-media-task.js';import {createLocalModelServer} from '../local-model-server.mjs';import {listenLocalServer} from './local-server-listen.js';
test('watching existing videos never asks the semantic planner to authorize generation',async()=>{
 let calls=0;for(const request of ['打开并看看这个视频：https://example.com/flower.mp4 ，连续观察两次，再告诉我实际看到了什么。','刷一下B站视频','分析这个视频讲了什么','观看这部短片','打开 https://example.com/a.webm 看一下']){
  assert(localVideoObservationRequest(request),request);assert.equal(localMediaPlanningCandidate(request),false);
  const plan=await planLocalMediaTask(resolveLocalMediaTask(request),{request,model:async()=>{calls++;return '{"kind":"video","confidence":1}';}});
  assert.equal(plan.video,false);assert.equal(plan.source,'observation');
 }assert.equal(calls,0);
 for(const request of ['生成一段视频','看看效果，帮我制作一段视频','观看这段视频，然后生成一段视频','拍摄视频给我'])assert.equal(localVideoObservationRequest(request),false,request);
});
test('the real local gateway refuses a wrongly selected video generation tool before executing it',async()=>{
 const dir=mkdtempSync(new URL('../.video-observation-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir}));let generated=0,models=0;
 const server=createLocalModelServer({configFile:file,env:{LOCAL_AI_LOG_FILE:join(dir,'test.log'),LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},tools:{video:{execute:async()=>{generated++;return {media:[{kind:'video',file:join(dir,'not-created.mp4')}]};}}},model:async()=>++models===1?{tool_calls:[{id:'wrong',function:{name:'video',arguments:{prompt:'观看视频'}}}]}:{content:'未观看成功。'}});
 const base=await listenLocalServer(server);
 try{const response=await fetch(base+'/v1/local/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'打开并观看这个视频 https://example.com/a.mp4'}]})});const data=await response.json();assert.equal(generated,0);assert.equal(data.mediaTask?.requested?.includes('video'),false);assert.equal(data.attachments?.length||0,0);}finally{await server.close();rmSync(dir,{recursive:true,force:true});}
});
