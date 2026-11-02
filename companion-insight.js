// 情绪与说话节奏的按需提示：每轮最多一条，控制 token。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let emotions = [];
let dialogues = [];
try { emotions = JSON.parse(fs.readFileSync(join(here, 'assets', 'emotion-guide.json'), 'utf8')).emotions || []; } catch {}
try { dialogues = JSON.parse(fs.readFileSync(join(here, 'assets', 'human-dialogues.json'), 'utf8')).dialogues || []; } catch {}

const CUES = {
  sad: /难过|失落|没劲|算了|不想动/,
  lonely: /没人|孤单|一个人|睡不着|深夜/,
  annoyed: /烦|别说了|懒得|无语|烦死/,
  angry: /气死|凭什么|过分|滚|骂/,
  anxious: /担心|万一|怎么办|紧张|怕/,
  embarrassed: /羞|尴尬|别看我|说漏|脸红/,
  grateful: /谢谢|多亏|记得你/,
  happy: /开心|太好了|哈哈|成了|搞定/,
  tired: /累|困|上班|加班|不想动/,
  disappointed: /失望|白费|本来以为|结果/,
  proud: /我做到了|厉害吧|夸我|赢了/,
  curious: /这是什么|为什么|怎么弄|没听过/,
};

// 只挑一条最贴近的情绪，压成一行；没有明显情绪就不给。
export function insightHint(text) {
  const s = String(text || '').slice(0, 400);
  if (!s) return '';
  let picked = null;
  for (const e of emotions) {
    const re = CUES[e.id];
    if (re && re.test(s)) { picked = e; break; }
  }
  const parts = [];
  if (picked) parts.push('【对方现在' + picked.zh + '】' + picked.human + '；不要' + picked.avoid + '。');
  return parts.join('\n').slice(0, 120);
}
