import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selectIncomingBatch} from '../incoming-batch.js';
import {retainInbox} from '../inbox-recovery.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const start = source.indexOf('  function handlePayload(payload,');
const end = source.indexOf('  /** 重启时', start);
assert.ok(start >= 0 && end > start);

function host(previous = [], concurrency = 2) {
  const calls = [], timers = new Map(), running = new Set();
  const h = {
    featureState: {inbox: previous}, inboxRunning: running, inboxTimers: timers,
    inboxWaiting: new Set(), maxConcurrentInboxDrains: concurrency,
    settings: {activeAccountId: 'a', owners: [], memory: {enabled:false}, reliability:{}},
    lastSelfId:'99999', stopped: false, accountPaused: false, memoryHub: null,
    receiveQqFilePayload: p => p, sleepingPayload: () => false,
    incomingAllowed: () => true, prioritizeLocalQq() {}, extractIncoming: m => ({text:m[0].data.text}),
    localReplyDelay: () => 100, segmentsOf: m => m, selectIncomingBatch,
    setTimeout: fn => fn, clearTimeout() {}, queueMicrotask, Buffer, log() {},
    handlePayloadCore: async p => {calls.push(p);},
    saveFeatures() {
      h.featureState.inbox = retainInbox(h.featureState.inbox, () => true);
      h.saved = JSON.parse(JSON.stringify(h.featureState.inbox));
      return true;
    }
  };
  vm.createContext(h);
  vm.runInContext(source.slice(start, end), h);
  return {h, calls};
}

function payload(id, user = '12345', self = '99999') {
  return {post_type:'message', message_type:'private', self_id:self, user_id:user,
    message_id:String(id), message:[{type:'text',data:{text:'消息 '+id}}]};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the 201st ordinary message survives admission, duplicate frames and restart in source order', async () => {
  const {h} = host();
  for (let i = 1; i <= 201; i++) h.handlePayload(payload(i));
  h.handlePayload(payload(201));
  assert.equal(h.saved.length, 201);
  assert.equal(h.saved.at(-1).payload.message_id, '201');
  assert.equal(h.saved.at(-1).accountId, 'a');
  const restored = host(h.saved);
  restored.h.resumeQueuedInbox();
  await tick();
  const ids = restored.calls.flatMap(p => Array.from(p._bridgeReceivedIds));
  assert.deepEqual(ids, Array.from({length:201}, (_,i) => String(i+1)));
  assert.ok(restored.h.saved.every(j => j.status === 'admitted'));
  assert.ok(restored.h.saved.every(j => j.payload),'admission alone must not erase the input needed after an interrupted answer');
});

test('many ready conversations wait for capacity and are drained once each', async () => {
  const {h} = host();
  for (let i=0; i<9; i++) h.handlePayload(payload(i,String(12345+i)));
  const releases = [], completed = []; let active = 0, peak = 0;
  h.handlePayloadCore = async p => {
    peak = Math.max(peak,++active);
    await new Promise(resolve => releases.push(resolve));
    active--; completed.push(p.message_id);
  };
  for(const fn of [...h.inboxTimers.values()]) fn();
  for(let pass=0;pass<9;pass++) {
    for (const finish of releases.splice(0)) finish();
    await tick();
  }
  assert.ok(peak <= 2, 'concurrent conversations exceeded worker capacity: '+peak);
  assert.equal(new Set(completed).size,9);
  assert.equal(h.inboxRunning.size,0);
});

test('restart only claims matching account and QQ, including pre-scope pending rows', async () => {
  const {h} = host();
  h.handlePayload(payload('old'));
  h.handlePayload(payload('same'));
  const rows=h.saved; delete rows[0].accountId;
  h.settings.activeAccountId='b';
  h.handlePayload(payload('same'));
  const restarted=host([...rows,h.saved.at(-1)]);
  restarted.h.lastSelfId='88888';
  restarted.h.resumeQueuedInbox();await tick();
  assert.equal(restarted.calls.length,0);
  restarted.h.lastSelfId='99999';
  restarted.h.settings.activeAccountId='b';
  restarted.h.resumeQueuedInbox();await tick();
  assert.ok(restarted.calls.flatMap(p=>Array.from(p._bridgeReceivedIds)).includes('same'));
  assert.equal(restarted.h.saved.find(row=>row.accountId==='a').status,'queued');
  restarted.h.settings.activeAccountId='a';
  restarted.h.resumeQueuedInbox();await tick();
  assert.equal(restarted.h.saved.find(row=>row.accountId==='a').status,'admitted');
});

test('a second frame arriving during a drain retains its debounce within the same millisecond', async () => {
  const {h} = host();
  h.Date = {now:()=>123456};
  const calls = [];
  let release;
  h.handlePayloadCore = async p => {
    calls.push(p.message_id);
    if (calls.length===1) await new Promise(resolve=>{release=resolve;});
  };
  const key='private:12345';
  h.handlePayload(payload(1));h.inboxTimers.get(key)();
  h.handlePayload(payload(2));
  release();await tick();
  assert.deepEqual(calls,['1']);
  h.inboxTimers.get(key)();await tick();
  assert.deepEqual(calls,['1','2']);
});

test('a failed persistence attempt keeps the input queued until processing can be recorded', async () => {
  const {h,calls} = host();
  const key='private:12345', save=h.saveFeatures;
  h.handlePayload(payload(1));
  h.saveFeatures=()=>false;
  h.inboxTimers.get(key)();await tick();
  assert.equal(calls.length,0);
  assert.equal(h.featureState.inbox[0].status,'queued');
  h.saveFeatures=save;
  h.inboxTimers.get(key)();await tick();
  assert.equal(calls.length,1);
  assert.equal(h.saved[0].status,'admitted');
});
