import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createMobileOverlayBridge} from '../mobile-overlay-bridge.js';
import {createVisualSessions} from '../visual-session.js';
const frame=(at=1000)=>({capturedAt:at,signature:Array(144).fill(20),data:Buffer.from([255,216,255,192,0,11,8,0,2,0,2,1,1,17,0,255,217]).toString('base64')});
function fixture(extra={}){
 let time=1000,context={key:'private:owner',accountId:'a',personaId:'p'},enabled=true,modelCalls=0;
 const manager=createVisualSessions({schedule:()=>0,cancel:()=>{},valid:()=>enabled,local:()=>false});
 const command=(args,c)=>args.action==='start'?manager.start(args,c):args.action==='input'?manager.submit(c.key,args.text):manager.control(c.key,args.action);
 const bridge=createMobileOverlayBridge({panelContext:()=>context,valid:()=>enabled,command,list:()=>manager.list(),now:()=>time,platform:'android',transcribe:async()=>{modelCalls++;return '转写草稿';},...extra});
 const pair=()=>bridge.pair(context,'http://127.0.0.1:19480');
 const ticket=value=>new URLSearchParams(new URL(value.url).hash.slice(1)).get('ticket');
 async function connected(){const value=pair(),claim=await bridge.execute({action:'claim',ticket:ticket(value)});const start=await bridge.execute({action:'start'},claim.token);return {token:claim.token,session:start.session};}
 return {bridge,manager,pair,ticket,connected,context,advance:ms=>time+=ms,switchPersona:()=>{context={...context,personaId:'other'};},disable:()=>enabled=false,get modelCalls(){return modelCalls;},close(){bridge.close();manager.close();}};
}
test('pairing is loopback-only, short-lived, one-use and contains no permanent credential',async()=>{const f=fixture();try{
 assert.throws(()=>f.bridge.pair(f.context,'http://example.com:80'),/本机/);
 const paired=f.pair();assert.equal(new URL(paired.url).protocol,'dshcompanion:');const token=await f.bridge.execute({action:'claim',ticket:f.ticket(paired)});assert.ok(token.token);assert.ok(!paired.url.includes(token.token));await assert.rejects(f.bridge.execute({action:'claim',ticket:f.ticket(paired)}),/过期/);
 const next=f.pair();f.advance(120001);await assert.rejects(f.bridge.execute({action:'claim',ticket:f.ticket(next)}),/过期/);
 assert.equal(f.modelCalls,0);
 }finally{f.close();}});
test('native frame transport keeps only the latest bounded frame and reuses phone API budget',async()=>{const f=fixture();try{const {token,session}=await f.connected();assert.equal(session.captureSource,'native');assert.equal(session.backend,'api');assert.equal(session.budget.maxEdge,768);
 for(let i=0;i<20;i++){f.advance(1);await f.bridge.execute({action:'frame',id:session.id,frame:frame(1001+i)},token);}
 const captured=f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget);assert.equal(captured.capturedAt,1020);assert.match(captured.coverage,/MediaProjection/);assert.equal(f.modelCalls,0);
 assert.equal((await f.bridge.execute({action:'frame',id:session.id,frame:frame(1010)},token)).accepted,false);
 await assert.rejects(f.bridge.execute({action:'frame',id:session.id,frame:frame(-10000)},token),/过期/);
 await assert.rejects(f.bridge.execute({action:'frame',id:session.id,frame:{...frame(1020),data:'invalid'}},token),/画面/);
 }finally{f.close();}});
test('session mismatch, persona change and revoked connection never reach model or old pixels',async()=>{const f=fixture();try{const {token,session}=await f.connected();await assert.rejects(f.bridge.execute({action:'input',id:'other',text:'old'},token),/切换/);f.switchPersona();await assert.rejects(f.bridge.execute({action:'status'},token),/失效/);assert.throws(()=>f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget),/断开/);assert.equal(f.modelCalls,0);}finally{f.close();}});
test('re-pair invalidates former helper, pause drops pixels, explicit stop ends the model session',async()=>{const f=fixture();try{const old=await f.connected(),now=await f.connected();await assert.rejects(f.bridge.execute({action:'status'},old.token),/失效/);
 await f.bridge.execute({action:'frame',id:now.session.id,frame:frame()},now.token);
 await f.bridge.execute({action:'pause',id:now.session.id},now.token);assert.equal(f.manager.list()[0].status,'paused');assert.equal((await f.bridge.execute({action:'frame',id:now.session.id,frame:frame()},now.token)).accepted,false);
 await f.bridge.execute({action:'resume',id:now.session.id},now.token);await f.bridge.execute({action:'input',id:now.session.id,text:'这是哪里'},now.token);assert.equal(f.manager.list()[0].pendingInputs,1);
 const stt=await f.bridge.execute({action:'transcribe',id:now.session.id,audio:{}},now.token);assert.equal(stt.text,'转写草稿');assert.equal(f.manager.list()[0].pendingInputs,1);
 await f.bridge.execute({action:'disconnect',id:now.session.id},now.token);assert.equal(f.manager.list()[0].status,'stopped');await assert.rejects(f.bridge.execute({action:'status'},now.token),/失效/);
 }finally{f.close();}});
test('silent helper expiry stops accepting frames and desktop cannot acquire a native phone lease',async()=>{const f=fixture(),pc=fixture({platform:'win32'});try{const {token}=await f.connected();f.advance(300001);await assert.rejects(f.bridge.execute({action:'status'},token),/失效/);assert.throws(()=>pc.pair(),/手机版/);await assert.rejects(pc.bridge.execute({action:'claim',ticket:'x'}),/不可用/);}finally{f.close();pc.close();}});
test('native HTTP transport rejects browser origins and returns real authenticated receipts',async()=>{const f=fixture(),server=http.createServer(f.bridge.handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;try{
 const blocked=await fetch(url,{method:'POST',headers:{origin:'https://unrelated.example'},body:'{}'});assert.equal(blocked.status,403);
 const denied=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"status"}'});assert.equal(denied.status,400);
 const paired=f.pair(),claim=await fetch(url,{method:'POST',body:JSON.stringify({action:'claim',ticket:f.ticket(paired)})}).then(r=>r.json());
 const start=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+claim.token},body:'{"action":"start"}'}).then(r=>r.json());assert.equal(start.session.target,'phone');assert.equal(start.session.captureSource,'native');
 }finally{f.close();await new Promise(r=>server.close(r));}});

test('live static screen heartbeat preserves original pixel timestamp without expired frame failures',async()=>{const f=fixture();try{const {token,session}=await f.connected();f.advance(60_000);await f.bridge.execute({action:'frame',id:session.id,frame:{...frame(61_000),sourceCapturedAt:1000,unchangedSource:true}},token);const result=f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget);assert.equal(result.sourceCapturedAt,1000);assert.equal(result.capturedAt,61_000);assert.equal(result.unchangedSource,true);assert.equal(f.modelCalls,0);}finally{f.close();}});

test('resume grants a new first-frame window after an idle pause',async()=>{const f=fixture();try{const {token,session}=await f.connected();await f.bridge.execute({action:'pause',id:session.id},token);f.advance(60_000);await f.bridge.execute({action:'resume',id:session.id},token);assert.deepEqual(f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget),{pending:true});}finally{f.close();}});

test('hidden single-app projection waits without stale analysis and resumes when visible',async()=>{const f=fixture();try{const {token,session}=await f.connected();await f.bridge.execute({action:'frame',id:session.id,frame:frame()},token);await f.bridge.execute({action:'status',sourceVisible:false},token);f.advance(30_000);const pending=f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget);assert.equal(pending.pending,true);assert.match(pending.reason,/不可见/);await f.bridge.execute({action:'status',sourceVisible:true},token);await f.bridge.execute({action:'frame',id:session.id,frame:frame(31_000)},token);assert.equal(f.bridge.capture({}, {...f.context,visualSessionId:session.id},session.budget).capturedAt,31_000);assert.equal(f.modelCalls,0);}finally{f.close();}});
