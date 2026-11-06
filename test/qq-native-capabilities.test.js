import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QQ_NATIVE_CATALOG,
  createQqNativeCapabilities,
} from '../qq-native-capabilities.js';

const groupContext = {
  accountId: '10001',
  personaId: 'persona',
  key: 'active-key',
  scope: 'group',
  groupId: '20002',
};

const privateContext = {
  accountId: '10001',
  personaId: 'persona',
  key: 'active-key',
  scope: 'private',
  userId: '30003',
};

function owner() {
  return true;
}

test('catalog is curated, closed, and unknown until a real request succeeds', async () => {
  const calls = [];
  const native = createQqNativeCapabilities({
    request: async (...args) => {
      calls.push(args);
      return {status: 'ok', retcode: 0, data: {user_id: 10001}};
    },
    allowedUsers: () => ['30003'],
    allowedGroups: () => ['20002'],
    isOwner: owner,
  });

  assert.ok(QQ_NATIVE_CATALOG.every(entry => (
    Object.keys(entry).sort().join(',') === 'action,required,scope,title,write'
    && Array.isArray(entry.required)
  )));
  assert.ok(native.catalog(privateContext).every(entry => entry.status === 'unknown'));
  for (const forbidden of [
    'send_msg', 'send_forward_msg', 'send_group_forward_msg', 'get_cookies',
    'get_csrf_token', 'get_credentials', 'group_kick', 'set_group_leave',
  ]) {
    assert.equal(QQ_NATIVE_CATALOG.some(entry => entry.action === forbidden), false);
  }

  const unrequested = native.catalog(privateContext).find(entry => entry.action === 'get_login_info');
  assert.equal(unrequested.status, 'unknown');
  assert.equal(calls.length, 0);
  const read = await native.call({action: 'get_login_info'}, privateContext);
  assert.equal(read.ok, true);
  assert.equal(read.verified, true);
  assert.equal(
    native.catalog(privateContext).find(entry => entry.action === 'get_login_info').status,
    'supported',
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['get_login_info', {}, privateContext]);
});

test('owner can read an allowed group; non-owner is confined to the current group', async () => {
  const calls = [];
  let nonOwnerRequests = 0;
  const native = createQqNativeCapabilities({
    request: async action => {
      calls.push(action);
      return {status: 'ok', data: {group_id: 20002, group_name: 'allowed'}};
    },
    allowedGroups: () => ['20002', '20003'],
    isOwner: owner,
  });

  const ownerRead = await native.call(
    {action: 'get_group_info', params: {group_id: '20002'}},
    privateContext,
  );
  assert.equal(ownerRead.ok, true);
  assert.equal(ownerRead.verified, true);
  assert.deepEqual(ownerRead.result, {group_id: 20002, group_name: 'allowed'});

  const nonOwner = createQqNativeCapabilities({
    request: async () => {
      nonOwnerRequests += 1;
      return {status: 'ok', data: {}};
    },
    allowedGroups: () => ['20002', '20003'],
    isOwner: () => false,
  });
  const sameGroup = await nonOwner.call(
    {action: 'get_group_info', params: {group_id: '20002'}},
    groupContext,
  );
  assert.equal(sameGroup.ok, true);
  const crossGroup = await nonOwner.call(
    {action: 'get_group_info', params: {group_id: '20003'}},
    groupContext,
  );
  assert.equal(crossGroup.ok, false);
  assert.equal(nonOwnerRequests, 1);
});

test('private actions require the user allowlist and non-owner same-private scope', async () => {
  const calls = [];
  const native = createQqNativeCapabilities({
    request: async (action, params) => {
      calls.push({action, params});
      return {status: 'ok', data: {user_id: params.user_id}};
    },
    allowedUsers: () => ['30003', '30004'],
    isOwner: () => false,
  });

  const same = await native.call(
    {action: 'get_stranger_info', params: {user_id: '30003'}},
    privateContext,
  );
  assert.equal(same.ok, true);
  const cross = await native.call(
    {action: 'get_stranger_info', params: {user_id: '30004'}},
    privateContext,
  );
  assert.equal(cross.ok, false);
  assert.equal(calls.length, 1);

  const notAllowed = await native.call(
    {action: 'get_stranger_info', params: {user_id: '39999'}},
    privateContext,
  );
  assert.equal(notAllowed.ok, false);
});

test('friend and group lists expose only allowlisted identifiers', async () => {
  const native = createQqNativeCapabilities({
    request: async action => ({
      status: 'ok',
      retcode: 0,
      data: action === 'get_friend_list'
        ? [
          {user_id: 30003, nickname: 'allowed'},
          {user_id: 39999, nickname: 'not allowed'},
        ]
        : [
          {group_id: 20002, group_name: 'allowed'},
          {group_id: 29999, group_name: 'not allowed'},
        ],
    }),
    allowedUsers: () => ['30003'],
    allowedGroups: () => ['20002'],
    isOwner: owner,
  });

  const friends = await native.call({action: 'get_friend_list'}, privateContext);
  const groups = await native.call({action: 'get_group_list'}, privateContext);
  assert.deepEqual(friends.result, [{user_id: 30003, nickname: 'allowed'}]);
  assert.deepEqual(groups.result, [{group_id: 20002, group_name: 'allowed'}]);
});

test('successful writes are accepted but not verified, while reads are verified', async () => {
  const calls = [];
  const native = createQqNativeCapabilities({
    request: async (action, params) => {
      calls.push({action, params});
      return {status: 'ok', retcode: 0, data: {accepted: true}};
    },
    allowedGroups: () => ['20002'],
    allowedUsers: () => ['30003'],
    isOwner: owner,
  });

  const write = await native.call(
    {action: 'set_group_ban', params: {group_id: '20002', user_id: '30003', duration: 60}},
    privateContext,
  );
  assert.deepEqual(write, {
    ok: true,
    action: 'set_group_ban',
    result: {accepted: true},
    verified: false,
    coverage: '平台已接收普通操作，未作读回',
  });
  assert.equal(calls.length, 1);

  const read = await native.call(
    {action: 'get_group_info', params: {group_id: '20002'}},
    privateContext,
  );
  assert.equal(read.ok, true);
  assert.equal(read.verified, true);
  assert.equal(calls.length, 2);
});

test('write actions require the current private-owner predicate', async () => {
  let requests = 0;
  const native = createQqNativeCapabilities({
    request: async () => {
      requests += 1;
      return {status: 'ok'};
    },
    allowedGroups: () => ['20002'],
    allowedUsers: () => ['30003'],
    isOwner: () => false,
  });

  const groupWrite = await native.call(
    {action: 'set_group_name', params: {group_id: '20002', group_name: 'new name'}},
    groupContext,
  );
  const privateWrite = await native.call(
    {action: 'send_like', params: {user_id: '30003'}},
    privateContext,
  );
  assert.equal(groupWrite.ok, false);
  assert.equal(privateWrite.ok, false);
  assert.equal(requests, 0);
});

test('missing fields and arbitrary or dangerous parameters are rejected before request', async () => {
  let requests = 0;
  const native = createQqNativeCapabilities({
    request: async () => {
      requests += 1;
      return {status: 'ok', data: {}};
    },
    allowedGroups: () => ['20002'],
    allowedUsers: () => ['30003'],
    isOwner: owner,
  });

  for (const bad of [
    {action: 'get_group_info', params: {}},
    {action: 'set_group_ban', params: {group_id: '20002', user_id: '30003'}},
    {action: 'get_group_info', params: {group_id: '20002', path: 'C:\\secret'}},
    {action: 'get_group_info', params: {group_id: '20002', command: 'whoami'}},
    {action: 'get_group_info', params: {group_id: 'not-a-number'}},
    {action: 'get_group_info', params: {group_id: 20002, nested: {value: true}}},
    {action: 'send_msg', params: {message: 'hello'}},
    {action: 'send_forward_msg', params: {}},
    {action: 'rawpacket', params: {packet: '...'}},
  ]) {
    const result = await native.call(bad, privateContext);
    assert.equal(result.ok, false);
  }
  assert.equal(requests, 0);
});

test('request failures are sanitized and explicit unsupported responses update status', async () => {
  const native = createQqNativeCapabilities({
    request: async action => {
      if (action === '_get_group_notice') {
        return {
          status: 'failed',
          retcode: 1404,
          message: 'unknown action at https://secret.invalid/?token=abc',
        };
      }
      throw new Error('password=hunter2 https://secret.invalid/cookie');
    },
    allowedGroups: () => ['20002'],
    isOwner: owner,
  });

  const unsupported = await native.call(
    {action: '_get_group_notice', params: {group_id: '20002'}},
    privateContext,
  );
  assert.equal(unsupported.ok, false);
  assert.equal(
    native.catalog(privateContext).find(entry => entry.action === '_get_group_notice').status,
    'unsupported',
  );

  const failed = await native.call(
    {action: 'get_group_info', params: {group_id: '20002'}},
    privateContext,
  );
  assert.equal(failed.ok, false);
  assert.equal(
    native.catalog(privateContext).find(entry => entry.action === 'get_group_info').status,
    'failed',
  );
  assert.doesNotMatch(JSON.stringify([unsupported, failed]), /hunter2|secret\.invalid|cookie|token=/i);
});

test('successful return data has obvious credentials redacted', async () => {
  const native = createQqNativeCapabilities({
    request: async () => ({
      status: 'ok',
      data: {
        account: 10001,
        access_token: 'plain-secret',
        nested: {
          cookie: 'uin=secret',
          note: 'password=hunter2',
          safe: 'visible',
        },
      },
    }),
    isOwner: owner,
  });

  const result = await native.call({action: 'get_login_info'}, privateContext);
  assert.equal(result.ok, true);
  assert.equal(result.result.account, 10001);
  assert.equal(result.result.access_token, '[redacted]');
  assert.equal(result.result.nested.cookie, '[redacted]');
  assert.equal(result.result.nested.note, '[redacted]');
  assert.equal(result.result.nested.safe, 'visible');
});

test('missing active context is rejected and never reaches the request', async () => {
  let requests = 0;
  const native = createQqNativeCapabilities({
    request: async () => {
      requests += 1;
      return {status: 'ok'};
    },
    isOwner: owner,
  });

  assert.throws(() => native.catalog({accountId: '10001', personaId: 'persona'}));
  const result = await native.call(
    {action: 'get_status'},
    {accountId: '10001', personaId: 'persona', key: ''},
  );
  assert.equal(result.ok, false);
  assert.equal(requests, 0);
});

test('thrown OneBot unsupported errors are classified without exposing details',async()=>{
 const native=createQqNativeCapabilities({request:async()=>{throw Object.assign(new Error('unknown_action token=private-value'),{retcode:1404});}});
 const context={accountId:'account',personaId:'persona',key:'private:10001',kind:'private',chatId:'10001'};
 const result=await native.call({action:'get_status'},context);assert.equal(result.status,'unsupported');assert.doesNotMatch(JSON.stringify(result),/private-value/);
});
