import test from 'node:test';
import assert from 'node:assert/strict';
import {createQzoneSession} from '../qzone-session.js';

const UIN = '123456789';
const COOKIE = `uin=o${UIN}; skey=RAW-COOKIE-SECRET`;
const GTK = 321;

function connection(accountId = 'account-a', revision = 1, connected = true) {
  return {accountId, revision, connected};
}

function auth(cookie = COOKIE, uin = UIN) {
  return {uin, cookie, gtk: GTK};
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return {promise, resolve, reject};
}

async function waitFor(predicate) {
  for (let index = 0; index < 50; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('test condition was not reached');
}

test('single-flight refreshes validate once and cached auth is reused for its TTL', async () => {
  let clock = 1000;
  let loads = 0;
  let probes = 0;
  const firstLoad = deferred();
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => {
      loads += 1;
      return loads === 1 ? firstLoad.promise : auth(`cookie-${loads}`);
    },
    probeAuth: async () => {
      probes += 1;
      return {ok: true};
    },
    now: () => clock,
    ttlMs: 1000
  });

  const one = session.getAuth();
  const two = session.getAuth({force: true});
  const checked = session.check({force: true});
  await waitFor(() => loads === 1);
  firstLoad.resolve(auth('cookie-1'));

  assert.equal((await one).cookie, 'cookie-1');
  assert.equal((await two).cookie, 'cookie-1');
  assert.equal((await checked).state, 'ready');
  assert.equal(loads, 1);
  assert.equal(probes, 1);

  clock += 999;
  assert.equal((await session.getAuth()).cookie, 'cookie-1');
  assert.equal(loads, 1);

  assert.equal((await session.getAuth({force: true})).cookie, 'cookie-2');
  assert.equal(loads, 2);
  clock += 1000;
  assert.equal((await session.getAuth()).cookie, 'cookie-3');
  assert.equal(loads, 3);
});

test('a cookie is insufficient until probeAuth explicitly returns ok true', async () => {
  let probes = 0;
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => auth(),
    probeAuth: async () => {
      probes += 1;
      return probes === 1 ? {ok: false} : {ok: 'yes'};
    },
    retryMs: 0
  });

  await assert.rejects(session.getAuth(), error => error.code === 'QZONE_UNAVAILABLE');
  assert.equal(session.status().state, 'unavailable');
  assert.equal(session.status().checking, false);
  await assert.rejects(session.getAuth(), error => error.code === 'QZONE_UNAVAILABLE');
  assert.equal(session.status().state, 'unavailable');
});

test('explicit auth-required probe failure gets one reload and probe before backoff', async () => {
  let clock = 10;
  let loads = 0;
  let probes = 0;
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => auth(`reload-${++loads}`),
    probeAuth: async () => {
      probes += 1;
      if (probes === 1) throw Object.assign(new Error(COOKIE), {code: 'QZONE_AUTH_REQUIRED'});
      return {ok: true};
    },
    now: () => clock,
    retryMs: 100
  });

  assert.equal((await session.getAuth()).cookie, 'reload-2');
  assert.equal(loads, 2);
  assert.equal(probes, 2);

  const invalid = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => auth(`invalid-${++loads}`),
    probeAuth: async () => {
      probes += 1;
      throw Object.assign(new Error(COOKIE), {code: 'QZONE_AUTH_REQUIRED'});
    },
    now: () => clock,
    retryMs: 100
  });
  loads = 0;
  probes = 0;

  await assert.rejects(invalid.getAuth(), error => error.code === 'QZONE_AUTH_REQUIRED');
  assert.equal(loads, 2);
  assert.equal(probes, 2);
  assert.equal(invalid.status().state, 'auth_required');
  await assert.rejects(invalid.getAuth({force: true}), error => error.code === 'QZONE_AUTH_REQUIRED');
  assert.equal(loads, 2);
  assert.equal(probes, 2);
  assert.equal(invalid.status().nextCheckAt, 110);
});

test('network and throttle failures back off exponentially and force cannot bypass cooldown', async () => {
  let clock = 100;
  let probes = 0;
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => auth(),
    probeAuth: async () => {
      probes += 1;
      if (probes === 1) throw new Error(`network ${COOKIE}`);
      throw Object.assign(new Error(COOKIE), {code: 'QZONE_THROTTLED'});
    },
    now: () => clock,
    retryMs: 100,
    maxRetryMs: 150
  });

  await assert.rejects(session.getAuth(), error => error.code === 'QZONE_UNAVAILABLE');
  assert.equal(session.status().nextCheckAt, 200);
  await assert.rejects(session.getAuth({force: true}), error => error.code === 'QZONE_UNAVAILABLE');
  assert.equal(probes, 1);

  clock = 200;
  await assert.rejects(session.getAuth(), error => error.code === 'QZONE_THROTTLED');
  assert.equal(session.status().nextCheckAt, 350);
  clock = 349;
  await assert.rejects(session.getAuth({force: true}), error => error.code === 'QZONE_THROTTLED');
  assert.equal(probes, 2);

  clock = 350;
  await assert.rejects(session.getAuth(), error => error.code === 'QZONE_THROTTLED');
  assert.equal(probes, 3);
  assert.equal(session.status().nextCheckAt, 500);
});

test('pending results for an old account or revision cannot replace a new connection', async () => {
  let current = connection('account-a', 1);
  const pendingKey = new Map();
  const session = createQzoneSession({
    getConnection: () => current,
    loadAuth: ({connection: requested}) => {
      const key = `${requested.accountId}:${requested.revision}`;
      const value = deferred();
      pendingKey.set(key, value);
      return value.promise;
    },
    probeAuth: async validated => ({ok: validated.cookie.startsWith('fresh')}),
    retryMs: 0
  });

  const oldAccount = session.getAuth();
  await waitFor(() => pendingKey.has('account-a:1'));
  current = connection('account-b', 1);
  const newAccount = session.getAuth();
  await waitFor(() => pendingKey.has('account-b:1'));
  pendingKey.get('account-b:1').resolve(auth('fresh-b'));
  assert.equal((await newAccount).cookie, 'fresh-b');

  pendingKey.get('account-a:1').resolve(auth('fresh-a'));
  await assert.rejects(oldAccount, error => error.code === 'QZONE_ABORTED');
  assert.equal((await session.getAuth()).cookie, 'fresh-b');

  current = connection('account-b', 2);
  const oldRevision = session.getAuth();
  await waitFor(() => pendingKey.has('account-b:2'));
  current = connection('account-b', 3);
  const newRevision = session.getAuth();
  await waitFor(() => pendingKey.has('account-b:3'));
  pendingKey.get('account-b:3').resolve(auth('fresh-revision-3'));
  assert.equal((await newRevision).cookie, 'fresh-revision-3');

  pendingKey.get('account-b:2').resolve(auth('fresh-revision-2'));
  await assert.rejects(oldRevision, error => error.code === 'QZONE_ABORTED');
  assert.equal((await session.getAuth()).cookie, 'fresh-revision-3');
});

test('an old pending probe cannot overwrite a newer connection state', async () => {
  let current = connection('probe-a', 7);
  const oldProbe = deferred();
  let probes = 0;
  const session = createQzoneSession({
    getConnection: () => current,
    loadAuth: ({connection: requested}) => auth(`cookie-${requested.accountId}`),
    probeAuth: async () => {
      probes += 1;
      return probes === 1 ? oldProbe.promise : {ok: true};
    },
    retryMs: 0
  });

  const old = session.getAuth();
  await waitFor(() => probes === 1);
  current = connection('probe-b', 1);
  assert.equal((await session.getAuth()).cookie, 'cookie-probe-b');
  oldProbe.resolve({ok: true});
  await assert.rejects(old, error => error.code === 'QZONE_ABORTED');
  assert.equal((await session.getAuth()).cookie, 'cookie-probe-b');
  assert.equal(session.status().state, 'ready');
});

test('an old connection lookup rejection cannot clear a newer ready session', async () => {
  const oldLookup = deferred();
  let lookups = 0;
  const session = createQzoneSession({
    getConnection: () => {
      lookups += 1;
      return lookups === 1 ? oldLookup.promise : connection('new-account', 1);
    },
    loadAuth: () => auth('new-cookie'),
    probeAuth: async () => ({ok: true}),
    retryMs: 0
  });

  const old = session.getAuth();
  await waitFor(() => lookups === 1);
  assert.equal((await session.getAuth()).cookie, 'new-cookie');
  oldLookup.reject(new Error(`old lookup ${COOKIE}`));
  await assert.rejects(old, error => error.code === 'QZONE_ABORTED');
  assert.equal(session.status().state, 'ready');
  assert.equal((await session.getAuth()).cookie, 'new-cookie');
});

test('offline and close abort pending work; offline can recover while close cannot refresh', async () => {
  const pending = deferred();
  let aborts = 0;
  let loads = 0;
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: ({signal}) => {
      loads += 1;
      signal.addEventListener('abort', () => {
        aborts += 1;
      }, {once: true});
      return loads === 1 ? pending.promise : auth(`load-${loads}`);
    },
    probeAuth: async () => ({ok: true}),
    retryMs: 0
  });

  const first = session.getAuth();
  await waitFor(() => loads === 1);
  session.offline();
  assert.equal(session.status().state, 'offline');
  assert.equal(aborts, 1);
  await assert.rejects(first, error => error.code === 'QZONE_ABORTED');
  pending.resolve(auth('stale'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(session.status().state, 'offline');
  assert.equal((await session.getAuth()).cookie, 'load-2');

  const closing = deferred();
  loads = 2;
  const originalLoad = session.getAuth;
  assert.equal(typeof originalLoad, 'function');
  const closedSession = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: ({signal}) => {
      signal.addEventListener('abort', () => {
        aborts += 1;
      }, {once: true});
      return closing.promise;
    },
    probeAuth: async () => ({ok: true})
  });
  const second = closedSession.getAuth();
  await new Promise(resolve => setImmediate(resolve));
  closedSession.close();
  assert.equal(closedSession.status().state, 'offline');
  await assert.rejects(second, error => error.code === 'QZONE_SESSION_CLOSED');
  await assert.rejects(closedSession.getAuth(), error => error.code === 'QZONE_SESSION_CLOSED');
  assert.equal((await closedSession.check()).state, 'offline');
});

test('invalidate cancels a pending refresh, forces a reread, and accepts a renewed cookie', async () => {
  let loads = 0;
  let probes = 0;
  const stale = deferred();
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => {
      loads += 1;
      return loads === 2 ? stale.promise : auth(`new-cookie-${loads}`);
    },
    probeAuth: async () => {
      probes += 1;
      return {ok: true};
    },
    retryMs: 0
  });

  assert.equal((await session.getAuth()).cookie, 'new-cookie-1');
  const pending = session.getAuth({force: true});
  await waitFor(() => loads === 2);
  session.invalidate('cookie expired');
  assert.equal(session.status().state, 'unverified');
  await assert.rejects(pending, error => error.code === 'QZONE_ABORTED');

  const recovered = session.getAuth();
  await waitFor(() => loads === 3);
  stale.resolve(auth('expired-cookie'));
  assert.equal((await recovered).cookie, 'new-cookie-3');
  assert.equal(probes, 2);
  assert.equal(session.status().state, 'ready');
});

test('dependency errors, status and observers never expose raw credentials', async () => {
  const changes = [];
  const session = createQzoneSession({
    getConnection: () => connection(),
    loadAuth: () => auth(),
    probeAuth: async () => {
      throw Object.assign(new Error(`failed ${UIN} ${COOKIE}`), {code: 'QZONE_AUTH_REQUIRED'});
    },
    retryMs: 100,
    onChange: value => {
      changes.push(value);
      throw new Error(`observer ${COOKIE}`);
    }
  });

  const error = await session.getAuth().then(
    () => assert.fail('expected failure'),
    value => value
  );
  assert.equal(error.code, 'QZONE_AUTH_REQUIRED');
  assert.equal(error.message.includes(UIN), false);
  assert.equal(error.message.includes('RAW-COOKIE-SECRET'), false);
  const visible = JSON.stringify({error, status: session.status(), changes});
  assert.equal(visible.includes(UIN), false);
  assert.equal(visible.includes('RAW-COOKIE-SECRET'), false);
  assert.ok(changes.length > 0);
});

test('unknown and unsupported probes never produce ready status', async () => {
  for (const [response, expected] of [
    [undefined, 'unavailable'],
    [{ok: false, code: 'QZONE_UNSUPPORTED'}, 'unsupported']
  ]) {
    const session = createQzoneSession({
      getConnection: () => connection(),
      loadAuth: () => auth(),
      probeAuth: async () => response,
      retryMs: 0
    });
    await session.check();
    assert.equal(session.status().state, expected);
    assert.equal(session.status().checking, false);
  }
});
