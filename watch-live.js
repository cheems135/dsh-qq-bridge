// Playback-aware segment timing for live watching. The approach is inspired by
// dsh-watch-together (Apache-2.0), but this module only computes boundaries; it
// does not run a background loop or schedule speech.
export const DEFAULT_RAMP = Object.freeze([60, 120, 180, 240]);
export const DEFAULT_SEGMENT = 300;
export const DEFAULT_LEAD = 15;

const clamp = (value, max = Infinity) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : 0;
};

/** The current segment, with a short ramp so the first segment arrives sooner. */
export function watchSegment(position, {
  segment = DEFAULT_SEGMENT,
  ramp = DEFAULT_RAMP,
  lead = DEFAULT_LEAD,
} = {}) {
  const pos = clamp(position);
  const steady = Number(segment) > 0 ? Number(segment) : DEFAULT_SEGMENT;
  const steps = Array.isArray(ramp)
    ? ramp.map(Number).filter((value) => Number.isFinite(value) && value > 0)
    : [];
  const prefix = [0];
  for (let i = 0; i < steps.length; i += 1) prefix.push(prefix[i] + steps[i]);
  const rampEnd = prefix[steps.length];
  let index;
  let from;
  let size;
  if (steps.length > 0 && pos < rampEnd) {
    index = 0;
    while (index + 1 < steps.length && prefix[index + 1] <= pos) index += 1;
    from = prefix[index];
    size = steps[index];
  } else {
    index = steps.length + Math.floor((pos - rampEnd) / steady);
    from = rampEnd + (index - steps.length) * steady;
    size = steady;
  }
  const to = from + size;
  const safeLead = Math.max(0, Math.min(size, Number(lead) || 0));
  const sayAt = Math.max(from, to - safeLead);
  return {
    index,
    from,
    to,
    size,
    lead: safeLead,
    sayAt,
    nextAt: pos < sayAt ? sayAt : to,
    progress: size > 0 ? Math.max(0, Math.min(1, (pos - from) / size)) : 0,
    due: pos >= sayAt && pos <= to,
  };
}

/** Freshness of a browser player sample, mirroring the position estimate rules. */
export function playerPosition(player, now = Date.now(), {freshMs = 5000, maxStaleMs = 60000} = {}) {
  const pos = clamp(player?.currentTime, Number(player?.duration) || Infinity);
  const paused = player?.paused === true;
  const ended = player?.ended === true;
  const sampledAt = Number(player?.at) || now;
  const ageMs = Math.max(0, now - sampledAt);
  if (ended) return {at: pos, paused, ended, ageMs, confidence: 'ended', reason: 'ended'};
  if (paused) return {at: pos, paused, ended, ageMs, confidence: 'fresh', reason: 'paused'};
  if (ageMs <= freshMs) return {at: pos, paused, ended, ageMs, confidence: 'fresh', reason: 'recent-read'};
  if (ageMs <= maxStaleMs) return {at: clamp(pos + ageMs / 1000, Number(player?.duration) || Infinity), paused, ended, ageMs, confidence: 'extrapolated', reason: 'wall-clock'};
  return {at: pos, paused, ended, ageMs, confidence: 'unknown', reason: 'stale'};
}
