import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeMemory} from '../life-memory.js';

test('one corrupt calendar document cannot abort startup pruning', () => {
  const badName = `${'a'.repeat(64)}.json`;
  const life = createLifeMemory({
    storage: {
      list: () => [badName],
      read: () => { throw Object.assign(new Error('quarantined'), {code:'MEMORY_CORRUPT'}); },
      write: () => {},
      remove: () => { throw new Error('corrupt document must not be deleted by prune'); },
    },
    config: () => ({life:{enabled:false},memory:{enabled:false}}),
    allowed: () => true,
    roles: () => [],
    signature: () => '',
    ask: async () => '',
  });
  assert.doesNotThrow(() => life.prune(() => true));
  assert.deepEqual(life.scopes(), []);
});
