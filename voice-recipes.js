/* 语音演出配方：把号主认可过的「台词 + 指令 + 档位 + 后期说明」存成可复用的档案。
   assets/voice-recipes/*.json 是唯一事实来源，这里只负责读取、缓存和筛选。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets', 'voice-recipes');
let cache = { key: '', items: [] };

function signature() {
  try {
    return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).sort()
      .map(f => { const s = fs.statSync(path.join(DIR, f)); return f + ':' + s.size + ':' + s.mtimeMs; }).join('|');
  } catch { return ''; }
}

/** 列出全部配方（按名称索引，缓存按文件变化刷新） */
export function listRecipes() {
  const key = signature();
  if (key === cache.key) return cache.items;
  const items = [];
  try {
    for (const file of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
        if (!raw || !raw.text) continue;
        items.push({
          file,
          name: String(raw.name || file),
          text: String(raw.text),
          instructions: String(raw.instructions || ''),
          guidance: Number(raw.voice_settings?.guidance_scale) || 3,
          audio: raw.file ? path.join(DIR, raw.file) : '',
          durationSec: Number(raw.durationSec) || 0,
          postProcess: Array.isArray(raw.postProcess) ? raw.postProcess : [],
          notes: String(raw.notes || ''),
          approvedAt: String(raw.approvedAt || '')
        });
      } catch { /* 坏文件跳过，不影响其它配方 */ }
    }
  } catch { /* 目录不存在就当作没有配方 */ }
  cache = { key, items };
  return items;
}

/** 按名称或关键词找一个配方；name 精确优先，其次包含匹配 */
export function findRecipe(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const items = listRecipes();
  return items.find(r => r.name === q) || items.find(r => r.name.includes(q)) || null;
}

/** 语音管线用的最小载荷：直接喂给 breezeSpeech 的 options.recipe */
export function recipePayload(query) {
  const r = findRecipe(query);
  if (!r) return null;
  return { name: r.name, text: r.text, instructions: r.instructions, guidance: r.guidance, audio: r.audio };
}
