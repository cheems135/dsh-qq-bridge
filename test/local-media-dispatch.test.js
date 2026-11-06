import {listenLocalServer} from './local-server-listen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localImageRequest,localVideoRequest,requestsVoice,requestsImage} from '../media-intent.js';
import {localRequirements} from '../local-routing.js';
import {fastDialoguePlan} from '../local-fast-chat.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';

test('ordinary photo phrasing reaches the tool path and capability check without requiring the word photo',()=>{
 for(const request of ['再拍一张给我看','拍张吧','给我拍一张窗边绿植','能不能拍个照','你再发张给我看','发一张吧']){
  assert.equal(localImageRequest(request),true,request);assert.equal(localRequirements(request).image,true,request);assert.equal(localRequirements(request).tools,true,request);assert.equal(fastDialoguePlan(request).fast,false,request);
 }
 for(const request of ['别再拍一张给我看','不用拍照','拍一下你的头','“再拍一张给我看”是什么意思','例如拍一张','刚才拍的照片为什么没发','生成照片的提示词怎么写','如何拍一张好照片','你会拍照吗'])assert.equal(localImageRequest(request),false,request);
 assert.equal(fastDialoguePlan('好',{messages:[{role:'user',content:'再拍一张给我看'}]}).fast,false);
 assert.equal(requestsImage('“再拍一张给我看”是什么意思'),false);
 assert.equal(requestsImage('请生成图片：“窗边的绿植”'),true);
});
test('speech and video have the same dispatch and capability contract; negation and quoted requests stay quiet',()=>{
 for(const request of ['发句语音','用声音说一句晚安']){assert.equal(requestsVoice(request),true);assert.equal(localRequirements(request).speech,true);assert.equal(fastDialoguePlan(request).fast,false);}
 for(const request of ['生成一段窗边小猫的视频','来段绿植的短片']){assert.equal(localVideoRequest(request),true,request);assert.equal(localImageRequest(request),false,request);assert.equal(localRequirements(request).video,true);assert.equal(fastDialoguePlan(request).fast,false);}
 for(const request of ['别生成视频','生成视频的提示词怎么写','例如生成一段视频','“生成一段视频”是什么意思','视频工作流报错了','刚才生成的视频挺好看','生成一段视频的代码怎么写','你支持生成视频吗'])assert.equal(localVideoRequest(request),false,request);
 const both=localRequirements('生成一张图片和一段视频');assert.equal(both.image,true);assert.equal(both.video,true);
});
test('gateway executes requested photo or video once even when the model only claims it sent the media',async()=>{
 for(const kind of ['image','video']){
  const dir=mkdtempSync(join(tmpdir(),'media-dispatch-')),graph=join(dir,'graph.json'),configFile=join(dir,'config.json');let executed=0,models=0;
  writeFileSync(graph,'{}');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,mediaDir:dir,workflowLibrary:[{id:kind+'-workflow',kind,name:'测试工作流',file:graph,inputs:{prompt:{node:'1',field:'text'}}}]}));
  const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},model:async options=>{models++;if(options.purpose==='notice')return '我去给窗边那盆绿植找个好角度，稍等一下。';assert.ok(options.tools.some(t=>t.function.name===kind));return '我已经把窗边的绿植发给你了。';},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(workflow,args)=>{executed++;assert.equal(workflow,kind+'-workflow');assert.match(args.prompt,kind==='image'?/拍一张/:/视频/);const file=join(dir,kind==='image'?'picture.png':'clip.mp4');writeFileSync(file,kind==='image'?probeColorPng():Buffer.from('0000ftypisom'));return {ok:true,media:[{kind,file}]};}},fetchImpl:async()=>Response.json({loaded:false,busy:false,queue_running:[],queue_pending:[]})});
  await listenLocalServer(service);
  try{const base='http://127.0.0.1:'+service.server.address().port,response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:kind==='image'?'再拍一张给我看':'生成一段绿植的视频'}]})}),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(executed,1);assert.equal(result.attachments[0].kind,kind);assert.equal(result.receipts.filter(r=>r.ok).length,1);assert.doesNotMatch(result.text,/已经.*发给你/);if(kind==='image')assert.equal(models,2);}finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('a natural photo request with background and exclusions requires one actual execution even if the model only answers in prose',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'photo-constraints-')),graph=join(dir,'graph.json'),configFile=join(dir,'config.json');
 const request='我想看看你的相片：在图书馆窗边，穿绿色外套，不要水印';let executions=0;
 writeFileSync(graph,'{}');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,mediaDir:dir,workflowLibrary:[{id:'photo',kind:'image',name:'测试工作流',file:graph,inputs:{prompt:{node:'1',field:'text'}}}]}));
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},model:async options=>options.purpose==='notice'?'我去窗边找个好角度，等我一下。':'这就给你看看。',runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(workflow,args)=>{executions++;assert.equal(workflow,'photo');assert.equal(args.prompt,request);const file=join(dir,'picture.png');writeFileSync(file,probeColorPng());return {ok:true,media:[{kind:'image',file}]};}},fetchImpl:async()=>Response.json({loaded:false,busy:false,queue_running:[],queue_pending:[]})});
 await listenLocalServer(service);
 try{const response=await fetch('http://127.0.0.1:'+service.server.address().port+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:request}]})}),result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.mediaTask.source,'direct');assert.deepEqual(result.mediaTask.requested,['image']);assert.equal(executions,1);assert.equal(result.attachments.length,1);assert.equal(result.receipts.filter(r=>r.ok).length,1);}
 finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
