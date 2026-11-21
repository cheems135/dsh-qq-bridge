import test from 'node:test';
import {conversationTimingHint} from '../conversation-timing.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSleepAwareness} from '../sleep-awareness.js';
import {createLifeExecution} from '../life-execution.js';
import {localSharedContext} from '../local-chat-context.js';

const meta = {accountId: 'account-a', personaId: 'persona-a'};
function fixture() {
  let time = Date.parse('2026-11-16T22:00:00+08:00'), stored;
  const storage = {read: () => structuredClone(stored), write: value => { stored = structuredClone(value); }};
  return {now: () => time, advance: ms => { time += ms; }, open: () => createSleepAwareness({storage, now: () => time})};
}
const online = {connected: true};
const sleep = {connected: true, sleeping: true, scene: {activity: '睡觉'}};

test('first install does not invent any prior sleep or unavailable duration', () => {
  const f=fixture(), tracker=f.open();
  assert.equal(tracker.snapshot(meta).mode,'unknown');
  tracker.observe(meta,online);
  assert.equal(tracker.snapshot(meta).lastRest,null);
  assert.equal(tracker.hint(meta),'');
});

test('actual scheduled sleep survives heartbeats and wakes once with real duration', () => {
  const f=fixture(),tracker=f.open();tracker.observe(meta,sleep);
  f.advance(6*3600000);tracker.observe(meta,sleep);
  f.advance(3600000);tracker.observe(meta,{...online,wakeReason:'号主叫醒'});
  const value=tracker.snapshot(meta);
  assert.equal(value.mode,'awake');assert.equal(value.lastRest.kind,'scheduled_sleep');
  assert.equal(value.lastRest.durationMs,7*3600000);assert.equal(value.lastRest.endedBy,'号主叫醒');
  tracker.observe(meta,online);assert.equal(tracker.snapshot(meta).history.length,1);
  assert.match(tracker.hint(meta),/主动睡眠.*420分钟/);
});

test('normal shutdown is passive, its timestamp persists through repeated startup observations', () => {
  const f=fixture();let tracker=f.open();tracker.observe(meta,online);f.advance(60000);tracker.close();
  f.advance(8*3600000);tracker=f.open();tracker.observe(meta,{connected:false});f.advance(30000);tracker.observe(meta,online);
  const rest=tracker.snapshot(meta).lastRest;
  assert.equal(rest.kind,'passive_offline');assert.equal(rest.reason,'runtime_closed');
  assert.equal(rest.durationMs,8*3600000+30000);assert.equal(rest.estimatedStart,false);
  assert.match(tracker.hint(meta),/插件或宿主退出/);
});

test('hard kill recovers from durable heartbeat and explicitly marks start as estimated', () => {
  const f=fixture();let tracker=f.open();tracker.observe(meta,online);f.advance(15000);tracker.observe(meta,online);
  f.advance(3*3600000);tracker=f.open();tracker.observe(meta,online);
  const rest=tracker.snapshot(meta).lastRest;
  assert.equal(rest.reason,'runtime_restart');assert.equal(rest.estimatedStart,true);assert.equal(rest.durationMs,3*3600000);
  assert.match(tracker.hint(meta),/被动离线 约/);assert.doesNotMatch(tracker.hint(meta),/主动睡眠/);
});

test('shutdown during sleep preserves two intervals instead of labelling the whole night voluntary', () => {
  const f=fixture();let tracker=f.open();tracker.observe(meta,sleep);f.advance(3600000);tracker.close();
  f.advance(7*3600000);tracker=f.open();tracker.observe(meta,online);
  const value=tracker.snapshot(meta);
  assert.deepEqual(value.history.map(e=>[e.kind,e.durationMs]),[['scheduled_sleep',3600000],['passive_offline',7*3600000]]);
  assert.equal(value.lastRest.precededBySleep,true);assert.match(tracker.hint(meta),/此前确实处于日程睡眠/);
});

test('hard kill while asleep stops observed rest at heartbeat, never at next boot', () => {
  const f=fixture();let tracker=f.open();tracker.observe(meta,sleep);f.advance(30000);tracker.observe(meta,sleep);
  f.advance(3600000);tracker=f.open();tracker.observe(meta,sleep);
  const value=tracker.snapshot(meta);
  assert.equal(value.mode,'scheduled_sleep');assert.equal(value.history[0].durationMs,30000);
  assert.equal(value.history[0].estimatedEnd,true);assert.equal(value.lastRest.kind,'passive_offline');
  assert.equal(value.current.startedAt,f.now());
  f.advance(60000);tracker.observe(meta,online);
  assert.match(tracker.hint(meta),/被动离线.*主动睡眠/s);
});

test('a connection interruption and a later app stop preserve the first disconnect time', () => {
  const f=fixture();let tracker=f.open();tracker.observe(meta,online);f.advance(10000);tracker.observe(meta,{connected:false});
  f.advance(60000);tracker.close();f.advance(60000);tracker=f.open();tracker.observe(meta,online);
  const rest=tracker.snapshot(meta).lastRest;
  assert.equal(rest.reason,'disconnected');assert.equal(rest.runtimeStopped,true);assert.equal(rest.durationMs,120000);
});

test('different contacts share one persona state, different accounts and personae do not', () => {
  const f=fixture(),tracker=f.open();tracker.observe({...meta,key:'private:1'},sleep);
  assert.equal(tracker.snapshot({...meta,key:'group:2'}).mode,'scheduled_sleep');
  assert.equal(tracker.snapshot({...meta,accountId:'b'}).mode,'unknown');
  assert.equal(tracker.snapshot({...meta,personaId:'b'}).mode,'unknown');
  tracker.reconcile([{...meta,accountId:'b'}]);assert.equal(tracker.snapshot(meta).current.reason,'inactive');
});

test('recent facts expire from ordinary prompts but remain retrievable on sleep questions', () => {
  const f=fixture(),tracker=f.open();tracker.observe(meta,sleep);f.advance(60000);tracker.observe(meta,online);
  f.advance(31*60000);assert.equal(tracker.hint(meta),'');assert.match(tracker.hint(meta,{question:'你之前睡了多久？'}),/主动睡眠/);
  f.advance(8*86400000);tracker.observe(meta,online);assert.equal(tracker.snapshot(meta).history.length,0);assert.equal(tracker.hint(meta,{question:'你之前睡了多久？'}),'');
});

test('real sleep executor wake and rest callbacks update awareness immediately', async () => {
  const f=fixture(),tracker=f.open();let engine;
  const role={meta},scene={date:'2026-11-16',start:'22:00',end:'24:00',taskKind:'sleep',activity:'睡觉',planned:true};
  const observe=()=>{const status=engine.snapshot(meta);tracker.observe(meta,{connected:true,sleeping:status.sleeping,scene:status.scene,wakeReason:status.wake?.reason});};
  engine=createLifeExecution({storage:{read:()=>undefined,write:()=>{}},now:f.now,config:()=>({enabled:true,sleep:true}),roles:()=>[role],sceneFor:()=>scene,allowed:()=>true,dispatch:()=>{throw Error('must not call a model');},onStateChange:observe});
  await engine.syncState(meta);f.advance(10000);engine.wake(meta,{reason:'叫醒'});
  assert.equal(tracker.snapshot(meta).mode,'awake');assert.equal(tracker.snapshot(meta).lastRest.durationMs,10000);
  engine.rest(meta);assert.equal(tracker.snapshot(meta).mode,'scheduled_sleep');
  await engine.tick();assert.equal(tracker.snapshot(meta).history.length,1);
  await engine.close();
});

test('the common conversation enrichment reaches API, local and both chat scopes', () => {
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const start=source.indexOf('  function enrichConversation('),end=source.indexOf('    try{const files=qqFileTransfer',start);
  const head=source.slice(start,end)+'\n}';
  const f=fixture(),tracker=f.open();tracker.observe(meta,sleep);f.advance(60000);tracker.observe(meta,online);
  const enrich=Function('sleepAwarenessHint','conversationTimingHint','return ('+head+');')((_key,question)=>tracker.hint(meta,{question}),conversationTimingHint);
  for(const kind of ['private','group']){
    const parts=[];enrich({key:kind+':1'}, {}, parts,'醒了吗',true);
    assert.equal(parts.length,1);assert.match(parts[0].text,/主动睡眠/);
    const packed=localSharedContext(parts,{maxChars:100});assert.equal(packed.messages[0].content,parts[0].text);
    assert.ok(parts[0].text.length<450);assert.match(parts[0].text,/不要求汇报/);
    const waking=[];enrich({key:kind+':1'}, {_bridgeMemoryUserText:'刚刚睡醒呢'}, waking,'刚刚睡醒呢',true);
    assert.match(waking.find(part=>part._bridgeContext==='conversationTiming').text,/对方说自己刚醒/);
    assert.match(waking.find(part=>part._bridgeContext==='sleepAwareness').text,/角色当前/);
    assert.equal(localSharedContext(waking,{maxChars:100}).messages.length,2);
  }
});
