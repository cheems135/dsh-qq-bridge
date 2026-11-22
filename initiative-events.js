import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function moodInitiativeEvent(mood,{now=Date.now(),enabled=true}={}){
 if(!enabled)return null;
 const timeline=Array.isArray(mood?.timeline)?mood.timeline:mood?.event?[mood.event]:[];
 const event=timeline.filter(e=>e&&Number.isFinite(e.at)&&e.at<=now&&now-e.at<=24*3600000&&Number(e.impact)>=3).sort((a,b)=>b.at-a.at)[0];
 if(!event)return null;
 return {id:hash(['mood',event.id,event.status]),kind:'mood',at:event.at,summary:{at:event.at,status:event.status==='settled'?'缓和':'仍有影响',direction:event.delta<0?'低落':event.delta>0?'积极':'有变化',note:'有原话依据的情绪变化；只作是否行动的线索，不公开私人原因，也不证明已经做过任何事'}};
}
export function moodFollowupReady(event,{now=Date.now(),lastIncoming=0}={}){
 return event?.kind==='mood'&&now-Math.max(Number(event.at)||0,Number(lastIncoming)||0)>=20*60000;
}
// Only an actual, persisted execution dead end can invite a new decision.
// A busy service, an ordinary pause, and a plan that has not run are not
// reasons to ask a person for help. The model still decides whether to try a
// different tool, ask one concrete question, or stay quiet.
export function blockedTaskInitiativeEvent(jobs=[],now=Date.now()){
 const candidates=jobs.flatMap(job=>{
  if(!job?.id||!job.scene?.activity||job.waitingService&&!job.waitingService.expired)return [];
  const unknown=(job.steps||[]).filter(step=>!step.idempotent&&['started','unknown'].includes(step.status));
  const failed=job.status==='failed'&&Number(job.endedAt)>0;
  const reconcile=job.status==='needs_reconcile'&&unknown.length>0&&Number(job.lastTurnEnded?.at)>0;
  if(!failed&&!reconcile)return [];
  const at=failed?Number(job.endedAt):Number(job.lastTurnEnded.at);
  if(!Number.isFinite(at)||at>now||now-at>24*3600000)return [];
  const reason=String((failed?job.lastError||job.reason:job.reason||job.lastError)||job.note||'').trim();
  if(!reason)return [];
  const completed=(job.evidence||[]).filter(e=>e.ok===true&&e.substantive===true).slice(-2).map(e=>({tool:String(e.tool||'').slice(0,80),coverage:String(e.coverage||'').slice(0,160)}));
  const state=failed?'failed':'needs_reconcile';
  const id=hash(['task-blocker',job.id,state,failed?at:unknown.map(step=>step.id)]);
  return [{id,kind:'task-blocker',at,summary:{jobId:job.id,activity:String(job.scene.activity).slice(0,160),status:state,reason:reason.slice(0,220),confirmedProgress:completed,next:String(job.checkpoint?.next||'').slice(0,220),note:'这是实际执行记录中的障碍，不证明任务已完成。先尝试可安全核对或替代的方法；只有确实需要本人提供信息或操作时，才自然询问一个具体问题。不要重复执行结果未知的操作，也不要把内部错误原样发给对方。'}}];
 });
 return candidates.sort((a,b)=>b.at-a.at)[0]||null;
}
// Only confirmed outgoing group speech can become a private follow-up cue.
// Incoming group text and unsubmitted model drafts are never event sources.
function directedPrivateIntent(text,ownerId){
 const qqId=/^\d+$/.test(String(ownerId||''))?String(ownerId):'';
 const target='(?:我爸|爸爸|爸比|主人|号主'+(qqId?'|@'+qqId+'|\\[CQ:at,qq='+qqId+'\\]':'')+')';
 if(/(?:算了|先别|不去了|不找了|不说了|不聊了)/.test(String(text||'')))return false;
 return String(text||'').split(/[，。！？!?\n；;]/).some(raw=>{
  const clause=raw.trim();
  if(!/^(?:那|所以|不过|然后|好吧|算了)?我(?!爸|妈|朋友|同学|姐姐|妹妹|哥哥|弟弟)/.test(clause))return false;
  if(/不(?:去|想|会|找|聊|发)|别|不用|没打算|如果|假如|要是|比如|举例|假设|可能|也许|大概|[“「‘"]|(?:已经|刚才|刚刚|昨天)/.test(clause))return false;
  if(!/(?:想|要|准备|打算|会|先|就|现在|待会|等会|回头|一会|去)/.test(clause))return false;
  return new RegExp('(?:去|来|找|联系|私聊|私信|单聊).{0,12}'+target).test(clause)
   ||new RegExp('(?:跟|和|向|给).{0,4}'+target+'.{0,14}(?:说|聊|问|倾诉|吐槽|抱怨|撒娇|解释|分享|发(?:条|个)?(?:消息|私信|语音|图片))').test(clause);
 });
}
export function groupPrivateOpportunity({messages=[],accountId='',personaId='',ownerId='',ownerIds=[],groups=[],now=Date.now()}={}){
 if(!ownerId||ownerIds.length!==1||String(ownerIds[0])!==String(ownerId))return null;
 const scoped=messages.filter(m=>(m.accountId||'')===accountId&&m.personaId===personaId);
 const source=scoped.filter(m=>m.dir==='out'&&m.delivery==='sent'&&m.verification?.state==='observed'&&groups.includes(String(m.chat).replace(/^group:/,''))&&String(m.chat).startsWith('group:')&&m.time<=now&&m.time>now-86400000).reverse().find(m=>directedPrivateIntent(m.text,ownerId));
 if(!source)return null;
 // A real private exchange after the statement supersedes this opportunity.
 if(scoped.some(m=>m.chat==='private:'+ownerId&&m.time>source.time&&(m.dir==='in'||m.dir==='out'&&m.delivery==='sent')))return null;
 const summary={sourceChat:source.chat,sourceId:source.messageId||source.localId||'',at:source.time,said:String(source.text||'').slice(0,600),context:scoped.filter(m=>m.chat===source.chat&&m.time<=source.time&&(m.dir==='in'||m.delivery==='sent')).slice(-5).map(m=>({speaker:m.dir==='out'?'你':String(m.userId||m.senderId||'群成员'),text:String(m.text||'').slice(0,220)})),note:'这是你实际在群里说过的想去找号主的念头，不是他发来的新要求；结合眼下情绪与话题决定是否自然私聊接上，不重复宣布要去，不编造已经私聊或对方回应。'};
 return {id:hash([accountId,personaId,ownerId,source.chat,summary.sourceId,source.time,summary.said]),kind:'social-followup',summary};
}
// Inputs must be obtained from the host's scoped calendar and execution ledger.
// Timestamps from polling are deliberately excluded from event identity.
export function initiativeEvent({scene=null,jobs=[],mood=null,moodEnabled=true,now=Date.now()}={}){
 const emotional=moodInitiativeEvent(mood,{now,enabled:moodEnabled});
 const blocker=blockedTaskInitiativeEvent(jobs,now);
 const recent=jobs.flatMap(j=>(j.evidence||[]).filter(e=>e.ok===true&&e.substantive===true&&Number(e.at)>now-86400000).map(e=>({j,e}))).sort((a,b)=>b.e.at-a.e.at);
 const found=recent[0];
 const events=[emotional,blocker].filter(Boolean);
 if(found){const {j,e}=found,payload={job:j.id,tool:e.tool||'',url:e.url||'',file:e.file||'',coverage:e.coverage||'',complete:e.complete===true,partial:e.partial===true};events.push({id:hash(['progress',payload]),kind:'progress',at:e.at,summary:{...payload,activity:j.scene?.activity||''}});return events.sort((a,b)=>b.at-a.at)[0];}
 // The scene is supplied separately as context to both API and local decision
 // prompts. A planned/simulated slot is not a newly observed event.
 return events.sort((a,b)=>b.at-a.at)[0]||null;
}
export function eventInitiativeCadence(record,base,now,{event=null,commit=false}={}){
 // Older records may already contain repeated IDs. Idle decisions must not
 // evict a distinct event just by observing the last one again.
 const seen=[...new Set([...(record?.seenEventIds||[]),record?.eventId].filter(Boolean))].slice(-12);
 // A calendar scene is background for the next ordinary decision. It is not
 // a new observation and must not buy an extra model call when the slot moves.
 const realEvent=event&&['mood','task-blocker','progress','social-followup','message'].includes(event.kind);
 const fresh=!!realEvent&&!!event.id&&!seen.includes(event.id);
 const prior=record?.base===base?record:{base,fired:[]},last=prior.fired?.at(-1)||0;
 const next=last?last+(prior.fired.length<2?15:120)*60000:base+15*60000;
 const ok=fresh||now>=next;
 const value={...prior,eventId:record?.eventId||'',seenEventIds:seen.slice(-12)};
 if(ok&&commit){value.fired=[...(prior.fired||[]),now].slice(-8);if(fresh){value.eventId=event.id;value.seenEventIds=[...seen,event.id].slice(-12);}}
 return {ok,next,event:fresh?event:null,record:value};
}
