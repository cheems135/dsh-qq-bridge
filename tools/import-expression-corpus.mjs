#!/usr/bin/env node
/**
 * Import human chat samples into the local expression corpus.
 *
 * The bridge only bundles a small MIT-licensed LCCC sample plus project-authored
 * references. Larger public corpora cannot be shipped wholesale, so this tool
 * converts a local download into the same small reference format:
 *
 *   node tools/import-expression-corpus.mjs \
 *     --src KdConv/train.json --format kdconv \
 *     --source "KdConv" --url "https://github.com/thu-coai/KdConv" \
 *     --license "Apache-2.0" --max 200
 *
 * Supported formats:
 *   lccc    LCCC-style JSON: [{dialog:[...]}] or [[...], ...]
 *   kdconv  KdConv-style JSON: [{messages:[{message:"..."}]}]
 *   jsonl   one {turns|dialog|messages} object per line
 *   json    array of the above objects
 *
 * Ratings:
 *   general (default) always eligible; edgy only owner-private/free-expression;
 *   bawdy (adult humor) eligible in any chat, as jokes only; adult (intimacy)
 *   only owner-private with the adult mode enabled. Importing adult text
 *   requires --confirm-adult, and only the owner's own files should be used.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback = '') => {
  const index = argv.indexOf('--' + name);
  return index >= 0 && argv[index + 1] !== undefined ? argv[index + 1] : fallback;
};
const flag = name => argv.includes('--' + name);
const src = opt('src');
const format = opt('format', 'jsonl');
const rating = opt('rating', 'general');
const source = opt('source', 'imported');
const url = opt('url', '');
const license = opt('license', 'unknown');
const out = opt('out', 'assets/expression-dialogues.json');
const max = Math.max(1, Math.min(2000, Number(opt('max', '200')) || 200));
if (!src) {
  console.error('usage: node tools/import-expression-corpus.mjs --src FILE --format lccc|kdconv|jsonl|json [--rating general|edgy|bawdy|adult] [--max 200]');
  process.exit(2);
}
if (!['general', 'edgy', 'bawdy', 'adult'].includes(rating)) {
  console.error('rating must be general, edgy, bawdy or adult');
  process.exit(2);
}
if (rating === 'adult' && !flag('confirm-adult')) {
  console.error('refusing adult import without --confirm-adult; only import material you have the right to use');
  process.exit(2);
}
if (!['lccc', 'kdconv', 'jsonl', 'json'].includes(format)) {
  console.error('format must be lccc, kdconv, jsonl or json');
  process.exit(2);
}
const unsafe = /https?:|www\.|@[^\s]+\.(?:com|cn|net)|(?:\d{7,})|(?:api[_-]?key|token|password|passwd|密钥|密码|验证码)/i;
const cleanTurn = value => String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function turnsOf(row) {
  if (!row || typeof row !== 'object') return [];
  if (Array.isArray(row.turns)) return row.turns.map(cleanTurn);
  if (Array.isArray(row.dialog)) return row.dialog.map(cleanTurn);
  if (Array.isArray(row.messages)) return row.messages.map(m => cleanTurn(m && typeof m === 'object' ? m.message ?? m.text : m));
  if (Array.isArray(row)) return row.map(cleanTurn);
  if (typeof row === 'string') return [cleanTurn(row)];
  return [];
}
function rowsOf(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of ['data', 'dialogues', 'rows', 'samples']) if (Array.isArray(raw[key])) return raw[key];
  }
  return [];
}
function parseInput() {
  const text = readFileSync(resolve(process.cwd(), src), 'utf8');
  if (format === 'jsonl') {
    return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }
  let raw;
  try { raw = JSON.parse(text); } catch (error) {
    throw new Error('input is not valid JSON: ' + error.message);
  }
  return rowsOf(raw);
}

const outPath = resolve(process.cwd(), out);
let doc;
if (existsSync(outPath)) {
  doc = JSON.parse(readFileSync(outPath, 'utf8'));
} else {
  doc = {version: 2, license: 'MIT (LCCC sample) + project-original', referenceOnly: true, sourceRevision: '', dialogues: []};
}
if (!Array.isArray(doc.dialogues)) doc.dialogues = [];
const known = new Set(doc.dialogues.map(d => (Array.isArray(d.turns) ? d.turns.join('\u0001') : '')));
let candidates = 0, added = 0, skipped = 0;
const reasons = {};
const reject = reason => { skipped++; reasons[reason] = (reasons[reason] || 0) + 1; };
for (const row of parseInput()) {
  if (added >= max) break;
  candidates++;
  let turns = turnsOf(row).slice(0, 8);
  turns = turns.map(t => t.slice(0, 140)).filter(Boolean);
  if (turns.length < 2) { reject('too-few-turns'); continue; }
  if (turns.join(' ').length < 6 || turns.join(' ').length > 1200) { reject('length'); continue; }
  if (unsafe.test(turns.join(' '))) { reject('unsafe-or-personal'); continue; }
  const key = turns.join('\u0001');
  if (known.has(key)) { reject('duplicate'); continue; }
  known.add(key);
  const tags = [...new Set([
    ...(Array.isArray(row.tags) ? row.tags.map(String) : []),
    ...(typeof row.domain === 'string' && row.domain.trim() ? [row.domain.trim()] : []),
    '导入',
  ].filter(Boolean))].slice(0, 6);
  doc.dialogues.push({
    id: 'imp-' + hash([source, turns]).slice(0, 20),
    turns,
    tags,
    rating,
    source,
    ...(url ? {url} : {}),
    license,
    importedAt: Date.now(),
  });
  added++;
}
doc.version = 2;
doc.referenceOnly = true;
doc.imports = Array.isArray(doc.imports) ? doc.imports : [];
doc.imports.push({at: Date.now(), file: src, format, source, url, license, rating, added, skipped, total: doc.dialogues.length});
doc.imports = doc.imports.slice(-20);
writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
console.log(JSON.stringify({file: outPath, candidates, added, skipped, reasons, total: doc.dialogues.length, rating}, null, 2));
