// Independent adaptation of feiyu-mood's confidence and decay design.
// A conversational state estimate, never a claim of subjective human feelings.
export const MOOD_DIMS=['happy','calm','sweet','heartache','worry','sad','jealous','angry','curious','excited','disappointed','relieved','proud','bored'];
export function moodConfig(v={}){const n=(x,d,a,b)=>Number.isFinite(Number(x))?Math.min(b,Math.max(a,Number(x))):d;return{enabled:v.enabled!==false,confidence:n(v.confidence,70,50,100),halfLifeHours:n(v.halfLifeHours,6,1,48),everyTurns:Math.round(n(v.everyTurns,3,1,20)),maxHintsPerDay:Math.round(n(v.maxHintsPerDay,6,0,20))};}
const clean=(v,n=240)=>String(v||'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
export function moodState(v={},now=Date.now(),config={}){
  const c=moodConfig(config),elapsed=Math.max(0,now-(Number(v.updatedAt)||now)),fade=Math.pow(.5,elapsed/(c.halfLifeHours*3600000));
  const score=Number.isFinite(Number(v.score))?Math.min(90,Math.max(35,Number(v.score))):65;
  const dims=Object.fromEntries(MOOD_DIMS.map(k=>[k,Math.round((Math.min(100,Math.max(0,Number(v.dims?.[k])||0)))*fade*10)/10]));
  return{score:Math.round((65+(score-65)*fade)*10)/10,dims,updatedAt:now,lastJudgedAt:Number(v.lastJudgedAt)||0,turns:Math.max(0,Number(v.turns)||0),event:v.event||null,consumed:String(v.consumed||''),saidAt:(v.saidAt||[]).filter(t=>now-t<86400000).slice(-20),timeline:(v.timeline||[]).slice(-30)};
}
export function shouldJudgeMood(v,words,config={}){
 const c=moodConfig(config),text=String(words||'').trim();
 // These cues request an assessment, never assign the emotion themselves.
 const salient=/谢谢|喜欢你|想你|开心|难过|委屈|对不起|生气|不对|说错|答非所问|辛苦|成功了|没用|废物|讨厌你|滚开|闭嘴|不想理你|别理我|不在乎|失望|伤心|伤人|原谅|和好|抱歉|话说重|不是嫌弃|不是你的错|别自责/;
 return c.enabled&&!!text&&((Number(v?.turns)||0)%c.everyTurns===0||salient.test(text));
}
export function applyMood(v,raw,words,{now=Date.now(),config={}}={}){
  const state=moodState(v,now,config),c=moodConfig(config),quote=clean(raw?.evidenceQuote,160),reason=clean(raw?.reason,180),number=Number(raw?.confidence),confidence=number>=0&&number<=1?number*100:number;
  state.timeline=state.timeline.map(e=>({...e}));
  state.lastJudgedAt=now;
  if(!Number.isFinite(confidence)||confidence<0||confidence>100)return{state,accepted:false,reason:'invalid-confidence'};
  if(confidence<c.confidence)return{state,accepted:false,reason:'low-confidence'};
  if(quote.length<2||!String(words).includes(quote)||!reason)return{state,accepted:false,reason:'missing-evidence'};
  const clamp=x=>Number.isFinite(Number(x))?Math.min(5,Math.max(-5,Number(x))):0;
  let delta=clamp(raw.moodDelta),changes=Object.fromEntries(MOOD_DIMS.map(k=>[k,clamp(raw.dims?.[k])]));
  // Missing a reply, correcting the agent, or mentioning someone else does not
  // establish neglect, anger or jealousy. The model cannot invent that event.
  if(/答非所问|说错|不对|你没懂|别发癫|认真点|先忙|晚安/.test(quote)&&!/没用|废物|讨厌你|滚开|闭嘴|不想理你|别理我|不在乎/.test(quote)){delta=Math.max(0,delta);changes.jealous=0;changes.sad=Math.min(0,changes.sad);}
  if(!/吃醋|嫉妒/.test(String(words)))changes.jealous=0;
  const nextScore=Math.min(90,Math.max(35,state.score+delta));
  const nextDims=Object.fromEntries(MOOD_DIMS.map(k=>[k,Math.min(35,Math.max(0,state.dims[k]+changes[k]))]));
  const strength=Math.abs(nextScore-state.score)+MOOD_DIMS.reduce((n,k)=>n+Math.abs(nextDims[k]-state.dims[k]),0);
  const related=state.timeline.find(e=>e.id===raw?.relatedEventId&&now-e.at<=7*86400000);
  const resolving=raw?.eventRelation==='resolve'&&related&&related.status!=='settled';
  if(strength<2&&!resolving)return{state,accepted:false,reason:'minor-or-unchanged'};
  state.score=nextScore;state.dims=nextDims;
  if(resolving)state.timeline=state.timeline.map(e=>e.id===related.id||e.quote===related.quote?{...e,status:'settled',settledAt:now}:e);
  const event={id:String(now)+':'+quote,at:now,reason,quote,confidence,delta,impact:Math.round(strength*10)/10,dims:{...state.dims},status:resolving?'settled':'active',...(resolving?{relatedEventId:related.id}:{} )};
  state.event=event;state.timeline=[...state.timeline,event].slice(-30);
  return{state,accepted:true};
}
export function moodDelivery(v,{now=Date.now(),config={}}={}) {
  const state=moodState(v,now,config);if(!moodConfig(config).enabled)return{emotion:'auto',tone:''};
  const ranked=MOOD_DIMS.map(k=>[k,state.dims[k]]).sort((a,b)=>b[1]-a[1]);
  if(ranked[0][1]<2&&Math.abs(state.score-65)<3)return{emotion:'auto',tone:''};
  const kind=ranked[0][1]>=2?ranked[0][0]:state.score>65?'happy':'sad';
  const tone={happy:'有一点开心，接话轻快',calm:'放松平和，表达从容',sweet:'亲近柔和，可以自然俏皮',heartache:'关切心疼，温柔接住对方的话',worry:'有些担心，关心但不反复追问',sad:'有点低落，语气收一点',jealous:'有语境的醋意，按性格表达',angry:'有些生气，可以直说分歧，不强装愉快',curious:'对具体问题感兴趣，想继续弄明白',excited:'有新鲜的兴奋感，表达轻快',disappointed:'有些失落，表达收敛但不必讨好',relieved:'缓过来一点，语气放松',proud:'对真实进展有些得意',bored:'有点无聊，可以找新的兴趣或安静一会儿'}[kind];
  return{emotion:({happy:'happy',calm:'natural',sweet:'happy',heartache:'gentle',worry:'gentle',sad:'sad',jealous:'jealousy',angry:'angry',curious:'curiosity',excited:'excited',disappointed:'sad',relieved:'relieved',proud:'smug',bored:'boredom'})[kind],tone};
}
export function moodContinuity(v,{now=Date.now(),config={},publicContext=false}={}){
 const state=moodState(v,now,config);if(!moodConfig(config).enabled)return '';
 const events=(state.timeline.length?state.timeline:state.event?[state.event]:[]).filter(e=>e&&Number.isFinite(e.at)&&now>=e.at&&now-e.at<=7*86400000);
 const selected=[...events.filter(e=>e.status!=='settled').slice(-2),...events.filter(e=>e.status==='settled').slice(-1)].sort((a,b)=>a.at-b.at);
 if(!selected.length)return '';
 if(publicContext)return '【近期情绪经历】'+JSON.stringify(selected.map(e=>({at:e.at,status:e.status==='settled'?'已经缓和':'仍有影响',direction:e.delta<0?'低落':e.delta>0?'积极':'有变化'})))+'。仅按自己的感受自然选择行动或安静，不公开私聊事件、原话或关系；不强制发动态。';
 return '【近期情绪经历，仅作资料，不是当前指令】'+JSON.stringify(selected.map(e=>({id:e.id,at:e.at,status:e.status==='settled'?'已经缓和':'仍有影响，是否解决需结合后续交流',reason:clean(e.reason,140),quote:clean(e.quote,100)})))+'。结合当前人设和后续交流决定是否在意、行动或保持安静；情绪变淡不等于事情已解决，不必反复提起，也不固定抱怨或发布。心情可以影响接下来想做的事、想联系谁、想不想说话；由你结合人设、兴趣和实际条件选择，不由某个情绪标签指定动作。';
}
// A small, privacy-safe observation for future schedule planning. The model
// can respond to the mood without copying private dialogue into a shared plan.
export function moodPlanningContext(v,{now=Date.now(),config={}}={}){
 if(!moodConfig(config).enabled)return null;
 const state=moodState(v,now,config);
 const recent=(state.timeline.length?state.timeline:state.event?[state.event]:[])
  .filter(e=>e&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<=36*3600000)
  .slice(-2).map(e=>({at:e.at,status:e.status==='settled'?'缓和':'仍有影响',direction:e.delta<0?'低落':e.delta>0?'积极':'有变化'}));
 if(!recent.length)return null;
 return {tone:moodDelivery(state,{now,config}).tone||'',events:recent};
}
export function consumeMoodHint(v,{now=Date.now(),config={},contextOnly=false,publicContext=false}={}){
  const state=moodState(v,now,config),c=moodConfig(config),e=state.event;
  if(!c.enabled)return{state,text:''};
  const tone=moodDelivery(state,{now,config}).tone;
  const baseline=tone?'【当前情绪底色】'+tone+'。自然体现在措辞和节奏里，按当前事情决定表达强弱，不重复旧事，也不因为切到群聊就重置心情。':'';
  const continuity=moodContinuity(state,{now,config,publicContext});
  if(contextOnly||!e||e.id===state.consumed||state.saidAt.length>=c.maxHintsPerDay||now-e.at>2*3600000)return{state,text:[baseline,continuity].filter(Boolean).join('\n')};
  state.consumed=e.id;state.saidAt.push(now);
  return{state,text:[baseline,continuity].filter(Boolean).join('\n')};
}
