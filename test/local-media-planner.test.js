import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocalMediaTask,localMediaCancelled} from '../local-media-task.js';
import {localImageRequest} from '../media-intent.js';
import {planLocalMediaTask,localMediaPlanningCandidate} from '../local-media-planner.js';
import {localRequirements} from '../local-routing.js';

test('local photo demands cover ordinary wants without changing the API interpreter',()=>{
 assert.equal(localImageRequest('我要看照片呀你这个混蛋'),false);
 for(const request of ['我要看照片呀你这个混蛋','我想看看你的相片','让我看看照片','照片给我看看']){assert.equal(resolveLocalMediaTask(request).image,true,request);assert.equal(localRequirements(request).image,true,request);}
 for(const request of ['我不想看照片','“我要看照片”是什么意思','你支持发照片吗','照片里面有什么'])assert.equal(resolveLocalMediaTask(request).image,false,request);
});
test('local photo requirements preserve scene constraints without mistaking them for cancellation',()=>{
 for(const request of ['我要看照片：窗边花盆里的绿植，只画静物，不要人物','我要看照片不要水印','我想看看你的相片，在图书馆里，别加文字','照片给我看看，不需要文字']){
  assert.equal(localMediaCancelled(request),false,request);
  assert.equal(resolveLocalMediaTask(request).image,true,request);
  assert.equal(localRequirements(request).image,true,request);
 }
 for(const request of ['我不想看照片','不要再给我发图片','我要看照片。算了，不要发了','照片先不要了','我想看照片里的文字','我想看照片里面有什么'])assert.equal(resolveLocalMediaTask(request).image,false,request);
 assert.equal(localMediaCancelled('别发语音','speech'),true);
 assert.equal(localMediaCancelled('不要生成视频','video'),true);
 assert.equal(localMediaCancelled('我要看照片，语音不用了','image'),false);
 assert.equal(localMediaCancelled('我要看照片，不要图书馆背景','image'),false);
 assert.equal(localMediaCancelled('不要'+('这张'.repeat(200))+'水印','image'),false);
});
test('local semantic checks still understand a scene request with negative content constraints',async()=>{
 const request='把图书馆里靠窗那张书桌的模样发过来吧，不要人物和水印',initial=resolveLocalMediaTask(request);
 assert.equal(initial.image,false);assert.equal(localMediaPlanningCandidate(request),true);
 let calls=0;const task=await planLocalMediaTask(initial,{request,model:async()=>{calls++;return JSON.stringify({kind:'image',evidence:'模样发过来',request:'生成图书馆靠窗书桌的图片，不要人物和水印',confidence:.98});}});
 assert.equal(calls,1);assert.equal(task.source,'semantic');assert.equal(task.image,true);assert.match(task.effectiveRequest,/不要人物和水印/);
});
test('local semantic fallback understands a media request and checks evidence against current human words',async()=>{
 const request='把窗边那盆绿植的模样发过来吧',initial=resolveLocalMediaTask(request);assert.equal(initial.image,false);
 let calls=0;const task=await planLocalMediaTask(initial,{request,model:async options=>{calls++;assert.deepEqual(options.tools,[]);assert.equal(options.purpose,'media_intent');return JSON.stringify({kind:'image',evidence:'发过来',request:'生成一张窗边绿植的图片',confidence:.95});}});assert.equal(task.image,true);assert.equal(task.source,'semantic');assert.equal(calls,1);
 for(const decision of [{kind:'image',evidence:'不存在的请求',confidence:1},{kind:'image',evidence:'发过来',confidence:.2},{kind:'image',evidence:'发过来',confidence:1,request:'生成https://invented.invalid/a'}]){const rejected=await planLocalMediaTask(initial,{request,model:async()=>JSON.stringify(decision)});assert.equal(rejected.image,false);}
});
test('explicit tasks need no extra classifier, and cancellation, examples and screenshots cannot become generation requests',async()=>{
 let calls=0;const model=async()=>{calls++;return '{}';};for(const request of ['我要看照片','不要发照片','例如发一张照片','看一下截图','本地生图报错了'])await planLocalMediaTask(resolveLocalMediaTask(request),{request,model});assert.equal(calls,0);
 assert.equal(localMediaPlanningCandidate('看一下截图'),false);
});
