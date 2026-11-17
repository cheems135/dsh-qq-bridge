#!/usr/bin/env node
/**
 * fx-lab：一条命令管「素材 → 变体 → 对比」。
 * 费用只在 synth：同一句台词+情绪只合成一次，之后所有声学实验都走本地缓存，零积分。
 * 用法：
 *   fx-lab synth  --line "唔……嗯……" --emotion moan            # 合成并缓存，打印 take id
 *   fx-lab import --file /path/audio.mp3                        # 把已有音频登记成素材（不花钱）
 *   fx-lab takes                                                # 列出已有素材
 *   fx-lab render --take <id> --scene 拍打 --out /tmp/a.mp3 [--method filter|world] [--set pole=260,0.3] [--events wet:0.2,slap:0.3] [--react 0.42:0.7]
 *   fx-lab sweep  --take <id> --scene 拍打 --param pole --values 0.15,0.3,0.45 --outdir /tmp/sweep
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CACHE = join(ROOT, '.cache', 'fx-lab');
const SETTINGS = '/root/projects/.dsh/im-bridge-mobile/settings.json';
const SCENES = join(ROOT, 'voice-scenes.json');
const APPROVED = join(ROOT, 'voice-presets-approved.json');
const PY = process.env.DSH_SCENE_PYTHON || '/root/projects/.dsh/tools/qq-bridge-mobile-media/bin/python';
const FFMPEG = process.env.DSH_FFMPEG || '/usr/bin/ffmpeg';
mkdirSync(CACHE, { recursive: true });

const args = process.argv.slice(2);
const cmd = args[0] || 'help';
const opt = (name, dflt = '') => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const key = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

function scenes() {
  try { return JSON.parse(readFileSync(SCENES, 'utf8')).scenes || {}; } catch { return {}; }
}
function approvedAll() {
  try { return JSON.parse(readFileSync(APPROVED, 'utf8')); } catch { return { presets: {} }; }
}
function approvedSave(db) { writeFileSync(APPROVED, JSON.stringify(db, null, 1)); }

function approve() {
  const take = opt('take'), scene = opt('scene'), label = opt('label');
  if (!take || !existsSync(takePath(take))) throw new Error('需要已存在的 --take');
  if (!label) throw new Error('需要 --label（这条叫什么）');
  const sets = opt('set') ? opt('set').split(',') : [];
  const { fx } = buildFx(scene, sets);
  const events = opt('events') ? parseEvents(opt('events')) : (scenes()[scene]?.events || []);
  const react = (opt('react') || '').split(',').filter(Boolean).map(p => { const [at, depth] = p.split(':').map(Number); return { at, depth }; });
  const method = opt('method', 'filter');
  const row = render({ take, scene, sets, method, out: opt('probe', join('/tmp', 'probe-' + Date.now() + '.mp3')) });
  const db = approvedAll();
  const id = key(label + '|' + Date.now());
  db.presets[id] = { id, label, scene, take, method, fx, events, react, line: opt('line'), emotion: opt('emotion'),
    bands: row.bands, duration: row.duration, approvedAt: new Date().toISOString() };
  approvedSave(db);
  return { approved: id, label, scene, take, method, bands: row.bands };
}

function presets() {
  const db = approvedAll();
  return Object.values(db.presets).map(p => ({ id: p.id, label: p.label, scene: p.scene, take: p.take, method: p.method, bands: p.bands, duration: p.duration, approvedAt: p.approvedAt }));
}

async function clone() {
  const which = opt('preset');
  const db = approvedAll();
  const p = Object.values(db.presets).find(x => x.id === which || x.label === which);
  if (!p) throw new Error('找不到这条已认可的预设');
  if (!existsSync(takePath(p.take))) {
    if (!p.line) throw new Error('素材不在了，也没存台词，无法复刻');
    await synth.call(null);
  }
  const row = render({ take: p.take, scene: p.scene, sets: [], method: p.method, out: opt('out', join('/tmp', 'clone-' + Date.now() + '.mp3')) });
  return { cloned: p.label, out: row.out, bands: row.bands, duration: row.duration };
}

function takePath(id) { return join(CACHE, id + '.mp3'); }
function listTakes() {
  try { return readdirSync(CACHE).filter(f => f.endsWith('.mp3')).map(f => f.replace(/\.mp3$/, '')); } catch { return []; }
}

async function synth() {
  const line = opt('line'), emotion = opt('emotion', 'natural');
  if (!line) throw new Error('需要 --line');
  const id = key(line + '|' + emotion);
  if (existsSync(takePath(id))) { console.log(JSON.stringify({ take: id, cached: true })); return; }
  const { breezeSpeech } = await import('file://' + join(ROOT, 'voice-studio.js'));
  const voice = JSON.parse(readFileSync(SETTINGS, 'utf8')).voice;
  const result = await breezeSpeech(line, { ...voice, engine: 'breeze' }, { emotion });
  writeFileSync(takePath(id), result.bytes);
  console.log(JSON.stringify({ take: id, cached: false, bytes: result.bytes.length, mood: result.mood }));
}

function extract() {
  const file = opt('file');
  if (!file || !existsSync(file)) throw new Error('需要存在的 --file（视频或音频）');
  const start = opt('start', '0'), dur = opt('dur', '');
  const end = opt('end', '');
  const id = key('cut|' + file + '|' + start + '|' + (end || dur) + '|' + readFileSync(file).length);
  const out = takePath(id);
  if (!existsSync(out)) {
    const args = ['-v', 'error', '-y'];
    if (start !== '0') args.push('-ss', start);
    args.push('-i', file);
    if (end) args.push('-to', String(Math.max(0, Number(end) - Number(start))));
    else if (dur) args.push('-t', dur);
    args.push('-vn', '-ac', '1', '-ar', '24000', '-b:a', '128k', out);
    execFileSync(FFMPEG, args, { timeout: 120000 });
  }
  console.log(JSON.stringify({ take: id, seconds: Number(end || dur || 0) || null, file: out }));
}

function importFile() {
  const file = opt('file');
  if (!file || !existsSync(file)) throw new Error('需要存在的 --file');
  const id = key('import|' + file + '|' + readFileSync(file).length);
  if (!existsSync(takePath(id))) writeFileSync(takePath(id), readFileSync(file));
  console.log(JSON.stringify({ take: id, cached: existsSync(takePath(id)) }));
}

function buildFx(sceneId, sets) {
  const table = scenes();
  const base = sceneId && table[sceneId] ? JSON.parse(JSON.stringify(table[sceneId])) : {};
  const fx = base.fx || {};
  for (const pair of sets) {
    const [k, v] = pair.split('=');
    if (k === 'pole') { const [hz, amt] = v.split(/[:,]/).map(Number); if (!Number.isFinite(amt)) throw new Error('pole 写法：pole=260:0.3'); fx.pole = [hz, amt]; }
    else if (k === 'cutoff') fx.cutoff = Number(v);
    else if (k.startsWith('anti')) fx.anti = (fx.anti || []).concat([[Number(v.split(',')[0]), Number(v.split(',')[1])]]);
    else if (k === 'consonant') fx.consonant = Number(v);
    else if (k === 'breath') fx.breath = Number(v);
    else if (k === 'highpass') fx.highpass = Number(v);
  }
  return { base, fx };
}

function parseEvents(spec, baseEvents = []) {
  if (!spec) return baseEvents;
  return spec.split(',').map(s => {
    const [layer, spread] = s.split(':');
    return { layer, spread: spread === undefined ? 0.4 : Number(spread) };
  });
}

function runTool(payload) {
  const out = execFileSync(PY, [join(HERE, 'sound-fx.py')], {
    input: JSON.stringify(payload), encoding: 'utf8', timeout: 180000,
  });
  const row = JSON.parse(out.trim().split('\n').pop());
  if (!row.ok) throw new Error(row.error || '处理失败');
  return row;
}

function render(opts = {}) {
  const take = opts.take || opt('take', listTakes().slice(-1)[0] || '');
  if (!take || !existsSync(takePath(take))) throw new Error('找不到素材，先 synth 或 import');
  const sceneId = opts.scene || opt('scene');
  const { base, fx } = buildFx(sceneId, opts.sets || (opt('set') ? opt('set').split(',') : []));
  const sets = opt('set') ? opt('set').split(',') : [];
  const merged = buildFx(sceneId, sets);
  let events = parseEvents(opts.events || opt('events'), base.events || []);
  if ((opt('auto') === '1' || opts.auto) && events.length) events = events.map(e => ({ layer: e.layer }));
  const react = (opts.react || opt('react') || '').split(',').filter(Boolean).map(pair => {
    const [at, depth] = pair.split(':').map(Number);
    return { at, depth: Number.isFinite(depth) ? depth : 0.6 };
  });
  const outMp3 = opts.out || opt('out', join('/tmp', 'fx-' + Date.now() + '.mp3'));
  const wav = outMp3.replace(/\.mp3$/, '') + '.wav';
  const payload = {
    input: takePath(take), output: wav, scene: sceneId || 'custom', ffmpegPath: FFMPEG,
    method: opts.method || opt('method', 'world'), fx, events,
  };
  if (react.length) payload.react = react;
  const layers = (opts.layers || opt('layers') || '').split(',').filter(Boolean);
  if (layers.length) payload.layers = layers;
  if (opt('rt60')) payload.rt60 = Number(opt('rt60'));
  if (opt('rainlevel')) payload.rainLevel = Number(opt('rainlevel'));
  if (opt('rainheavy')) payload.rainHeavy = Number(opt('rainheavy'));
  if (opt('windlevel')) payload.windLevel = Number(opt('windlevel'));
  if (opt('drownlevel')) payload.drownLevel = Number(opt('drownlevel'));
  if (opt('breathrate')) payload.breathRate = Number(opt('breathrate'));
  if (opt('wetrate')) payload.wetRate = Number(opt('wetrate'));
  if (opt('wetlevel')) payload.wetLevel = Number(opt('wetlevel'));
  if (opt('breathtier')) payload.breathTier = Number(opt('breathtier'));
  if (opt('wet')) payload.wet = Number(opt('wet'));
  if (base.events && !opt('events') && !opts.events) payload.events = base.events;
  const report = runTool(payload);
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-i', wav, '-ar', '32000', '-ac', '1', '-b:a', '128k', outMp3], { timeout: 60000 });
  return { ...report, out: outMp3, take, scene: sceneId || 'custom' };
}

function sweep() {
  const param = opt('param', 'pole'), values = opt('values', '0.2,0.4,0.6').split(',');
  const outdir = opt('outdir', '/tmp/fx-sweep');
  mkdirSync(outdir, { recursive: true });
  const rows = [];
  for (const v of values) {
    const sets = opt('set') ? opt('set').split(',').filter(s => !s.startsWith(param + '=')) : [];
    const setPair = param === 'pole' ? `pole=260,${v}` : param === 'cutoff' ? `cutoff=${v}` : `${param}=${v}`;
    const out = join(outdir, `${param}-${v}.mp3`);
    const row = render({ sets: sets.concat([setPair]), out });
    rows.push({ value: v, out: row.out, bands: row.bands, duration: row.duration });
  }
  return rows;
}

try {
  if (cmd === 'synth') await synth();
  else if (cmd === 'import') importFile();
  else if (cmd === 'extract') extract();
  else if (cmd === 'approve') console.log(JSON.stringify(approve()));
  else if (cmd === 'presets') console.log(JSON.stringify(presets()));
  else if (cmd === 'clone') console.log(JSON.stringify(await clone()));
  else if (cmd === 'takes') console.log(JSON.stringify({ takes: listTakes() }));
  else if (cmd === 'render') console.log(JSON.stringify(render()));
  else if (cmd === 'sweep') console.log(JSON.stringify(sweep()));
  else console.log(JSON.stringify({
    usage: ['synth --line ... --emotion ...', 'import --file ...', 'extract --file video.mp4 --start 00:10 --dur 8', 'takes',
      'approve --take id --scene 场景 --label 名字 [--set ...] [--events ...] [--method filter]',
      'presets', 'clone --preset 名字 --out x.mp3',
      'render --take id --scene 场景 [--layers fabric,roomtone,room] [--rt60 0.7] [--wet 0.5] [--method filter|world] [--set pole=260:0.3,cutoff=4000] [--events wet:0.2,slap:0.3] [--react 0.42:0.7]',
      'sweep --take id --scene 场景 --param pole --values 0.2,0.4'],
    note: '只有 synth 花积分；同一句台词第二次直接读缓存',
  }));
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: String(error.message || error).slice(0, 300) }));
  process.exitCode = 1;
}
