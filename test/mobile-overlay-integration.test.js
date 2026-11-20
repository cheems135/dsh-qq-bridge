import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';
import {installVisualCompanion} from '../companion-plugin.js';
import {createAgentCapabilities} from '../agent-capabilities.js';
const jpeg=Buffer.from([255,216,255,192,0,11,8,0,2,0,2,1,1,17,0,255,217]).toString('base64');
test('real plugin routes connect native capture to current phone session without host screenshots or local models',async()=>{
 const routes=new Map(),dispose=[],context={key:'private:owner',accountId:'a',personaId:'p'};let hostCaptures=0,visionCalls=0,seenFrame,delivered=[];
 const server=http.createServer((req,res)=>{if(req.url==='/im-bridge/mobile-overlay'){res.writeHead(401);res.end();return;}const handler=routes.get(req.url);if(handler)return handler(req,res);res.writeHead(404);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const webServer={port:server.address().port,register:r=>{routes.set(r.path,r.handler);return()=>routes.delete(r.path);}};
 const ctx={get:name=>name==='webServer'?webServer:name==='attachments'?{saveImage:async image=>{seenFrame=image;return {id:'test-image'};}}:null,effect:fn=>dispose.push(fn())};
 const companion=installVisualCompanion({ctx,platform:'android',cacheDir:'.',valid:()=>true,busy:()=>false,local:()=>false,phone:{act:async()=>{hostCaptures++;throw Error('host path must remain unused');},status:async()=>({connected:false})},model:async()=>{visionCalls++;return '{"say":"测试画面已送达","action":null}';},persona:()=>'',deliver:async text=>delivered.push(text),record:()=>{},panelContext:key=>({...context,key:key||context.key})});
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(url,args,token)=>{const r=await fetch(url,{method:args?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:args?JSON.stringify(args):undefined});const json=await r.json();if(!r.ok)throw Error(json.error);return json;};
 try{
  const panel=base+'/im-bridge/visual-session';
  const before=await call(panel);
  assert.equal(before.nativeMobile.connected,false);
  assert.equal(before.installer.available,true);
  assert.notEqual(new URL(before.installer.url).origin,base);
  const landing=await fetch(before.installer.url);
  assert.equal(landing.status,200);
  assert.match(await landing.text(),/href="\/im-bridge\/mobile-overlay\.apk"/);
  const installer=await fetch(new URL('/im-bridge/mobile-overlay.apk',before.installer.url));
  assert.equal(installer.headers.get('content-type'),'application/vnd.android.package-archive');
  assert.match(installer.headers.get('content-disposition'),/DSH-Companion\.apk/);
  assert.equal(Buffer.from(await installer.arrayBuffer()).subarray(0,4).toString('hex'),'504b0304');
  const pair=await call(panel,{action:'pair-native',key:context.key});
  const options=new URLSearchParams(new URL(pair.url).hash.slice(1));
  const origin=options.get('base'),overlay=origin+'/im-bridge/mobile-overlay';
  assert.notEqual(origin,base);assert.equal(new URL(origin).hostname,'127.0.0.1');
  const handoff=new URL(pair.handoffUrl);
  assert.equal(handoff.origin,origin);
  assert.equal(handoff.search,'');
  assert.equal(new URLSearchParams(handoff.hash.slice(1)).get('ticket'),options.get('ticket'));
  const handoffPage=await fetch(handoff);
  assert.equal(handoffPage.status,200);
  assert.equal(handoffPage.headers.get('referrer-policy'),'no-referrer');
  assert.doesNotMatch(await handoffPage.text(),new RegExp(options.get('ticket')));
  assert.equal(routes.has('/im-bridge/mobile-overlay'),false);
  await assert.rejects(call(overlay,{action:'status'}),/失效/);
  const claim=await call(overlay,{action:'claim',ticket:options.get('ticket')});
  assert.equal((await call(panel)).nativeMobile.connected,false);
  const start=await call(overlay,{action:'start',profile:'saver'},claim.token);assert.equal(start.session.captureSource,'native');assert.equal(start.session.budget.maxEdge,640);
  assert.equal((await call(panel)).nativeMobile.ready,false);
  await assert.rejects(call(panel,{action:'observe',key:context.key}),/等待第一张/);
  await call(overlay,{action:'frame',id:start.session.id,frame:{data:jpeg,capturedAt:Date.now(),signature:Array(144).fill(50)}},claim.token);
  // Explicit input causes the next valid latest frame to be analyzed, independent of the automatic interval.
  await call(overlay,{action:'input',id:start.session.id,text:'测试接口'},claim.token);
  const until=Date.now()+4500;while(visionCalls===0&&Date.now()<until)await new Promise(r=>setTimeout(r,20));
  assert.equal(visionCalls,1);assert.equal(hostCaptures,0);assert.equal(seenFrame.mediaType,'image/jpeg');
  const state=await call(panel);assert.equal(state.captureMode,'android-media-projection');assert.equal(state.crossAppOverlay,true);assert.equal(state.sessions[0].backend,'api');assert.equal(state.sessions[0].nativeCapture.ready,true);
  const preview=await call(panel,{action:'observe',key:context.key});
  assert.equal(preview.preview,'data:image/jpeg;base64,'+jpeg);
  assert.equal(preview.modelCalled,false);
  await assert.rejects(call(panel,{action:'observe',key:'private:other'}),/请先连接/);
  const definitions=new Map();
  const tools=createAgentCapabilities({
   platform:'linux',ctx:{get:name=>name==='tools'?{register:definition=>{definitions.set(definition.name,definition);}}:ctx.get(name)},
   getConfig:()=>({phone:true}),getContext:()=>context,authorize:()=>true,browser:{close:async()=>{}},
   services:{companion:companion.command},getPhone:()=>({act:()=>{throw Error('must reuse the shared frame');}})
  });
  try{
   tools.start();
   const observation=await definitions.get('bridge_device').execute({target:'phone',action:'observe-shared'},{agent:{id:'dsh-owner'}});
   assert.equal(observation.imageAttachments[0].id,'test-image');
   assert.equal(observation.audioState,'not-captured');
   assert.equal(visionCalls,1);
   assert.equal(hostCaptures,0);
  }finally{tools.close();}
  await call(panel,{action:'pause',id:start.session.id,key:context.key});
  await call(panel,{action:'resume',id:start.session.id,key:context.key});
  assert.equal((await call(panel)).nativeMobile.ready,false);
  await assert.rejects(call(panel,{action:'observe',key:context.key}),/等待第一张/);
  await call(overlay,{action:'status',sourceVisible:false},claim.token);
  assert.equal((await call(panel)).nativeMobile.ready,false);
  await assert.rejects(call(panel,{action:'observe',key:context.key}),/不可见/);
  await call(overlay,{action:'disconnect',id:start.session.id},claim.token);assert.equal(companion.list()[0].status,'stopped');assert.deepEqual(delivered,['测试画面已送达']);
 }finally{for(const fn of dispose.reverse())fn?.();companion.close();await new Promise(r=>server.close(r));}
});
