const ACTIVE_DELIVERY_STATUSES = new Set(['queued', 'sending']);

export function isProgressDelivery(row) {
  return row?.deliveryRole === 'progress' || /^local:queue:|:wait(?::(?:line|part):\d+)?$/.test(row?.deliveryKey || '');
}

export function deliveryMatchesAudit(row, audit) {
  const persona = audit.personaId || audit.persona;
  return row.auditId === audit.id &&
    (row.accountId == null || row.accountId === audit.accountId) &&
    (!row.personaId || !persona || row.personaId === persona) &&
    (!row.chat || row.chat === audit.chat || audit.outboxIds?.includes(row.id));
}

export function hasDeliveryReceipt(row) {
  return row.status === 'sent' && (!!row.messageId ||
    row.uploadReceipt?.transport === 'accepted' && ['upload_private_file', 'upload_group_file'].includes(row.uploadReceipt.action));
}

// The caller supplies the formal deliveries for one request.
export function replyDeliveryState(rows, interrupted = false) {
  if (!rows.length) return '';
  if (rows.some(row => row.status === 'unknown' || row.status === 'sent' && !hasDeliveryReceipt(row) ||
      interrupted && row.status === 'sending')) return 'unknown';
  if (rows.some(row => row.status === 'failed')) return 'failed';
  if (rows.some(row => ['queued', 'sending'].includes(row.status))) return 'queued';
  if (rows.every(row => row.status === 'sent')) return 'sent';
  return rows.every(row => row.status === 'cancelled') ? 'cancelled' : 'unknown';
}

function finiteScheduleValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function deliveryScopeKey(accountId, chat) {
  return [accountId, chat];
}

function sameDeliveryScope(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

export function queuedDeliverySelection(jobs, now = Date.now(), sender) {
  if (!Array.isArray(jobs)) return {job: null, nextAt: null};

  const heads = [];
  let selectedJob = null;
  let earliestFuture = null;

  for (const job of jobs) {
    if (!job || !ACTIVE_DELIVERY_STATUSES.has(job.status)) continue;
    if (sender && (job.accountId !== sender.qqAccountId || job.qqSenderId !== sender.qqSenderId)) continue;

    const scope = deliveryScopeKey(job.accountId, job.chat);
    if (heads.some(head => sameDeliveryScope(head, scope))) continue;
    heads.push(scope);

    if (job.status !== 'queued') continue;

    const dueAt = Math.max(
      finiteScheduleValue(job.notBefore),
      finiteScheduleValue(job.nextAttemptAt),
    );

    if (dueAt <= now) {
      if (selectedJob === null) selectedJob = job;
      continue;
    }

    if (earliestFuture === null || dueAt < earliestFuture) {
      earliestFuture = dueAt;
    }
  }

  if (selectedJob !== null) return {job: selectedJob, nextAt: null};
  return {job: null, nextAt: earliestFuture};
}

// Recover the physical QQ sender for jobs written by older versions. Only
// identifiers associated with the same chat, account and incoming turn count.
export function bindQueuedSenders(state, account, previousSelf, configuredSelf) {
  let changed = false;
  for (const job of state.outbox) {
    if (job.status !== 'queued' || job.accountId !== account || job.qqSenderId) continue;
    const audit = state.audits?.find(row => row.id === job.auditId && row.chat === job.chat && row.accountId === account);
    const ids = new Set((job.replyToInboundIds || audit?.inboundIds || []).map(String));
    const senders = new Set();
    for (const input of state.inbox || []) {
      if (input.key !== job.chat || (input.accountId != null && input.accountId !== account)) continue;
      if (!(input.receivedIds || [input.payload?.message_id]).some(id => id != null && ids.has(String(id)))) continue;
      const sender = input.payload?.self_id ?? /^(\d+):/.exec(input.id)?.[1];
      if (sender != null) senders.add(String(sender));
    }
    const expected = audit?.qqSenderId || (senders.size === 1 ? [...senders][0] : previousSelf || configuredSelf);
    if (senders.size > 1 || !/^\d{5,20}$/.test(String(expected || ''))) {
      job.status = 'failed';
      job.error = '旧发送记录缺少可核实的发件 QQ，尚未提交；请核对当前登录后手动重发';
    } else job.qqSenderId = String(expected);
    changed = true;
  }
  return changed;
}

export function knownUnsentRetry(
  job,
  error,
  {now = Date.now(), maxRetries = 4, maxAgeMs = 120000} = {},
) {
  if (
    !job
    || !error
    || error.submitted !== false
    || error.retryable !== true
    || error.deliveryUnknown === true
    || !Number.isFinite(job.at)
    || !Number.isFinite(now)
    || !Number.isFinite(maxRetries)
    || !Number.isFinite(maxAgeMs)
    || now - job.at > maxAgeMs
  ) {
    return null;
  }

  const rawCount = job.unsentRetries ?? 0;
  if (!Number.isInteger(rawCount) || rawCount < 0 || rawCount >= maxRetries) {
    return null;
  }

  return {
    unsentRetries: rawCount + 1,
    nextAttemptAt: now + Math.min(15000, 1000 * 2 ** rawCount),
  };
}

export function cancelOutgoingDelivery(job, reason, now = Date.now()) {
  if (!job || (job.status !== 'queued' && job.status !== 'sending')) return false;

  const reasonText = String(reason);
  job.updatedAt = now;

  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.error = `${reasonText}，本条尚未提交，不自动补发`;
  } else {
    job.status = 'unknown';
    job.error = `${reasonText}，发送回执未确认，原消息可能已送达，不自动重发`;
  }

  return true;
}
