import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBilibiliService} from '../bilibili-service.js';
import {imageBytes} from '../social-images.js';
import {probeColorPng} from '../local-probe-image.js';
const c={accountId:'test',personaId:'role'},BV='BV1xx411c7mD';
function fixture(){
 const directory=mkdtempSync(join(tmpdir(),'bili-image-')),slot=join(directory,createHash('sha256').update(JSON.stringify([c.accountId,c.personaId])).digest('hex'));mkdirSync(slot);
 writeFileSync(join(slot,'credential.json'),JSON.stringify({SESSDATA:'TEST_SESSION',bili_jct:'TEST_CSRF',DedeUserID:'42'}));
 writeFileSync(join(slot,'state.json'),JSON.stringify({history:[{bvid:BV,title:'已读取的视频'}],drafts:[],commentPublishEnabled:true}));
 let time=1700000000000,uploadMode='',service;const calls=[];
 const options={directory,loadImage:async()=>imageBytes(probeColorPng()),now:()=>time+=1000,fetchImpl:async(url,opts)=>{
  const path=new URL(url).pathname;calls.push({path,opts});
  if(path.endsWith('/view'))return Response.json({code:0,data:{bvid:BV,aid:170001,title:'视频'}});
  if(path.endsWith('/v2/reply'))return Response.json({code:0,data:{page:{count:1},replies:[{rpid:7,member:{uname:'甲'},content:{message:'根评论'},replies:[{rpid:8,member:{uname:'乙'},content:{message:'楼中楼'}}]}]}});
  if(path.endsWith('/upload_bfs')){
   if(uploadMode==='fail')return Response.json({code:-1,message:'mock rejection'});
   if(uploadMode==='incomplete')return Response.json({code:0,data:{image_url:'https://i0.hdslb.com/a.png'}});
   if(uploadMode==='disabled')await service.act({action:'set-publish-enabled',enabled:false},c);
   if(uploadMode==='logout')await service.act({action:'logout'},c);
   return Response.json({code:0,data:{image_url:'https://i0.hdslb.com/bfs/mock.png',image_width:32,image_height:32,img_size:1}});
  }
  return Response.json({code:0,data:{rpid:12345}});
 }};service=createBilibiliService(options);
 return {service,calls,mode:v=>uploadMode=v,close:()=>{service.close();rmSync(directory,{recursive:true,force:true});}};
}
test('Bili saves actual images as a draft, uploads only on publish and addresses nested replies correctly',async()=>{
 const f=fixture();try{
  await f.service.act({action:'comments',bvid:BV},c);
  const {draft}=await f.service.act({action:'draft',bvid:BV,replyId:'8',text:'这个转折我也没想到',images:['local-image']},c);
  assert.equal(draft.root,'7');assert.equal(draft.parent,'8');assert.equal(draft.replyTo.author,'乙');assert.equal(f.calls.some(r=>r.opts.method==='POST'),false);
  const preview=await f.service.act({action:'preview-image',draftId:draft.id,imageId:draft.images[0].id},c);assert.match(preview.image,/^data:image\/png;base64,/);
  const result=await f.service.act({action:'publish',draftId:draft.id,confirm:true},c);assert.equal(result.posted,true);
  const upload=f.calls.find(r=>r.path.endsWith('upload_bfs'));assert.equal(upload.opts.body.get('file_up').type,'image/png');assert.equal(upload.opts.headers['content-type'],undefined);
  const final=f.calls.find(r=>r.path.endsWith('reply/add')),form=new URLSearchParams(final.opts.body);assert.equal(form.get('root'),'7');assert.equal(form.get('parent'),'8');assert.equal(JSON.parse(form.get('pictures'))[0].img_width,32);
  const state=await f.service.act({action:'status'},c);assert.equal(state.drafts[0].images[0].file,undefined);assert.doesNotMatch(JSON.stringify(state),/TEST_SESSION|TEST_CSRF/);
 }finally{f.close();}
});
test('Bili rejects guessed comment targets and isolates image previews by account/persona',async()=>{
 const f=fixture();try{
  await assert.rejects(f.service.act({action:'draft',bvid:BV,replyId:'999',text:'不能猜楼层'},c),/先读取/);
  const {draft}=await f.service.act({action:'draft',bvid:BV,text:'配图',images:['local-image']},c);
  await assert.rejects(f.service.act({action:'preview-image',draftId:draft.id,imageId:draft.images[0].id},{...c,personaId:'other'}),/找不到/);
 }finally{f.close();}
});
test('Bili failed uploads and changed publication permissions never degrade to a text-only reply',async()=>{
 for(const mode of ['fail','incomplete','disabled','logout']){
  const f=fixture();try{
   const {draft}=await f.service.act({action:'draft',bvid:BV,text:'要带图',images:['local-image']},c);f.mode(mode);
   const result=await f.service.act({action:'publish',draftId:draft.id,confirm:true},c);assert.equal(result.posted,false);assert.equal(f.calls.some(r=>r.path.endsWith('reply/add')),false);assert.equal(result.uncertain,false);
  }finally{f.close();}
 }
});
