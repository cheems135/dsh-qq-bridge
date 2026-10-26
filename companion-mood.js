// Independent adaptation of feiyu-mood's confidence and decay design.
// A conversational state estimate, never a claim of subjective human feelings.
export const MOOD_DIMS=['happy','calm','sweet','heartache','worry','sad','jealous'];
export function moodConfig(v={}){const n=(x,d,a,b)=>Number.isFinite(Number(x))?Math.min(b,Math.max(a,Number(x))):d;return{enabled:v.enabled!==false,confidence:n(v.confidence,70,50,100),halfLifeHours:n(v.halfLifeHours,6,1,48),everyTurns:Math.round(n(v.everyTurns,3,1,20)),maxHintsPerDay:Math.round(n(v.maxHintsPerDay,6,0,20))};}
const clean=(v,n=240)=>String(v||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
export function moodState(v={},now=Date.now(),config={}){
  const c=moodConfig(config),elapsed=Math.max(0,now-(Number(v.updatedAt)||now)),fade=Math.pow(.5,elapsed/(c.halfLifeHours*3600000));
  const score=Number.isFinite(Number(v.score))?Math.min(90,Math.max(35,Number(v.score))):65;
  const dims=Object.fromEntries(MOOD_DIMS.map(k=>[k,Math.round((Math.min(100,Math.max(0,Number(v.dims?.[k])||0)))*fade*10)/10]));
  return{score:Math.round((65+(score-65)*fade)*10)/10,dims,updatedAt:now,lastJudgedAt:Number(v.lastJudgedAt)||0,turns:Math.max(0,Number(v.turns)||0),event:v.event||null,consumed:String(v.consumed||''),saidAt:(v.saidAt||[]).filter(t=>now-t<86400000).slice(-20),timeline:(v.timeline||[]).slice(-30)};
}
export function shouldJudgeMood(v,words,config={}){const c=moodConfig(config);return c.enabled&&((Number(v?.turns)||0)%c.everyTurns===0||/谢谢|喜欢你|想你|开心|难过|委屈|对不起|生气|不对|说错|答非所问|辛苦|成功了/.test(String(words)));}
export function applyMood(v,raw,words,{now=Date.now(),config={}}={}){
  const state=moodState(v,now,config),c=moodConfig(config),quote=clean(raw?.evidenceQuote,160),reason=clean(raw?.reason,180),number=Number(raw?.confidence),confidence=number>=0&&number<=1?number*100:number;
  state.lastJudgedAt=now;
  if(!Number.isFinite(confidence)||confidence<0||confidence>100)return{state,accepted:false,reason:'invalid-confidence'};
  if(confidence<c.confidence)return{state,accepted:false,reason:'low-confidence'};
  if(quote.length<2||!String(words).includes(quote)||!reason)return{state,accepted:false,reason:'missing-evidence'};
  const clamp=x=>Number.isFinite(Number(x))?Math.min(5,Math.max(-5,Number(x))):0;
  let delta=clamp(raw.moodDelta),changes=Object.fromEntries(MOOD_DIMS.map(k=>[k,clamp(raw.dims?.[k])]));
  // Missing a reply, correcting the agent, or mentioning someone else does not
  // establish neglect, anger or jealousy. The model cannot invent that event.
  if(/答非所问|说错|不对|你没懂|别发癫|认真点|先忙|晚安/.test(quote)){delta=Math.max(0,delta);changes.jealous=0;changes.sad=Math.min(0,changes.sad);}
  if(!/吃醋|嫉妒/.test(String(words)))changes.jealous=0;
  const nextScore=Math.min(90,Math.max(35,state.score+delta));
  const nextDims=Object.fromEntries(MOOD_DIMS.map(k=>[k,Math.min(35,Math.max(0,state.dims[k]+changes[k]))]));
  const strength=Math.abs(nextScore-state.score)+MOOD_DIMS.reduce((n,k)=>n+Math.abs(nextDims[k]-state.dims[k]),0);
  if(strength<2)return{state,accepted:false,reason:'minor-or-unchanged'};
  state.score=nextScore;state.dims=nextDims;
  const event={id:String(now)+':'+quote,at:now,reason,quote,confidence,delta,dims:{...state.dims}};
  state.event=event;state.timeline=[...state.timeline,event].slice(-30);
  return{state,accepted:true};
}
export function moodDelivery(v,{now=Date.now(),config={}}={}) {
  const state=moodState(v,now,config);if(!moodConfig(config).enabled)return{emotion:'auto',tone:''};
  const ranked=MOOD_DIMS.map(k=>[k,state.dims[k]]).sort((a,b)=>b[1]-a[1]);
  if(ranked[0][1]<2&&Math.abs(state.score-65)<3)return{emotion:'auto',tone:''};
  const kind=ranked[0][1]>=2?ranked[0][0]:state.score>65?'happy':'sad';
  const tone={happy:'有一点开心，接话轻快',calm:'放松平和，表达从容',sweet:'亲近柔和，可以自然俏皮',heartache:'关切心疼，温柔接住对方的话',worry:'有些担心，关心但不反复追问',sad:'有点低落，语气收一点',jealous:'一点有语境的醋意，轻轻开玩笑'}[kind];
  return{emotion:({happy:'happy',calm:'natural',sweet:'happy',heartache:'gentle',worry:'gentle',sad:'sad',jealous:'natural'})[kind],tone};
}
export function consumeMoodHint(v,{now=Date.now(),config={}}={}){
  const state=moodState(v,now,config),c=moodConfig(config),e=state.event;
  if(!c.enabled)return{state,text:''};
  const tone=moodDelivery(state,{now,config}).tone;
  const baseline=tone?'【本对话当前情绪底色】'+tone+'。按人设自然体现在措辞和节奏中，强度克制；这不是新话题，不需要报告心情，不重复旧事。用户当前问题、情绪和明确要求优先。':'';
  if(!e||e.id===state.consumed||state.saidAt.length>=c.maxHintsPerDay||now-e.at>2*3600000)return{state,text:baseline};
  state.consumed=e.id;state.saidAt.push(now);
  return{state,text:[baseline,'【本对话近期情绪变化：可修正的状态估计，不是台词或用户事实】\n'+JSON.stringify({reason:e.reason,evidence:e.quote,at:e.at})+'\n仅在当前语境合适时体现在语气中，不复述这些字段，不夸大或延续委屈，不因对方暂时不回而催促。当前问题和纠正优先。'].filter(Boolean).join('\n')};
}
