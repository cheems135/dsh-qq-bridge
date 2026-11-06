import test from 'node:test';
import assert from 'node:assert/strict';
import {abortScopedLocalTurn, deliveryScopeCurrent, localScopeCurrent, localScopeKey} from '../local-turn-state.js';

const scope = {accountId: 'a1', personaId: 'p1', personaVersion: 'v1', key: 'private:10001'};

test('scope comparison includes account persona version and chat', () => {
  assert.notEqual(localScopeKey(scope), localScopeKey({...scope, accountId: 'a2'}));
  assert.notEqual(localScopeKey(scope), localScopeKey({...scope, personaId: 'p2'}));
  assert.notEqual(localScopeKey(scope), localScopeKey({...scope, key: 'private:10002'}));
  assert.equal(localScopeCurrent(scope, () => ({...scope})), true);
  assert.equal(localScopeCurrent(scope, () => ({...scope, accountId: 'a2'})), false);
  assert.equal(localScopeCurrent(scope, () => ({...scope}), {accountPaused: true}), false);
});

test('old scoped turn cannot cancel a new account or persona turn', () => {
  let aborted = 0;
  const active = {scope: {...scope, accountId: 'a2'}, controller: {abort() { aborted += 1; }}};
  const turns = new Map([[scope.key, active]]);
  assert.equal(abortScopedLocalTurn(turns, scope.key, scope), false);
  assert.equal(aborted, 0);
  assert.equal(abortScopedLocalTurn(turns, scope.key, {...scope, accountId: 'a2'}), true);
  assert.equal(aborted, 1);
});

test('delivery expected scope prevents stale account or persona output', () => {
  assert.equal(deliveryScopeCurrent({accountId: 'a1', personaVersion: 'v1'}, {accountId: 'a1', personaVersion: 'v1'}), true);
  assert.equal(deliveryScopeCurrent({accountId: 'a1', personaVersion: 'v1'}, {accountId: 'a2', personaVersion: 'v1'}), false);
  assert.equal(deliveryScopeCurrent({accountId: 'a1', personaVersion: 'v1'}, {accountId: 'a1', personaVersion: 'v2'}), false);
});
