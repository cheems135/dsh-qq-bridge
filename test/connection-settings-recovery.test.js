import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const settingsStart = source.indexOf("              if (Array.isArray(patch.accounts))");
const settingsEnd = source.indexOf("              if (Array.isArray(patch.groups))", settingsStart);
assert.ok(settingsStart > 0 && settingsEnd > settingsStart);

function settingsFixture({ paused = false, loggedOut = false } = {}) {
  const initial = { id: 'first', name: '当前', wsUrl: 'ws://localhost:3001', token: 'fixture' };
  const other = { id: 'second', name: '备用', wsUrl: 'ws://localhost:3002', token: '' };
  const settings = { activeAccountId: initial.id, accounts: [initial, other] };
  const cfg = { wsUrl: initial.wsUrl, accessToken: initial.token };
  const state = { chats: {}, manuallyLoggedOut: loggedOut };
  const events = [];
  const deps = {
    state, settings, cfg, featureState: {}, cancelFeatureWork() {}, invalidateChat() {},
    memoryHub: null, personaGrowth: null, learningMemory: null, lifeMemory: null, expressionLearning: null,
    loginHold: (_state, id) => id === other.id, saveState: () => events.push('save'),
    socket: { close: () => events.push('close') }, connectSocket: () => events.push('connect'),
    refreshInitiativeTimers() {}, log() {}, paused,
  };
  const assemble = Function(...Object.keys(deps),
    'let accountPaused = paused, lastSelfId = "known"; return patch => {' +
    source.slice(settingsStart, settingsEnd) +
    ';return {accountPaused,lastSelfId};}');
  return { apply: assemble(...Object.values(deps)), cfg, settings, state, events, initial, other };
}

test('saving the current account preserves a live session, a manual pause and a logged-out session', () => {
  for (const [paused, loggedOut] of [[false, false], [true, false], [true, true]]) {
    const f = settingsFixture({ paused, loggedOut });
    const result = f.apply({ activeAccountId: f.initial.id, accounts: [{ ...f.initial, name: '改个显示名' }, f.other] });
    assert.deepEqual(result, { accountPaused: paused, lastSelfId: 'known' });
    assert.equal(f.state.manuallyLoggedOut, loggedOut);
    assert.deepEqual(f.events, []);
  }
});

test('an actual connection edit takes effect immediately when running and stays paused when stopped', () => {
  for (const paused of [false, true]) {
    const f = settingsFixture({ paused, loggedOut: paused });
    const result = f.apply({ accounts: [{ ...f.initial, token: 'changed' }, f.other] });
    assert.equal(result.lastSelfId, '');
    assert.equal(result.accountPaused, paused);
    assert.equal(f.cfg.accessToken, 'changed');
    assert.equal(f.state.manuallyLoggedOut, paused);
    assert.deepEqual(f.events, paused ? ['close'] : ['close', 'connect']);
  }
});

test('switching profiles still honors the destination account hold', () => {
  const f = settingsFixture();
  assert.equal(f.apply({ activeAccountId: f.other.id }).accountPaused, true);
  assert.equal(f.cfg.wsUrl, f.other.wsUrl);
  assert.ok(!f.events.includes('connect'));
  assert.equal(f.apply({ activeAccountId: f.initial.id }).accountPaused, false);
  assert.equal(f.events.filter(x => x === 'connect').length, 1);
});

const recovery = source.match(/^  async function recoverNapCat\([^]*?^  \}/m)[0];
function recoveryFixture() {
  const settings = { activeAccountId: 'first', login: { autoRecover: true } };
  const events = [], timers = [];
  let complete;
  const status = new Promise(resolve => { complete = resolve; });
  const deps = {
    settings, state: {}, cfg: { napcat: { dir: 'fixture' } }, stopped: false, accountPaused: false,
    loginHold: () => false, loginScopeKey: () => 'scope', localLoginAccount: () => '12345', localNapCat: {},
    guardConfig: () => ({}), join: () => '', existsSync: () => false, log() {},
    currentLoginClient: () => ({ getStatus: () => { events.push('probe'); return status; } }),
    preserveLoginWindow: () => false, killNapCatProcesses: () => events.push('stop'),
    startNapCatLauncher: async () => events.push('start'),
    setTimeout: callback => { timers.push(callback); return 1; }, clearTimeout() {},
  };
  const run = Function(...Object.keys(deps),
    'let lastDisconnectAt=1,lastRecoverAt=0,recoverWindowStart=0,recoverCount=0,recoveryLaunchTimer=null,socket=null;' +
    recovery + ';return () => recoverNapCat("watchdog");')(...Object.values(deps));
  return { run, settings, events, timers, finish: () => complete({ loginPhase: 'offline' }) };
}

test('disabling recovery cancels a pending probe or delayed launch', async () => {
  const disabled = recoveryFixture();
  disabled.settings.login.autoRecover = false;
  disabled.finish();
  assert.equal(await disabled.run(), false);
  assert.deepEqual(disabled.events, []);

  const checking = recoveryFixture();
  const pending = checking.run();
  checking.settings.login.autoRecover = false;
  checking.finish();
  assert.equal(await pending, false);
  assert.deepEqual(checking.events, ['probe']);

  const delayed = recoveryFixture();
  delayed.finish();
  assert.equal(await delayed.run(), true);
  delayed.settings.login.autoRecover = false;
  delayed.timers[0]();
  assert.deepEqual(delayed.events, ['probe', 'stop']);
});
