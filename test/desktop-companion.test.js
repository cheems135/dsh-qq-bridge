import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createDesktopCompanion} from '../desktop-companion.js';
import {installVisualCompanion,parseVisualReaction} from '../companion-plugin.js';
import {transcribeCompanionAudio} from '../companion-input-audio.js';
import {recoverInterruptedChatAudits,chatAuditInvocations} from '../model-invocation-audit.js';
import {createVisualSessions} from '../visual-session.js';

test('real vision prose remains a reaction without a paid repair call or executable action; malformed JSON is rejected',()=>{
 assert.deepEqual(parseVisualReaction('画面里几个穿白队服的人正抱在一起庆祝'),{say:'画面里几个穿白队服的人正抱在一起庆祝',action:null});
 assert.deepEqual(parseVisualReaction('内部观察：画面正在变化',{allowProse:false}),{say:'',action:null});
 assert.deepEqual(parseVisualReaction('{"analysis":"内部分析不能发送","say":"这个好有意思","action":null}',{allowProse:false}).say,'这个好有意思');
 assert.deepEqual(parseVisualReaction('```json\n{"say":"看到了","action":null}\n```'),{say:'看到了',action:null});
 for(const raw of ['{"say":"截断','["say"]','null','<think>内部推理</think>回复',''])assert.throws(()=>parseVisualReaction(raw),/有效的反应结构/);
});

function fakeSpawn(respond){const children=[];const spawn=(_exe,args,options)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.stdin=new EventEmitter();c.stdin.write=(line,callback)=>{queueMicrotask(()=>respond(c,JSON.parse(line)));callback?.();};c.kill=()=>{c.killed=true;c.emit('exit',0);};children.push(c);assert.equal(options.windowsHide,true);assert(args.includes('capture'));return c;};return {spawn,children};}
test('persistent native capture needs no FFmpeg and preserves UTF-8 titles across arbitrary pipe chunks',async()=>{
 const f=fakeSpawn((c,r)=>{const b=Buffer.from(JSON.stringify({id:r.id,result:{ok:true,sourceLabel:'测试窗口',signature:[1],data:'jpeg'}})+'\n');for(const byte of b)c.stdout.emit('data',Buffer.from([byte]));});
 const native=createDesktopCompanion({platform:'win32',spawnImpl:f.spawn,getCacheDir:()=>''});try{for(let i=0;i<3;i++){const result=await native.capture({windowId:'123'},{},{maxEdge:640,quality:60});assert.equal(result.sourceLabel,'测试窗口');}assert.equal(f.children.length,1);}finally{native.close();}assert.equal(f.children[0].killed,true);
});
test('cancelled and late native frame results cannot complete another capture; helper restarts after failure',async()=>{
 let first;const f=fakeSpawn((c,r)=>{if(!first){first={c,r};return;}c.stdout.emit('data',Buffer.from(JSON.stringify({id:r.id,result:{ok:true,sourceLabel:'new'}})+'\n'));});
 const native=createDesktopCompanion({platform:'win32',spawnImpl:f.spawn,getCacheDir:()=>''}),controller=new AbortController();const pending=native.capture({}, {signal:controller.signal},{maxEdge:640,quality:60});await new Promise(r=>setImmediate(r));controller.abort();await assert.rejects(pending,e=>e.name==='AbortError');first.c.stdout.emit('data',Buffer.from(JSON.stringify({id:first.r.id,result:{sourceLabel:'old'}})+'\n'));assert.equal((await native.sources()).sourceLabel,'new');first.c.kill();assert.equal((await native.sources()).sourceLabel,'new');assert.equal(f.children.length,2);native.close();await assert.rejects(native.sources(),/仅在电脑版|已关闭|桌面识屏/);
});
function httpFixture({platform='win32',permitted=true}={}){
 let handler,captures=0,opened=0,models=0;const effects=[];const native={capture:async()=>{captures++;return {ok:true,width:640,height:360,data:'jpeg',signature:[1],capturedAt:Date.now()};},sources:async()=>({ok:true,windows:[{windowId:'123',title:'test'}]}),open:async()=>{opened++;return {native:true};},closeWindow:()=>{},acceptsToken:t=>t==='allowed',close:()=>{}};
 const plugin=installVisualCompanion({ctx:{get:n=>n==='webServer'?{port:1234,register:r=>{handler=r.handler;return()=>{};}}:null,effect:fn=>effects.push(fn())},nativeDesktop:native,platform,cacheDir:'unused',valid:()=>permitted,busy:()=>true,local:()=>true,browser:{},panelContext:key=>({key,accountId:'a',personaId:'p'}),model:()=>models++,record:()=>{}});
 const request=(body,headers={})=>new Promise(resolve=>{const req=new EventEmitter();Object.assign(req,{method:'POST',headers:{host:'127.0.0.1',...headers},socket:{localPort:1234},setEncoding:()=>{}});handler(req,{writeHead:status=>req.status=status,end:raw=>resolve({status:req.status,body:JSON.parse(raw)})});req.emit('data',JSON.stringify(body));req.emit('end');});
 return {request,plugin,close:()=>{for(const stop of effects)stop?.();},counts:()=>({captures,opened,models})};
}
test('native probe returns actual preview without creating an inference session, open uses independent native window',async()=>{
 const f=httpFixture();try{const result=await f.request({action:'probe',key:'private:1'});assert.equal(result.body.modelCalled,false);assert.equal(result.body.preview,'data:image/jpeg;base64,jpeg');assert.equal(f.plugin.list().length,0);assert.equal((await f.request({action:'sources',key:'private:1'})).body.windows[0].windowId,'123');assert.equal((await f.request({action:'open-window',key:'private:1'})).body.window.native,true);assert.deepEqual(f.counts(),{captures:1,opened:1,models:0});assert.equal((await f.request({action:'probe'},{'x-dsh-companion':'stale'})).status,403);assert.equal((await f.request({action:'probe'},{origin:'http://evil.invalid'})).status,403);}finally{f.close();}
});

test('the bot can directly open its native floating window without inventing a screen session',async()=>{
 const f=httpFixture();try{const r=await f.plugin.command({action:'open-window'},{key:'private:1',accountId:'a',personaId:'p'});assert.equal(r.ok,true);assert.equal(r.started,false);assert.equal(f.counts().opened,1);assert.equal(f.plugin.list().length,0);}finally{f.close();}
 const denied=httpFixture({permitted:false});try{assert.throws(()=>denied.plugin.command({action:'open-window'},{key:'private:1'}),/权限/);assert.equal(denied.counts().opened,0);}finally{denied.close();}
});
test('phone and revoked desktop contexts cannot launch a native window or read desktop frames',async()=>{
 for(const options of [{platform:'android'},{permitted:false}]){const f=httpFixture(options);try{assert.equal((await f.request({action:'open-window',key:'private:1'})).status,400);assert.equal((await f.request({action:'probe',key:'private:1'})).status,400);assert.deepEqual(f.counts(),{captures:0,opened:0,models:0});}finally{f.close();}}
});
test('screen and selected-window sessions do not require a link, use local budget and retain capture ownership',()=>{
 const f=httpFixture();try{const s=f.plugin.command({action:'start',target:'screen'},{key:'private:1',accountId:'a',personaId:'p'});assert.equal(s.target,'screen');assert.equal(s.budget.maxEdge,640);assert.throws(()=>f.plugin.command({action:'start',target:'window'},{key:'private:1'}),/真实窗口/);const w=f.plugin.command({action:'start',target:'window',windowId:'123'},{key:'private:1',accountId:'a',personaId:'p'});assert.equal(w.windowId,'123');assert.equal(f.plugin.list()[0].id,w.id);}finally{f.close();}
});
function wav(){const b=Buffer.alloc(8044);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(8000,40);return b;}
test('native microphone WAV uses saved ASR route, correct MIME and filename; malformed PCM never uploads',async()=>{
 let calls=0;const bytes=wav(),audio={data:bytes.toString('base64'),mediaType:'audio/wav'},options={media:{asrApiKey:'fixture',asrBaseUrl:'https://example.com/v1'},fetchImpl:async(_url,request)=>{calls++;const file=request.body.get('file');assert.equal(file.name,'microphone.wav');assert.equal(file.type,'audio/wav');return Response.json({text:'可编辑的语音输入'});}};
 assert.equal(await transcribeCompanionAudio(audio,options),'可编辑的语音输入');bytes.writeUInt32LE(7,40);await assert.rejects(transcribeCompanionAudio({...audio,data:bytes.toString('base64')},options),/格式/);assert.equal(calls,1);
});
test('restart recovery closes orphaned chat audit status without replaying or changing delivery receipts',()=>{
 const rows=[{id:'old',accountId:'a',chat:'private:1',at:1,status:'running'},{id:'fresh',accountId:'a',chat:'private:1',at:100,status:'running'},{id:'other',accountId:'b',chat:'private:1',at:1,status:'running'}],outbox=[{auditId:'old',status:'unknown'}];assert.equal(recoverInterruptedChatAudits(rows,outbox,{accountId:'a',keys:['private:1'],before:50,now:100}),1);assert.equal(rows[0].status,'cancelled');assert.equal(rows[0].deliveryState,'unknown');assert.equal(rows[0].durationUnknown,true);assert.equal(outbox[0].status,'unknown');assert.equal(rows[1].status,'running');assert.equal(rows[2].status,'running');assert.equal(chatAuditInvocations(rows,'a').find(r=>r.auditId==='old').elapsedMs,undefined);
});
test('temporary local resource deferral never accumulates screen failures or halts the session',async()=>{
 let time=0,calls=0;const queue=[];const manager=createVisualSessions({capture:async()=>({data:'frame'+time,signature:[time],capturedAt:time}),analyze:async()=>{calls++;throw Object.assign(Error('本地资源忙'),{code:'LOCAL_ANALYSIS_DEFERRED'});},valid:()=>true,busy:()=>false,local:()=>true,now:()=>time,schedule:fn=>{const row={fn};queue.push(row);return row;},cancel:row=>{if(row)row.cancelled=true;}});manager.start({target:'screen'},{key:'private:1'});for(let n=0;n<5;n++){time+=15000;let row;while((row=queue.shift())?.cancelled){}row?.fn();await new Promise(r=>setImmediate(r));}assert(calls>=3);assert.equal(manager.list()[0].status,'running');assert.equal(manager.list()[0].error,'');assert(manager.list()[0].events.some(e=>e.type==='deferred'));manager.close();
});
test('slow understanding of an unchanged screen is usable, while old automatic game actions remain discarded',async()=>{
 for(const game of [false,true]){
  let now=0,finish;const tasks=[],sent=[],actions=[];const manager=createVisualSessions({now:()=>now,schedule:fn=>{const t={fn};tasks.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},capture:async()=>({data:game?'frame'+now:'static',signature:[game?now:1],capturedAt:now,elements:[{type:'canvas',ref:'game'}]}),analyze:()=>new Promise(r=>finish=r),deliver:async t=>sent.push(t),act:async t=>actions.push(t)});
  manager.start(game?{target:'browser',url:'https://example.com/',mode:'game',control:true}:{target:'screen'},{key:'private:1'});
  const tick=async()=>{let t;while((t=tasks.shift())?.cancelled){}t?.fn();await new Promise(r=>setImmediate(r));};now=1000;await tick();now=22000;await tick();finish({say:'实际观察到的画面',action:game?{action:'press',key:'Space'}:null});await new Promise(r=>setImmediate(r));assert.equal(sent.length,game?0:1);assert.equal(actions.length,0);manager.close();
 }
});
test('explicit screen questions receive their snapshot answer instead of requeuing forever when scenes change',async()=>{
 let now=0,finish;const tasks=[],sent=[];const manager=createVisualSessions({now:()=>now,schedule:fn=>{const t={fn};tasks.push(t);return t;},cancel:t=>{if(t)t.cancelled=true;},capture:async()=>({data:'frame'+now,signature:[now],capturedAt:now}),analyze:()=>new Promise(r=>finish=r),deliver:async t=>sent.push(t)});manager.start({target:'screen'},{key:'private:1'});const input=manager.submit('private:1','刚才那个绿色圆形是什么？');const tick=async()=>{let t;while((t=tasks.shift())?.cancelled){}t?.fn();await new Promise(r=>setImmediate(r));};now=1000;await tick();now=25000;await tick();finish({say:'拍下来的那一刻，左边确实是个绿色圆形',action:null});await new Promise(r=>setImmediate(r));assert.equal(sent.length,1);assert.equal(manager.list()[0].pendingInputs,0);assert.equal(manager.list()[0].messages.find(m=>m.id===input.id).state,'answered');assert(manager.list()[0].events.some(e=>e.type==='snapshot-answer'));manager.close();
});
