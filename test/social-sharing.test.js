import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {imageBytes,loadSocialImage} from '../social-images.js';
import {probeColorPng} from '../local-probe-image.js';
import {initiativePolicy,selectInitiative,noteInitiative,sharingExpression} from '../api-initiative.js';
import {createQzoneService,qzoneJson,qzoneUploadResult} from '../qzone-service.js';

const context={accountId:'account-a',personaId:'persona-a'};
const auth={uin:'12345678',gtk:123,cookie:'uin=o12345678; skey=MOCK; p_skey=MOCK2'};
function fixture(){
 let saved={entries:[],comments:[]},allowed=true,time=1700000000000,authRevision=0,mode='',service;
 const calls=[],records=[],photo=imageBytes(probeColorPng());
 const options={storage:{read:()=>structuredClone(saved),write:value=>saved=structuredClone(value)},getAuth:async()=>({...auth,cookie:auth.cookie+authRevision}),loadImage:async()=>photo,now:()=>time,authorize:()=>allowed,onRecord:(row,c)=>records.push({row,c}),fetchImpl:async(url,opts)=>{
  const u=new URL(url),params=new URLSearchParams(opts.body);calls.push({u,opts,params});
  if(u.pathname.includes('upload_image')){
   if(mode==='upload-fail')throw Error('mock upload failure');
   if(mode==='account-change')authRevision++;
   if(mode==='cancel')allowed=false;
   return Response.json({code:0,data:{albumid:'a',lloc:'l',sloc:'s',type:1,height:32,width:32,pre:'https://example.test/image?bo=photo-token'}});
  }
  if(u.pathname.includes('getdetail'))return Response.json({code:0,commentlist:[{commentid:4,uin:87654321,name:'读者',content:'这个颜色好看',create_time:1},{commentid:5,uin:Number(auth.uin),name:'自己',content:'自己的评论'}]});
  if(mode==='uncertain')throw Error('connection lost after submission');
  if(mode==='reject')return Response.json({code:-6});
  return Response.json({code:0,data:u.pathname.includes('re_feeds')?{commentid:'reply-1'}:{tid:'post-1'}});
 }};
 const start=()=>service=createQzoneService(options);start();
 return {get service(){return service;},calls,records,get saved(){return saved;},photo,setMode:v=>mode=v,advance:v=>time+=v,restart:start};
}
test('API initiatives keep per-activity budgets, cooldowns and fair selection',()=>{
 const config=initiativePolicy({minGapMinutes:15,maxPerDay:{chats:2,qzone:1,qzoneReplies:3}},false),now=1700000000000;
 assert.equal(config.maxPerDay.chats,2);assert.equal(config.minGapMinutes,15);
 const state={counts:{chats:2},actions:{chat:{lastAt:now}},log:[]};
 assert.equal(selectInitiative([{action:'chat'},{action:'qzone'}],state,config,{now}).action,'qzone');
 state.counts.chats=0;noteInitiative(state,'chat',{now});
 assert.equal(selectInitiative([{action:'chat'},{action:'signature'}],state,config,{now:now+60000}).action,'signature');
 noteInitiative(state,'qzone',{now,sent:true});
 assert.equal(selectInitiative([{action:'qzone'}],state,config,{now:now+14*60000}),null);
 assert.equal(selectInitiative([{action:'qzone'}],state,config,{now:now+16*60000}).action,'qzone');
 assert.equal(selectInitiative([{action:'chat'},{action:'qzoneReply',event:true}],{counts:{}},config,{now}).action,'qzoneReply');
 assert.equal(selectInitiative([{action:'qzone'}],{counts:{qzone:1}},config,{now}),null);
});
test('unrestricted API initiatives bypass quotas, gaps and considered backoff without changing scoring',()=>{
 const now=1700000000000,limited=initiativePolicy({minGapMinutes:45,maxPerDay:{chats:1,qzone:1}},false),unrestricted=initiativePolicy({minGapMinutes:45,maxPerDay:{chats:1,qzone:1}},true);
 assert.equal(unrestricted.unrestricted,true);assert.equal(unrestricted.minGapMinutes,0);
 const blocked={counts:{chats:9,qzone:9},actions:{chat:{lastAt:now,consideredAt:now},qzone:{lastAt:now,consideredAt:now}}};
 assert.equal(selectInitiative([{action:'chat'}],blocked,limited,{now}),null);
 assert.equal(selectInitiative([{action:'chat'}],blocked,unrestricted,{now}).action,'chat');
 const state={counts:{},actions:{qzone:{consideredAt:now}}};
 assert.equal(selectInitiative([{action:'chat',event:true},{action:'qzone'}],state,unrestricted,{now}).action,'chat');
});
test('sharing expression carries current emotion and real dialogue without requiring a stock question',()=>{
 const prompt=sharingExpression({tone:'有点得意，轻松',recent:['刚才那段节奏好特别']});
 assert.match(prompt,/有点得意/);assert.match(prompt,/刚才那段节奏/);assert.match(prompt,/不机械.*你觉得呢/);assert.match(prompt,/不编共同回忆/);assert.match(prompt,/工具回执.*调用记录/);assert.match(prompt,/不把每次分享演成兴奋/);
});
test('social images accept genuine bytes and confine files to the allowed directory',()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-image-'));try{
  const root=join(dir,'allowed');mkdirSync(root);writeFileSync(join(root,'a.png'),probeColorPng());writeFileSync(join(dir,'private.png'),probeColorPng());
  assert.equal(loadSocialImage(join(root,'a.png'),{roots:[root]}).mime,'image/png');
  assert.throws(()=>loadSocialImage(join(dir,'private.png'),{roots:[root]}),/目录/);
  assert.throws(()=>loadSocialImage('https://example.test/photo.png',{roots:[root]}),/当前角色/);
  const data={data:probeColorPng().toString('base64')};assert.throws(()=>loadSocialImage(data),/当前角色/);assert.equal(loadSocialImage(data,{allowData:true}).mime,'image/png');
  assert.throws(()=>imageBytes(Buffer.from('<svg/>')),/真实/);assert.throws(()=>imageBytes(Buffer.alloc(12*1024*1024+1)),/12MB/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Qzone parses JSONP without evaluating it and requires complete upload receipts',()=>{
 assert.equal(qzoneJson('callback({"code":0,"data":{}});').code,0);
 assert.throws(()=>qzoneJson('callback({"data":{}});'),/明确状态/);
 assert.throws(()=>qzoneJson('(()=>process.exit())()'),/有效/);
 assert.throws(()=>qzoneUploadResult({code:0,data:{albumid:'a'}}),/回执不完整/);
});
test('Qzone uploads all image bytes before publishing and records the receipt',async()=>{
 const f=fixture(),result=await f.service.publish({text:'这次的蓝色我喜欢',images:['first','second']},context);
 assert.equal(result.imageCount,2);assert.equal(result.status,'accepted');assert.equal(result.verified,false);
 assert.equal(f.calls.length,3);assert.equal(f.calls[0].u.hostname,'up.qzone.qq.com');assert.equal(f.calls[0].params.get('picfile'),f.photo.bytes.toString('base64'));
 const last=f.calls.at(-1);assert.match(last.u.pathname,/publish_v6/);assert.equal(last.params.get('richval').split('\t').length,2);assert.equal(last.params.get('con'),'这次的蓝色我喜欢');assert.equal(last.params.get('pic_bo'),'photo-token,photo-token');
 assert.equal(f.records.filter(e=>e.row.stage==='image-upload').length,2);assert.equal(f.records.at(-1).row.stage,'receipt');
 const duplicate=await f.service.publish({text:'这次的蓝色我喜欢',images:['first','second']},context);assert.equal(duplicate.duplicate,true);assert.equal(f.calls.length,3);
});
test('Qzone never silently turns a failed image post into text-only',async()=>{
 for(const mode of ['upload-fail','account-change','cancel']){
  const f=fixture();f.setMode(mode);await assert.rejects(f.service.publish({text:'配图测试',images:['a']},context));assert.equal(f.calls.some(c=>c.u.pathname.includes('publish_v6')),false);assert.equal(f.saved.entries[0].status,'failed');
 }
});
test('Qzone uncertain submission is persisted and blocked across restart and concurrency',async()=>{
 const f=fixture();f.setMode('uncertain');await assert.rejects(f.service.publish({text:'未知提交'},context),/待核对/);f.restart();
 const results=await Promise.all([f.service.publish({text:'未知提交'},context),f.service.publish({text:'未知提交'},context)]);assert.ok(results.every(r=>r.duplicate));assert.equal(f.calls.length,1);assert.equal(f.saved.entries[0].status,'unknown');
});
test('Qzone replies only to a read comment in the same scope, with exact parent fields',async()=>{
 const f=fixture();const reply={text:'对，我也偏爱这个颜色',target:{uin:auth.uin,tid:'post-1'},commentId:'4',commentUin:'87654321'};
 await assert.rejects(f.service.publish(reply,context),/实际读取/);
 await f.service.comments({tid:'post-1',uin:auth.uin},context);
 await assert.rejects(f.service.publish(reply,{...context,personaId:'other'}),/实际读取/);
 await f.service.publish(reply,context);const form=f.calls.at(-1).params;assert.equal(form.get('topicId'),auth.uin+'_post-1__1');assert.equal(form.get('t2_tid'),'4');assert.equal(form.get('t2_uin'),'87654321');
 await assert.rejects(f.service.publish({...reply,images:['a']},context),/尚未验证带图回复/);
});
test('Qzone automatic replies select other people on own posts and skip already submitted targets',async()=>{
 const f=fixture();await f.service.publish({text:'这张图的颜色',images:[]},context);
 await f.service.comments({tid:'post-1',uin:auth.uin},context);const target=await f.service.nextReply(context);assert.equal(target.id,'4');assert.equal(target.postText,'这张图的颜色');
 await f.service.publish({text:'同感',target:{tid:target.tid,uin:target.owner},commentId:target.id,commentUin:target.uin},context);
 assert.equal(await f.service.nextReply(context),null);assert.equal(await f.service.nextReply({...context,accountId:'other'}),null);
});
