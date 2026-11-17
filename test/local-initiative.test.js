import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalInitiative} from '../local-initiative.js';

function setup(){
 let clock=Date.parse('2026-11-05T10:00:00+08:00'),ctx={allowed:true,id:'scope-a',signature:'account-persona-a',day:'2026-11-05',key:'private:12345',accountId:'a',personaId:'p',clock:'10:00',lastIncoming:clock-2*3600000,persona:'说话自然，有自己的想法。',memory:'对方喜欢摄影。',history:[{role:'user',content:'我在调整逆光照片，晚点再聊。'},{role:'assistant',content:'好，你先弄。'}],recent:['好，你先弄。'],scene:{date:'2026-11-05',start:'09:00',activity:'整理角色画布',outfit:'白色衬衫'}};
 const states={},calls=[],deliveries=[],records=[];
 let respond=async()=>JSON.stringify({speak:true,text:'刚想到逆光那张，保留一点轮廓光应该挺好看的。',reason:'延续摄影话题'}),probe=async()=>({status:'ready',contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}});
 const options={context:()=>ctx,now:()=>clock,load:id=>states[id]||{},save:(id,v)=>states[id]={...v},record:r=>records.push(r),probe:signal=>probe(signal),infer:async args=>{calls.push(args);return respond(args);},deliver:async d=>{deliveries.push(d);return 'outbox-1';}};
 const engine=createLocalInitiative(options);
 return {engine,states,calls,deliveries,records,options,get ctx(){return ctx;},set ctx(v){ctx=v;},get clock(){return clock;},advance:ms=>{clock+=ms;},respond:fn=>respond=fn,probe:fn=>probe=fn};
}

test('idle initiative uses one local decision with persona, history and memory, and records the queued result',async()=>{
 const h=setup();assert.equal((await h.engine.tick()).status,'queued');assert.equal(h.calls.length,1);assert.equal(h.deliveries.length,1);
 assert.match(JSON.stringify(h.calls[0].messages),/逆光|摄影/);assert.match(JSON.stringify(h.calls[0].messages),/现在没有用户新消息/);assert.match(JSON.stringify(h.calls[0].messages),/只允许文字/);
 assert.equal(h.records.at(-1).result.deliveryId,'outbox-1');assert.equal(h.records.at(-1).backend,'local');assert.equal(h.states['scope-a'].count,1);
 h.advance(2*3600000);assert.equal((await h.engine.tick()).status,'quiet');assert.equal(h.calls.length,2);assert.equal(h.deliveries.length,1);
});

test('silence is a valid decision and is not repeatedly evaluated on each maintenance tick',async()=>{
 const h=setup();h.respond(async()=>'{"speak":false,"text":"","reason":"没有新话题"}');assert.equal((await h.engine.tick()).status,'quiet');
 for(let i=0;i<5;i++){h.advance(5*60000);await h.engine.tick();}assert.equal(h.calls.length,1);assert.equal(h.deliveries.length,0);assert.equal(h.states['scope-a'].count,0);
});

test('permissions, busy service, lack of history, hourly gap and daily cap do not run inference',async()=>{
 for(const scenario of ['disabled','history','busy','daily','gap']){
  const h=setup();if(scenario==='disabled')h.ctx={...h.ctx,allowed:false,reason:'免打扰'};
  if(scenario==='history')h.ctx={...h.ctx,lastIncoming:0};
  if(scenario==='busy')h.probe(async()=>({busy:true}));
  if(scenario==='daily')h.states['scope-a']={day:h.ctx.day,count:3};
  if(scenario==='gap'){h.states['scope-a']={day:h.ctx.day,count:1,lastSent:h.clock-30*60000};h.ctx={...h.ctx,lastIncoming:h.clock-20*60000};}
  assert.equal((await h.engine.tick()).status,'waiting',scenario);assert.equal(h.calls.length,0,scenario);
 }
});

test('schedule and clock changes alone are context; a real progress event can prompt a decision',async()=>{
 const h=setup();h.ctx={...h.ctx,lastIncoming:h.clock-25*60000};await h.engine.tick();assert.equal(h.calls.length,0);
 h.ctx={...h.ctx,scene:{...h.ctx.scene,now:'10:05'}};await h.engine.tick();assert.equal(h.calls.length,0);
 h.ctx={...h.ctx,scene:{...h.ctx.scene,start:'10:00',activity:'整理另一幅画布'}};assert.equal((await h.engine.tick()).status,'waiting');
 h.ctx={...h.ctx,event:{id:'actual-progress-1',kind:'progress',at:h.clock,summary:{activity:'完成画布第一稿'}}};assert.equal((await h.engine.tick()).status,'queued');
 assert.equal(h.records[0].arguments.trigger,'progress');assert.match(h.calls[0].messages.at(-1).content,/新的活动线索或实际进展/);
});

test('incoming QQ cancellation interrupts a pending initiative and suppresses even a late model result',async()=>{
 const h=setup();let started,finish;const ready=new Promise(r=>started=r);h.respond(async({signal})=>{started();return new Promise(r=>finish=()=>r('{"speak":true,"text":"迟到的主动发言"}'));});
 const task=h.engine.tick();await ready;h.engine.cancel();assert.equal(h.calls[0].signal.aborted,true);finish();assert.equal((await task).status,'cancelled');assert.equal(h.deliveries.length,0);assert.equal(h.records.at(-1).status,'cancelled');
});

test('switching account, persona or permission during a probe or inference prevents stale delivery',async()=>{
 for(const stage of ['probe','infer']){
  const h=setup();if(stage==='probe')h.probe(async()=>{h.ctx={...h.ctx,signature:'other-persona'};return {status:'ready'};});
  else h.respond(async()=>{h.ctx={...h.ctx,allowed:false};return '{"speak":true,"text":"不该发出的旧消息"}';});
  assert.equal((await h.engine.tick()).status,'cancelled');assert.equal(h.deliveries.length,0);
 }
});

test('malformed output, repeated catchphrases and unavailable local features do not send or fall back',async()=>{
 for(const scenario of ['malformed','repeat','unsupported']){
  const h=setup();if(scenario==='malformed')h.respond(async()=> '你好呀');
  if(scenario==='repeat')h.respond(async()=>'{"speak":true,"text":"好，你先弄。"}');
  if(scenario==='unsupported')h.probe(async()=>({features:{text:{supported:true},json:{supported:false}}}));
  const r=await h.engine.tick();assert.ok(['failed','quiet','waiting'].includes(r.status));assert.equal(h.deliveries.length,0);
 }
});

test('restart and day rollover retain no-repeat and gap state while resetting the daily count',async()=>{
 const h=setup();await h.engine.tick();const restarted=createLocalInitiative(h.options);h.advance(2*3600000);assert.equal((await restarted.tick()).status,'quiet');assert.equal(h.deliveries.length,1);
 h.ctx={...h.ctx,day:'2026-11-06',lastIncoming:h.clock-70*60000};h.states['scope-a'].count=3;h.advance(24*3600000);h.ctx={...h.ctx,lastIncoming:h.clock-70*60000};
 h.respond(async()=>JSON.stringify({speak:true,text:'今天想换个方向试试雨天街拍'}));assert.equal((await restarted.tick()).status,'queued');assert.equal(h.states['scope-a'].count,1);
});

test('malformed initiative gets one bounded format repair and preserves silence',async()=>{
 const h=setup();let calls=0;
 h.respond(async()=>++calls===1?'这不是 JSON':'{"speak":false,"text":"","reason":"没有明确新话题"}');
 assert.equal((await h.engine.tick()).status,'quiet');assert.equal(calls,2);assert.equal(h.deliveries.length,0);
});

test('QQ arrival during format repair cancels rather than sending late output',async()=>{
 const h=setup();let calls=0;
 h.respond(async()=>{if(++calls===1)return '格式错误';h.engine.cancel();return '{"speak":true,"text":"不应发送"}';});
 assert.equal((await h.engine.tick()).status,'cancelled');assert.equal(h.deliveries.length,0);
});
