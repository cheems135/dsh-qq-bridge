const ERROR_MESSAGES = Object.freeze({
  QZONE_AUTH_REQUIRED: '空间登录状态不可用，请重新登录后再试',
  QZONE_THROTTLED: '空间访问请求过于频繁，请稍后再试',
  QZONE_UNSUPPORTED: '当前空间接口不支持此操作',
  QZONE_UNAVAILABLE: '空间登录状态验证暂时失败，请稍后再试',
  QZONE_OFFLINE: 'QQ 当前未连接，无法读取空间登录状态',
  QZONE_ABORTED: '空间登录状态检查已取消',
  QZONE_SESSION_CLOSED: '空间会话已关闭，不能继续刷新'
});

const FAILURE_STATES = Object.freeze({
  QZONE_AUTH_REQUIRED: 'auth_required',
  QZONE_THROTTLED: 'throttled',
  QZONE_UNSUPPORTED: 'unsupported',
  QZONE_UNAVAILABLE: 'unavailable'
});

const INVALIDATE_TEXT = Object.freeze({
  expired: '空间登录状态已过期，等待重新验证',
  auth_required: ERROR_MESSAGES.QZONE_AUTH_REQUIRED,
  throttled: ERROR_MESSAGES.QZONE_THROTTLED,
  unsupported: ERROR_MESSAGES.QZONE_UNSUPPORTED
});

function stableError(code) {
  const resolved = ERROR_MESSAGES[code] ? code : 'QZONE_UNAVAILABLE';
  return Object.assign(new Error(ERROR_MESSAGES[resolved]), {
    name: 'QzoneSessionError',
    code: resolved
  });
}

function errorCode(error) {
  try {
    const code = error && typeof error === 'object' ? error.code : '';
    return FAILURE_STATES[code] ? code : 'QZONE_UNAVAILABLE';
  } catch {
    return 'QZONE_UNAVAILABLE';
  }
}

function safeDuration(value, fallback, {allowZero = false} = {}) {
  return Number.isFinite(Number(value)) && (allowZero ? Number(value) >= 0 : Number(value) > 0)
    ? Number(value)
    : fallback;
}

function cacheKey(connection) {
  return JSON.stringify([
    connection.accountId,
    typeof connection.revision,
    String(connection.revision)
  ]);
}

function normalizeConnection(value) {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.accountId !== 'string') return null;
  if (!(typeof value.revision === 'string'
    || (typeof value.revision === 'number' && Number.isFinite(value.revision)))) return null;
  if (typeof value.connected !== 'boolean') return null;
  return {
    accountId: value.accountId,
    revision: value.revision,
    connected: value.connected
  };
}

function normalizeAuth(value) {
  if (!value || typeof value !== 'object') throw stableError('QZONE_AUTH_REQUIRED');
  const uin = String(value.uin ?? '');
  const cookie = typeof value.cookie === 'string' ? value.cookie.trim() : '';
  if (!/^\d{5,20}$/.test(uin)
    || !cookie
    || !Number.isInteger(value.gtk)
    || value.gtk < 0) {
    throw stableError('QZONE_AUTH_REQUIRED');
  }
  return {uin, cookie, gtk: value.gtk};
}

function copyAuth(auth) {
  return auth ? {uin: auth.uin, cookie: auth.cookie, gtk: auth.gtk} : null;
}

function explicitProbeError(value) {
  if (value && value.ok === true) return null;
  const code = value && typeof value === 'object' && FAILURE_STATES[value.code]
    ? value.code
    : 'QZONE_UNAVAILABLE';
  return stableError(code);
}

export function createQzoneSession({
  getConnection,
  loadAuth,
  probeAuth,
  now = Date.now,
  ttlMs = 600000,
  retryMs = 60000,
  maxRetryMs = 600000,
  onChange = () => {}
} = {}) {
  if (typeof getConnection !== 'function'
    || typeof loadAuth !== 'function'
    || typeof probeAuth !== 'function') {
    throw new TypeError('qzone session dependencies are required');
  }

  const ttl = safeDuration(ttlMs, 600000);
  const retry = safeDuration(retryMs, 60000, {allowZero: true});
  const maxRetry = Math.max(retry, safeDuration(maxRetryMs, 600000, {allowZero: true}));
  const readNow = () => {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  };

  let closed = false;
  let generation = 0;
  let staleBarrier = 0;
  let currentKey = null;
  let cached = null;
  let failure = null;
  let active = null;
  let state = {
    state: 'unverified',
    qqConnected: null,
    checkedAt: null,
    lastSuccessAt: null,
    nextCheckAt: null,
    reason: null,
    checking: false
  };

  function status(connection) {
    if (!closed && connection) observeConnection(connection);
    if (state.state === 'ready' && cached && readNow() >= cached.expiresAt) {
      state = {...state, state: 'unverified', reason: '空间登录状态待重新验证'};
    }
    return {...state};
  }

  function notify() {
    const snapshot = status();
    try {
      const result = onChange(snapshot);
      if (result && typeof result.then === 'function') result.catch(() => {});
    } catch {
      // Observers are advisory and must not affect session correctness.
    }
  }

  function cancelActive() {
    const token = active;
    active = null;
    generation += 1;
    if (token) {
      token.cancelled = true;
      try {
        token.controller.abort();
      } catch {
        // An abort observer must not prevent local cleanup.
      }
    }
  }

  function clearCredentials() {
    cached = null;
    failure = null;
  }

  function markInvalidConnection() {
    cancelActive();
    staleBarrier += 1;
    currentKey = null;
    clearCredentials();
    state = {
      ...state,
      state: 'unavailable',
      qqConnected: null,
      checkedAt: readNow(),
      nextCheckAt: null,
      reason: ERROR_MESSAGES.QZONE_UNAVAILABLE,
      checking: false
    };
    notify();
  }

  function observeConnection(rawConnection) {
    const connection = normalizeConnection(rawConnection);
    if (!connection) {
      markInvalidConnection();
      return null;
    }

    const key = cacheKey(connection);
    if (key !== currentKey) {
      cancelActive();
      staleBarrier += 1;
      currentKey = key;
      clearCredentials();
      state = {
        state: connection.connected ? 'unverified' : 'offline',
        qqConnected: connection.connected,
        checkedAt: null,
        lastSuccessAt: null,
        nextCheckAt: null,
        reason: connection.connected ? null : ERROR_MESSAGES.QZONE_OFFLINE,
        checking: false
      };
      notify();
      return connection;
    }

    if (state.qqConnected !== connection.connected) {
      state.qqConnected = connection.connected;
      if (!connection.connected) {
        cancelActive();
        staleBarrier += 1;
        clearCredentials();
        state = {
          ...state,
          state: 'offline',
          checkedAt: readNow(),
          nextCheckAt: null,
          reason: ERROR_MESSAGES.QZONE_OFFLINE,
          checking: false
        };
      } else {
        state = {
          ...state,
          state: 'unverified',
          nextCheckAt: null,
          reason: null,
          checking: false
        };
      }
      notify();
    }
    return connection;
  }

  function tokenCurrent(token) {
    return !token.cancelled
      && !token.controller.signal.aborted
      && active === token
      && generation === token.generation
      && currentKey === token.key;
  }

  function assertToken(token) {
    if (closed) throw stableError('QZONE_SESSION_CLOSED');
    if (!tokenCurrent(token)) throw stableError('QZONE_ABORTED');
  }

  async function verifyConnection(token) {
    let rawConnection;
    try {
      rawConnection = await getConnection();
    } catch {
      assertToken(token);
      throw stableError('QZONE_UNAVAILABLE');
    }
    assertToken(token);
    observeConnection(rawConnection);
    assertToken(token);
  }

  async function guardedCall(token, dependency) {
    let value;
    let failureValue;
    let failed = false;
    const signal = token.controller.signal;
    let onAbort;
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(stableError('QZONE_ABORTED'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, {once: true});
    });
    try {
      value = await Promise.race([Promise.resolve().then(dependency), aborted]);
    } catch (error) {
      failureValue = error;
      failed = true;
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
    if (signal.aborted) assertToken(token);
    await verifyConnection(token);
    if (failed) throw failureValue;
    return value;
  }

  function retryDelay(count) {
    const exponent = Math.min(Math.max(count - 1, 0), 30);
    return Math.min(maxRetry, retry * (2 ** exponent));
  }

  function commitSuccess(token, auth) {
    assertToken(token);
    const at = readNow();
    cached = {
      key: token.key,
      auth: copyAuth(auth),
      expiresAt: at + ttl
    };
    failure = null;
    state = {
      ...state,
      state: 'ready',
      qqConnected: true,
      checkedAt: at,
      lastSuccessAt: at,
      nextCheckAt: cached.expiresAt,
      reason: '自己的空间只读检查已通过；发布和评论仍以实际回执为准',
      checking: false
    };
    notify();
  }

  function commitFailure(token, error) {
    if (!tokenCurrent(token)) throw stableError('QZONE_ABORTED');
    const code = errorCode(error);
    const at = readNow();
    const count = failure && failure.key === token.key ? failure.count + 1 : 1;
    const retryAt = at + retryDelay(count);
    failure = {
      key: token.key,
      count,
      code,
      retryAt
    };
    cached = null;
    state = {
      ...state,
      state: FAILURE_STATES[code],
      qqConnected: true,
      checkedAt: at,
      nextCheckAt: retryAt,
      reason: ERROR_MESSAGES[code],
      checking: false
    };
    notify();
  }

  function beginChecking(token) {
    assertToken(token);
    state = {
      ...state,
      state: 'checking',
      nextCheckAt: null,
      reason: '正在用当前 QQ 登录凭据核对空间状态',
      checking: true
    };
    notify();
  }

  async function runRefresh(token) {
    try {
      beginChecking(token);

      let auth = normalizeAuth(await guardedCall(
        token,
        () => loadAuth({
          connection: copyConnection(token.connection),
          signal: token.controller.signal
        })
      ));

      let probeValue;
      try {
        probeValue = await guardedCall(
          token,
          () => probeAuth(copyAuth(auth), {
            connection: copyConnection(token.connection),
            signal: token.controller.signal
          })
        );
        const probeFailure = explicitProbeError(probeValue);
        if (probeFailure) throw probeFailure;
      } catch (error) {
        if (errorCode(error) !== 'QZONE_AUTH_REQUIRED') throw error;

        assertToken(token);
        auth = normalizeAuth(await guardedCall(
          token,
          () => loadAuth({
            connection: copyConnection(token.connection),
            signal: token.controller.signal
          })
        ));
        probeValue = await guardedCall(
          token,
          () => probeAuth(copyAuth(auth), {
            connection: copyConnection(token.connection),
            signal: token.controller.signal
          })
        );
        const retryFailure = explicitProbeError(probeValue);
        if (retryFailure) throw retryFailure;
      }

      commitSuccess(token, auth);
      return copyAuth(auth);
    } catch (error) {
      if (!tokenCurrent(token)) {
        throw stableError(closed ? 'QZONE_SESSION_CLOSED' : 'QZONE_ABORTED');
      }
      commitFailure(token, error);
      throw stableError(errorCode(error));
    } finally {
      if (active === token) active = null;
    }
  }

  function copyConnection(connection) {
    return {
      accountId: connection.accountId,
      revision: connection.revision,
      connected: connection.connected
    };
  }

  async function getAuthOperation({force = false} = {}) {
    if (closed) throw stableError('QZONE_SESSION_CLOSED');

    const startBarrier = staleBarrier;
    let rawConnection;
    try {
      rawConnection = await getConnection();
    } catch {
      if (closed) throw stableError('QZONE_SESSION_CLOSED');
      if (staleBarrier !== startBarrier) throw stableError('QZONE_ABORTED');
      markInvalidConnection();
      throw stableError('QZONE_UNAVAILABLE');
    }
    if (closed) throw stableError('QZONE_SESSION_CLOSED');
    if (staleBarrier !== startBarrier) {
      const latestConnection = normalizeConnection(rawConnection);
      const latestKey = latestConnection ? cacheKey(latestConnection) : null;
      const joinsCurrent = latestKey === currentKey
        && (!!active || !!cached || !!failure || state.state === 'offline');
      if (!joinsCurrent) throw stableError('QZONE_ABORTED');
    }

    const connection = observeConnection(rawConnection);
    if (!connection) throw stableError('QZONE_UNAVAILABLE');
    if (!connection.connected) throw stableError('QZONE_OFFLINE');

    if (active && active.key === currentKey) return active.promise;

    const at = readNow();
    if (failure && failure.key === currentKey && at < failure.retryAt) {
      throw stableError(failure.code);
    }
    if (!force && cached && cached.key === currentKey && at < cached.expiresAt) {
      return copyAuth(cached.auth);
    }

    const token = {
      key: currentKey,
      generation,
      connection,
      controller: new AbortController(),
      cancelled: false
    };
    active = token;
    token.promise = runRefresh(token);
    token.promise.catch(() => {});
    return token.promise;
  }

  function getAuth(options = {}) {
    const promise = getAuthOperation(options);
    promise.catch(() => {});
    return promise;
  }

  async function check({force = false} = {}) {
    if (closed) return status();
    try {
      await getAuth({force});
    } catch {
      // Status is the public, redacted result of a probe.
    }
    return status();
  }

  function invalidate(reason = 'expired') {
    if (closed) return;
    cancelActive();
    staleBarrier += 1;
    clearCredentials();
    const at = readNow();
    const normalized = String(reason ?? '').toLowerCase();
    let nextState = 'unverified';
    let text = INVALIDATE_TEXT.expired;
    if (normalized === 'qq-reconnected') {
      text = 'QQ 已连接，等待核对空间登录';
    } else if (normalized === 'qzone_auth_required' || normalized === 'auth_required' || normalized === 'auth-required') {
      nextState = 'auth_required';
      text = INVALIDATE_TEXT.auth_required;
    } else if (normalized === 'qzone_throttled' || normalized === 'throttled') {
      nextState = 'throttled';
      text = INVALIDATE_TEXT.throttled;
    } else if (normalized === 'qzone_unsupported' || normalized === 'unsupported') {
      nextState = 'unsupported';
      text = INVALIDATE_TEXT.unsupported;
    }
    state = {
      ...state,
      state: nextState,
      checkedAt: at,
      nextCheckAt: null,
      reason: text,
      checking: false
    };
    notify();
  }

  function offline() {
    if (closed) return;
    cancelActive();
    staleBarrier += 1;
    clearCredentials();
    currentKey = null;
    state = {
      ...state,
      state: 'offline',
      qqConnected: false,
      checkedAt: readNow(),
      nextCheckAt: null,
      reason: ERROR_MESSAGES.QZONE_OFFLINE,
      checking: false
    };
    notify();
  }

  function close() {
    if (closed) return;
    cancelActive();
    staleBarrier += 1;
    closed = true;
    clearCredentials();
    currentKey = null;
    state = {
      ...state,
      state: 'offline',
      qqConnected: false,
      checkedAt: readNow(),
      nextCheckAt: null,
      reason: ERROR_MESSAGES.QZONE_SESSION_CLOSED,
      checking: false
    };
    notify();
  }

  return {getAuth, check, status, invalidate, offline, close};
}
