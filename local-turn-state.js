export function localScopeKey(scope = {}) {
  return JSON.stringify([scope.accountId || '', scope.personaId || '', scope.personaVersion || '', scope.key || '']);
}

export function localScopeCurrent(scope, getCurrent, {stopped = false, accountPaused = false} = {}) {
  if (!scope || stopped || accountPaused) return false;
  try {
    return localScopeKey(getCurrent(scope)) === localScopeKey(scope);
  } catch {
    return false;
  }
}

export function abortScopedLocalTurn(turns, key, scope, onAbort) {
  const active = turns.get(key);
  if (!active) return false;
  if (scope && localScopeKey(active.scope) !== localScopeKey(scope)) return false;
  active.controller.abort();
  onAbort?.(active);
  return true;
}

export function deliveryScopeCurrent(expected, current) {
  if (expected?.accountId !== undefined && expected.accountId !== current?.accountId) return false;
  if (expected?.personaVersion !== undefined && expected.personaVersion !== current?.personaVersion) return false;
  return true;
}
