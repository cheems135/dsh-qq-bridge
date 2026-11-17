/**
 * dump-session.mjs — print the event timeline of a DSH v4 session log.
 *
 * A live session log is an append-only file of concatenated zstd frames, so
 * `zstdDecompressSync` alone only yields the first one. This splits on the
 * zstd magic number and decodes every frame.
 *
 * Usage: node tools/dump-session.mjs <session.v4.jsonl.zstd> [tail]
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

const file = process.argv[2];
const tail = Number(process.argv[3] ?? 12);
if (!file) {
  console.error('usage: node tools/dump-session.mjs <session.v4.jsonl.zstd> [tail]');
  process.exit(2);
}

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
    /* not a frame boundary — skip */
  }
}

const lines = text.trim().split(/\r?\n/).filter((line) => line.trim() !== '');
console.log(`frames=${cuts.length - 1} lines=${lines.length}`);
for (const line of lines.slice(-Math.max(1, tail))) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    console.log(line.slice(0, 200));
    continue;
  }
  if (event.type === 'session') {
    console.log('session', event.id, event.agentPreset ?? '');
    continue;
  }
  const data = event.data ?? {};
  let brief;
  if (event.type === 'assistant/message') {
    brief = (data.message?.content ?? [])
      .map((block) => (block.type === 'text' ? block.text : `[${block.type}]`))
      .join('');
  } else if (event.type === 'user/message') {
    brief = (data.content ?? []).map((block) => block.text ?? `[${block.type}]`).join('');
  } else if (event.type === 'turn/end') {
    brief = JSON.stringify(data.reason);
  } else {
    brief = JSON.stringify(data);
  }
  console.log(`${event.seq ?? '-'} ${event.type} ${String(brief).slice(0, 400)}`);
}
