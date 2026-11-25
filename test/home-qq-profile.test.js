import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const controller = readFileSync(new URL('../ui/console-controller.js', import.meta.url), 'utf8');
const functions = controller.slice(controller.indexOf('  var homeQQProfile = '), controller.indexOf('  function companionHome()'));
const origin = 'https://bridge.example';
const scope = 'a'.repeat(64);
function settings(accountId, selfId, connected = true) {
  return {settings: {activeAccountId: accountId}, status: {selfId, connected, edition: 'desktop'}};
}
function profile(accountId, selfId) {
  return {accountId, selfId, state: 'ready', nickname: accountId, signature: 'assigned signature', onlineStatus: '忙碌',
    avatarUrl: 'https://q.qlogo.cn/headimg_dl?dst_uin=' + selfId, backgroundScope: scope,
    cardBackgroundUrl: '/im-bridge/self-profile/background?scope=' + scope, cardBackgroundSource: 'local'};
}
function fixture() {
  const nodes = new Map(), requests = [];
  const get = key => {
    if (!nodes.has(key)) nodes.set(key, {dataset: {}, getAttribute(name) { return this[name]; },
      setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; }});
    return nodes.get(key);
  };
  const ctx = vm.createContext({URL, location: {origin}, document: {hidden: false}, $: get, tab: 'overview',
    data: settings('first', '100001'), api: () => new Promise(resolve => requests.push(resolve))});
  vm.runInContext(functions, ctx);
  return {ctx, get, requests, nodes};
}

test('a late profile cannot paint after either an account switch or a change of QQ identity on the same account', async () => {
  const {ctx, get, requests} = fixture();
  const first = ctx.refreshHomeQQProfile();
  ctx.data = settings('second', '200002');
  const second = ctx.refreshHomeQQProfile();
  requests[1](profile('second', '200002'));
  await second;
  requests[0](profile('first', '100001'));
  await first;
  assert.equal(get('homeQQNickname').textContent, 'second');
  assert.match(get('homeQQAvatar').src, /200002/);
  ctx.data = settings('second', '300003');
  const third = ctx.refreshHomeQQProfile();
  assert.equal(get('homeQQNickname').textContent, 'QQ 资料卡');
  assert.equal(get('homeQQCover').src, undefined);
  requests[2](profile('second', '200002'));
  await third;
  assert.equal(get('homeQQAvatar').src, undefined);
  assert.equal(get('homeQQFresh').textContent, '资料暂时无法读取');
});

test('reads are home-only, coalesced in flight and cached across routine refreshes', async () => {
  const {ctx, requests} = fixture();
  ctx.tab = 'connection';
  ctx.refreshHomeQQProfile();
  assert.equal(requests.length, 0);
  ctx.tab = 'overview';
  const first = ctx.refreshHomeQQProfile();
  assert.equal(ctx.refreshHomeQQProfile(), first);
  requests[0](profile('first', '100001'));
  await first;
  ctx.refreshHomeQQProfile();
  assert.equal(requests.length, 1);
});

test('a missing QQ signature is distinguished from a confirmed empty signature', async () => {
  for (const [state, expected] of [['partial', '个性签名暂未取得'], ['ready', '未设置个性签名']]) {
    const {ctx, get, requests} = fixture();
    const pending = ctx.refreshHomeQQProfile();
    requests[0]({...profile('first', '100001'), state, signature:''});
    await pending;
    assert.equal(get('homeQQSignature').textContent, expected);
  }
});

test('an offline cached profile supplies neither a remote avatar request nor a live QQ status', async () => {
  const {ctx, get, requests} = fixture();
  ctx.data = settings('first', '100001', false);
  const pending = ctx.refreshHomeQQProfile();
  requests[0]({...profile('first', '100001'), state: 'offline', updatedAt: 1735689600000});
  await pending;
  assert.equal(get('homeQQAvatar').src, undefined);
  assert.equal(controller.includes('id="homeQQPresence"'), false);
  assert.equal(get('homeQQBridge').textContent, '桥接 · 未连接');
  assert.match(get('homeQQFresh').textContent, /上次同步/);
});

test('a connected bridge never renders cached QQ offline presence as a live status',async()=>{
  const {ctx,get,requests,nodes}=fixture();
  const pending=ctx.refreshHomeQQProfile();
  requests[0]({...profile('first','100001'),onlineStatus:'离线'});
  await pending;
  assert.equal(get('homeQQBridge').textContent,'桥接 · 已连接');
  assert.equal(nodes.has('homeQQPresence'),false);
  assert.equal(controller.includes('id="homeQQPresence"'),false);
});

test('profile images are bound to the reported QQ and local background scope', () => {
  const {ctx} = fixture();
  const card = profile('first', '100001');
  assert.equal(ctx.homeQQMedia({...card, avatarUrl:'https://q1.qlogo.cn/g?nk=200002'}, true).avatar, '');
  assert.equal(ctx.homeQQMedia({...card, cardBackgroundUrl:'https://other.example/im-bridge/self-profile/background?scope='+scope}, true).background, '');
  assert.equal(ctx.homeQQMedia({...card, cardBackgroundUrl:'/im-bridge/self-profile/background?scope='+'b'.repeat(64)}, true).background, '');
});

test('empty or undecodable input preserves the original cover and sends no upload', async () => {
  const {ctx, get, requests} = fixture();
  const pending = ctx.refreshHomeQQProfile();
  requests[0](profile('first', '100001'));
  await pending;
  const cover = get('homeQQCover').src;
  let writes = 0, decoded = 0, revoked = 0;
  ctx.fetch = async () => { writes++; };
  ctx.URL = class extends URL {
    static createObjectURL() { return 'blob:test'; }
    static revokeObjectURL() { revoked++; }
  };
  ctx.Image = class { async decode() { decoded++; throw Error('invalid bytes'); } };
  await ctx.changeHomeQQBackground(ctx.homeQQProfile, {size:0, type:'image/png'});
  assert.match(get('homeQQBackgroundResult').textContent, /为空/);
  await ctx.changeHomeQQBackground(ctx.homeQQProfile, {size:40, type:'image/png'});
  assert.match(get('homeQQBackgroundResult').textContent, /无法解码/);
  assert.equal(get('homeQQCover').src, cover);
  assert.deepEqual([writes, decoded, revoked], [0, 1, 1]);
});
