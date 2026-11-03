import {createHash,randomUUID} from 'node:crypto';
import {calendarNow} from './life-memory.js';
import {digitalActivityKind,DIGITAL_PERSON_RULES} from './digital-life.js';
import {approvalAnswer} from './operation-policy.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=500)=>String(v??'').trim().slice(0,n);
const ACTIVE=new Set(['queued','running','waiting_user','planned','paused','needs_reconcile','participating']);
const EFFECTS=new Set(['send','publish','comment','payment','delete','security','credentials']);
const groupIds=scene=>(Array.isArray(scene?.groupIds)?scene.groupIds.map(String).filter(id=>/^\d{5,20}$/.test(id)).slice(0,20):[]);
export function lifeQuestionText(q={}){const d=q.details||{},parts=[text(q.question,240)];if(d.target)parts.push('这次是给 '+text(d.target,180)+'。');if(d.url)parts.push('我看的页面是 '+text(d.url,400));if(d.amount!==undefined)parts.push('要用 '+text(d.amount,40)+' '+text(d.currency||'元',12)+(d.merchant?'，收款方是 '+text(d.merchant,120):'')+'。');else if(d.merchant)parts.push('收款方是 '+text(d.merchant,120)+'。');if(d.text)parts.push('想发的是：\n'+text(d.text,400));if(d.operation&&!d.target&&!d.text&&!d.amount)parts.push('我想做的是 '+text(d.operation,160)+'。');return parts.filter(Boolean).join('\n');}
export function lifeExecutionConfig(raw={}){return {enabled:raw.enabled!==false,execute:raw.execute!==false,sleep:raw.sleep!==false,maxTasksPerDay:Number(raw.maxTasksPerDay)===0?0:Math.max(1,Math.min(99,Number(raw.maxTasksPerDay)||8))};}
export function activityKind(scene={}){return digitalActivityKind(scene);}
export const LIFE_EXECUTION_RULES=DIGITAL_PERSON_RULES+'\n【日程实际行动】日程是你自己写的计划，不是时钟命令。先结合兴趣和真实进度决定继续、开始、改期、换件事或休息；用bridge_life_adjust mode=start记录已选择开始的活动，mode=plan改计划，mode=finish结束当前活动。不必等用户要求才可更改。时段结束不强行打断，正在做的事可以做完；不能把计划直接说成正在做。当前明确请求优先。只把工具成功返回的作品、页面、画面或音频算作结果，不能把计划写成经历。先观察真实能力和设备状态，再决定行动；首页、标题不能证明看过内容。画画优先用bridge_drawing真实画布逐笔创作、观察修改、导出作品，而不是生成一张假装画画的照片。本人明确要AI生图时才用bridge_art；听歌必须用bridge_audio取得实际音频波形图和频谱图并结合图像分析反馈，不只看歌词或歌名；想玩游戏先bridge_game request取得本人同意，再play并真实操作、bridge_life_qq读取允许对象的真实对话并选择是否发送，不群发。其他数字活动优先直接使用DSH原生工具实际操作，不按固定bridge步骤；作品用bridge_life_artifact登记。需要账号、支付、评论、公开发布、隐私或严重后果时，说明准确目标和完整内容，通过bridge_life_request提出一个具体问题并等待真实回答。问过的事跨日程保留；本人正常闲聊不是审批。任务切换前用bridge_life_checkpoint保存进度、待验证结果和下一步；发送、发布、支付等操作结果未知时先核对，不重放。当前请求结束后可继续先前任务；重新观察当前页面而非复用旧坐标。日程任务的最终文字只留在Harness，不会自动当成QQ消息。想聊天须实际调用bridge_life_qq发送并查询status；想分享作品或链接须用bridge_life_share取得送达状态，不能只写一段给对方的正文就当已经发出。已经用这些工具发过的，回合末尾只回 [skip]，不另写回执、送达确认或本轮总结。有想说的、想分享的或想邀请的，可以主动开口；不想开口才保持安静。结束调用bridge_life_finish，没有真实结果不能声明完成。';

export function createLifeExecution({storage,config,roles,sceneFor,activityFor=sceneFor,onFinish=()=>{},allowed,dispatch,groups=null,stop=()=>{},notify=async()=>{},now=()=>Date.now()}={}){
 let state;try{state=storage.read();}catch(e){if(e.code!=='ENOENT')throw e;}
 state=state&&Array.isArray(state.jobs)?state:{version:2,jobs:[],wake:{},sleep:{}};state.version=2;state.wake||={};state.sleep||={};
 let closed=false,busy=false;
 const groupWindow=typeof groups==='function'?groups:null;
 const cfg=()=>lifeExecutionConfig(config()),scope=m=>hash([m.accountId||'',m.personaId]);
 const save=()=>{const pending=state.jobs.filter(j=>ACTIVE.has(j.status));const historical=state.jobs.filter(j=>!ACTIVE.has(j.status)).slice(-300);state.jobs=[...historical,...pending].sort((a,b)=>a.at-b.at);storage.write(state);};
 // No blind replay after restart. Only a persisted read-only continuation is
 // eligible to resume automatically; unknown side effects require observation.
 for(const j of state.jobs)if(['queued','running'].includes(j.status)){
  const unresolved=(j.steps||[]).some(s=>['started','unknown'].includes(s.status)&&(!s.idempotent||EFFECTS.has(s.effect)));
  j.status=unresolved?'needs_reconcile':j.checkpoint?.safeToResume?'paused':'interrupted';
  j.reason=unresolved?'上次操作结果未知，先核对真实状态，不重放':'上次执行中断，保留进度，先重新观察';
  j.resume=!!j.checkpoint?.safeToResume&&!unresolved;j.restartedAt=now();
 }
 save();
 const liveRole=meta=>meta?roles().find(r=>scope(r.meta)===scope(meta)):undefined;
 const sceneStamp=(meta,sc)=>hash([meta.accountId||'',meta.personaId,sc?.date,sc?.start,sc?.activity]);
 function current(meta){return sceneFor(liveRole(meta)||{meta});}
 function asleep(meta){if(closed||!cfg().enabled||!cfg().sleep)return false;const scene=activityFor(liveRole(meta)||{meta});if(!scene||scene.planned===true||activityKind(scene)!=='sleep')return false;const override=state.wake[scope(meta)];return !override||override.sceneId!==hash([scene.date,scene.start,scene.activity])||!!(override.until&&override.until<=now());}
 function wake(meta,{minutes,reason='本轮明确请求'}={}){const scene=activityFor(liveRole(meta)||{meta});if(scene)state.wake[scope(meta)]={sceneId:hash([scene.date,scene.start,scene.activity]),at:now(),until:minutes?now()+Math.max(1,Math.min(30,Number(minutes)||20))*60_000:0,reason:text(reason,160)};save();return {ok:true,awake:true};}
 function rest(meta){delete state.wake[scope(meta)];save();return {ok:true,sleeping:asleep(meta)};}
 // taskKind==='group' is a participation window, not a model task: at the slot
 // start the listed groups accept her without @; the window closes when the
 // slot ends, the schedule sleeps, or her own leaveWhen condition is met.
 async function closeGroupWindow(meta,j,reason){
  if(!j?.group?.open)return false;
  const opened={...j.group};
  j.group={...opened,open:false,closedAt:now(),reason:text(reason,160)};
  j.status='ended';j.endedAt=j.endedAt||now();save();
  if(groupWindow)try{await groupWindow(meta,{open:false,scene:j.scene,groupIds:opened.ids||[],reason:text(reason,160)});}catch{/* the local window stays closed */ }
  return true;
 }
 async function syncGroupWindow(role,j,scene,sleeping,elsewhere=false){
  const meta=role.meta,ids=groupIds(scene),open=!!j.group?.open;
  // Once she left this slot by her own condition, do not walk back into it.
  if(j.group?.left===true&&!open)return;
  // A plan is not a command: if she chose a different activity, stay out of the group.
  if(sleeping||!cfg().execute||!ids.length){
   if(open){await closeGroupWindow(meta,j,sleeping?'日程进入休息，结束群参与':!ids.length?'这个时段没有指定要参与的群':'当前未开启日程执行，结束群参与');return;}
   j.status=sleeping?'sleeping':!cfg().execute?'planned':'unsupported';j.reason=sleeping?'日程休息，不参与群聊':!cfg().execute?'等待允许执行日程':'这个时段没有指定要参与的群';save();return;
  }
  if(elsewhere){
   if(open){await closeGroupWindow(meta,j,'她正在做别的事，结束群参与');return;}
   j.status='cancelled';j.reason='她选择了现在正在做的事，不开启群参与';save();return;
  }
  if(!groupWindow){j.status='unsupported';j.reason='当前宿主没有开放群参与能力';save();return;}
  const leaveWhen=text(scene.leaveWhen,120);
  let result;
  try{result=await groupWindow(meta,{open:true,scene,groupIds:ids,leaveWhen})||{};}
  catch(e){if(open){j.status='paused';j.reason='群参与窗口暂时无法更新：'+text(e.message,160);j.resumeOnIdle=true;save();}else{j.status='planned';j.reason='等到下次维护再开启群参与';save();}return;}
  if(result.open===false){
   j.group={open:false,left:result.left===true,ids,leaveWhen,openedAt:j.group?.openedAt||now(),closedAt:now(),reason:text(result.reason||(result.left?'按离开条件结束群参与':'按时结束群参与'),160)};
   j.status='ended';j.endedAt=j.endedAt||now();save();return;
  }
  j.group={open:true,ids:Array.isArray(result.groupIds)&&result.groupIds.length?result.groupIds:ids,leaveWhen,openedAt:j.group?.openedAt||now()};
  j.scene={...scene};j.kind='group';j.status='participating';j.boundSceneId=sceneStamp(meta,scene);j.startedAt||=now();j.reason='';save();
 }
 function jobs(meta){return meta?state.jobs.filter(j=>scope(j.meta)===scope(meta)):[];}
 function job(id,meta){const j=state.jobs.find(j=>j.id===id);if(!j||scope(j.meta)!==scope(meta)||!allowed(meta))throw Error('这不是当前角色的有效日程任务');return j;}
 function record(id,meta,evidence){const j=job(id,meta);if(!ACTIVE.has(j.status))return false;j.evidence=(j.evidence||[]).concat({...evidence,at:now()}).slice(-48);save();return true;}
 function checkpoint(id,meta,{summary='',next='',safeToResume=false,expectedResult='',stepId=''}={}){const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');const unresolved=(j.steps||[]).some(s=>['started','unknown'].includes(s.status)&&!s.idempotent);j.checkpoint={summary:text(summary,1200),next:text(next,800),expectedResult:text(expectedResult,600),stepId:text(stepId,100),safeToResume:safeToResume===true&&!unresolved,at:now()};save();return {ok:true,checkpoint:j.checkpoint};}
 function beginStep(id,meta,{key,effect='read',target='',idempotent=false,details={}}={}){const j=job(id,meta);if(!['queued','running'].includes(j.status))throw Error('任务未在执行');const fingerprint=hash([effect,target,details]);j.steps||=[];const old=j.steps.find(s=>s.key===key);if(old){if(old.fingerprint!==fingerprint)throw Error('同一步骤的内容已变化，请建立新步骤');if(old.status==='confirmed')return {ok:true,reused:true,step:old};if(['started','unknown'].includes(old.status)&&!old.idempotent)throw Error('前次操作结果未知，必须核对，不能重放');}const step={id:randomUUID(),key:text(key||randomUUID(),160),effect:text(effect,40),target:text(target,600),fingerprint,idempotent:idempotent===true&&!EFFECTS.has(effect),status:'started',at:now()};j.steps.push(step);save();return {ok:true,reused:false,step};}
 function settleStep(id,meta,stepId,{status='unknown',evidence={}}={}){const j=job(id,meta),step=j.steps?.find(s=>s.id===stepId);if(!step)throw Error('步骤不存在');if(!['confirmed','failed','not_applied','unknown'].includes(status))throw Error('无效步骤状态');if(step.status==='confirmed'&&status!=='confirmed')throw Error('已确认的步骤不能改为未知');step.status=status;step.evidence={...evidence};step.checkedAt=now();if(status==='unknown'&&!step.idempotent){j.status='needs_reconcile';j.reason='操作结果未知，先观察平台结果，不重复执行';}save();return {ok:true,step};}
 function finish(id,meta,{status='completed',note=''}={}){
  const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');
  if(status==='completed'&&j.status==='waiting_user'&&!j.question?.answer)throw Error('还在等待本人决定，不能自行完成这件事');
  if(status==='completed'&&(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)))throw Error('存在结果未知的操作，需要先核对');
  if(status==='completed'&&!j.evidence?.some(e=>e.ok&&e.substantive))throw Error('还没有真实作品或具体内容证据，不能把计划当作已完成');
  j.status=['completed','failed','unsupported','cancelled'].includes(status)?status:'failed';j.note=text(note,350);j.endedAt=now();save();onFinish(j);return {ok:true,status:j.status,evidence:j.evidence||[]};
 }
 async function request(id,meta,{kind,question,details={}}){
  const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');
  if(!['login','payment','comment','publish','choice','permission','delete','security','privacy'].includes(kind))throw Error('请选择需要本人决定的问题类型');
  if(!String(question||'').trim())throw Error('请先写清楚要问的一件事');
  if(j.question&&!j.question.answer)return {ok:true,waiting:true,id:j.question.id};
  j.question={id:randomUUID(),kind,question:text(question,240),details,at:now()};j.status='waiting_user';save();await notify(j);return {ok:true,waiting:true,id:j.question.id};
 }
 function answer(questionId,meta,value){
  const j=jobs(meta).find(j=>j.question?.id===questionId&&j.status==='waiting_user');if(!j)throw Error('问题已过期或不属于当前角色');
  const disposition=approvalAnswer(value);if(j.question.kind!=='choice'&&disposition==='unrelated')return {ok:false,unrelated:true,questionId};
  j.question.answer=text(value,1200);j.question.answeredAt=now();j.question.disposition=disposition;
  if(disposition==='deny'){j.status='cancelled';j.note='本人拒绝此操作';j.endedAt=now();j.resume=false;}else{j.status='paused';j.resume=true;j.resumeAfterAnswer=true;}save();return j;
 }
 function question(meta){return jobs(meta).filter(j=>j.status==='waiting_user'&&!j.question?.answer).at(-1)||null;}
 function reserveFinalReply(id,meta,{body='',turn}={}){
  const j=job(id,meta),value=text(body,2400),sc=current(meta);
  if(!['running','queued'].includes(j.status)||j.finalReply||!value||/\[skip\]/i.test(value)||!sc||j.shares?.length||(j.steps||[]).some(s=>EFFECTS.has(s.effect)&&['started','unknown','confirmed'].includes(s.status)))return null;
  j.finalReply={text:value,turn,at:now(),status:'awaiting_decision'};save();return j;
 }
 function markShare(id,meta,item){const j=job(id,meta);j.shares=(j.shares||[]).concat({...item,at:now()});if(j.finalReply){j.finalReply.status='queued';j.finalReply.deliveryIds=[...new Set([...(j.finalReply.deliveryIds||[]),...(item.deliveryIds||[item.deliveryId]).filter(Boolean)])];}save();}

 function deliveryReceipt(deliveryId,{status,messageId}={}){for(const j of state.jobs){if(j.finalReply?.deliveryIds?.includes(deliveryId)){j.finalReply.receipts||={};j.finalReply.receipts[deliveryId]={status,messageId:messageId||'',at:now()};const values=j.finalReply.deliveryIds.map(id=>j.finalReply.receipts[id]?.status);j.finalReply.status=values.every(s=>s==='sent')?'sent':values.includes('unknown')?'unknown':values.includes('failed')?'failed':'queued';}}for(const j of state.jobs)for(const step of j.steps||[]){const ids=step.evidence?.deliveryIds||[step.evidence?.deliveryId].filter(Boolean);if(!ids.includes(deliveryId))continue;step.evidence.deliveryStates||={};step.evidence.deliveryStates[deliveryId]={status,messageId:messageId||'',at:now()};if(ids.every(id=>step.evidence.deliveryStates[id]?.status==='sent')){step.status='confirmed';step.checkedAt=now();step.evidence.verified=true;if(j.status==='needs_reconcile'&&!(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status))){j.status='running';j.reason='QQ回执已确认，可以继续当前任务';}}}save();}
 function pause(j,reason){j.status='paused';j.reason=reason;j.pausedAt=now();j.resumeOnIdle=true;}
 function resume(id,meta,{observed=false}={}){const j=job(id,meta);if(j.status==='waiting_user')throw Error('先等待对应问题的真实回答');if(j.status==='needs_reconcile'&&!observed)throw Error('先观察并核对上次操作结果');if(!['paused','interrupted','needs_reconcile','incomplete'].includes(j.status))throw Error('任务不能在当前状态恢复');if((j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)))throw Error('仍有结果未知的步骤，不能恢复执行');j.status='paused';j.resume=true;j.resumeObserved=observed;j.reason='从保留的进度恢复，先重新观察';save();return {ok:true,id};}
 async function syncState(meta){
  if(closed||!liveRole(meta))return;
  const sleeping=asleep(meta),key=scope(meta);
  if(state.sleep[key]!==sleeping){state.sleep[key]=sleeping;save();if(sleeping){for(const j of jobs(meta))if(j.group?.open)await closeGroupWindow(meta,j,'日程进入休息，结束群参与');await stop(meta);}}
 }
 async function tick(){
  if(closed||busy||!cfg().enabled)return;busy=true;
  try{
   // A closed gate or a switched account must not leave a stale participation window.
   for(const j of state.jobs)if(j.meta&&j.group?.open&&!allowed(j.meta))await closeGroupWindow(j.meta,j,'当前不允许执行日程，结束群参与');
   for(const role of roles()){
   if(!role?.meta)continue;
   try{
   if(closed||!allowed(role.meta))continue;const sc=current(role.meta);if(!sc)continue;
   const sleeping=asleep(role.meta),key=scope(role.meta);if(state.sleep[key]!==sleeping){state.sleep[key]=sleeping;save();if(sleeping)await stop(role.meta);}
   const id=sceneStamp(role.meta,sc),kind=activityKind(sc);let scheduled=state.jobs.find(j=>j.id===id);
   if(!scheduled){scheduled={id,meta:{...role.meta},scene:{...sc},kind,status:sc.requested?'user_request':sleeping?'sleeping':'planned',at:now(),evidence:[]};state.jobs.push(scheduled);save();}
   if(scheduled.status==='budget'&&cfg().maxTasksPerDay===0){scheduled.status='planned';scheduled.reason='已取消日常任务次数上限，重新自行判断';save();}
   for(const old of jobs(role.meta))if(old.id!==id&&old.status==='planned'){old.status='cancelled';old.reason='旧计划未开始，已过原定时段';}save();
   // Her group participation belongs to one slot: close it as soon as that slot ends.
   for(const old of jobs(role.meta))if(old.id!==id&&old.group?.open)await closeGroupWindow(old.meta,old,'时段结束，结束群参与');
   if(String(sc.taskKind||'')==='group'){
    const actual=activityFor(role);
    const elsewhere=!!actual&&actual.actual===true&&activityKind(actual)!=='group'&&actual.activity!==sc.activity;
    await syncGroupWindow(role,scheduled,sc,sleeping,elsewhere);continue;
   }
   // An elapsed plan boundary never interrupts an activity she chose to begin.
   if(jobs(role.meta).some(j=>['queued','running'].includes(j.status)))continue;
   // Pending questions survive time-slot changes, midnight, restart and another
   // user request. They are never implicitly treated as approvals or expired.
   save();if(sc.requested||sleeping||!cfg().execute||jobs(role.meta).some(j=>['running','queued'].includes(j.status)))continue;
   const resumable=jobs(role.meta).filter(j=>j.status==='paused'&&(j.resume||j.resumeOnIdle)&&!(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status))).sort((a,b)=>(b.question?.answeredAt||b.pausedAt||0)-(a.question?.answeredAt||a.pausedAt||0));
   const j=resumable[0]||scheduled;if(!['planned','paused'].includes(j.status))continue;
   if(j.kind==='unsupported'){j.status='unsupported';j.reason='忽略无法实际完成的实体活动，不伪造经历';save();continue;}
   const day=calendarNow(now()).day,started=jobs(role.meta).filter(x=>x.startedAt&&x.kind!=='group'&&calendarNow(x.startedAt).day===day).length;
   if(!j.resume&&!j.resumeOnIdle&&cfg().maxTasksPerDay>0&&started>=cfg().maxTasksPerDay){j.status='budget';j.reason='今天的实际日程任务额度已用完';save();continue;}
   const stamp=sceneStamp(role.meta,sc);j.status='queued';save();
   try{const sessionId=await dispatch(role,j);if(!sessionId){if(j.status==='queued')j.status=j.resume||j.resumeOnIdle?'paused':'planned';save();continue;}if(!allowed(role.meta)){await stop(role.meta);if(['queued','running'].includes(j.status))pause(j,'执行期间安排变化，保留进度');save();continue;}if(j.status==='queued')j.status='running';j.boundSceneId=stamp;j.sessionId=sessionId;j.startedAt||=now();j.resume=false;j.resumeOnIdle=false;save();}
   catch(e){j.status='failed';j.reason=text(e.message,220);save();}
  }catch(error){/* one broken role must not block the others */}
  }
  }finally{busy=false;}
 }
 function interruptForRequest(meta){for(const j of jobs(meta))if(['queued','running','planned'].includes(j.status))pause(j,'用户当前请求优先，暂停默认日程');save();}
 function ended(id,meta,reason){const j=state.jobs.find(j=>j.id===id&&scope(j.meta)===scope(meta));if(!j||!['running','queued'].includes(j.status))return;if(j.finalReply?.status==='awaiting_decision')j.finalReply.status='not_sent';const unknown=(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status));j.status=unknown?'needs_reconcile':reason==='completed'?'incomplete':'paused';j.reason=unknown?'存在结果未知的步骤，先核对，不重放':reason==='completed'?'本轮没有确认真实结果，未标记完成':'执行已暂停，保留进度';j.pausedAt=now();j.resumeOnIdle=reason!=='completed'&&!!j.checkpoint?.safeToResume;save();}
 function snapshot(meta){return {config:cfg(),sleeping:asleep(meta),scene:activityFor(liveRole(meta)||{meta}),plan:current(meta),jobs:jobs(meta).slice(-25).reverse(),pending:question(meta),waiting:jobs(meta).filter(j=>j.status==='waiting_user'),recoverable:jobs(meta).filter(j=>['paused','needs_reconcile','interrupted','incomplete'].includes(j.status)).map(j=>({id:j.id,status:j.status,activity:j.scene?.activity,checkpoint:j.checkpoint,reason:j.reason}))};}
 return {tick,syncState,reserveFinalReply,asleep,wake,rest,interruptForRequest,record,checkpoint,beginStep,settleStep,resume,finish,request,answer,question,snapshot,job,ended,markShare,deliveryReceipt,close:async()=>{closed=true;for(const j of state.jobs.filter(x=>x.group?.open))if(groupWindow)try{await groupWindow(j.meta,{open:false,scene:j.scene,groupIds:j.group.ids||[],reason:'日程执行已关闭'});}catch{}},reload(){try{state=storage.read();state.wake||={};state.sleep||={};}catch{}}};
}
