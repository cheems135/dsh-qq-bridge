const ACTIVE_DELIVERY_STATUSES = new Set(['queued', 'sending']);

function finiteScheduleValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function deliveryScopeKey(accountId, chat) {
  return [accountId, chat];
}

function sameDeliveryScope(left, right) {
  return left[0] === right[0] && left[1] === right[1];
}

export function queuedDeliverySelection(jobs, now = Date.now()) {
  if (!Array.isArray(jobs)) return {job: null, nextAt: null};

  const heads = [];
  let selectedJob = null;
  let earliestFuture = null;

  for (const job of jobs) {
    if (!job || !ACTIVE_DELIVERY_STATUSES.has(job.status)) continue;

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
