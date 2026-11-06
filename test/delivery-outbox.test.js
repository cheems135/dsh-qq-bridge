import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelOutgoingDelivery,
  knownUnsentRetry,
  queuedDeliverySelection,
} from '../delivery-outbox.js';

test('selection respects per-chat FIFO and returns the first due head in input order', () => {
  const waitingHead = {
    id: 'a-blocker',
    accountId: 'account-1',
    chat: 'chat-1',
    status: 'queued',
    nextAttemptAt: 150,
  };
  const blockedLater = {
    id: 'a-later',
    accountId: 'account-1',
    chat: 'chat-1',
    status: 'queued',
  };
  const dueOtherChat = {
    id: 'b-due',
    accountId: 'account-1',
    chat: 'chat-2',
    status: 'queued',
  };
  const dueOtherAccount = {
    id: 'c-due',
    accountId: 'account-2',
    chat: 'chat-1',
    status: 'queued',
  };

  assert.strictEqual(
    queuedDeliverySelection(
      [waitingHead, blockedLater, dueOtherChat, dueOtherAccount],
      100,
    ).job,
    dueOtherChat,
  );

  waitingHead.status = 'sending';
  assert.strictEqual(
    queuedDeliverySelection([waitingHead, blockedLater], 200).job,
    null,
  );

  waitingHead.status = 'sent';
  assert.strictEqual(
    queuedDeliverySelection([waitingHead, blockedLater], 200).job,
    blockedLater,
  );
});

test('a scheduled chat does not prevent another chat from progressing', () => {
  const future = {
    id: 'future',
    accountId: 'account-1',
    chat: 'waiting-chat',
    status: 'queued',
    notBefore: 200,
    nextAttemptAt: 125,
  };
  const ready = {
    id: 'ready',
    accountId: 'account-1',
    chat: 'ready-chat',
    status: 'queued',
  };

  assert.deepEqual(queuedDeliverySelection([future, ready], 100), {
    job: ready,
    nextAt: null,
  });
  assert.deepEqual(queuedDeliverySelection([future], 100), {
    job: null,
    nextAt: 200,
  });
});

test('future scheduling uses the latest finite boundary and reports the earliest future head', () => {
  const first = {
    id: 'first',
    accountId: 'a',
    chat: 'one',
    status: 'queued',
    notBefore: 140,
    nextAttemptAt: 130,
  };
  const second = {
    id: 'second',
    accountId: 'a',
    chat: 'two',
    status: 'queued',
    notBefore: 150,
    nextAttemptAt: 120,
  };

  assert.deepEqual(queuedDeliverySelection([first, second], 100), {
    job: null,
    nextAt: 140,
  });
  assert.strictEqual(queuedDeliverySelection([first, second], 140).job, first);
});

test('non-finite scheduling fields are treated as zero', () => {
  const job = {
    id: 'finite',
    accountId: 'a',
    chat: 'one',
    status: 'queued',
    notBefore: Number.POSITIVE_INFINITY,
    nextAttemptAt: Number.NaN,
  };

  assert.strictEqual(queuedDeliverySelection([job], 0).job, job);
});

test('unknown, failed, cancelled, and sent deliveries are never selected', () => {
  const inactive = ['unknown', 'failed', 'cancelled', 'sent'].map((status, index) => ({
    id: status,
    accountId: `account-${index}`,
    chat: 'chat',
    status,
  }));

  assert.deepEqual(queuedDeliverySelection(inactive, 100), {
    job: null,
    nextAt: null,
  });
});

test('definite-unsent retries back off exponentially and leave attempt fields untouched', () => {
  const error = {submitted: false, retryable: true};

  for (let previous = 0; previous < 4; previous += 1) {
    const job = {at: 10000, unsentRetries: previous, attempts: 9};
    assert.deepEqual(knownUnsentRetry(job, error, {now: 50000}), {
      unsentRetries: previous + 1,
      nextAttemptAt: 50000 + Math.min(15000, 1000 * 2 ** previous),
    });
    assert.equal(job.unsentRetries, previous);
    assert.equal(job.attempts, 9);
  }
});

test('retry requires a definite, retryable, non-unknown failure', () => {
  const job = {at: 10000};
  const accepted = {submitted: false, retryable: true, deliveryUnknown: false};

  assert.notEqual(knownUnsentRetry(job, accepted, {now: 20000}), null);
  for (const error of [
    null,
    {submitted: true, retryable: true},
    {submitted: undefined, retryable: true},
    {submitted: false, retryable: false},
    {submitted: false, retryable: undefined},
    {submitted: false, retryable: true, deliveryUnknown: true},
  ]) {
    assert.equal(knownUnsentRetry(job, error, {now: 20000}), null);
  }
});

test('retry rejects exhausted counts, stale jobs, and invalid timestamps', () => {
  const error = {submitted: false, retryable: true};

  assert.equal(
    knownUnsentRetry({at: 10000, unsentRetries: 4}, error, {now: 20000}),
    null,
  );
  assert.equal(
    knownUnsentRetry({at: 0}, error, {now: 120001}),
    null,
  );
  assert.notEqual(
    knownUnsentRetry({at: 0}, error, {now: 120000}),
    null,
  );

  for (const at of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(knownUnsentRetry({at}, error, {now: 20000}), null);
  }
});

test('cancelling a queued delivery makes it terminal and prevents resend', () => {
  const job = {
    status: 'queued',
    updatedAt: 1,
    error: 'old',
    attempts: 2,
  };

  assert.equal(cancelOutgoingDelivery(job, 'user cancelled', 1234), true);
  assert.equal(job.status, 'cancelled');
  assert.equal(job.updatedAt, 1234);
  assert.match(job.error, /user cancelled/);
  assert.match(job.error, /不自动补发/);
  assert.equal(job.attempts, 2);
});

test('cancelling a sending delivery records ambiguous delivery as unknown', () => {
  const job = {status: 'sending'};

  assert.equal(cancelOutgoingDelivery(job, 'local timeout', 4321), true);
  assert.equal(job.status, 'unknown');
  assert.equal(job.updatedAt, 4321);
  assert.match(job.error, /local timeout/);
  assert.match(job.error, /回执未确认/);
  assert.match(job.error, /不自动重发/);
  assert.equal(cancelOutgoingDelivery(job, 'duplicate', 5000), false);
  assert.equal(job.status, 'unknown');
  assert.equal(job.updatedAt, 4321);
});

test('cancellation leaves other delivery states unchanged', () => {
  for (const status of ['unknown', 'failed', 'cancelled', 'sent']) {
    const job = {status, updatedAt: 7, error: 'keep'};
    assert.equal(cancelOutgoingDelivery(job, 'ignored', 99), false);
    assert.deepEqual(job, {status, updatedAt: 7, error: 'keep'});
  }
});
