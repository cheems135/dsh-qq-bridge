import {requestedFormatting,cleanLocalReply,needsDialogueRepair} from './local-reply.js';
import {localImageRequest,localVideoRequest,requestsVoice} from './media-intent.js';
import {resolveLocalMediaTask,unverifiedMediaProgress} from './local-media-task.js';
import {localRepeatRisk,recentAssistantReplies,repeatRequested} from './local-repetition.js';

export function fastDialoguePlan(request,{messages=[],hasImages=false,pending=false,maxTokens=512,judgeMood=false,priority='speed'}={}){
 const text=String(request).trim();
 const operation=/(?:https?:|www\.|\[附件|读取|检查|查(?:一下|找|询|查)|搜索|搜一下|联网|浏览|打开|访问|登录|扫码|评论|点赞|投币|收藏|播放|看(?:看|一下|一眼|视频)|刷|B站|哔哩|bilibili|网页|网站|视频|生成|绘制|自拍|照片|图片|语音|声音|唱|读给|说给|念给|发送|发给|发一|发张|发个|发下|发图|发声|工具|工作流|设置|配置|文件|目录|终端|命令|运行|执行|安装|下载|提醒|闹钟|日程|天气|新闻|股价|汇率|几号|几点|现在时间|分析|推导|证明|详细|仔细|长篇|完整|教程|代码|编程|翻译|解题|数学|怎么做|如何做|为什么|原理)/i;
 const followup=/^(?:继续|接着|好(?:的)?|可以|行|就这样|试试|再来|来吧|帮我|去吧|嗯)[。！!~～\s]*$/.test(text);
 const recent=messages.filter(row=>row.role!=='system').slice(-4).map(row=>typeof row.content==='string'?row.content:'').join('\n');
 const task=resolveLocalMediaTask(text,{history:messages});
 const fast=!!text&&text.length<=180&&!hasImages&&!pending&&!requestedFormatting(text)&&!repeatRequested(text)&&!task.image&&!task.speech&&!task.video&&!task.ambiguous&&!operation.test(text)&&!(followup&&(operation.test(recent)||localImageRequest(recent)||localVideoRequest(recent)||requestsVoice(recent)));
 return {fast,outputTokens:priority==='quality'?maxTokens:Math.min(maxTokens,judgeMood?320:256),targetRatio:priority==='quality'?.9:fast?.68:.86};
}

export const QUALITY_CONVERSATION_RULES="【连贯的自然对话】先结合最近几轮确认正在谈的人、地点、选择和未完的话，再回应当前消息；“第二个、那件事、继续”等指代沿用前文，不把每条消息当新话题。对明显的错别字、漏字、谐音和口语，先在心里按上下文还原通顺的实际意思，直接回应这个意思。不要把错字硬解释成新事物、故意装不懂、用“你是说某个字吗”取笑对方，或把纠错本身当新话题。例如“补药”通常是“不要”，“灰常”通常是“非常”；出行对话优先考虑正常出行含义。只有确有两种会影响决定的理解才简短确认；调皮的人设也要先理解对方。有自己的具体判断和自然联想，不只附和、复述或逐问逐答，不要求每次反问、安慰或固定收尾，不为扩展话题编造共同经历。长短按实际内容决定，先把一个意思说完整，按自然段组织，不强制一句一条。";
export const QUALITY_DIALOGUE_RULES=QUALITY_CONVERSATION_RULES+'涉及查找、操作或媒体时只返回 {"action":"need_tools"} 进入工具流程，不假装执行。';

export const FAST_DIALOGUE_RULES='【普通对话】直接接住本轮的话，通常自然说一到三句，不复述问题、不凑结尾。有实质内容就说清楚，保留角色语气。若必须查找、操作或生成媒体，只返回 {"action":"need_tools"} 转工具模式，不假装执行。';

function dialoguePrefix(raw){
 let text=String(raw).replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi,'');
 if(/<think\b/i.test(text))return '';
 text=text.trimStart();
 if(text.startsWith('{')){
  const match=text.match(/^\{\s*"action"\s*:\s*"final"\s*,\s*"text"\s*:\s*"/);
  if(!match)return '';
  let value='',escape=false,unicode='';
  for(const c of text.slice(match[0].length)){
   if(unicode){unicode+=c;if(unicode.length===5){if(!/^u[0-9a-f]{4}$/i.test(unicode))return '';value+=String.fromCharCode(parseInt(unicode.slice(1),16));unicode='';}continue;}
   if(escape){escape=false;if(c==='u')unicode='u';else if(c in {n:1,r:1,t:1,b:1,f:1,'"':1,'\\':1,'/':1})value+=({n:'\n',r:'\r',t:'\t',b:'',f:'','"':'"','\\':'\\','/':'/'})[c];else return '';continue;}
   if(c==='\\'){escape=true;continue;}if(c==='"')break;value+=c;
  }
  return value;
 }
 if(/^[\[<`]|"(?:action|arguments|tool_calls|prompt)"\s*:/.test(text))return '';
 // A wrapping quotation may close only at the very end. Wait rather than
 // leaking the opening quote, then changing already published text.
 if(/^[“「『"]/.test(text)&&!/[”」』"]\s*$/.test(text))return '';
 return text;
}

export function removeStreamedPrefix(final,parts=[]){
 const wanted=parts.join('').replace(/\s/g,'');if(!wanted)return {consistent:true,tail:final};
 let current='',end=0;for(const c of String(final)){end+=c.length;if(!/\s/.test(c))current+=c;if(current.length>=wanted.length)break;}
 return current===wanted?{consistent:true,tail:String(final).slice(end).trimStart()}:{consistent:false,tail:''};
}

export function createDialogueStream({request='',messages=[],emit=()=>{},paragraphs=false}={}){
 let raw='',consumed=0,blocked=false;const parts=[],seen=new Set();
 const old=recentAssistantReplies(messages).map(t=>t.replace(/[\p{P}\p{S}\s]/gu,''));
 return {parts,feed(delta){
  raw+=String(delta||'');if(blocked||raw.length>32000)return;
  const visible=cleanLocalReply(dialoguePrefix(raw),{request});
  if(needsDialogueRepair(visible,{request}))return;
  const boundaries=[...visible.matchAll(paragraphs?/\n+/gu:/[。！？!?]+[”」』"]?|\n+/gu)];
  for(const match of boundaries){const end=match.index+match[0].length;if(end<=consumed)continue;
   const prefix=visible.slice(0,end),text=visible.slice(consumed,end).trim();if(!text)continue;
   const normalized=prefix.replace(/[\p{P}\p{S}\s]/gu,'');
   if(normalized.length<8)continue;
   if(localRepeatRisk(prefix,{messages,request})||old.some(previous=>previous.startsWith(normalized)||normalized.startsWith(previous)&&previous.length>=8)){blocked=true;return;}
   if(unverifiedMediaProgress(text)||/\[|\]|```|\{\s*"|(?:场景|旁白|动作|心理活动)[:：]/.test(text)){blocked=true;return;}
   const sentenceKey=text.replace(/[\p{P}\p{S}\s]/gu,'');
   if(seen.has(sentenceKey)){consumed=end;continue;}
   emit(text,parts.length);parts.push(text);seen.add(sentenceKey);consumed=end;
  }
 },finish(text){return {...removeStreamedPrefix(text,parts),parts:[...parts]};}};
}
