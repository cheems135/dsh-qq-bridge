import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

import {segmentsOf} from '../bridge-features.js';
import {verifyDelivery} from '../delivery-verification.js';
import {createQqForwardReader} from '../qq-forward-reader.js';

const INDEX_PATH = fileURLToPath(new URL('../index.js', import.meta.url));
const indexSource = readFileSync(INDEX_PATH, 'utf8');

// Compile successively complete function candidates with JavaScript's parser.
// The function body is not executed during extraction; no external parser is needed.
function functionFromIndex(name, dependencies = {}) {
  const start = indexSource.search(new RegExp('^  (?:async )?function '+name+'\\(', 'm'));
  assert.ok(start >= 0, `could not find ${name} in index.js`);
  const names = Object.keys(dependencies);
  for (let end=indexSource.indexOf('}',start);end>=0;end=indexSource.indexOf('}',end+1)) {
    const source=indexSource.slice(start,end+1);
    let factory;
    try {factory=Function(...names, `'use strict'; return (${source});`);} catch(error) {if(error instanceof SyntaxError)continue;throw error;}
    return factory(...Object.values(dependencies));
  }
  throw Error('No complete function found: '+name);
}

const PNG_BASE64 = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8hZJwAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwAFhQJ/4p7fWQAAAABJRU5ErkJggg==',
];

function imageSegment(index) {
  return {type: 'image', data: {file: `base64://${PNG_BASE64[index]}`}};
}

function historyMessages() {
  return [
    {
      message_id: '41001',
      sender: {user_id: '20001'},
      message: [
        {type: 'text', data: {text: 'two images in the first row'}},
        imageSegment(0),
        imageSegment(1),
      ],
    },
    {
      message_id: '41002',
      sender: {user_id: '20002'},
      message: [{type: 'image', data: {file: 'base64://AAAA'}}],
    },
  ];
}

function makeForwardReader(request, reads) {
  return createQqForwardReader({
    request,
    readImage: async (data, scope) => {
      reads.push({data, scope});
      if (data?.fail === true) return null;
      const encoded = String(data?.file || '').replace(/^base64:\/\//, '');
      const bytes = Buffer.from(encoded, 'base64');
      if (!bytes.length) return null;
      return {
        type: 'image',
        data: bytes.toString('base64'),
        mediaType: 'image/png',
        name: 'synthetic-history-image',
      };
    },
  });
}

function makeHistoryHarness({
  allowed,
  chat,
  state = {accountId: 'account-a', personaId: 'persona-a', personaVersion: 'v1'},
  response,
  settings = {owners: []},
  reads = [],
}) {
  const requestCalls = [];
  let uuidSequence = 0;
  const request = async (...args) => {
    requestCalls.push(args);
    return response(...args);
  };
  const forwardReader = makeForwardReader(request, reads);
  const qqReadScope = key => ({
    accountId: state.accountId,
    personaId: state.personaId,
    personaVersion: state.personaVersion,
    key,
  });
  const readQqHistory = functionFromIndex('readQqHistory', {
    request,
    recordsAllowed: key => allowed.has(key),
    groupStopped: () => false,
    randomUUID: () => `history-${++uuidSequence}`,
    qqForwardReader: forwardReader,
    segmentsOf,
    qqReadScope,
    settings,
  });
  return {
    forwardReader,
    qqReadScope,
    readQqHistory,
    requestCalls,
    reads,
    state,
  };
}

test('group history reads two real image parts by default and exposes remaining media', async () => {
  const chatKey = 'group:12345678';
  const harness = makeHistoryHarness({
    allowed: new Set([chatKey]),
    chat: {key: chatKey, kind: 'group', chatId: '12345678'},
    response: async () => ({messages: historyMessages()}),
  });
  const chat = {key: chatKey, kind: 'group', chatId: '12345678'};
  const scope = harness.qqReadScope(chatKey);

  const result = await harness.readQqHistory(chat, {action: 'history'}, scope);

  assert.deepEqual(harness.requestCalls, [[
    'get_group_msg_history',
    {group_id: '12345678', count: 20},
    12000,
  ]]);
  assert.equal(result.sourceChat, chatKey);
  assert.equal(result.parts.length, 2);
  assert.equal(result.mediaRead, 2);
  assert.equal(result.mediaFailed, 0);
  assert.equal(result.parts[0].data, PNG_BASE64[0]);
  assert.equal(result.parts[1].data, PNG_BASE64[1]);
  assert.deepEqual(
    result.records.flatMap(row => row.media.map(media => `${row.index}:${media.index}`)),
    ['0:1', '0:2', '1:0'],
  );

  const remaining = await harness.forwardReader.read(scope, result.historyId, {
    offset: 0,
    limit: 20,
    media: ['1:0'],
  });
  assert.equal(remaining.ok, true);
  assert.equal(remaining.parts.length, 1);
  assert.equal(remaining.parts[0].data, Buffer.from('AAAA', 'base64').toString('base64'));
  assert.equal(remaining.mediaRead, 1);
  assert.equal(remaining.mediaFailed, 0);
  assert.equal(harness.reads[2].data.file, 'base64://AAAA');
});

test('a failed selected image is marked as not understood rather than silently omitted', async () => {
  const scope = {
    accountId: 'account-a',
    personaId: 'persona-a',
    personaVersion: 'v1',
    key: 'group:12345678',
  };
  const requestCalls = [];
  const reads = [];
  const reader = makeForwardReader(async (...args) => {
    requestCalls.push(args);
    return {messages: []};
  }, reads);
  const historyId = reader.remember(scope, 'failed-image-history', {}, [{
    message_id: '52001',
    sender: {user_id: '20001'},
    message: [{type: 'image', data: {file: 'base64://AAAA', fail: true}}],
  }]);

  const result = await reader.read(scope, historyId, {media: ['0:0']});

  assert.equal(result.ok, false);
  assert.equal(result.parts.length, 0);
  assert.equal(result.mediaFailed, 1);
  assert.equal(result.partial, true);
  assert.equal(result.records[0].mediaResults[0].status, 'failed');
  assert.match(result.coverage, /没有看懂/);
  assert.deepEqual(requestCalls, []);
  assert.equal(reads.length, 1);
});

test('group cross-read is rejected even when the other group is allowlisted', async () => {
  const ownGroup = 'group:12345678';
  const otherGroup = 'group:87654321';
  const harness = makeHistoryHarness({
    allowed: new Set([ownGroup, otherGroup]),
    chat: {key: ownGroup, kind: 'group', chatId: '12345678'},
    response: async () => ({messages: historyMessages()}),
  });

  await assert.rejects(
    harness.readQqHistory(
      {key: ownGroup, kind: 'group', chatId: '12345678'},
      {action: 'history', target: otherGroup},
      harness.qqReadScope(ownGroup),
    ),
    /群聊不能读取其他会话/,
  );
  assert.deepEqual(harness.requestCalls, []);
});

test('private owner can cross-read only an allowlisted private target', async () => {
  const ownerKey = 'private:11111111';
  const allowedTarget = 'private:22222222';
  const blockedTarget = 'private:33333333';
  const chat = {
    key: ownerKey,
    kind: 'private',
    chatId: '11111111',
    userId: '11111111',
    isOwner: true,
  };
  const harness = makeHistoryHarness({
    allowed: new Set([ownerKey, allowedTarget]),
    chat,
    response: async () => ({messages: historyMessages()}),
    settings: {owners: ['11111111']},
  });

  const result = await harness.readQqHistory(
    chat,
    {action: 'history', target: allowedTarget},
    harness.qqReadScope(ownerKey),
  );
  assert.equal(result.sourceChat, allowedTarget);
  assert.equal(harness.requestCalls[0][0], 'get_friend_msg_history');
  assert.equal(harness.requestCalls[0][1].user_id, '22222222');

  await assert.rejects(
    harness.readQqHistory(
      chat,
      {action: 'history', target: blockedTarget},
      harness.qqReadScope(ownerKey),
    ),
    /历史记录目标不在当前允许范围/,
  );
  assert.equal(harness.requestCalls.length, 1);
});

test('history read discards its result if account or persona changes while awaiting', async t => {
  for (const changedField of ['accountId', 'personaId', 'personaVersion']) {
    await t.test(changedField, async () => {
      const chatKey = 'group:12345678';
      const state = {
        accountId: 'account-a',
        personaId: 'persona-a',
        personaVersion: 'v1',
      };
      const harness = makeHistoryHarness({
        allowed: new Set([chatKey]),
        chat: {key: chatKey, kind: 'group', chatId: '12345678'},
        state,
        response: async () => {
          state[changedField] = 'changed';
          return {messages: historyMessages()};
        },
      });

      await assert.rejects(
        harness.readQqHistory(
          {key: chatKey, kind: 'group', chatId: '12345678'},
          {action: 'history'},
          harness.qqReadScope(chatKey),
        ),
        /读取期间账号或人设已改变/,
      );
      assert.equal(harness.reads.length, 0);
    });
  }
});

test('registered bridge_qq_read renderer turns saved attachments into image blocks', () => {
  let registered;
  const tools = {
    register(definition) {
      registered = definition;
      return () => {};
    },
  };
  const ctx = {
    get(name) {
      assert.equal(name, 'tools');
      return tools;
    },
    effect(callback) {
      assert.equal(typeof callback, 'function');
    },
  };
  const registerQqReadTool = functionFromIndex('registerQqReadTool', {
    ctx,
    qqReadToolRegistered: false,
  });

  assert.equal(registerQqReadTool(), true);
  assert.equal(registered.name, 'bridge_qq_read');
  assert.equal(registered.output.render.length, 2);

  const blocks = registered.output.render({}, {
    ok: true,
    imageAttachments: ['attachment-one', 'attachment-two'],
  });
  assert.deepEqual(blocks, [
    {type: 'text', text: JSON.stringify({ok: true}).slice(0, 26000)},
    {type: 'image', attachment: 'attachment-one'},
    {type: 'image', attachment: 'attachment-two'},
  ]);
  assert.equal(blocks.some(block => block.type === 'text' && block.text.includes('imageAttachments')), false);
});

function makeDeliveryHarness({
  job,
  response,
  isCurrent = () => true,
}) {
  const requestCalls = [];
  const issues = [];
  const invocations = [];
  const featureState = {outbox: [job], generation: 7};
  const deliveryVerificationCurrent = isCurrent;
  const request = async (...args) => {
    requestCalls.push(args);
    return response(...args);
  };
  const deliveryHistoryCache = new Map();
  const deliveryReadRequest = functionFromIndex('deliveryReadRequest', {
    deliveryVerificationCurrent,
    request,
    deliveryHistoryCache,
  });
  const deliveryCheckSummary = functionFromIndex('deliveryCheckSummary');
  const checkOutgoingDelivery = functionFromIndex('checkOutgoingDelivery', {
    job,
    socket: {ready: true},
    deliveryVerificationCurrent,
    deliveryCheckSummary,
    deliveryVerificationInFlight: new Map(),
    saveFeatures: () => {},
    verifyDelivery,
    deliveryReadRequest,
    featureState,
    settings: {activeAccountId: 'account-a'},
    lastSelfId: '99999999',
    recordInvocation: row => invocations.push(row),
    reportBridgeIssue: row => issues.push(row),
    logDelivery: () => {},
    armDeliveryVerification: () => {},
  });
  return {
    checkOutgoingDelivery,
    requestCalls,
    issues,
    invocations,
    featureState,
  };
}

function privateDeliveryJob(overrides = {}) {
  return {
    id: 'delivery-private',
    accountId: 'account-a',
    personaId: 'persona-a',
    chat: 'private:44444444',
    kind: 'private',
    chatId: '44444444',
    messageId: '70001',
    status: 'sent',
    segments: [{type: 'text', data: {text: 'exact delivery text'}}],
    ...overrides,
  };
}

function exactPrivateMessage(overrides = {}) {
  return {
    message_id: '70001',
    message_type: 'private',
    user_id: '99999999',
    sender: {user_id: '99999999'},
    message: [{type: 'text', data: {text: 'exact delivery text'}}],
    ...overrides,
  };
}

test('delivery verification observes an exact readback without sending or changing sent state', async () => {
  const job = privateDeliveryJob();
  const harness = makeDeliveryHarness({
    job,
    response: async () => ({status: 'ok', data: {messages: [exactPrivateMessage()]}}),
  });

  const summary = await harness.checkOutgoingDelivery(job);

  assert.equal(summary.state, 'observed');
  assert.equal(summary.recipient, 'unknown');
  assert.equal(summary.read, 'unknown');
  assert.equal(job.status, 'sent');
  assert.equal(job.verification.state, 'observed');
  assert.equal(job.verification.attempts, 1);
  assert.deepEqual(harness.requestCalls, [[
    'get_friend_msg_history',
    {user_id: '44444444', count: 30},
    5000,
  ]]);
  assert.equal(harness.requestCalls.some(([name]) => /send/i.test(name)), false);
});

test('a same-ID content mismatch stays unconfirmed and never resends', async () => {
  const job = privateDeliveryJob({status: 'sent'});
  const harness = makeDeliveryHarness({
    job,
    response: async () => ({
      status: 'ok',
      data: {
        messages: [exactPrivateMessage({
          message: [{type: 'text', data: {text: 'different delivery text'}}],
        })],
      },
    }),
  });

  const summary = await harness.checkOutgoingDelivery(job);

  assert.equal(summary.state, 'unconfirmed');
  assert.equal(job.status, 'sent');
  assert.equal(job.verification.state, 'unconfirmed');
  assert.match(job.verification.detail, /content does not match/);
  assert.ok(job.verification.nextCheckAt > Date.now());
  assert.deepEqual(harness.requestCalls.map(([name]) => name), ['get_friend_msg_history']);
  assert.equal(harness.requestCalls.some(([name]) => /send/i.test(name)), false);
});

test('delivery verification discards an exact result if the account scope changes mid-read', async () => {
  let current = true;
  const job = privateDeliveryJob({status: 'unknown'});
  const harness = makeDeliveryHarness({
    job,
    isCurrent: () => current,
    response: async () => {
      current = false;
      return {status: 'ok', data: {messages: [exactPrivateMessage()]}};
    },
  });

  const summary = await harness.checkOutgoingDelivery(job);

  assert.equal(summary.state, 'unconfirmed');
  assert.match(summary.coverage, /旧结果未采用/);
  assert.equal(job.status, 'unknown');
  assert.notEqual(job.verification.state, 'observed');
  assert.equal(harness.requestCalls.some(([name]) => /send/i.test(name)), false);
});

test('recipient reply quotes are conservative for both private and group jobs', async () => {
  const privateJob = privateDeliveryJob({
    id: 'quote-private',
    verification: {state: 'unconfirmed', recipient: 'unknown', read: 'unknown'},
  });
  const groupJob = privateDeliveryJob({
    id: 'quote-group',
    chat: 'group:77777777',
    kind: 'group',
    chatId: '77777777',
    messageId: '70002',
    verification: {state: 'unconfirmed', recipient: 'unknown', read: 'unknown'},
  });
  const featureState = {outbox: [privateJob, groupJob]};
  let saved = 0;
  const observeRecipientReply = functionFromIndex('observeRecipientReply', {
    lastSelfId: '99999999',
    recordsAllowed: () => true,
    groupStopped: () => false,
    segmentsOf,
    featureState,
    settings: {activeAccountId: 'account-a'},
    activePersona: () => ({id: 'persona-a'}),
    saveFeatures: () => {
      saved += 1;
    },
    logDelivery: () => {},
  });

  observeRecipientReply({
    post_type: 'message',
    message_type: 'private',
    user_id: '44444444',
    message: [{type: 'reply', data: {id: '70001'}}],
  });
  observeRecipientReply({
    post_type: 'message',
    message_type: 'group',
    user_id: '55555555',
    group_id: '77777777',
    message: [{type: 'reply', data: {id: '70002'}}],
  });

  assert.equal(privateJob.verification.state, 'unconfirmed');
  assert.equal(privateJob.verification.recipient, 'reply_observed');
  assert.equal(privateJob.verification.recipientId, '44444444');
  assert.equal(privateJob.verification.read, 'unknown');
  assert.equal(groupJob.verification.state, 'unconfirmed');
  assert.equal(groupJob.verification.recipient, 'reply_observed');
  assert.equal(groupJob.verification.recipientId, '55555555');
  assert.equal(groupJob.verification.read, 'unknown');
  assert.equal(saved, 2);
});

test('real host tool middleware admits group QQ reads without invoking owner-only device context',async()=>{
 const marker="ctx.on('tools/execute',",start=indexSource.indexOf(marker)+marker.length;
 assert.ok(start>=marker.length);
 const dependencies={chats:new Map(),randomUUID:()=> 'invocation',invocationScope:()=>({}),recordInvocation:()=>{},invocationKind:()=> 'tool',settings:{activeAccountId:'account-a',localChat:{enabled:false}},currentOwnerToolDenial:()=>undefined,qqReadScope:()=>({accountId:'account-a',personaId:'persona-a'}),agencyContext:()=>{throw Error('owner device context must not run');},executionRuntime:{beginHost:()=>{throw Error('device operation runtime must not begin');},finish:()=>{}},apiModelScope:{run:(_scope,fn)=>fn()}};
 const chat={sessionId:'group-session',key:'group:77777777',turns:new Map()};dependencies.chats.set(chat.sessionId,chat);
 let factory;for(let end=indexSource.indexOf('}',start);end>=0;end=indexSource.indexOf('}',end+1))try{factory=Function(...Object.keys(dependencies),'return ('+indexSource.slice(start,end+1)+');');break;}catch(error){if(!(error instanceof SyntaxError))throw error;}
 const middleware=factory(...Object.values(dependencies));
 for(const name of ['bridge_qq_read','bridge_qq_api']){let calls=0;const result=await middleware({name,agent:{id:chat.sessionId},arguments:{action:'history'}},async()=>{calls++;return {ok:true};});assert.equal(calls,1);assert.equal(result.ok,true);}
});

test('local QQ pack returns actual history image observations and has an explicit native capability tool',async()=>{
 const chat={key:'group:77777777',kind:'group',chatId:'77777777'},active={controller:new AbortController()},localTurns=new Map([[chat.key,active]]),scope={key:chat.key,accountId:'account-a',personaId:'persona-a',personaVersion:'v1'};
 const create=functionFromIndex('localQqTools',{qqReadScope:()=>scope,stopped:false,accountPaused:false,localTurns,recordsAllowed:()=>true,groupStopped:()=>false,randomUUID:()=> 'invocation',recordInvocation:()=>{},qqNativeParameters:{type:'object'},executeNativeQq:async()=>({ok:true}),readQqHistory:async()=>({ok:true,parts:[{type:'image',mediaType:'image/png',data:PNG_BASE64[0]}],records:[]})});
 const tools=create(chat,active);assert.ok(tools.bridge_qq_api);const result=await tools.bridge_qq_read.execute({action:'history'});assert.equal(result.localObservations[0].url,'data:image/png;base64,'+PNG_BASE64[0]);assert.equal(result.parts,undefined);active.controller.abort();await assert.rejects(tools.bridge_qq_read.execute({action:'history'}),/会话已变化/);
});
