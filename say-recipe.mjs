import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { breezeSpeech } from './voice-studio.js';
import { listRecipes } from './voice-recipes.js';
const key = process.argv[2];
const out = process.argv[3] || path.resolve('say.mp3');
if (!key) throw Error('请提供已安装的语音配方名');
const s = JSON.parse(fs.readFileSync(process.env.QQ_BRIDGE_SETTINGS || path.join(os.homedir(), '.dsh', 'im-bridge', 'settings.json'),'utf8')).voice;
const r = listRecipes().find(x => x.name.includes(key));
if (!r) { console.log('no recipe', key); process.exit(1); }
const res = await breezeSpeech('占位', s, { recipe: r.name });
fs.writeFileSync(out, res.bytes);
console.log('OK', r.name, res.format, res.bytes.length);
