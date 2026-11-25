import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {markInterruptedInbox, reconcileUncertainInbox, repairPrivateReviewAdmission,settleInterruptedAdmissions} from '../inbox-recovery.js';
import {bindQueuedSenders} from '../delivery-outbox.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const recoverySource = source.match(/^  function recoverUncertainInbox\(\) \{[\s\S]*?^  \}/m)[0];
const now = Date.now();
const key = 'private:12345';

test('private unread reviews are not treated as group authorization; only the latest pre-model rejection is retried',()=>{
 const make=()=>({key,accountId:'a',status:'failed',error:'当前联系人不再允许访问',payload:{self_id:'99999',message_type:'private',_sleepReview:true,_groupAttentionApproved:true,_bridgeReceivedIds:['one','two']}});
 const rows=[make(),make(),{...make(),error:'submitted timeout'}];
 assert.equal(repairPrivateReviewAdmission(rows,{activeAccountId:'a',selfId:'99999'}),1);
 assert.equal(rows[0].status,'cancelled');assert.equal(rows[1].status,'queued');assert.equal(rows[1].payload._groupAttentionApproved,undefined);assert.equal(rows[2].status,'failed');
 assert.equal(repairPrivateReviewAdmission(rows,{activeAccountId:'a',selfId:'99999'}),0);
 const start=source.indexOf('  function incomingAllowed('),end=source.indexOf('\n  /** Volatile group transcript',start);
 const fn=Function('lifeExecution','calendarMeta','activePersona','effectiveGroups','effectiveUsers',source.slice(start,end)+';return incomingAllowed;')({asleep:()=>false},()=>({}),()=>({id:'p'}),()=>[],()=>['12345']);
 assert.equal(fn({user_id:'12345',self_id:'99999',message_type:'private',_groupAttentionApproved:true}),true);
 assert.equal(fn({user_id:'12346',self_id:'99999',message_type:'private',_groupAttentionApproved:true}),false);
});
function uncertain(id, overrides = {}) {
  return {id, key, status: 'uncertain', at: now, payload: {message_id: id}, ...overrides};
}

function runRecovery(inbox, {audits = [], outbox = [], messages = []} = {}) {
  const snapshots = [];
  const deps = {
    featureState: {inbox, audits, outbox}, messages, reconcileUncertainInbox,
    repairPrivateReviewAdmission, settings: {activeAccountId: 'profile'}, lastSelfId: 'self',
    saveFeatures: () => snapshots.push(structuredClone(inbox)),
    log: () => {}
  };
  Function(...Object.keys(deps), recoverySource + '\nrecoverUncertainInbox();')(...Object.values(deps));
  return snapshots;
}

test('restart persists an expired or payload-less inbox even with no other recovery work', () => {
  const inbox = [
    uncertain('expired', {at: now - 86400001, error: 'previous error'}),
    uncertain('missing', {payload: undefined}),
    uncertain('missing-with-reason', {payload: null, error: 'original reason'}),
    uncertain('stale', {at: now - 86400001})
  ];
  const snapshots = runRecovery(inbox);
  assert.equal(snapshots.length, 1);
  assert.ok(snapshots[0].every(row => row.status === 'failed'));
  assert.equal(snapshots[0][0].error, 'previous error');
  assert.equal(snapshots[0][1].error, '缺少原始消息，未自动重试');
  assert.equal(snapshots[0][2].error, 'original reason');
  assert.equal(snapshots[0][3].error, '恢复窗口已过，未自动重试');
  assert.equal(runRecovery(inbox).length, 0);
});

test('startup marks interrupted processing and preserves other states, payloads and old fields', () => {
  const processing = uncertain('p', {status: 'processing', legacyField: 'keep'});
  const originalPayload = processing.payload;
  const queued = uncertain('q', {status: 'queued'});
  const existing = uncertain('u', {error: 'previous error'});
  markInterruptedInbox([processing, queued, existing]);
  assert.equal(processing.status, 'uncertain');
  assert.match(processing.error, /重启前/);
  assert.equal(processing.legacyField, 'keep');
  assert.equal(processing.payload, originalPayload);
  assert.equal(queued.status, 'queued');
  assert.equal(existing.error, 'previous error');
});

test('restart keeps the original evidence checks for possible replies and paid cover submissions', () => {
  const cover = uncertain('song', {receivedIds: ['song', '32']});
  const withOutbox = uncertain('dispatch', {key: 'group:17'});
  const withReply = uncertain('reply', {key: 'private:18'});
  const retryable = uncertain('retryable', {key: 'private:19', at: now - 86400000});
  const inbox = [cover, withOutbox, withReply, retryable];
  const result = reconcileUncertainInbox(inbox, {
    audits: [
      {chat: key, at: now, mediaIntent: {cover: true}, singingAttempted: true, inboundIds: [32]},
      {chat: retryable.key, at: now, mediaIntent: {cover: true}, singingAttempted: true, inboundIds: ['other']}
    ],
    outbox: [{chat: withOutbox.key, at: now}, {chat: retryable.key, at: retryable.at - 1}],
    messages: [{chat: withReply.key, time: now, dir: 'out'}, {chat: retryable.key, time: now, dir: 'in'}],
    now
  });
  assert.deepEqual(result, {retried: 1, blocked: 3, unavailable: 0, admitted: 0});
  for (const job of [cover, withOutbox, withReply]) {
    assert.equal(job.status, 'failed');
    assert.match(job.error, /确认后重试/);
  }
  assert.equal(retryable.status, 'queued');
  assert.equal(retryable.error, '');
});

test('restart never substitutes B’s delivery, an initiative or a foreign account for A', () => {
  const a = uncertain('A', {accountId: 'first'});
  const bAudit = {id:'ab', chat:key, accountId:'first', at:now, inboundIds:['B'], status:'completed'};
  const outbox = [
    {id:'for-b', chat:key, at:now, accountId:'first', status:'sent', auditId:bAudit.id},
    {id:'direct-b', chat:key, at:now, accountId:'first', status:'sent', replyToInboundIds:['B']},
    {id:'foreign-a', chat:key, at:now, accountId:'other', status:'queued', replyToInboundIds:['A']},
    {id:'initiative', chat:key, at:now, accountId:'first', status:'sent', initiative:true}
  ];
  const messages = [
    ...outbox.map(row=>({dir:'out', chat:key, time:now, accountId:row.accountId, localId:row.id, delivery:'sent'})),
    {dir:'out', chat:key, time:now, accountId:'first', automaticPrivate:true, delivery:'sent'}
  ];
  const result = reconcileUncertainInbox([a], {audits:[bAudit], outbox, messages, now});
  assert.equal(result.retried, 1);
  assert.equal(a.status, 'queued');
});

test('one persisted audited batch or explicit silent decision completes each matching inbox row', () => {
  const batch = [uncertain('1'), uncertain(2), uncertain('quiet')];
  const audits = [
    {id:'batch', chat:key, at:now, inboundIds:[1,'2'], status:'completed'},
    {id:'silent', chat:key, at:now, inboundIds:['quiet'], status:'silent', deliveryState:'silent'}
  ];
  const result = reconcileUncertainInbox(batch, {audits, outbox:[], messages:[
    {dir:'out', chat:key, time:now, auditId:'batch', delivery:'sent'}
  ], now});
  assert.equal(result.admitted, 3);
  assert.ok(batch.every(row=>row.status==='admitted' && !row.payload));
});

test('restart distinguishes persisted pre-submission, in-flight work and ambiguous legacy evidence', () => {
  const jobs=['fresh','submitted','media','legacy','dangling','sent'].map(id=>uncertain(id,{key:'private:'+id}));
  const audits=jobs.slice(0,4).map(row=>({id:'audit'+row.id, chat:row.key, at:now, status:'queued', inboundIds:[row.id]}));
  audits[0].submissionStartedAt=0;
  audits[1].submissionStartedAt=now;
  audits[2].submissionStartedAt=0;
  const result=reconcileUncertainInbox(jobs,{
    audits, mediaTasks:[{id:'image',chat:jobs[2].key,at:now,auditId:audits[2].id,status:'waiting_service'}],
    outbox:[{chat:jobs[4].key,at:now,auditId:'expired-audit',status:'sending'},
      {chat:jobs[5].key,at:now,replyToInboundIds:['sent'],status:'queued'}],
    messages:[], now
  });
  assert.deepEqual(jobs.map(j=>j.status),['queued','failed','failed','failed','failed','admitted']);
  assert.deepEqual(result,{retried:1,blocked:4,unavailable:0,admitted:1});
});

test('recovery skips other logins and resolves older inbox scope from the matching QQ login', () => {
  const same=uncertain('A',{payload:{self_id:'1000',message_id:'A'}}), other=uncertain('A',{accountId:'second'});
  const foreignSelf=uncertain('A',{payload:{self_id:'2000',message_id:'A'}});
  const result=reconcileUncertainInbox([other,foreignSelf,same],{
    activeAccountId:'first',selfId:'1000',outbox:[{chat:key,at:now,status:'sent',accountId:'second',replyToInboundIds:['A']}],
    messages:[],now
  });
  assert.deepEqual([other.status,foreignSelf.status,same.status],['uncertain','uncertain','queued']);
  assert.equal(result.retried,1);
});

test('a composite inbox payload requires evidence for every original before being discarded', () => {
  const grouped=()=>uncertain('wake-summary',{receivedIds:['10','11'],payload:{message_id:'wake-summary',_bridgeReceivedIds:[10,11]}});
  const partial=grouped(),complete=grouped();
  const replies=['10','11'].map(id=>({chat:key,at:now,status:'queued',replyToInboundIds:[id]}));
  reconcileUncertainInbox([partial],{outbox:replies.slice(0,1),now});
  assert.equal(partial.status,'failed');
  assert.ok(partial.payload);
  reconcileUncertainInbox([complete],{outbox:replies,now});
  assert.equal(complete.status,'admitted');
  assert.ok(!complete.payload);
});

test('progress notices never settle the user reply or block a known pre-submission retry', () => {
  const job=uncertain('A');
  const audit={id:'a',chat:key,at:now,inboundIds:['A'],status:'queued',submissionStartedAt:0,deliveryState:'sent',outboxIds:['wait']};
  const outbox=[{id:'wait',chat:key,at:now,status:'sent',auditId:audit.id,deliveryKey:'local:a:wait:line:0'},
    {chat:key,at:now,status:'sent',deliveryKey:'local:queue:abc'}];
  const messages=[{dir:'out',localId:'wait',chat:key,time:now,delivery:'sent'},
    {dir:'out',chat:key,time:now,replyToInboundIds:['A'],deliveryRole:'progress',delivery:'sent'}];
  reconcileUncertainInbox([job],{audits:[audit],outbox,messages,now});
  assert.equal(job.status,'queued');
});

test('the host retry route requires explicit confirmation once the restart found an uncertain side effect',async()=>{
  const job=uncertain('A',{accountId:'profile',payload:{message_id:'A',self_id:'self'}});
  runRecovery([job],{outbox:[{chat:key,at:now,status:'unknown',accountId:'profile'}]});
  const scopeSource=source.match(/^  function inboxRowForAccount\([\s\S]*?^  \}/m)[0];
  const routeSource=source.match(/^  async function featureAction\([\s\S]*?^  \}/m)[0];
  let saved=0,drained=0;
  const deps={featureState:{inbox:[job]},settings:{activeAccountId:'profile'},lastSelfId:'self',
    isDesktop:true,settleInterruptedAdmissions,conversationScope:()=> 'same-scope',saveFeatures:()=>{saved++;},drainInbox:()=>{drained++;}};
  const action=Function(...Object.keys(deps),scopeSource+'\n'+routeSource+'\nreturn featureAction;')(...Object.values(deps));
  await assert.rejects(action('inbox-retry',{id:job.id}),/先核对/);
  assert.equal(job.status,'failed');assert.equal(saved,0);assert.equal(drained,0);
  assert.deepEqual(await action('inbox-retry',{id:job.id,confirmUncertain:true}),{ok:true});
  assert.equal(job.status,'queued');assert.equal(saved,1);assert.equal(drained,1);
});

test('unknown login preserves a legacy inbox until its actual recipient can be matched',()=>{
  const job=uncertain('10000:'+key+':99',{payload:{self_id:10000,message_id:99}});
  const old=uncertain('legacy-unscoped');
  const options={activeAccountId:'profile',outbox:[{chat:key,at:now,status:'sent',accountId:'profile',replyToInboundIds:['99']}],now};
  reconcileUncertainInbox([job,old],{...options,selfId:''});
  assert.deepEqual([job.status,old.status],['uncertain','uncertain']);
  reconcileUncertainInbox([job,old],{...options,selfId:'20000'});
  assert.deepEqual([job.status,old.status],['uncertain','uncertain']);
  reconcileUncertainInbox([job,old],{...options,selfId:'10000'});
  assert.deepEqual([job.status,old.status],['admitted','uncertain']);
});

test('a OneBot login reply or first event starts recovery once for the current socket and receiver',async()=>{
  const body=source.match(/^  function connectSocket\(\) \{[\s\S]*?^  \}/m)[0];
  const sockets=[],requests=[],effects=[],heartbeats=[];
  const deps={deviceSync:null, cfg:{wsUrl:'ws://fixture'}, settings:{activeAccountId:'profile'},qzoneSessionManager:null,
    featureState:{outbox:[]},bindQueuedSenders,saveFeatures:()=>true,
    setTimeout:()=>({unref(){}}),setInterval:fn=>heartbeats.push(fn),clearTimeout(){},clearInterval(){},pendingCalls:new Map(),
    log(){},armDeliveryVerification(){},flushOutbox(){},observeRecipientReply(){},handlePayload(){},
    captureQQRuntime(){},
    request(name){return name==='get_status'?Promise.resolve({}):new Promise((resolve,reject)=>requests.push({resolve,reject}));},
    record:(phase,who)=>effects.push([phase,who]),
    MiniWebSocket:class {constructor(url,options){Object.assign(this,options);sockets.push(this);}open(){this.ready=true;this.onOpen();}close(){this.ready=false;this.closed=true;}}};
  const connect=Function(...Object.keys(deps),`
    let socket,lastSelfId='',stopped=false,accountPaused=false,reconnectTimer,heartbeat,qzoneWarmTimer,qzoneConnectionRevision=0,lastDisconnectAt,reconnectDelay;
    const recoverUncertainInbox=()=>record('recover',lastSelfId),resumeQueuedInbox=()=>record('drain',lastSelfId),catchUpMissedMessages=async()=>record('history',lastSelfId);
    `+body+';return connectSocket;')(...Object.values(deps));
  const tick=()=>new Promise(resolve=>setImmediate(resolve));
  const event=(i,id)=>sockets[i].onMessage(JSON.stringify({post_type:'meta_event',self_id:id}));
  connect();requests[0].reject(new Error('login timeout'));await tick();
  assert.deepEqual(effects,[]);
  heartbeats[0]();heartbeats[0]();assert.equal(requests.length,2);
  requests[1].resolve({user_id:10000});await tick();event(0,10000);await tick();
  assert.deepEqual(effects,[['recover','10000'],['drain','10000'],['history','10000']]);
  sockets[0].close();connect();event(1,20000);requests[2].resolve({user_id:10000});await tick();
  event(0,30000);event(1,20000);await tick();
  assert.deepEqual(effects.slice(3),[['recover','20000'],['drain','20000'],['history','20000']]);
  sockets[1].close();connect();sockets[2].close();connect();requests[3].resolve({user_id:30000});requests[4].resolve({user_id:40000});await tick();
  event(3,40000);await tick();
  assert.deepEqual(effects.slice(6),[['recover','40000'],['drain','40000'],['history','40000']]);
});
