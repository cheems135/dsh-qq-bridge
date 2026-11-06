import {cleanLocalReply,requestedFormatting} from './local-reply.js';
import {replyRepetition} from './tone-routing.js';

const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/[。！？!?；;，,、:：…]+$/u,'');
const plain=value=>key(value).replace(/[\p{P}\p{S}]/gu,'');
export function repeatRequested(value='') {
  const text=String(value);
  if(/(?:别|不要|停止|不许|禁止).{0,6}(?:重复|复述|再说|再发|重发)/.test(text))return false;
  return /再(?:说|讲|发|念|读|重复)(?:一遍|一次|下)|重复.{0,6}(?:遍|次)|复述|原话|原样|逐字|歌词|绕口令|repeat|say (?:it )?again/i.test(text);
}
const protectedText=(value,request)=>repeatRequested(request)||requestedFormatting(request)||/```|https?:\/\/|^\s*(?:[-*•]\s|\d+[.)、]\s|\|)/m.test(value);
const clauses=value=>String(value).match(/[^。！？!?；;\n]+[。！？!?；;]*|\n+/gu)||[];

export function prepareLocalReply(value,{request='',spoken=[]}={}) {
  const text=cleanLocalReply(value,{request});
  if(protectedText(text,request))return text;
  const seen=new Set();
  for(const previous of spoken)for(const clause of clauses(previous)){const k=key(clause);if(plain(k).length>=3)seen.add(k);}
  return clauses(text.replace(/\|\|\|/g,'\n')).filter(clause=>{
    const k=key(clause);
    if(plain(k).length<3)return true;
    if(seen.has(k))return false;
    seen.add(k);return true;
  }).join('').replace(/\n{3,}/g,'\n\n').trim();
}

export function recentAssistantReplies(messages=[]) {
  const latest=messages.map(row=>row.role==='user'&&!row._localReceipt?'user':'').lastIndexOf('user');
  const result=[];let group=[];
  const flush=()=>{if(group.length)result.push(group.join('\n'));group=[];};
  for(const row of messages.slice(0,latest)) {
    if(row.role==='assistant'&&!row.tool_calls?.length&&typeof row.content==='string')group.push(row.content);
    else if(row.role!=='system')flush();
  }
  flush();return result.slice(-6);
}

export function localRepeatRisk(value,{messages=[],request=''}={}) {
  if(protectedText(value,request))return null;
  const previous=recentAssistantReplies(messages),candidate=plain(value);
  if(candidate.length<3||candidate.length>1800)return null;
  const priorUsers=messages.filter(row=>row.role==='user'&&!row._localReceipt);
  if(priorUsers.length>1&&typeof priorUsers.at(-2).content==='string'&&key(priorUsers.at(-2).content)===key(request))return null;
  if(/^(?:确认一下|再确认|你还在吗|还在吗|能听到吗|还是这个答案吗)[？?。！!]*$/.test(request.trim()))return null;
  // Short persona catchphrases used to bypass the eight-character guard.
  // Repeated greetings/acknowledgements alone do not prove a problem; require
  // two prior occurrences for these very short replies.
  if(candidate.length<8){
    return previous.slice(-4).filter(text=>plain(text)===candidate).length>=2?{kind:'short-catchphrase',score:1}:null;
  }
  const risk=replyRepetition(value,previous,request);if(risk)return risk;
  const same=previous.some(text=>candidate===plain(text));if(same)return {kind:'same-content',score:1};
  const common=(left,right)=>{let i=0;while(i<Math.min(left.length,right.length)&&left[i]===right[i])i++;return i;};
  const numbers=value=>(String(value).match(/\d+(?:\.\d+)?/g)||[]).join('|');
  const recent=previous.slice(-3).filter(text=>numbers(text)===numbers(value)).map(plain);
  const opening=String(value).split(/[。！？!?；;\n～~]/u)[0];
  const opener=plain(opening);
  if(opener.length>=3&&opener.length<=10&&previous.slice(-4).filter(text=>plain(text.split(/[。！？!?；;\n～~]/u)[0])===opener).length>=2)return {kind:'persona-opening',score:opener.length/candidate.length};
  for(const reverse of [false,true]) {
    const current=reverse?[...candidate].reverse().join(''):candidate;
    const matches=recent.map(old=>common(current,reverse?[...old].reverse().join(''):old));
    if(matches.filter(n=>n>=12).length>=2&&Math.max(...matches)>=candidate.length*0.4)return {kind:reverse?'repeated-ending':'repeated-opening',score:Math.max(...matches)/candidate.length};
  }
  return null;
}

export function localRepetitionInstruction(messages=[]) {
  const previous=recentAssistantReplies(messages);
  return '【本轮内容优先】先回应对方这一次新说的具体内容。历史和人设示例是背景，不是待续写或逐字复读的范文；人设口头禅不必每轮出现，不能只拿称呼或语气词代替实质回应。不要沿用最近回复的整段内容、固定开场和固定收尾。不为换说法编造事实。明确要求复述或确认时按要求回答。'+(previous.length?'\n最近已说过，避免复读：'+JSON.stringify(previous.slice(-3).map(text=>text.slice(0,140))):'');
}
