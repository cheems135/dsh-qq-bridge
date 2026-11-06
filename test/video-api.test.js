import test from 'node:test';
import assert from 'node:assert/strict';
import {connectionVideo,videoJobUrl} from '../video-api.js';
import {buildVideoPrompt,videoConfig} from '../video-prompt.js';
import {createServiceConnections,connectionUrl} from '../service-connections.js';
const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(20)]);
const profile={type:'openai',baseUrl:'https://video.example/v1',apiKey:'private-key',videoModel:'arbitrary-video-model',paths:{}};
const response=v=>new Response(JSON.stringify(v),{headers:{'content-type':'application/json'}});
test('video shares full image base and adds timeline, user motion and camera without overwriting wardrobe',()=>{
 const base='人设身份：小雨。服装白裙，蓝色发饰；日程：海边散步；背景浪花与沙滩。';
 const prompt=buildVideoPrompt(base,{seconds:9,action:'前2秒抬手，随后挥手',cameraMotion:'自拍视角轻微跟随'});
 assert(prompt.startsWith(base+'\n'));for(const s of ['9秒','0–3秒','3–6秒','6–9秒','前2秒抬手，随后挥手','自拍视角轻微跟随','头饰','日程场景'])assert(prompt.includes(s));
 assert.match(buildVideoPrompt(base,{language:'en',seconds:12}),/Duration: 12 seconds/);assert.throws(()=>buildVideoPrompt(base,{seconds:0}));assert.throws(()=>videoConfig({size:'bad'}));assert.equal(videoConfig({seconds:240}).seconds,240);
});
test('multipart video submits once with real reference then polls and downloads authenticated content',async()=>{
 const requests=[],states=[];
 const result=await connectionVideo(profile,{prompt:'完整视频提示词',reference:{bytes:Buffer.from('actual reference'),mediaType:'image/jpeg'},seconds:8,size:'720x1280',pollMs:0,onJob:j=>states.push(j)},async(url,options)=>{
  requests.push({url,options});if(options.method==='POST'){assert(options.body instanceof FormData);assert.equal(options.body.get('model'),'arbitrary-video-model');assert.equal(options.body.get('seconds'),'8');assert.equal(await options.body.get('input_reference').text(),'actual reference');return response({id:'job-one',status:'queued'});}
  if(String(url).endsWith('/content'))return new Response(mp4);return response({id:'job-one',status:'completed'});
 });assert.equal(result.extension,'mp4');assert.equal(requests.filter(r=>r.options.method==='POST').length,1);assert.equal(requests[2].options.headers.authorization,'Bearer private-key');assert.deepEqual(states.map(j=>j.status),['submitting','queued','completed']);
});
test('JSON custom paths keep reference and arbitrary model, resume never POSTs, signed CDN gets no credentials',async()=>{
 let posts=0,downloads=0;
 const p={...profile,videoMode:'json',paths:{video:'/generate/video',videoStatus:'/tasks/{id}',videoContent:'/tasks/{id}/result'}};
 const result=await connectionVideo(p,{prompt:'test',reference:{bytes:Buffer.from('abc')},pollMs:0},async(url,options)=>{
  if(options.method==='POST'){posts++;const body=JSON.parse(options.body);assert.match(body.input_reference,/base64,YWJj$/);assert.equal(url,'https://video.example/generate/video');return response({data:{task_id:'abc',status:'queued'}});}
  assert.equal(url,'https://video.example/tasks/abc');return response({status:'success',video_url:'https://cdn.example/video.mp4?signature=abc'});
 },{download:async(url,options)=>{downloads++;assert.equal(options.headers,undefined);return {status:200,bytes:mp4};}});
 assert.equal(posts,1);assert.equal(downloads,1);assert.equal(result.extension,'mp4');
 await connectionVideo(p,{prompt:'test',job:{id:'abc',status:'completed'}},async(url,options)=>{assert.notEqual(options.method,'POST');assert.match(url,/tasks\/abc\/result$/);return new Response(mp4);});
 assert.throws(()=>videoJobUrl({...p,paths:{videoStatus:'https://other.example/tasks/{id}'}},'videoStatus','abc'),/当前服务/);
});
test('job failure, invalid file, ambiguous submit and cancellation never trigger another generation',async()=>{
 let posts=0;
 await assert.rejects(connectionVideo(profile,{prompt:'test',pollMs:0},async(_u,o)=>{if(o.method==='POST'){posts++;return response({id:'j',status:'queued'});}return response({id:'j',status:'failed',error:{message:'quota insufficient'}});}),/quota insufficient/);assert.equal(posts,1);
 await assert.rejects(connectionVideo(profile,{prompt:'test',job:{status:'submitting',id:''}},()=>{throw Error('must not request');}),/不确定/);
 await assert.rejects(connectionVideo(profile,{prompt:'test',job:{id:'j',status:'completed'}},async()=>new Response('<html>failure</html>')),/MP4/);
 const controller=new AbortController();controller.abort(Error('cancelled'));await assert.rejects(connectionVideo(profile,{prompt:'test',signal:controller.signal},()=>{throw Error('must not request');}),/cancelled/);
});
test('video profile fields survive other connection edits, mobile accepts API, paths are same origin',()=>{
 let state={profiles:[],routes:{enabled:false}};const connections=createServiceConnections({apiOnly:true,storage:{read:()=>state,write:v=>state=v}});
 const p=connections.save({...profile,name:'video',paths:{video:'/v1/videos',videoStatus:'/v1/videos/{id}',videoContent:'/v1/videos/{id}/content'}});
 const updated=connections.save({...p,name:'renamed',videoModel:undefined,videoMode:undefined});assert.equal(updated.videoModel,'arbitrary-video-model');assert.equal(updated.videoMode,'multipart');assert.match(updated.paths.videoStatus,/\{id\}/);assert.equal(updated.apiKey,undefined);assert.equal(updated.hasKey,true);assert.equal(connectionUrl('https://video.example/v1/videos'),'https://video.example/v1');
 assert.throws(()=>connections.save({...p,paths:{video:'https://evil.example/videos'}}),/当前服务/);
});
