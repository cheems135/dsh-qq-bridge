import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breezeSpeech } from './voice-studio.js';
import { listRecipes } from './voice-recipes.js';
const s = JSON.parse(fs.readFileSync(process.env.QQ_BRIDGE_SETTINGS || path.join(os.homedir(), '.dsh', 'im-bridge', 'settings.json'),'utf8')).voice;
for (const r of listRecipes()) {
  try {
    const out = await breezeSpeech('占位', s, { recipe: r.name });
    const f = path.resolve('pipe-' + r.name.split('-')[0] + '.' + out.format);
    fs.writeFileSync(f, out.bytes);
    console.log('OK', r.name, out.format, out.bytes.length, 'mood=', out.mood);
  } catch (e) { console.log('FAIL', r.name, String(e.message).slice(0,80)); }
}
