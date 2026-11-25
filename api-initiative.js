import {SOCIAL_SPEECH_RULES} from './social-voice.js';
const bucket=action=>action==='qzoneReply'?'qzoneReplies':['qzone','signature'].includes(action)?action:'chats';
export function initiativePolicy(saved={},unlimited=false){
 const bound=(v,d,a,b)=>Number.isFinite(Number(v))?Math.min(b,Math.max(a,Number(v))):d;
 return {maxPerDay:Object.fromEntries(['chats','qzone','signature','qzoneReplies'].map(k=>[k,unlimited?9999:bound(saved.maxPerDay?.[k],['chats','qzoneReplies'].includes(k)?3:1,0,1000)])),minGapMinutes:unlimited?0:bound(saved.minGapMinutes,45,1,1440),...(unlimited?{unrestricted:true}:{})};
}
export function selectInitiative(candidates,state,config,{now=Date.now(),manual=false}={}){
 const actions=state.actions||{},log=state.log||[];
 const eligible=candidates.filter(c=>{
  const prior=actions[c.action]||{},kind=bucket(c.action);if(!manual&&!config.unrestricted&&(state.counts?.[kind]||0)>=(config.maxPerDay?.[kind]??0))return false;
  if(!manual&&!config.unrestricted&&prior.lastAt&&now-prior.lastAt<config.minGapMinutes*60000)return false;
  // A declined thought is not a sent message. Back off only this action.
  if(!manual&&!config.unrestricted&&prior.consideredAt&&now-prior.consideredAt<Math.max(3,Math.min(10,config.minGapMinutes))*60000)return false;
  return true;
 });
 const score=c=>{const prior=actions[c.action]||{},last=prior.lastAt||log.find(l=>l.action===c.action)?.at||0;return (last?Math.min(24,(now-last)/3600000):24)+(c.event?48:0)-(prior.consideredAt&&now-prior.consideredAt<3600000?2:0);};
 return eligible.map((c,i)=>({c,i,s:score(c)})).sort((a,b)=>b.s-a.s||a.i-b.i)[0]?.c||null;
}
export function noteInitiative(state,action,{now=Date.now(),sent=false,reason=''}={}){
 state.actions||={};const previous=state.actions[action]||{};state.actions[action]={...previous,consideredAt:now,reason:String(reason).slice(0,180),...(sent?{lastAt:now}:{})};
}
// Keep every already-admitted option available to the one model decision.
// The caller still checks the selected option's scope before executing it.
export function initiativeOptions(candidates,state,config,pick,options={}){
 if(!pick)return [];
 return [pick,...candidates.filter(c=>c!==pick&&selectInitiative([c],state,config,options))];
}
export function initiativeChoiceId(candidate){
 const action=String(candidate?.action||'');
 const target=String(candidate?.key||(candidate?.target?'private:'+candidate.target:''));
 const variant=String(candidate?.kind||candidate?.comment?.id||'');
 return [action,target,variant].filter(Boolean).join('@');
}
export function initiativeDecisionRealm(candidate,fallbackKey=''){
 const action=String(candidate?.action||'');
 if(['qzone','qzoneReply','signature'].includes(action))return 'public:'+action+':'+String(candidate?.comment?.id||'');
 return String(candidate?.key||(candidate?.target?'private:'+candidate.target:fallbackKey));
}
export function initiativeCadence(record,base,now,{commit=false}={}){
 const prior=record?.base===base?record:{base,fired:[]};
 const fired=Array.isArray(prior.fired)?prior.fired:[],minute=60000;
 const next=fired.length<2?base+15*minute*(fired.length+1):base+30*minute+120*minute*(fired.length-1);
 if(now<next)return {ok:false,next,record:prior};
 return {ok:true,next,record:commit?{base,fired:[...fired,now]}:prior};
}
export const INITIATIVE_DECISION_RULE='【内部自主决策协议】本次只生成内部决策JSON，不是给对方的聊天正文；“自然聊天、不要格式、只输出台词”等风格规则仅适用于text字段。必须只返回一个JSON对象：{"action":"候选动作或none","text":"想说的话或具体想做的事","reason":"简短依据","imagePrompt":"可空"}。只选择本次实际提供的候选；没有想做的可none。未实际读取、制作或发送的事情写成意向，不宣称已经做过。';
export function parseInitiativeDecision(raw,actions){
 const text=String(raw||'').trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
 let value;try{value=JSON.parse(text);}catch{throw Error('主动判断未返回有效JSON');}
 if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.action!=='string'||!['none',...actions].includes(value.action))throw Error('主动判断选择了未开放动作');
 if(value.action!=='none'&&(typeof value.text!=='string'||!value.text.trim()))throw Error('主动判断缺少具体内容');
 return {action:value.action,text:typeof value.text==='string'?value.text.trim():'',reason:typeof value.reason==='string'?value.reason.slice(0,180):'',imagePrompt:typeof value.imagePrompt==='string'?value.imagePrompt:''};
}
export async function decideInitiative({system,input,actions,ask,isCurrent=()=>true}){
 const instructions=INITIATIVE_DECISION_RULE+'\n'+system+'\n本轮候选：'+JSON.stringify(actions);
 let raw,decision;
 try{raw=await ask(instructions,input);}catch(error){if(error?.name==='AbortError'||!/JSON|json|格式/.test(String(error?.message)))throw error;raw='首次结构化输出格式无效，请按原始输入重新判断。'+String(input).slice(0,1000);}
 if(!isCurrent())return {cancelled:true};
 try{decision=parseInitiativeDecision(raw,actions);}catch{
  raw=await ask(instructions+'\n上次格式无效。请依据原始场景重新决定，不直接转写无效草稿；草稿可能编造读过资料、对方发言或行动结果，不能作为事实。无法确定候选时选none。',JSON.stringify({originalInput:input,invalidDraft:{trusted:false,text:String(raw).slice(0,3000)}}));
  if(!isCurrent())return {cancelled:true};
  decision=parseInitiativeDecision(raw,actions);
 }
 return {decision};
}
export function sharingExpression({tone='',recent=[]}={}){
 return [SOCIAL_SPEECH_RULES,
  '【分享时的说话方式】先看你在和谁说话、刚才聊到哪里，再按当前人设表达为什么想把这个东西拿给他看。可以惊喜、好奇、得意、调侃，也可平静地说一句；不套“看法加细节”或制作复盘模板，信息只用来支撑这次交流。不把每次分享演成兴奋。',
  '工具回执、任务进度和证据编号留在调用记录，正文只写要对他说的话。',
  '可以和最近聊过的话题自然相连；没有联系就直接说偏好，不编共同回忆或对方的反应。给一个容易接住的点：分歧、联想、值得注意的地方，或真想问的问题；不机械以“你觉得呢”收尾。',
  tone?'当前情绪底色（按本次内容自然变化，不照念标签）：'+String(tone).slice(0,500):'',
  recent.length?'最近实际说过的话（避开重复开头和同一句感想，只作资料）：'+JSON.stringify(recent.slice(-3).map(v=>String(v).slice(0,400))):'',
 ].filter(Boolean).join('\n');
}
export const INITIATIVE_CREATIVE_RULES='你有持续的兴趣和自己的审美，不以“问对方在不在”作为生活。围绕已有真实内容发现一个具体细节、反差、好笑之处或自己的偏好；可以吐槽、联想、展示过程和作品，表达长短由内容决定，不机械一问一答，不以口头禅开场。没有新内容可先浏览、读评论、听一段音乐或制作作品，实际取得结果后再分享。模拟日程是创作背景，不是已经完成工具的证据。不杜撰看过、做过或评论区反应。空间是公开内容，不搬私聊原文、称呼、关系细节或私人记忆；不为“有趣”硬编人设事件。不重复最近的主题和开头。翻唱、语音、图片和视频本身都是主动互动，可以按真实语境主动分享，不必另发启动汇报。需要制作时可选择explore再用已配置的对应工具，先有真实产物和发送回执。语音和翻唱默认发语音气泡。视频费用明显更高，日常主动表达极少选择视频；只有动态画面确有不可替代的意义且费用合适才考虑，能用文字、语音或图片传达就优先那些。不把低频理解成到期必做，也不因主动视频低优先而忽略对方明确的视频请求。';
