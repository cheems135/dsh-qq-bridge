import test from 'node:test';
import assert from 'node:assert/strict';
import {createVisualSessions,visualSessionBudget,visualGameAction,visualCompanionIntent} from '../visual-session.js';
import {installVisualCompanion} from '../companion-plugin.js';
import {localCompletionInput} from '../local-routing.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(extra={}){
 let now=0,frame=0,blocked=false,authorized=true;const jobs=[],sent=[],actions=[],analyzed=[];
 const engine=createVisualSessions({now:()=>now,schedule:fn=>{const job={fn};jobs.push(job);return job;},cancel:job=>{if(job)job.cancelled=true;},valid:()=>authorized,busy:()=>blocked,local:()=>false,
  capture:async()=>({data:'frame'+(++frame),signature:[frame*10],capturedAt:now,elements:[{type:'canvas',ref:'game'}]}),
  analyze:async f=>{analyzed.push(f);return {say:'画面'+frame};},deliver:async text=>sent.push(text),act:async a=>actions.push(a),...extra});
 const context={key:'private:1'};engine.start({url:'https://example.com/game',mode:'watch'},context);
 return {engine,sent,actions,analyzed,context,setBlocked:v=>{blocked=v;},setValid:v=>{authorized=v;},async tick(ms=9000){now+=ms;let job;while((job=jobs.shift())?.cancelled){}if(job)job.fn();await flush();await flush();},setFrame:v=>{frame=v;}};
}
test('latest-frame mailbox replaces pending history and never starts overlapping inference',async()=>{
 let finish;const received=[];const h=harness({analyze:frame=>{received.push(frame.data);return new Promise(resolve=>{finish=resolve;});}});
 await h.tick(1000);await h.tick();await h.tick();assert.deepEqual(received,['frame1']);assert.equal(h.engine.list()[0].dropped,1);
 finish({say:''});await flush();await h.tick();assert.deepEqual(received,['frame1','frame4']);h.engine.close();finish({say:''});await flush();
});
test('chat preempts pending inference and its result cannot send or act',async()=>{
 let finish,signal;const h=harness({analyze:(_f,_o,c)=>{signal=c.signal;return new Promise(resolve=>{finish=resolve;});}});
 await h.tick();h.setBlocked(true);await h.tick();assert.equal(signal.aborted,true);finish({say:'过期回复',action:{action:'press',key:'Space'}});await flush();assert.deepEqual(h.sent,[]);assert.deepEqual(h.actions,[]);assert.equal(h.engine.list()[0].priorityWait,true);h.engine.close();
});
test('pause, resume, stop and revoked context have explicit lifecycle boundaries',async()=>{
 const h=harness();await h.tick();assert.equal(h.sent.length,1);h.engine.control(h.context.key,'pause');await h.tick();assert.equal(h.sent.length,1);
 h.engine.control(h.context.key,'resume');await h.tick(30000);assert.equal(h.sent.length,2);h.setValid(false);await h.tick();assert.equal(h.engine.list()[0].status,'stopped');h.engine.close();
});

test('explicit resume clears the previous failure instead of advertising it as a current running error',async()=>{
 let broken=true;const h=harness({analyze:async()=>{if(broken)throw Error('反馈发送失败');return {say:'已恢复'};}});
 await h.tick();await h.tick();await h.tick();assert.equal(h.engine.list()[0].status,'error');assert.equal(h.engine.list()[0].error,'反馈发送失败');
 broken=false;h.engine.control(h.context.key,'resume');assert.equal(h.engine.list()[0].status,'running');assert.equal(h.engine.list()[0].error,'');await h.tick();assert.equal(h.sent.at(-1),'已恢复');h.engine.close();
});
test('game actions require explicit control and one subsequent observation per action',async()=>{
 assert.equal(visualGameAction({action:'press',key:'Space'},{},{mode:'watch',control:true}),null);
 assert.throws(()=>visualGameAction({action:'press',key:'Control+W'},{},{mode:'game',control:true}),/游戏只允许/);
 const h=harness({analyze:async()=>({say:'',action:{action:'press',key:'ArrowRight'}})});
 h.engine.start({url:'https://example.com/game',target:'browser',mode:'game',control:true},h.context);await h.tick();assert.equal(h.actions.length,1);await h.tick();assert.equal(h.actions.length,2);assert.equal(h.engine.list()[0].captures,2);h.engine.close();
});
test('three repeated failures stop background retry and ended video never invokes analysis',async()=>{
 const h=harness({capture:async()=>{throw Error('fixture failure');}});await h.tick();await h.tick();await h.tick();assert.equal(h.engine.list()[0].status,'error');h.engine.close();
 const ended=harness({capture:async()=>({ended:true})});await ended.tick();assert.equal(ended.engine.list()[0].status,'ended');assert.deepEqual(ended.sent,[]);ended.engine.close();
});
test('local budget reduces both image size and inference frequency',()=>{
 const local=visualSessionBudget(true),api=visualSessionBudget(false);assert(local.inferMs>api.inferMs);assert(local.sampleMs>api.sampleMs);assert(local.maxEdge<api.maxEdge);
});
test('explicit invitations start a session while ordinary links, negations and quoted examples do not',()=>{
 assert.equal(visualCompanionIntent('陪我看 https://example.com/video').action,'start');
 assert.equal(visualCompanionIntent('你来玩 https://example.com/game').control,true);
 for(const text of ['https://example.com/video','不要陪我看 https://example.com/video','比如陪我看 https://example.com/video','“陪我看 https://example.com/video”是什么意思'])assert.equal(visualCompanionIntent(text),null);
 assert.equal(visualCompanionIntent('停止陪看').action,'stop');assert.equal(visualCompanionIntent('暂停陪玩').action,'pause');
});
test('local companion sends inline image data through the actual local input normalizer',async()=>{
 let calls=0;const stops=[];
 const plugin=installVisualCompanion({ctx:{get:()=>null,effect:fn=>stops.push(fn())},browser:{act:async()=>({}),captureCompanion:async()=>({url:'https://example.com/',data:'aGVsbG8=',mediaType:'image/png',signature:[1],capturedAt:Date.now()}),stopCompanion:async()=>{}},cacheDir:'unused',valid:()=>true,busy:()=>false,local:()=>true,persona:()=> 'fixture',model:async(_system,input)=>{const result=localCompletionInput(input);assert.equal(result.supported,true);assert.equal(result.images,true);calls++;return '{"say":"","action":null}';},deliver:async()=>{},record:()=>{},panelContext:()=>({})});
 try{plugin.command({action:'start',url:'https://example.com/'},{key:'private:1'});await new Promise(r=>setTimeout(r,25));assert.equal(calls,1);}finally{plugin.close();}
});
test('static visuals still trigger understanding when a new audio window arrives',async()=>{
 let count=0;const h=harness({capture:async()=>({data:'same',signature:[1],audioChunk:{at:++count,data:'fixture'}})});
 await h.tick();await h.tick();assert.equal(h.analyzed.length,2);h.engine.close();
});
test('floating text input preempts background analysis and is answered against a fresh frame',async()=>{
 let finish,round=0;const seen=[];
 const h=harness({analyze:(frame,_options,c)=>{seen.push(frame.userInputs);if(++round===1)return new Promise(resolve=>{finish=resolve;});return Promise.resolve({say:'我看到你说的东西了'});}});
 await h.tick();const input=h.engine.submit(h.context.key,'你看左边那个');assert.equal(input.state,'queued');finish({say:'旧的后台回应'});await flush();
 await h.tick(1000);assert.equal(seen[1][0].text,'你看左边那个');assert.deepEqual(h.sent,['我看到你说的东西了']);assert.equal(h.engine.list()[0].messages.find(m=>m.id===input.id).state,'answered');h.engine.close();
});

test('automatic feedback is paced independently of observation and explicit questions bypass the cooldown',async()=>{
 const h=harness();await h.tick(1000);assert.equal(h.sent.length,1);
 await h.tick(9000);await h.tick(9000);assert.equal(h.analyzed.length,3);assert.equal(h.sent.length,1);
 assert.equal(h.analyzed.at(-1).speechAllowed,false);assert.equal(h.engine.list()[0].events.at(-1).said,false);
 h.engine.submit(h.context.key,'刚才画面里是什么？');await h.tick(1000);assert.equal(h.sent.length,2);assert.equal(h.analyzed.at(-1).speechAllowed,true);
 await h.tick(9000);assert.equal(h.sent.length,2);await h.tick(30000);assert.equal(h.sent.length,3);h.engine.close();
});
