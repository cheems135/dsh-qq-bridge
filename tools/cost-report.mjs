/**
 * cost-report.mjs — per-turn token usage and RMB cost for DSH v4 session logs.
 *
 * Pricing mirrors dsh-whale-widget's table (DeepSeek CNY per million tokens,
 * peak vs off-peak): flash hit/miss/out = 0.02/1/4 off-peak, 0.04/2/8 peak.
 * Peak = Beijing time, Monday–Friday, 09:00–12:00 and 14:00–18:00; weekends
 * count as off-peak. National-holiday dates are not modelled (noted in output).
 *
 * Usage: node tools/cost-report.mjs <session.v4.jsonl.zstd> [...]
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const PRICES = {
  'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
  'deepseek-v4-pro': { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
};
const PRICE_DEFAULT = PRICES['deepseek-flash'];

function readSession(file) {
  const bytes = readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const cuts = [];
  for (let i = 0; i <= bytes.length - 4; i += 1) {
    if (bytes[i] === magic[0] && bytes[i + 1] === magic[1] && bytes[i + 2] === magic[2] && bytes[i + 3] === magic[3]) {
      cuts.push(i);
    }
  }
  cuts.push(bytes.length);
  let text = '';
  for (let k = 0; k < cuts.length - 1; k += 1) {
    try {
      text += zstdDecompressSync(bytes.subarray(cuts[k], cuts[k + 1])).toString('utf8');
    } catch {
      /* not a frame boundary */
    }
  }
  return text
    .trim()
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function beijing(date) {
  return new Date(date.getTime() + 8 * 3600 * 1000);
}

function isPeak(timeMs) {
  const local = beijing(new Date(timeMs));
  const day = local.getUTCDay();
  if (day === 0 || day === 6) return false;
  const hour = local.getUTCHours();
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
}

function priceOf(model) {
  const name = String(model ?? '').toLowerCase();
  for (const [key, value] of Object.entries(PRICES)) {
    if (name.includes(key)) return value;
  }
  return PRICE_DEFAULT;
}

function costOf(usage, model, timeMs) {
  const price = priceOf(model);
  const tier = isPeak(timeMs) ? 1 : 0;
  const input = Number(usage.inputTokens) || 0;
  const cache = Number(usage.cacheReadTokens) || 0;
  const output = Number(usage.outputTokens) || 0;
  const cost = (cache / 1e6) * price.hit[tier] + (input / 1e6) * price.miss[tier] + (output / 1e6) * price.out[tier];
  return { input, cache, output, cost, tier };
}

for (const file of process.argv.slice(2)) {
  const events = readSession(file);
  const header = events.find((event) => event.type === 'session');
  const turns = new Map();
  for (const event of events) {
    if (event.type !== 'assistant/message' || !event.data?.usage) continue;
    const turn = event.data.turn ?? 0;
    const entry = turns.get(turn) ?? { input: 0, cache: 0, output: 0, cost: 0, peak: false, model: '' };
    const c = costOf(event.data.usage, event.data.message?.source?.model, event.time ?? Date.now());
    entry.input += c.input;
    entry.cache += c.cache;
    entry.output += c.output;
    entry.cost += c.cost;
    entry.peak = c.tier === 1;
    entry.model = event.data.message?.source?.model ?? entry.model;
    turns.set(turn, entry);
  }
  console.log(`\n=== ${header?.id ?? file}`);
  console.log(`preset=${header?.agentPreset ?? '?'} turns=${turns.size}`);
  console.log('turn |   输入(未缓存) | 缓存命中 | 输出 | 费用(¥)   | 时段');
  let total = 0;
  for (const [turn, entry] of [...turns.entries()].sort((a, b) => a[0] - b[0])) {
    total += entry.cost;
    console.log(
      `${String(turn).padStart(4)} | ${String(entry.input).padStart(13)} | ${String(entry.cache).padStart(8)} | ${String(entry.output).padStart(4)} | ${entry.cost.toFixed(6)} | ${entry.peak ? '高峰' : '空闲'} ${entry.model}`,
    );
  }
  const values = [...turns.values()];
  console.log(`合计 ¥${total.toFixed(6)}  · 平均每轮 ¥${(total / Math.max(1, values.length)).toFixed(6)}`);
}
