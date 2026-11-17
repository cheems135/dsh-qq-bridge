import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {installVisualCompanion} from '../companion-plugin.js';
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,2,0,2,1,1,17,0,255,217]).toString('base64');
test('real plugin routes connect native capture to current phone session without host screenshots or local models',async()=>{
 const routes=new Map(),dispose=[],context={key:'private:owner',accountId:'a',personaId:'p'};let hostCaptures=0,visionCalls=0,seenFrame,delivered=[];
 const server=http.createServer((req,res)=>{const handler=routes.get(req.url);if(handler)return handler(req,res);res.writeHead(404);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const webServer={port:server.address().port,register:r=>{routes.set(r.path,r.handler);return()=>routes.delete(r.path);}};
 const ctx={get:name=>name==='webServer'?webServer:name==='attachments'?{saveImage:async image=>{seenFrame=image;return {id:'test-image'};}}:null,effect:fn=>dispose.push(fn())};
 const companion=installVisualCompanion({ctx,platform:'android',cacheDir:'.',valid:()=>true,busy:()=>false,local:()=>false,phone:{act:async()=>{hostCaptures++;throw Error('host path must remain unused');},status:async()=>({connected:false})},model:async()=>{visionCalls++;return '{"say":"测试画面已送达","action":null}';},persona:()=>'',deliver:async text=>delivered.push(text),record:()=>{},panelContext:()=>context});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,args,token)=>{const r=await fetch(base+route,{method:args?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:args?JSON.stringify(args):undefined});const json=await r.json();if(!r.ok)throw Error(json.error);return json;};
 try{
  const pair=await call('/im-bridge/visual-session',{action:'pair-native',key:context.key});const ticket=new URLSearchParams(new URL(pair.url).hash.slice(1)).get('ticket');const claim=await call('/im-bridge/mobile-overlay',{action:'claim',ticket});
  const start=await call('/im-bridge/mobile-overlay',{action:'start',profile:'saver'},claim.token);assert.equal(start.session.captureSource,'native');assert.equal(start.session.budget.maxEdge,640);
  await call('/im-bridge/mobile-overlay',{action:'frame',id:start.session.id,frame:{data:jpeg,capturedAt:Date.now(),signature:Array(144).fill(50)}},claim.token);
  // Explicit input causes the next valid latest frame to be analyzed, independent of the automatic interval.
  await call('/im-bridge/mobile-overlay',{action:'input',id:start.session.id,text:'测试接口'},claim.token);
  const until=Date.now()+4500;while(visionCalls===0&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
  assert.equal(visionCalls,1);assert.equal(hostCaptures,0);assert.equal(seenFrame.mediaType,'image/jpeg');
  const state=await call('/im-bridge/visual-session');assert.equal(state.captureMode,'android-media-projection');assert.equal(state.crossAppOverlay,true);assert.equal(state.sessions[0].backend,'api');
  await call('/im-bridge/mobile-overlay',{action:'disconnect',id:start.session.id},claim.token);assert.equal(companion.list()[0].status,'stopped');assert.deepEqual(delivered,['测试画面已送达']);
 }finally{for(const fn of dispose.reverse())fn?.();companion.close();await new Promise(r=>server.close(r));}
});
