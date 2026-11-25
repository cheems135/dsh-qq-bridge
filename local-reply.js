import {DIALOGUE_ONLY_RULE,DRAFT_VOICE_RULE,requestedActionNarration,stripUnrequestedActions} from './dialogue-only.js';
import {QQ_LINE_BREAK_RULE,normalizeReplyNewlines,stripReplyDividers} from './chat-bubbles.js';
// Presentation rules for QQ dialogue. Tool arguments and creative tasks are not
// prose to scrub; only final chat text and speech use this formatter.
export function latestUserText(messages = []) {
  const row = [...messages].reverse().find(item => item?.role === 'user' && !item._localReceipt);
  return Array.isArray(row?.content) ? row.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n') : String(row?.content || '');
}

export function requestedFormatting(request = '') {
  const text = String(request).replace(/(?:不要|别|禁止|不许|不用|无需)[^，。！？\n]{0,18}(?:故事|小说|旁白|场景|动作|引号|代码|Markdown)/g, '');
  return /(?:写|编|续写|创作|讲|生成|来|给我|输出|返回|翻译|保留|原样|逐字|摘录|引用|解释|分析|修改|调试).{0,24}(?:故事|小说|剧本|诗|童话|代码|脚本|JSON|Markdown|引号|原文|台词)|(?:故事|小说|剧本|代码|JSON|Markdown).{0,12}(?:格式|写|输出|返回|翻译|怎么|如何)|翻译|原样|逐字|```/i.test(text);
}

export function requestsLiteralText(request = '') {
  const words=String(request).replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu,'');
  return words.split(/[，,。！？!?；;\n]/u).some(part=>{
    if(/(?:不用|无需|不必|别|不要|并非|不是|不需要).{0,5}(?:原样|逐字|照抄|一字不改|保留)/u.test(part))return false;
    return /(?:原样|逐字|一字不改)(?:地)?(?:回|发|抄|复述|输出|照写|保留)|^(?:请|帮我|给我|直接)?照(?:抄|发)|保留.{0,8}(?:标点|句号|逗号|空格|表情符号|emoji)|(?:原样|逐字)$/iu.test(part.trim());
  });
}

// Once a generated reply starts echoing the per-turn instruction, subsequent
// lines can be fabricated follow-up turns. Cut the draft before bubble splitting.
export function trimConversationHintEcho(value,request=''){
  const body=String(value??'');
  const header='【本轮相处方式】';
  if(!body.includes(header)||String(request).includes(header))return body;
  const pattern=/^(?:[ \t]*```|[ \t]*【本轮相处方式】)/gm;
  let inCode=false;
  for(const match of body.matchAll(pattern)){
    if(match[0].trimStart().startsWith('```'))inCode=!inCode;
    else if(!inCode)return body.slice(0,match.index).trimEnd();
  }
  return body;
}

export function cleanGeneratedReplyDividers(value='', {request=''}={}) {
  const body=trimConversationHintEcho(value,request);
  return requestedFormatting(request)||requestedActionNarration(request)?body:stripReplyDividers(body);
}

export const NATURAL_PARAGRAPH_RULE='【聊天分段】'+QQ_LINE_BREAK_RULE+'常规聊天按完整意思自然分行，短回复可以只写一行，不凑行数。';

export function localDialogueInstruction(request = '') {
  return requestedFormatting(request)||requestedActionNarration(request)
    ? '【本轮 QQ 表达】按请求的口吻和格式交付作品、引文或代码。工具回执只作资料。'+DRAFT_VOICE_RULE
    : DIALOGUE_ONLY_RULE+'\n'+'【本轮 QQ 表达】保留正常标点、emoji 和引用。'+NATURAL_PARAGRAPH_RULE;
}

const wrappers = [['“','”'],['「','」'],['『','』'],['"','"']];
function unwrap(value, markdown = true) {
  let text = value.trim();
  for (let i = 0; i < 3; i++) {
    const before = text;
    for (const [left,right] of wrappers) {
      if (text.startsWith(left) && text.endsWith(right)) {
        const inner = text.slice(left.length, -right.length);
        // A pair of separately quoted utterances is not one outer wrapper.
        if (!inner.includes(left) && !inner.includes(right)) text = inner.trim();
      }
    }
    if(markdown)text = text.replace(/^(\*\*|__)([^\n]+)\1$/, '$2').trim();
    if (text === before) break;
  }
  return text;
}

const actionWords = /(?:微笑|轻笑|笑了|笑着|眨眼|眨了|歪头|抬头|抬起|低头|低下|看着|望着|走到|走了|坐在|站在|靠近|伸手|摸了|抱住|点头|点了|摇头|摇了|转身|叹气|叹了|脸红|红了脸|心想|心中|轻声|柔声|说道|说着|答道)/;
const stageAction = value => actionWords.test(value) && !/(?:意思|表示|例如|比如|定义|术语|作用|不要|不能|“|”|「|」|")/.test(value);

export function cleanLocalReply(value, {request = ''} = {}) {
  let text = normalizeReplyNewlines(value||'').trim();
  text = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, '').replace(/<\|(?:im_start|im_end|eot_id|endoftext)\|>/g, '').trim();
  text=stripUnrequestedActions(text,{request});
  if (requestedFormatting(request) || requestedActionNarration(request)) return text;
  if (text.startsWith('"') && text.endsWith('"')) {
    try { const decoded = JSON.parse(text); if (typeof decoded === 'string') text = decoded; } catch {}
  }
  text = normalizeReplyNewlines(stripReplyDividers(text)).trim();
  if (/```/.test(text)) return text;
  text = text.replace(/^(?:assistant|助手|回复|答复)\s*[:：]\s*/i, '');
  text = unwrap(text, false);
  const lines = text.split('\n').flatMap(line => {
    let part = line.trim();
    if (!part) return [''];
    // Only explicit action wrappers/labels qualify, not ordinary parenthetical
    // explanations or quoted terms embedded in a sentence.
    if (/^(?:场景|旁白|动作|心理活动|内心独白)\s*[:：]/.test(part)) return [];
    if (/^(?:\*{1,3}[^*]+\*{1,3}|（[^（）]+）|\([^()]+\))$/.test(part) && stageAction(part)) return [];
    part = part.replace(/^(?:\*{1,3}[^*\n]{1,100}\*{1,3}|（[^（）\n]{1,100}）|\([^()\n]{1,100}\))\s*/, all => stageAction(all) ? '' : all);
    const narrative = part.match(/^([^“「"\n]{1,120})[“「"]([\s\S]+)[”」"]\s*[。.]?$/);
    if (narrative && actionWords.test(narrative[1]) && /(?:她|他|自己|少女|少年|轻声|柔声|说道|答道)/.test(narrative[1])) part = narrative[2];
    return [unwrap(part).replace(/^(\*|_)([^\n*_]+)\1$/, '$2')];
  });
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function needsDialogueRepair(value, {request = ''} = {}) {
  if (requestedFormatting(request) || !String(value || '').trim()) return false;
  const text=cleanLocalReply(value,{request});
  const first=text.split('\n')[0];
  return !text || /^(?:她|他|少女|少年|女孩|男孩)[^。！？\n]{0,40}(?:轻轻|微微|缓缓|轻声|柔声|眼神|嘴角|说道|答道)/.test(first) && actionWords.test(first) && !/[？?]$/.test(first);
}
