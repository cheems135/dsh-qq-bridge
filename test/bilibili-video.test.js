import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createBilibiliService} from '../bilibili-service.js';
import {resolveBiliVideoLink} from '../bilibili-video-link.js';
import {createAgentCapabilities} from '../agent-capabilities.js';

const context={accountId:'a',personaId:'p',key:'private:12345678'};
const bvid='BV1xx411c7mD';
function fixture(name,{resource='https://cdn.bilivideo.com/video.mp4?secret=SIGNED',backupUrls=[],failures=[],failure=false,change=false,readVideo}={}){
 const dir=fs.mkdtempSync('test/bili-video-');let allowed=true;const decodes=[],requests=[];
 const service=createBilibiliService({directory:dir,now:()=>Date.now()+1000,authorize:()=>allowed,
  fetchImpl:async(url)=>{const u=new URL(url);requests.push(u);
   if(u.pathname.endsWith('/nav'))return Response.json({code:0,data:{wbi_img:{img_url:'https://i0.hdslb.com/a/'.concat('a'.repeat(32),'.png'),sub_url:'https://i0.hdslb.com/a/'.concat('b'.repeat(32),'.png')}}});
   if(u.pathname.endsWith('/view'))return Response.json({code:0,data:{bvid,title:'两段视频',pages:[{page:1,cid:11,duration:5},{page:2,cid:22,duration:8}]}});
   if(u.pathname.endsWith('/playurl'))return Response.json({code:0,data:{durl:[{url:resource,backup_url:backupUrls}]}});
   if(u.pathname.endsWith('/wbi/v2'))return Response.json({code:0,data:{subtitle:{subtitles:[]}}});
   if(u.pathname.endsWith('/reply'))return Response.json({code:0,data:{page:{count:0},replies:[]}});
   throw Error('Unexpected mock request '+u.pathname);
  },readVideo:async(data,c)=>{
   const index=decodes.length;decodes.push({data,c});if(change)allowed=false;
   if(readVideo)return readVideo(data,c,index);
   const decodeFailure=failure===true?Error('解码器不可用'):failures[index];
   if(decodeFailure)throw decodeFailure;
   return {duration:8,frames:[{at:2,part:{type:'image',mediaType:'image/jpeg',data:'/9j/2Q=='}}],audioDecoded:false};
  }
 });return {service,decodes,requests,dir};
}
test('Bili read without subtitles obtains real selected-part frames without exposing signed media URLs',async()=>{
 const f=fixture('read');try{const result=await f.service.act({action:'read',bvid,page:2},context);
  assert.equal(result.frames.length,1);assert.equal(f.decodes[0].data.source,'bilibili');
  assert.equal(f.requests.find(u=>u.pathname.endsWith('/playurl')).searchParams.get('cid'),'22');
  assert.equal(result.audioDecoded,false);assert.match(result.coverage,/实际抽样/);assert.doesNotMatch(JSON.stringify(result),/SIGNED|video\.mp4|secret=/);
  assert.deepEqual(result.resourceAttempts,[{host:'cdn.bilivideo.com',ok:true}]);
  assert.equal((await f.service.act({action:'status'},context)).settings.commentPublishEnabled,false);
 }finally{f.service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('Bili decoder failures retain metadata but do not claim successful video viewing',async()=>{
 const f=fixture('failed',{failure:true});try{const result=await f.service.act({action:'read',bvid},context);assert.equal(result.frames,undefined);assert.match(result.errors.join(),/画面未取得/);assert.match(result.coverage,/没有取得视频内容/);}finally{f.service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('Bili resource validation rejects third-party URL before decoder; stale account cannot return frames',async()=>{
 const bad=fixture('bad',{resource:'https://bilivideo.com.attacker.test/video'});try{await assert.rejects(bad.service.act({action:'frames',bvid},context),/没有取得可读取/);assert.equal(bad.decodes.length,0);}finally{bad.service.close();fs.rmSync(bad.dir,{recursive:true,force:true});}
 const stale=fixture('stale',{change:true});try{await assert.rejects(stale.service.act({action:'frames',bvid},context),/变化/);}finally{stale.service.close();fs.rmSync(stale.dir,{recursive:true,force:true});}
});
test('Bili media failover tries a distinct backup and returns actual frames once with sanitized attempts',async()=>{
 const primary='https://cdn.bilivideo.com/primary.mp4?token=SIGNED_PRIMARY',backup='https://backup.bilivideo.com/backup.mp4?token=SIGNED_BACKUP';
 const blocked=Object.assign(Error('download failed'),{code:'VIDEO_RESOURCE',httpStatus:403,sourceHost:'cdn.bilivideo.com'});
 const f=fixture('backup',{resource:primary,backupUrls:[backup],failures:[blocked]});
 try{
  const result=await f.service.act({action:'frames',bvid},context);
  assert.equal(f.decodes.length,2);assert.deepEqual(f.decodes.map(item=>item.data.url),[primary,backup]);
  assert.equal(result.frames.length,1);
  assert.deepEqual(result.resourceAttempts,[
   {host:'cdn.bilivideo.com',status:403,code:'VIDEO_RESOURCE',ok:false},
   {host:'backup.bilivideo.com',ok:true},
  ]);
  assert.doesNotMatch(JSON.stringify(result),/SIGNED_PRIMARY|SIGNED_BACKUP|primary\.mp4|backup\.mp4|token=/);
 }finally{f.service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('Bili media failover stops on cancellation and never retries duplicate or invalid resources',async()=>{
 const controller=new AbortController();
 const pending=fixture('cancel',{readVideo:async()=>{
  controller.abort();
  throw Object.assign(Error('cancelled'),{name:'AbortError',code:'ABORT_ERR'});
 }});
 try{
  const task=pending.service.act({action:'frames',bvid},{...context,signal:controller.signal});
  await assert.rejects(task,error=>error.name==='AbortError');
  assert.equal(pending.decodes.length,1);
 }finally{pending.service.close();fs.rmSync(pending.dir,{recursive:true,force:true});}

 const signed='https://cdn.bilivideo.com/same.mp4?token=SIGNED';
 const failed=Object.assign(Error('download failed'),{code:'VIDEO_RESOURCE',httpStatus:404});
 const duplicate=fixture('duplicate',{resource:signed,backupUrls:[signed],failures:[failed]});
 try{
  await assert.rejects(duplicate.service.act({action:'frames',bvid},context),error=>{
   assert.equal(error.code,'VIDEO_RESOURCE');assert.match(error.message,/HTTP 404/);assert.match(error.message,/重新解析/);
   assert.deepEqual(error.resourceAttempts,[{host:'cdn.bilivideo.com',status:404,code:'VIDEO_RESOURCE',ok:false}]);
   assert.doesNotMatch(error.message+JSON.stringify(error),/SIGNED|same\.mp4|token=/);
   return true;
  });
  assert.equal(duplicate.decodes.length,1);
 }finally{duplicate.service.close();fs.rmSync(duplicate.dir,{recursive:true,force:true});}

 const invalid=Object.assign(Error('invalid media'),{code:'VIDEO_INVALID'});
 const rejected=fixture('invalid-retry',{resource:'https://cdn.bilivideo.com/primary.mp4',backupUrls:['https://backup.bilivideo.com/backup.mp4'],failures:[invalid]});
 try{
  await assert.rejects(rejected.service.act({action:'frames',bvid},context),error=>error.code==='VIDEO_INVALID');
  assert.equal(rejected.decodes.length,1);
 }finally{rejected.service.close();fs.rmSync(rejected.dir,{recursive:true,force:true});}
});
test('Bili total media failures give actionable 403, 404, and network summaries without exposing URLs',async()=>{
 const cases=[
  {status:403,pattern:/HTTP 403.*站点拒绝下载/},
  {status:404,pattern:/HTTP 404.*重新解析/},
  {status:undefined,pattern:/网络连接.*检查网络/},
 ];
 for(const [index,{status,pattern}] of cases.entries()){
  const failed=Object.assign(Error('download failed'),{code:'VIDEO_RESOURCE',...(status?{httpStatus:status}:{})});
  const f=fixture('summary-'+index,{resource:'https://cdn.bilivideo.com/private-'+index+'.mp4?token=SIGNED',failures:[failed]});
  try{
   await assert.rejects(f.service.act({action:'frames',bvid},context),error=>{
    assert.equal(error.code,'VIDEO_RESOURCE');assert.match(error.message,pattern);
    assert.equal(error.resourceAttempts.length,1);assert.equal(error.resourceAttempts[0].host,'cdn.bilivideo.com');assert.equal(error.resourceAttempts[0].ok,false);
    assert.doesNotMatch(error.message+JSON.stringify(error),/SIGNED|private-\d+\.mp4|token=/);
    return true;
   });
  }finally{f.service.close();fs.rmSync(f.dir,{recursive:true,force:true});}
 }
});
test('Bili links preserve selected part and bounded shortlink resolution never follows an unrelated website',async()=>{
 assert.deepEqual(await resolveBiliVideoLink('https://www.bilibili.com/video/'+bvid+'?p=2'),{bvid,page:2});
 let calls=0;const fetchImpl=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://www.bilibili.com/video/'+bvid+'?p=3'}});};
 assert.equal((await resolveBiliVideoLink('https://b23.tv/abc',{fetchImpl})).page,3);assert.equal(calls,1);
 await assert.rejects(resolveBiliVideoLink('https://b23.tv/abc',{fetchImpl:async()=>new Response(null,{status:302,headers:{location:'http://127.0.0.1/'}})}),/不是支持/);
});
test('real Bili tool gives API real image attachments and local visual observations instead of base64 text',async()=>{
 const registered=new Map(),saved=[];
 const frame={at:2,part:{type:'image',mediaType:'image/jpeg',data:'/9j/2Q=='}};
 const capability=createAgentCapabilities({ctx:{get:name=>name==='tools'?{register:d=>{registered.set(d.name,d);return()=>{};}}:name==='attachments'?{saveImage:async image=>{saved.push(image);return {id:'frame',mediaType:image.mediaType};}}:null},getConfig:()=>({enabled:true}),getContext:()=>context,authorize:()=>true,browser:{status:()=>({}),close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:async()=>({})}),services:{bilibili:async()=>({ok:true,frames:[frame],coverage:'真实抽样'})}});
 try{capability.start();const definition=registered.get('bridge_bilibili');
  const result=await definition.execute({action:'frames',bvid},{});assert.equal(saved.length,1);assert.equal(result.imageAttachments[0].id,'frame');assert.equal(definition.output.render({},result)[1].type,'image');assert.deepEqual(result.frames,[{at:2}]);
  const router=capability.localTools({...context,localTurn:true}).bridge_tools;
  const local=await router.execute({action:'call',name:'bridge_bilibili',arguments:{action:'frames',bvid}});
  assert.ok(JSON.stringify(local).includes('data:image/jpeg;base64,'));assert.equal(saved.length,1);
 }finally{capability.close();}
});
