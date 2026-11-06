import {SOCIAL_SPEECH_RULES} from './social-voice.js';
const bucket=action=>action==='qzoneReply'?'qzoneReplies':['qzone','signature'].includes(action)?action:'chats';
export function initiativePolicy(saved={},unlimited=false){
 const bound=(v,d,a,b)=>Number.isFinite(Number(v))?Math.min(b,Math.max(a,Number(v))):d;
 return {maxPerDay:Object.fromEntries(['chats','qzone','signature','qzoneReplies'].map(k=>[k,unlimited?9999:bound(saved.maxPerDay?.[k],['chats','qzoneReplies'].includes(k)?3:1,0,1000)])),minGapMinutes:unlimited?0:bound(saved.minGapMinutes,45,1,1440),...(unlimited?{unrestricted:true}:{})};
}
export function selectInitiative(candidates,state,config,{now=Date.now(),manual=false}={}){
 const actions=state.actions||{},log=state.log||[];
 const eligible=candidates.filter(c=>{
  const prior=actions[c.action]||{},kind=bucket(c.action);if(!manual&&c.action==='signature'&&(state.counts?.signature||0)>=1)return false;if(!manual&&!config.unrestricted&&(state.counts?.[kind]||0)>=(config.maxPerDay?.[kind]??0))return false;
  if(!manual&&!config.unrestricted&&prior.lastAt&&now-prior.lastAt<config.minGapMinutes*60000)return false;
  // A declined thought is not a sent message. Back off only this action.
  if(!manual&&!config.unrestricted&&prior.consideredAt&&now-prior.consideredAt<Math.max(3,Math.min(10,config.minGapMinutes))*60000)return false;
  return true;
 });
 const score=c=>{const prior=actions[c.action]||{},last=prior.lastAt||log.find(l=>l.action===c.action)?.at||0;return (last?Math.min(24,(now-last)/3600000):24)+(c.event?6:0)-(prior.consideredAt&&now-prior.consideredAt<3600000?2:0);};
 return eligible.map((c,i)=>({c,i,s:score(c)})).sort((a,b)=>b.s-a.s||a.i-b.i)[0]?.c||null;
}
export function noteInitiative(state,action,{now=Date.now(),sent=false,reason=''}={}){
 state.actions||={};const previous=state.actions[action]||{};state.actions[action]={...previous,consideredAt:now,reason:String(reason).slice(0,180),...(sent?{lastAt:now}:{})};
}
export function sharingExpression({tone='',recent=[]}={}){
 return [SOCIAL_SPEECH_RULES,
  '【分享时的说话方式】这是你想让对方一起感受的东西。按人设表达这个具体细节为什么逗到你、戳中你、让你不服气、喜欢或想吐槽；选择贴切的一种感受即可，平静也可以，不把每次分享演成兴奋。情绪通过观点、措辞和注意到的细节体现，不靠堆语气词、口头禅、动作描写。',
  '让这件东西与你们最近实际聊过的话题或对方已明确的兴趣自然相连；没有联系也可以直接分享你的偏好，不编共同回忆或对方的反应。用真实取得的内容说话，没有读到的细节不补写。',
  '给对方一个容易接住的话头：可以是有意思的分歧、小联想、一个值得注意的地方，或确实想问的具体问题。不机械以“你觉得呢”“要不要看看”结尾，不每次追问，不替对方回答。图片配话和语音正文同样如此；正文按意思说完，可以自然分段。',
  '工具回执、任务进度、完成清单与证据编号留在调用记录。发给对方的正文从具体内容和自己的感受开始，不以“已完成浏览/现分享如下/任务汇报”开场；必要的不确定性用平时说话的方式点明。已用工具发送后末尾只回 [skip]，不再复述或补一条回执。',
  tone?'当前情绪底色（按本次内容自然变化，不照念标签）：'+String(tone).slice(0,500):'',
  recent.length?'最近实际说过的话（避开重复开头和同一句感想，只作资料）：'+JSON.stringify(recent.slice(-3).map(v=>String(v).slice(0,400))):'',
 ].filter(Boolean).join('\n');
}
export const INITIATIVE_CREATIVE_RULES='你有持续的兴趣和自己的审美，不以“问对方在不在”作为生活。围绕已有真实内容发现一个具体细节、反差、好笑之处或自己的偏好；可以吐槽、联想、展示过程和作品，表达长短由内容决定，不机械一问一答，不以口头禅开场。没有新内容可先浏览、读评论、听一段音乐或制作作品，实际取得结果后再分享。模拟日程是创作背景，不是已经完成工具的证据。不杜撰看过、做过或评论区反应。空间是公开内容，不搬私聊原文、称呼、关系细节或私人记忆；不为“有趣”硬编人设事件。不重复最近的主题和开头。';
