import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareDeliveryMessage,
  verifyDelivery,
} from '../delivery-verification.js';

function privateJob(overrides = {}) {
  return {
    kind: 'private',
    chatId: '123',
    messageId: '456',
    segments: [{type: 'text', data: {text: 'hello'}}],
    ...overrides,
  };
}

function privateMessage(overrides = {}) {
  return {
    message_id: '456',
    message_type: 'private',
    user_id: '9',
    sender: {user_id: '9'},
    message: [{type: 'text', data: {text: 'hello'}}],
    ...overrides,
  };
}

test('private get_msg has no recipient target; scoped history supplies scope', () => {
  const job = privateJob();
  const message = privateMessage();

  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, false);
  assert.match(
    compareDeliveryMessage(job, message, {selfId: '9'}).reason,
    /private target/,
  );
  assert.equal(
    compareDeliveryMessage(job, message, {selfId: '9', historyScoped: true}).matched,
    true,
  );
  assert.equal(
    compareDeliveryMessage(job, privateMessage({target_id: '123'}), {selfId: '9'}).matched,
    true,
  );
  assert.equal(
    compareDeliveryMessage(job, privateMessage({target_id: '999'}), {selfId: '9'}).matched,
    false,
  );
});

test('wrong sender, ID, type, target, and text never match', () => {
  const changes = [
    privateMessage({sender: {user_id: '10'}, user_id: '10'}),
    privateMessage({message_id: '457'}),
    privateMessage({message_type: 'group', group_id: '123'}),
    privateMessage({target_id: '999'}),
    privateMessage({message: [{type: 'text', data: {text: 'hell0'}}]}),
  ];
  for (const message of changes) {
    assert.equal(
      compareDeliveryMessage(privateJob(), message, {selfId: '9', historyScoped: true}).matched,
      false,
    );
  }
});

test('media must retain every required type and count without comparing paths', () => {
  const job = privateJob({
    segments: [
      {type: 'text', data: {text: 'mixed'}},
      {type: 'image', data: {file: 'base64://AAAA'}},
      {type: 'record', data: {file: 'file:///C:/voice.amr'}},
      {type: 'video', data: {file: 'https://local.invalid/video.mp4'}},
      {type: 'image', data: {file: 'file:///C:/second.png'}},
    ],
  });
  const canonical = privateMessage({
    target_id: '123',
    message: [
      {type: 'text', data: {text: 'mixed'}},
      {type: 'image', data: {file: 'https://cdn.qq.invalid/a'}},
      {type: 'record', data: {file: 'https://cdn.qq.invalid/b'}},
      {type: 'video', data: {file: 'https://cdn.qq.invalid/c'}},
      {type: 'image', data: {file: 'https://cdn.qq.invalid/d'}},
    ],
  });
  assert.equal(compareDeliveryMessage(job, canonical, {selfId: '9'}).matched, true);

  for (const missingType of ['image', 'record', 'video']) {
    const message = structuredClone(canonical);
    const index = message.message.findIndex(segment => segment.type === missingType);
    message.message.splice(index, 1);
    assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, false);
  }
});

test('mixed text and media bubbles preserve order and only normalize CRLF/trim', () => {
  const job = privateJob({
    segments: [
      {type: 'text', data: {text: 'first\r\n  line '}},
      {type: 'image', data: {file: 'base64://AAAA'}},
      {type: 'text', data: {text: ' second '}},
    ],
  });
  const message = privateMessage({
    target_id: '123',
    message: [
      {type: 'text', data: {text: ' first\n  line'}},
      {type: 'image', data: {file: 'canonical-qq-path'}},
      {type: 'text', data: {text: 'second'}},
    ],
  });
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, true);

  message.message.reverse();
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, false);
});

test('group messages require exact group scope', () => {
  const job = {
    kind: 'group',
    chatId: '765',
    messageId: '88',
    segments: [{type: 'text', data: {text: 'group text'}}],
  };
  const message = {
    message_id: '88',
    message_type: 'group',
    group_id: '765',
    user_id: '9',
    message: [{type: 'text', data: {text: 'group text'}}],
  };
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, true);
  message.group_id = '766';
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, false);
});

test('CQ text and media parse without evaluating content', () => {
  const job = privateJob({
    segments: '[CQ:at,qq=42] hi [CQ:reply,id=-7][CQ:face,id=14][CQ:image,file=base64://AAAA,sub_type=0]',
  });
  const message = privateMessage({
    target_id: '123',
    message: [
      {type: 'at', data: {qq: '42'}},
      {type: 'text', data: {text: ' hi '}},
      {type: 'reply', data: {id: '-7'}},
      {type: 'face', data: {id: '14'}},
      {type: 'image', data: {file: 'https://cdn.qq.invalid/x'}},
    ],
  });
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, true);

  const script = privateJob({segments: '[CQ:text,text=process.exit(1)]'});
  assert.equal(compareDeliveryMessage(script, message, {selfId: '9'}).matched, false);
});

test('negative nonzero IDs are exact and zero IDs are rejected', () => {
  const job = privateJob({messageId: '-456'});
  const message = privateMessage({message_id: '-456', target_id: '123'});
  assert.equal(compareDeliveryMessage(job, message, {selfId: '9'}).matched, true);
  assert.equal(
    compareDeliveryMessage(privateJob({messageId: '0'}), message, {selfId: '9'}).matched,
    false,
  );
});

test('scoped history observes an exact sender-side readback', async () => {
  const calls = [];
  const result = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async (name, params, timeoutMs) => {
      calls.push({name, params, timeoutMs});
      return {status: 'ok', data: {messages: [privateMessage()]}};
    },
  });

  assert.equal(result.state, 'observed');
  assert.equal(result.method, 'get_friend_msg_history');
  assert.equal(result.recipient, 'unknown');
  assert.equal(result.read, 'unknown');
  assert.equal(typeof result.checkedAt, 'number');
  assert.deepEqual(calls.map(call => call.name), ['get_friend_msg_history']);
  assert.deepEqual(calls[0].params, {user_id: '123', count: 30});
});

test('history miss falls back to get_msg but private target remains mandatory', async () => {
  const calls = [];
  let response = {status: 'ok', data: {messages: []}};
  const result = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async name => {
      calls.push(name);
      return name === 'get_friend_msg_history' ? response : privateMessage();
    },
  });
  assert.equal(result.state, 'unconfirmed');
  assert.equal(result.method, 'get_msg');
  assert.match(result.reason, /private target/);

  calls.length = 0;
  response = {status: 'unsupported', message: 'not supported'};
  const explicit = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async name => {
      calls.push(name);
      return name === 'get_friend_msg_history'
        ? response
        : privateMessage({target_id: '123'});
    },
  });
  assert.equal(explicit.state, 'observed');
  assert.deepEqual(calls, ['get_friend_msg_history', 'get_msg']);
});

test('unsupported actions and ordinary request errors remain distinguishable', async () => {
  const unsupported = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async () => ({status: 'unsupported'}),
  });
  assert.equal(unsupported.state, 'unsupported');

  const failed = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async () => {
      throw new Error('connection reset');
    },
  });
  assert.equal(failed.state, 'unconfirmed');
  assert.doesNotMatch(failed.reason, /connection reset/);
});

test('cancellation is checked before and after each read', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  const skipped = await verifyDelivery(privateJob(), {
    selfId: '9',
    signal: before.signal,
    request: async () => {
      calls += 1;
      return {};
    },
  });
  assert.equal(skipped.state, 'unconfirmed');
  assert.equal(skipped.reason, 'verification aborted');
  assert.equal(calls, 0);

  const after = new AbortController();
  const cancelled = await verifyDelivery(privateJob(), {
    selfId: '9',
    signal: after.signal,
    request: async () => {
      calls += 1;
      after.abort();
      return {status: 'ok', data: {messages: [privateMessage()]}};
    },
  });
  assert.equal(cancelled.state, 'unconfirmed');
  assert.equal(cancelled.reason, 'verification aborted');
  assert.equal(calls, 1);
});

test('verification only uses read-only actions and never returns raw messages', async () => {
  const allowed = new Set(['get_msg', 'get_friend_msg_history', 'get_group_msg_history']);
  const names = [];
  const result = await verifyDelivery(privateJob(), {
    selfId: '9',
    request: async name => {
      names.push(name);
      return {unsupported: true};
    },
  });
  assert.equal(result.state, 'unsupported');
  assert.ok(names.every(name => allowed.has(name)));
  assert.deepEqual(Object.keys(result).sort(), [
    'checkedAt',
    'method',
    'read',
    'reason',
    'recipient',
    'state',
  ]);
});
