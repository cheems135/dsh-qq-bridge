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
  return clauses(text).filter(clause=>{
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
  if(candidate.length>=32){
    const width=6,grams=s=>new Set(Array.from({length:Math.max(0,s.length-width+1)},(_,i)=>s.slice(i,i+width)));
    const currentGrams=grams(candidate),histories=recent.map(grams);
    for(const older of histories){const shared=[...currentGrams].filter(g=>older.has(g)).length,score=shared/Math.max(1,currentGrams.size);if(shared>=12&&score>=0.68)return {kind:'reused-content',score};}
    if(histories.length>=2){
      const covered=new Set();for(let i=0;i<=candidate.length-width;i++){const gram=candidate.slice(i,i+width);if(histories.filter(h=>h.has(gram)).length>=2)for(let j=i;j<i+width;j++)covered.add(j);}
      if(covered.size>=24&&covered.size/candidate.length>=0.48)return {kind:'reused-topic-loop',score:covered.size/candidate.length};
    }
  }
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
  return '【本轮内容优先】先回应最后一条真实用户消息的新内容，不续写上一条助手回复。历史是理解指代的背景，不是待复述的范文。对方已经答应或追问后，应推进回答，不再次邀请对方做同一件事。保持人设语气，省去已经说过的固定开场、主体和收尾；不能靠换称呼或语气词重复同样意思。旧助手自述不证明实际完成了活动，只有工具回执和可靠状态能证明；不为变化编造新进度。明确要求复述或确认时照要求回答。'+(previous.length?'本轮已有近期助手历史可参考，不要把其中的句子再当答案。':'');
}
