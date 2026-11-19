import {taskProgressSignature,scheduleJobDetails} from './schedule-continuity.js';
import {taskCompletion,offlineSlot} from './schedule-evidence.js';
import {SCHEDULE_TOOL_RULE} from './schedule-tool-breaker.js';
import {createHash,randomUUID} from 'node:crypto';
import {constants,copyFileSync,readFileSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {calendarNow,lifeConfig} from './life-memory.js';
import {digitalActivityKind,DIGITAL_PERSON_RULES} from './digital-life.js';
import {approvalAnswer} from './operation-policy.js';
import {paymentQuestionText} from './social-voice.js';
import {latestTaskWait} from './task-progress.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const text=(v,n=500)=>String(v??'').trim().slice(0,n);
const ACTIVE=new Set(['queued','running','waiting_user','planned','paused','needs_reconcile','participating']);
export function lifeExecutionStorage(file,log=()=>{},now=Date.now){
 const backup=file+'.last-good';
 function readOne(path){
  try{
   const state=JSON.parse(readFileSync(path,'utf8'));
   if(!Array.isArray(state?.jobs)||state.jobs.some(job=>!job||typeof job!=='object'))throw new SyntaxError('invalid job list');
   return {state};
  }catch(error){
   if(error.code==='ENOENT')return {};
   if(!(error instanceof SyntaxError))throw error;
   const preserved=path+'.corrupt-'+randomUUID();
   copyFileSync(path,preserved,constants.COPYFILE_EXCL);
   log('日程执行记录无法解析，已保留原件：'+preserved);
   return {damaged:true};
  }
 }
 function replace(path,bytes){
  const temp=path+'.'+randomUUID()+'.tmp';
  try{writeFileSync(temp,bytes,{flag:'wx',flush:true});renameSync(temp,path);}
  finally{rmSync(temp,{force:true});}
 }
 return {
  read(){
   const main=readOne(file);if(main.state)return main.state;
   const previous=readOne(backup);
   if(!previous.state&&!main.damaged&&!previous.damaged)return undefined;
   const state=previous.state||{version:2,jobs:[],sleep:{},wake:{}};
   state.recoveredAt=now();
   for(const job of state.jobs)if(ACTIVE.has(job.status)){
    job.status='needs_reconcile';job.resume=false;job.resumeOnIdle=false;
    job.reason='从备用记录恢复，先核对任务的真实进度';
   }
   log(previous.state?'已从备用日程执行记录恢复':'无可读的备用执行记录，保留日程计划，从下一时段继续执行');
   return state;
  },
  write(state){
   const bytes=JSON.stringify(state,null,2);
   replace(file,bytes);
   try{replace(backup,bytes);}catch(error){log('日程执行备用记录保存失败：'+error.message);}
  }
 };
}
const EFFECTS=new Set(['send','publish','comment','payment','delete','security','credentials']);
const groupIds=scene=>(Array.isArray(scene?.groupIds)?scene.groupIds.map(String).filter(id=>/^\d{5,20}$/.test(id)).slice(0,20):[]);
export const CONTINUATION_RULE='\n【任务续做与收尾】每轮结束前核对scene.goal：已达成时用bridge_life_finish结束；未达成且可以继续时，用bridge_life_checkpoint保存真实进度、具体next及safeToResume，再继续推进。暂停、放弃或受阻时写清原因，不把“发了一句话”当作看完视频。continuation.closeoutOnly=true表示上一轮有操作却没有收尾：先用已有证据核对目标，完成则结束，未完成则保存具体下一步；不要重复已确认的发送、生成或发布。连续续做没有新增进度时停止空转，保留阻碍，不谎称完成。';
export function borrowAnswer(value){
 const phrase=String(value||'').trim().replace(/[。！!，,\s]/g,'');
 if(/^(?:可以用|用吧|你用吧|去玩吧|可以玩|现在可以|好啊|可以呀|可以啊)$/.test(phrase))return 'approve';
 if(/^(?:先别|等一下|等会儿|我在用|现在不行|先不用|别用)$/.test(phrase))return 'deny';
 return approvalAnswer(value);
}
export function lifeQuestionText(q={}){return q.kind==='payment'?paymentQuestionText(q):text(q.question,600);}
export function lifeExecutionConfig(raw={}){return lifeConfig(raw);}
export function activityKind(scene={}){return digitalActivityKind(scene);}
const BASE_LIFE_EXECUTION_RULES=DIGITAL_PERSON_RULES+'\n'+SCHEDULE_TOOL_RULE+'\n【日程实际行动】这是你自己选定要做的计划。日程是你给自己留的打算。结合此刻兴趣、设备状态和聊天，自行决定开始、继续、调整、休息或放弃。决定做的事可以自己推进，不必等人催。先根据真实能力自己寻找实现方法：发现工具、观察页面或设备、搜索资料、尝试操作，再核对结果；没有固定教程不等于做不了，一种路径失败时可换可行路径，实际没有能力或需要本人完成登录验证时再说明阻碍并保存进度，不假装成功。视频要实际播放并观察相应窗口，游戏要真实进入并操作；本次体验到自然停顿或目标达成即可，不必强制发QQ或交报告。结合真实进度继续推进，但不必死磕：做不动、卡住太久或者单纯不想做了，可以收尾换别的，记一句原因和进度就行；用bridge_life_adjust mode=start记录已选择开始的活动，mode=plan改计划，mode=finish结束当前活动。不必等用户要求才可更改。时段结束不强行打断，正在做的事可以做完；不能把计划直接说成正在做。当前明确请求优先。只把工具成功返回的作品、页面、画面或音频算作结果，不能把计划写成经历。先观察真实能力和设备状态，再决定行动；首页、标题不能证明看过内容。创作时自己选择适合目标的媒介和工具：bridge_drawing逐笔绘图、bridge_art生成数字画作，或实际可用的原生工具；如实区分制作方式，不把生成图片说成手绘。想记私人感受可用bridge_diary，写或不写由自己决定，没有日结要求。听歌用bridge_audio取得实际音频证据，必要时开启转写或图谱；波形图不是听懂内容的证明，不只看歌词或歌名；想玩游戏可直接bridge_game play并真实操作、bridge_life_qq读取允许对象的真实对话供自己理解，并把活动结果留在日程面板。其他数字活动优先直接使用DSH原生工具实际操作，不按固定bridge步骤；写作品前先读取bridge_capabilities的life.artifactDir与artifactWorkspace，优先在artifactDir写入后用bridge_life_artifact登记；不要假定进程当前目录就是任务目录。原件已在artifactWorkspace时可用action=import复制归档，保留原件；登记被拒按返回的suggestedFile和nextStep修正，不重做已完成作品。仅实际付款需要先核对准确收款方、金额与币种，通过bridge_life_request或bridge_operation_request自然询问并等本人同意；本人闲聊不算付款同意。登录、分享和普通操作不用申请，评论仍按独立开关与手动选择。缺少资料时可以自然问清，不输出申请清单。任务切换前用bridge_life_checkpoint保存进度、待验证结果和下一步；发送、发布、支付等操作结果未知时先核对，不重放。当前请求结束后可继续先前任务；重新观察当前页面而非复用旧坐标。【日程与主聊天】活动结果、作品、感想与待决定问题留在日程面板。继续自己做事和选择是否调整计划，媒体以真实作品为准。不要为日程另发QQ文字、作品、语音、视频或表情包，不为日程安排一条迟到的通知。本人主动问起时，在当前对话回答他真正问到的内容。结束调用bridge_life_finish，没有真实结果不能声明完成。';

export const LIFE_EXECUTION_RULES=BASE_LIFE_EXECUTION_RULES+'\n想用应用或玩游戏时，先查看当前平台与可用工具。独立后台浏览器可直接使用。用电脑或手机前台时，按当前情境自己决定直接用、改用后台、稍后再用，或先聊一句。若想等号主答复，可用 bridge_life_request kind=device_borrow，details.device 为 desktop 或 phone；一旦问了就等这一任务的答复，尊重拒绝。'+CONTINUATION_RULE+'\n【音频证据】听过或生成的音频要有真实任务结果，文本、歌词、音频文件和试听各自按实际回执记录。'+'\n【聊天时间边界】日程任务只把当前收到的消息当作正在进行的对话。较早的聊天、计划和上一轮自己的发言是历史资料；可以记得并在合适时提起，但不能把隔了很久的旧句子当成刚收到的话接着说。仍需兑现的约定以任务和回执核对，不因旧聊天原话未进入本轮上下文而取消。';
export function reconcileArtifactRejections(state,operations=[],now=Date.now()){
 let repaired=0;
 for(const job of state.jobs||[]){let changed=false;
  for(const step of job.steps||[]){
   if(step.status!=='unknown'||step.effect!=='local')continue;
   const op=operations.find(o=>o.id===step.evidence?.operationId&&o.tool==='bridge_life_artifact'&&o.accountId===job.meta?.accountId&&o.personaId===job.meta?.personaId);
   if(!op||!/(?:只登记当前角色自己的数字作品目录|ENOENT:.*(?:lstat|stat|realpath))/.test(String(op.error||'')))continue;
   step.status='not_applied';step.effect='read';step.idempotent=true;step.checkedAt=now;
   step.evidence={...step.evidence,verified:false,recovery:{at:now,operationId:op.id,reason:'旧版只读作品校验被拒，明确没有登记；原作品与检查点保留'}};changed=true;repaired++;
  }
  if(changed&&job.status==='needs_reconcile'&&!(job.steps||[]).some(s=>!s.idempotent&&['unknown','started'].includes(s.status))){
   job.status='paused';job.resume=false;job.resumeOnIdle=false;job.reason='只读登记误锁已解除；先核对现有作品、当前时间和检查点，再修正登记或收尾，不补发过期问候';
  }
 }
 return repaired;
}
// Older tool wrappers started a send under one host execution object and tried
// to finish it under another. A verified QQ readback can repair that exact
// missing receipt. Never infer success from a share record or queued send alone.
export function reconcileDeliveredLifeShares(state,operations=[],outbox=[],now=Date.now()){
 const byOperation=new Map(operations.map(row=>[row.id,row]));
 const byDelivery=new Map(outbox.map(row=>[row.id,row]));
 let repaired=0;
 for(const job of state.jobs||[]){
  let jobRepaired=0;
  const pending=(job.steps||[]).filter(step=>step.effect==='send'&&['started','unknown'].includes(step.status)&&!(step.evidence?.deliveryIds||[]).length);
  const matches=pending.map(step=>{
   const operation=byOperation.get(step.key||step.evidence?.operationId);
   if(!operation||operation.status!=='started'||operation.tool!==step.tool||operation.accountId!==job.meta?.accountId||operation.personaId!==job.meta?.personaId||operation.target!==step.target)return null;
   const candidates=(job.shares||[]).filter(share=>share.target===step.target&&share.at>=step.at&&share.at-step.at<=5000&&(share.deliveryIds||[share.deliveryId].filter(Boolean)).length);
   return candidates.length===1?{step,operation,share:candidates[0]}:null;
  }).filter(Boolean);
  for(const match of matches){
   if(matches.some(other=>other!==match&&other.share===match.share))continue;
   const {step,operation,share}=match,ids=share.deliveryIds||[share.deliveryId].filter(Boolean);
   const deliveries=ids.map(id=>byDelivery.get(id));
   if(deliveries.some((row,index)=>!row||row.id!==ids[index]||row.accountId!==job.meta?.accountId||row.personaId!==job.meta?.personaId||row.chat!==step.target||row.status!=='sent'||row.verification?.state!=='observed'||!row.messageId))continue;
   step.status='confirmed';step.checkedAt=now;
   step.evidence={...step.evidence,verified:true,operationId:operation.id,deliveryId:ids[0],deliveryIds:ids,deliveryStates:Object.fromEntries(deliveries.map(row=>[row.id,{status:row.status,messageId:row.messageId,verification:row.verification,at:row.updatedAt||now}])),recovery:{at:now,reason:'同一日程内的发送记录与QQ消息ID均已读回核对'}};
   operation.status='confirmed';operation.verified=true;operation.deliveryIds=ids;operation.coverage='日程发送记录与QQ消息ID均已读回核对';operation.updatedAt=now;
   repaired++;jobRepaired++;
  }
  if(jobRepaired&&job.status==='needs_reconcile'&&!(job.steps||[]).some(step=>!step.idempotent&&['started','unknown'].includes(step.status))){
   job.status='paused';job.resume=false;
   const current=calendarNow(now),sameSlot=job.scene?.date===current.day&&job.scene?.start<=current.clock&&job.scene?.end>current.clock;
   job.resumeOnIdle=!!sameSlot;job.closeoutAttempted=!!sameSlot;
   job.continuation={...job.continuation,closeoutOnly:!!sameSlot};
   job.reason=sameSlot?'QQ实际送达已核对；本时段核对目标并收尾，不重复发送':'QQ实际送达已核对；旧时段不重启发送';
  }
 }
 return repaired;
}
// A host operation can finish after the model turn (or after the bridge has
// restarted). Recover only the exact operation that started this step. A queued
// send is never proof of delivery: its QQ message must also be read back.
export function reconcileVerifiedLifeOperations(state,operations=[],outbox=[],now=Date.now()){
 const terminal=new Map(),deliveries=new Map(outbox.map(row=>[row.id,row]));
 for(const row of operations)if(row?.id&&row.status!=='started')terminal.set(row.id,row);
 let repaired=0;
 for(const job of state.jobs||[]){
  let changed=false;
  for(const step of job.steps||[]){
   if(step.idempotent||!['started','unknown'].includes(step.status))continue;
   const id=step.evidence?.operationId||step.key,op=terminal.get(id);
   if(!op||op.accountId!==job.meta?.accountId||op.personaId!==job.meta?.personaId||op.tool!==step.tool||op.target!==step.target||op.effect&&op.effect!==step.effect)continue;
   let status='';
   if(op.status==='not_applied')status='not_applied';
   else if(step.effect==='send'){
    const ids=[...new Set([...(step.evidence?.deliveryIds||[]),...(op.deliveryIds||[]),step.evidence?.deliveryId].filter(Boolean))];
    if(ids.length&&ids.every(deliveryId=>{
     const row=deliveries.get(deliveryId);
     return row?.accountId===job.meta?.accountId&&row.personaId===job.meta?.personaId&&row.chat===step.target&&row.status==='sent'&&row.verification?.state==='observed'&&!!row.messageId;
    })){
     status='confirmed';step.evidence={...step.evidence,deliveryIds:ids,deliveryStates:Object.fromEntries(ids.map(deliveryId=>{const row=deliveries.get(deliveryId);return [deliveryId,{status:row.status,messageId:row.messageId,verification:row.verification,at:row.updatedAt||now}];}))};
    }
   }else if(op.status==='confirmed'&&op.verified===true)status='confirmed';
   if(!status)continue;
   step.status=status;step.checkedAt=now;step.evidence={...step.evidence,operationId:op.id,verified:status==='confirmed',recovery:{at:now,reason:status==='confirmed'?'原操作及实际结果已核对':'原操作明确未执行，保留任务进度'}};
   changed=true;repaired++;
  }
  if(changed&&job.status==='needs_reconcile'&&!(job.steps||[]).some(step=>!step.idempotent&&['started','unknown'].includes(step.status))){
   const current=calendarNow(now),sameSlot=job.scene?.date===current.day&&job.scene?.start<=current.clock&&job.scene?.end>current.clock;
   job.status='paused';job.resume=false;job.resumeOnIdle=!!sameSlot;
   job.closeoutAttempted=!!sameSlot;
   job.continuation={...job.continuation,closeoutOnly:!!sameSlot};
   job.reason=sameSlot?'实际回执已核对；本时段重新观察并收尾，不重复已确认的操作':'实际回执已核对；旧时段不重放原操作';
  }
 }
 return repaired;
}
export function createLifeExecution({storage,config,roles,sceneFor,activityFor=sceneFor,onFinish=()=>{},allowed,dispatch,groups=null,conversationBusy=()=>false,onProgress=()=>{},onStateChange=()=>{},operationJournal=()=>[],deliveryJournal=()=>[],onReconcile=()=>{},stop=()=>{},notify=async()=>{},questionChannel='qq',now=()=>Date.now()}={}){
 let state;try{state=storage.read();}catch(e){if(e.code!=='ENOENT')throw e;}
 state=state&&Array.isArray(state.jobs)?state:{version:2,jobs:[],wake:{},sleep:{}};state.version=2;state.wake||={};state.sleep||={};
 let closed=false,busy=false;
 const groupWindow=typeof groups==='function'?groups:null;
 const cfg=()=>lifeExecutionConfig(config()),scope=m=>hash([m.accountId||'',m.personaId]);
 const save=()=>{const pending=state.jobs.filter(j=>ACTIVE.has(j.status));const historical=state.jobs.filter(j=>!ACTIVE.has(j.status)).slice(-300);state.jobs=[...historical,...pending].sort((a,b)=>a.at-b.at);storage.write(state);};
 function retireOrdinaryQuestions(){for(const j of state.jobs)if(j.status==='waiting_user'&&!['payment','device_borrow'].includes(j.question?.kind)){
  j.retiredQuestions=[...(j.retiredQuestions||[]),{...j.question,status:'retired',retiredAt:now()}].slice(-10);delete j.question;
  const unresolved=(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status));j.status=unresolved?'needs_reconcile':'paused';j.resume=!unresolved;j.resumeOnIdle=!unresolved;j.reason=unresolved?'先核对上次操作的实际结果':'普通操作无需再次许可，保留进度后继续';
 }}
 retireOrdinaryQuestions();
 // No blind replay after restart. Only a persisted read-only continuation is
 // eligible to resume automatically; unknown side effects require observation.
 for(const j of state.jobs)if(['queued','running'].includes(j.status)){
  const unresolved=(j.steps||[]).some(s=>['started','unknown'].includes(s.status)&&(!s.idempotent||EFFECTS.has(s.effect)));
  j.status=unresolved?'needs_reconcile':j.checkpoint?.safeToResume?'paused':'interrupted';
  j.reason=unresolved?'上次操作结果未知，先核对真实状态，不重放':'上次执行中断，保留进度，先重新观察';
  j.resume=!!j.checkpoint?.safeToResume&&!unresolved;j.restartedAt=now();
 }
 reconcileArtifactRejections(state,operationJournal(),now());
 if(reconcileDeliveredLifeShares(state,operationJournal(),deliveryJournal(),now()))try{onReconcile();}catch{}
 reconcileVerifiedLifeOperations(state,operationJournal(),deliveryJournal(),now());
 save();
 const liveRole=meta=>meta?roles().find(r=>scope(r.meta)===scope(meta)):undefined;
 const sceneStamp=(meta,sc)=>hash([meta.accountId||'',meta.personaId,sc?.date,sc?.start,sc?.activity]);
 function current(meta){return sceneFor(liveRole(meta)||{meta});}
 function sleepScene(meta){
  const role=liveRole(meta)||{meta},actual=activityFor(role),planned=sceneFor(role);
  // A planned sleep slot is a real behavioural rest window, even when the
  // previous digital activity has not been marked finished by a model.
  if(actual&&!offlineSlot(actual)&&actual.planned!==true&&activityKind(actual)==='sleep')return actual;
  return planned&&!offlineSlot(planned)&&activityKind(planned)==='sleep'?planned:null;
 }
 const awakeHolds=new Map();
 const observeState=meta=>{try{onStateChange(meta);}catch{/* observation must never prevent waking or task cleanup */}};
 function asleep(meta){if(closed||!cfg().enabled||!cfg().sleep)return false;const scene=sleepScene(meta);if(!scene)return false;const override=state.wake[scope(meta)];return !override||(!(awakeHolds.get(scope(meta))>0)&&!!(override.until&&override.until<=now()));}
 function wake(meta,{minutes=20,reason='本轮明确请求'}={}){observeState(meta);const scene=sleepScene(meta),duration=Math.max(1,Math.min(30,Number(minutes)||20))*60_000;state.wake[scope(meta)]={sceneId:scene?hash([scene.date,scene.start,scene.activity]):'',at:now(),duration,until:now()+duration,reason:text(reason,160)};save();observeState(meta);return {ok:true,awake:true,until:state.wake[scope(meta)].until};}
 function touchAwake(meta){const override=state.wake[scope(meta)];if(!override||asleep(meta))return false;override.duration||=Math.max(60_000,(override.until||0)-override.at)||20*60_000;override.until=now()+override.duration;override.lastInteraction=now();save();return true;}
 function holdAwake(meta){const key=scope(meta);if(asleep(meta)||!state.wake[key])return()=>{};awakeHolds.set(key,(awakeHolds.get(key)||0)+1);let released=false;return()=>{if(released)return;released=true;const count=(awakeHolds.get(key)||1)-1;if(count>0)awakeHolds.set(key,count);else{awakeHolds.delete(key);if(state.wake[key]){state.wake[key].until=now()+(state.wake[key].duration||20*60_000);save();}}};}
 function rest(meta){observeState(meta);delete state.wake[scope(meta)];save();observeState(meta);return {ok:true,sleeping:asleep(meta)};}
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
 function progress(j){try{onProgress(j);}catch{}}
 function record(id,meta,evidence){const j=job(id,meta);if(!ACTIVE.has(j.status))return false;j.evidence=(j.evidence||[]).concat({...evidence,at:now()}).slice(-48);save();progress(j);return true;}
 function checkpoint(id,meta,{summary='',next='',safeToResume=false,expectedResult='',stepId=''}={}){const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');const unresolved=(j.steps||[]).some(s=>['started','unknown'].includes(s.status)&&!s.idempotent);j.checkpoint={summary:text(summary,1200),next:text(next,800),expectedResult:text(expectedResult,600),stepId:text(stepId,100),safeToResume:safeToResume===true&&!unresolved,at:now()};save();progress(j);return {ok:true,checkpoint:j.checkpoint};}
 function beginStep(id,meta,{key,effect='read',target='',idempotent=false,details={}}={}){const j=job(id,meta);if(!['queued','running'].includes(j.status))throw Error('任务未在执行');const fingerprint=hash([effect,target,details]);j.steps||=[];const old=j.steps.find(s=>s.key===key);if(old){if(old.fingerprint!==fingerprint)throw Error('同一步骤的内容已变化，请建立新步骤');if(old.status==='confirmed')return {ok:true,reused:true,step:old};if(['started','unknown'].includes(old.status)&&!old.idempotent)throw Error('前次操作结果未知，必须核对，不能重放');}const step={id:randomUUID(),key:text(key||randomUUID(),160),effect:text(effect,40),tool:text(details.tool,100),target:text(target,600),fingerprint,idempotent:idempotent===true&&!EFFECTS.has(effect),status:'started',at:now()};j.steps.push(step);save();return {ok:true,reused:false,step};}
 function settleStep(id,meta,stepId,{status='unknown',evidence={}}={}){const j=job(id,meta),step=j.steps?.find(s=>s.id===stepId);if(!step)throw Error('步骤不存在');if(!['confirmed','failed','not_applied','unknown'].includes(status))throw Error('无效步骤状态');if(step.status==='confirmed'&&status!=='confirmed')throw Error('已确认的步骤不能改为未知');step.status=status;step.evidence={...evidence};step.checkedAt=now();if(status==='unknown'&&!step.idempotent){j.status='needs_reconcile';j.reason='操作结果未知，先观察平台结果，不重复执行';}save();progress(j);return {ok:true,step};}
 function finish(id,meta,{status='completed',note=''}={}){
  const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');
  if(status==='completed'&&j.status==='waiting_user'&&!j.question?.answer)throw Error('还在等待本人决定，不能自行完成这件事');
  if(status==='completed'&&latestTaskWait(j,now()))throw Error('真实服务任务仍在排队或处理中，先核对原任务结果，不能标记完成');
  if(status==='completed'&&(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)))throw Error('存在结果未知的操作，需要先核对');
  if(status==='completed'&&!j.evidence?.some(e=>e.ok&&e.substantive))throw Error('还没有真实作品或具体内容证据，不能把计划当作已完成');
  j.status=['completed','failed','unsupported','cancelled'].includes(status)?status:'failed';j.note=text(note,350);j.endedAt=now();save();onFinish(j);return {ok:true,status:j.status,evidence:j.evidence||[]};
 }
 async function request(id,meta,{kind,question,details={}}){
  const j=job(id,meta);if(!ACTIVE.has(j.status))throw Error('日程任务已结束');
  if(!['device_borrow','login','payment','comment','publish','choice','permission','delete','security','privacy'].includes(kind))throw Error('请选择需要本人决定的问题类型');
  if(kind==='device_borrow'&&!['desktop','phone'].includes(details.device))throw Error('请指定想借用的前台设备');
  if(kind!=='payment'&&kind!=='device_borrow')return {ok:true,ordinary:true,waiting:false,requiresDecision:false,coverage:'这件事无需申请付款许可，继续执行原操作；尚未执行原操作。评论仍按独立发布开关和手动选择'};
  if(kind==='payment'&&(!details.merchant||!details.amount||!details.currency))throw Error('先核对收款方、金额和币种，再问本人是否付款');
  if(!String(question||'').trim())throw Error('请先写清楚要问的一件事');
  if(j.question&&!j.question.answer)return {ok:true,waiting:true,id:j.question.id};
  const previous=j.status; j.question={id:randomUUID(),kind,question:text(question,240),details,at:now(),...(questionChannel==='panel'?{panelOnly:true}:{})};j.status='waiting_user';save();try{if(questionChannel!=='panel')await notify(j);}catch(error){if(error.code==='BORROW_NOT_QUEUED'&&j.status==='waiting_user'&&!j.question.answer){delete j.question;j.status=previous;save();}throw error;}return {ok:true,waiting:true,id:j.question.id};
 }
 function answer(questionId,meta,value){
  const j=jobs(meta).find(j=>j.question?.id===questionId&&j.status==='waiting_user');if(!j)throw Error('问题已过期或不属于当前角色');
  const disposition=j.question.kind==='device_borrow'?borrowAnswer(value):approvalAnswer(value);if(j.question.kind!=='choice'&&disposition==='unrelated')return {ok:false,unrelated:true,questionId};
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

 function deliveryReceipt(deliveryId,{status,messageId,verification}={}){for(const j of state.jobs){if(j.finalReply?.deliveryIds?.includes(deliveryId)){j.finalReply.receipts||={};j.finalReply.receipts[deliveryId]={status,messageId:messageId||'',verification,at:now()};const values=j.finalReply.deliveryIds.map(id=>j.finalReply.receipts[id]?.status);j.finalReply.status=values.every(s=>s==='sent')?'sent':values.includes('unknown')?'unknown':values.includes('failed')?'failed':'queued';}}for(const j of state.jobs)for(const step of j.steps||[]){const ids=step.evidence?.deliveryIds||[step.evidence?.deliveryId].filter(Boolean);if(!ids.includes(deliveryId))continue;step.evidence.deliveryStates||={};step.evidence.deliveryStates[deliveryId]={status,messageId:messageId||'',verification,at:now()};if(ids.every(id=>step.evidence.deliveryStates[id]?.status==='sent'&&step.evidence.deliveryStates[id]?.verification?.state==='observed')){step.status='confirmed';step.checkedAt=now();step.evidence.verified=true;if(j.status==='needs_reconcile'&&!(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status))){if(j.lastTurnEnded){j.status='paused';j.resumeOnIdle=true;j.closeoutAttempted=true;j.continuation={...j.continuation,closeoutOnly:true};j.reason='延迟QQ回执已核对，下轮收尾或续做，不重复发送';}else{j.status='running';j.reason='QQ回执已确认，可以继续当前任务';}}}}save();}
 function pause(j,reason){j.status='paused';j.reason=reason;j.pausedAt=now();j.resumeOnIdle=true;}
 function resume(id,meta,{observed=false}={}){if(!cfg().execute)throw Error('执行实际任务已关闭，先开启后再继续日程任务');const j=job(id,meta);if(j.status==='waiting_user')throw Error('先等待对应问题的真实回答');if(j.status==='needs_reconcile'&&!observed)throw Error('先观察并核对上次操作结果');if(!['paused','interrupted','needs_reconcile','incomplete'].includes(j.status))throw Error('任务不能在当前状态恢复');if((j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)))throw Error('仍有结果未知的步骤，不能恢复执行');j.status='paused';j.resume=true;j.nextDispatchAt=0;j.resumeRequestedAt=now();j.resumeObserved=observed;j.reason='从保留的进度恢复，先重新观察';save();return {ok:true,id};}
 async function syncState(meta){
  if(closed||!liveRole(meta))return;
  const sleeping=asleep(meta),key=scope(meta);
  if(state.sleep[key]!==sleeping){state.sleep[key]=sleeping;save();observeState(meta);if(sleeping){for(const j of jobs(meta))if(j.group?.open)await closeGroupWindow(meta,j,'日程进入休息，结束群参与');await stop(meta);}}
 }
 async function enforceExecution(){
  if(cfg().enabled&&cfg().execute){let changed=false;for(const j of state.jobs)if(j.status==='paused'&&j.pausedByExecutionSwitch){delete j.pausedByExecutionSwitch;j.resumeOnIdle=true;changed=true;}if(changed)save();return;}
  const stopped=new Map();
  for(const j of state.jobs){
   if(j.group?.open){await closeGroupWindow(j.meta,j,'执行实际任务已关闭');continue;}
   if(!['queued','running','participating'].includes(j.status))continue;
   j.status=(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status))?'needs_reconcile':'paused';j.reason='执行实际任务已关闭，保留进度，不声明完成';j.pausedAt=now();j.resume=false;j.resumeOnIdle=false;j.pausedByExecutionSwitch=true;stopped.set(scope(j.meta),j.meta);
  }
  save();for(const meta of stopped.values())await stop(meta,{scheduledOnly:true,reason:'执行实际任务已关闭'});
 }
 function resumableJobs(meta,explicitOnly=false){
  return jobs(meta).filter(j=>j.kind!=='sleep'&&j.status==='paused'
   &&(explicitOnly?j.resume&&(j.resumeRequestedAt||j.resumeAfterAnswer):j.resume||j.resumeOnIdle)
   &&!(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)))
   .sort((a,b)=>(b.resumeRequestedAt||b.question?.answeredAt||b.pausedAt||0)-(a.resumeRequestedAt||a.question?.answeredAt||a.pausedAt||0));
 }
 async function tick(){
  if(closed||busy)return;await enforceExecution();if(!cfg().enabled)return;busy=true;
  try{
   if(reconcileVerifiedLifeOperations(state,operationJournal(),deliveryJournal(),now()))save();
   // A closed gate or a switched account must not leave a stale participation window.
   for(const j of state.jobs)if(j.meta&&j.group?.open&&!allowed(j.meta))await closeGroupWindow(j.meta,j,'当前不允许执行日程，结束群参与');
   for(const role of roles()){
   if(!role?.meta)continue;
   try{
   if(closed||!allowed(role.meta))continue;const sc=current(role.meta);if(!sc)continue;
   // Offline/refresh placeholders describe availability, never an executable task.
   // Check before hashing the scene: their displayed clock changes every minute.
   if(offlineSlot(sc)||sc.scheduleNeedsRefresh===true){
    for(const old of jobs(role.meta))if(old.group?.open)await closeGroupWindow(old.meta,old,'设备离线或等待更新日程，结束群参与');
    continue;
   }
   const sleeping=asleep(role.meta),key=scope(role.meta);if(state.sleep[key]!==sleeping){state.sleep[key]=sleeping;save();observeState(role.meta);if(sleeping)await stop(role.meta);}
   // A failed execution must not start again under a minute-shifted self-plan.
   const blockedSlot=jobs(role.meta).find(j=>['needs_reconcile','failed'].includes(j.status)&&j.scene?.date===sc.date&&j.scene?.end>calendarNow(now()).clock&&(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status)));
   if(blockedSlot&&!sc.requested)continue;
   const kind=activityKind(sc);
   const quietSlot=!sc.requested&&kind!=='sleep'&&(sc.planOnly===true||kind==='rest');
   let explicitResume;
   if(quietSlot){
    for(const old of jobs(role.meta))if(old.group?.open)await closeGroupWindow(old.meta,old,'进入日常计划时段，结束群参与');
    explicitResume=resumableJobs(role.meta,true)[0];
    if(!explicitResume)continue;
   }
   const stampedId=sceneStamp(role.meta,sc);
   if(state.recoveredAt&&kind!=='sleep'&&!sc.requested&&!explicitResume){
    const recovery=calendarNow(state.recoveredAt);
    if(sc.date===recovery.day&&sc.start<=recovery.clock&&sc.end>recovery.clock)continue;
   }
   let scheduled=explicitResume||state.jobs.find(j=>j.id===stampedId);
   // A renamed overlapping plan with the same concrete goal is a revision
   // of the same activity, so it keeps the existing execution and receipts.
   if(!scheduled&&!sc.requested&&kind!=='group'&&kind!=='sleep'){
    scheduled=jobs(role.meta).findLast(j=>{
     const previous=j.scene;
     if(j.status==='cancelled'||previous?.requested||j.kind!==kind||previous?.date!==sc.date||previous.goal!==sc.goal)return false;
     const sameActivity=previous.activity===sc.activity;
     const overlap=sc.start<previous.end&&sc.end>previous.start;
     return overlap&&(sameActivity||Boolean(String(sc.goal??'').trim()))
       ||sameActivity&&previous.end===sc.start&&!!previous.phase&&!!sc.phase&&previous.phase!==sc.phase;
    });
    if(scheduled){scheduled.scene={...sc,start:scheduled.scene.start<sc.start?scheduled.scene.start:sc.start};save();}
   }
   const id=scheduled?.id||stampedId;
   if(!scheduled){scheduled={id,meta:{...role.meta},scene:{...sc},kind,status:sc.requested?'user_request':sleeping?'sleeping':'planned',at:now(),evidence:[]};state.jobs.push(scheduled);save();}
   if(kind==='sleep'&&!sleeping&&state.wake[key]){scheduled.status='paused';scheduled.resume=false;scheduled.resumeOnIdle=false;scheduled.reason='已被叫醒，原睡眠安排暂缓，保持当前交流';save();continue;}
   // Sleep is a state transition, not a task requiring paid inference, even
   // when the sleep blocking switch is off or a wake override has expired.
   if(kind==='sleep'){scheduled.status=sleeping?'sleeping':'paused';scheduled.resume=false;scheduled.resumeOnIdle=false;scheduled.reason=sleeping?'当前日程休息，不启动工具执行':'睡眠安排只记录状态，不启动执行回合';save();continue;}
   if(scheduled.status==='budget'&&cfg().maxTasksPerDay===0){scheduled.status='planned';scheduled.reason='已取消日常任务次数上限，重新自行判断';save();}
   for(const old of jobs(role.meta))if(old.id!==id&&old.status==='planned'){old.status='cancelled';old.reason='旧计划未开始，已过原定时段';}save();
   // Her group participation belongs to one slot: close it as soon as that slot ends.
   for(const old of jobs(role.meta))if(old.id!==id&&old.group?.open)await closeGroupWindow(old.meta,old,'时段结束，结束群参与');
   if(!quietSlot&&String(sc.taskKind||'')==='group'){
    const actual=activityFor(role);
    const sameGroupConversation=actual?.conversation===true&&groupIds(sc).some(id=>actual.key==='group:'+id);
    const elsewhere=!sameGroupConversation&&!!actual&&actual.actual===true&&activityKind(actual)!=='group'&&actual.activity!==sc.activity;
    await syncGroupWindow(role,scheduled,sc,sleeping,elsewhere);continue;
   }
   // An elapsed plan boundary never interrupts an activity she chose to begin.
   if(jobs(role.meta).some(j=>['queued','running'].includes(j.status)))continue;
   // Pending questions survive time-slot changes, midnight, restart and another
   // user request. They are never implicitly treated as approvals or expired.
   save();if(sc.requested||sleeping||!cfg().execute||jobs(role.meta).some(j=>['running','queued'].includes(j.status)))continue;
   const j=explicitResume||resumableJobs(role.meta)[0]||scheduled;if(!['planned','paused'].includes(j.status)||j.status==='paused'&&!j.resume&&!j.resumeOnIdle)continue;
   const pending=latestTaskWait(j,now());
   if(pending?.expired){j.status='needs_reconcile';j.resumeOnIdle=false;j.reason='服务状态已过期，保留原任务号，先核对原任务，不重新提交';save();continue;}
   if(j.kind==='unsupported'){j.status='unsupported';j.reason='忽略无法实际完成的实体活动，不伪造经历';save();continue;}
   const day=calendarNow(now()).day,started=jobs(role.meta).filter(x=>x.startedAt&&x.kind!=='group'&&calendarNow(x.startedAt).day===day).length;
   if(!j.resume&&!j.resumeOnIdle&&cfg().maxTasksPerDay>0&&started>=cfg().maxTasksPerDay){j.status='budget';j.reason='今天的实际日程任务额度已用完';save();continue;}
   const gap=cfg().minGapMinutes*60_000;
   if(gap&&!j.startedAt&&!j.resume&&!j.resumeOnIdle){
    const previous=jobs(role.meta).reduce((latest,task)=>task.id!==j.id&&task.kind!=='group'&&task.startedAt&&!task.scene?.requested
     ?Math.max(latest,Number(task.endedAt||task.lastTurnEnded?.at||task.lastDispatchAt||task.startedAt)):latest,0);
    if(previous&&now()-previous<gap){
     const reason='距上一项日程结束未满 '+cfg().minGapMinutes+' 分钟，稍后再开始';
     if(j.reason!==reason){j.reason=reason;save();}
     continue;
    }
    if(j.reason?.startsWith('距上一项日程结束未满 '))delete j.reason;
   }
   if(conversationBusy(role.meta)||j.nextDispatchAt>now())continue;
   const stamp=sceneStamp(role.meta,sc);j.status='queued';j.dispatchSignature=taskProgressSignature(j);delete j.lastTurnEnded;save();
   try{const sessionId=await dispatch(role,j);if(!sessionId){if(j.status==='queued')j.status=j.resume||j.resumeOnIdle?'paused':'planned';save();continue;}if(!cfg().execute||!allowed(role.meta)){await stop(role.meta,{scheduledOnly:true,reason:'日程执行已关闭'});if(['queued','running'].includes(j.status))pause(j,'执行期间安排变化，保留进度');save();continue;}if(j.status==='queued')j.status='running';j.boundSceneId=stamp;j.sessionId=sessionId;j.startedAt||=now();j.lastDispatchAt=now();j.dispatchCount=(j.dispatchCount||0)+1;j.resume=false;j.resumeOnIdle=false;delete j.resumeRequestedAt;delete j.resumeAfterAnswer;save();}
   catch(e){j.status='failed';j.reason=text(e.message,220);j.endedAt=now();save();onFinish(j);}
  }catch(error){/* one broken role must not block the others */}
  }
  }finally{busy=false;}
 }
 function interruptForRequest(meta,{activeOnly=false}={}){for(const j of jobs(meta))if((activeOnly?['queued','running']:['queued','running','planned']).includes(j.status))pause(j,'用户当前请求优先，暂停默认日程');save();}
 function ended(id,meta,reason,error,{body}={}){
  const j=state.jobs.find(j=>j.id===id&&scope(j.meta)===scope(meta));
  if(j?.status==='needs_reconcile'){j.lastTurnEnded={reason,at:now()};save();return;}
  if(!j||!['running','queued'].includes(j.status))return;
  j.lastTurnEnded={reason,at:now(),silent:/^\s*\[skip\]\s*$/i.test(body||'')};
  if(j.finalReply?.status==='awaiting_decision')j.finalReply.status='not_sent';
  const unknown=(j.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status));
  j.status=unknown?'needs_reconcile':reason==='completed'?'incomplete':'paused';
  j.reason=unknown?'存在结果未知的步骤，先核对，不重放':reason==='completed'?'本轮没有确认真实结果，未标记完成':'执行已暂停，保留进度';
  j.resume=false;j.pausedAt=now();j.resumeOnIdle=!unknown&&reason!=='completed'&&!!j.checkpoint?.safeToResume;
  if(error?.code==='LOCAL_TASK_YIELD'&&!unknown){
   const facts=text(JSON.stringify(error.continuation?.completed||[]),1000);
   j.checkpoint={...j.checkpoint,summary:text((j.checkpoint?.summary||'工具预算分段结束，已确认步骤保留在原任务中')+'\n本轮实际回执：'+facts,1200),next:j.checkpoint?.next||'重新观察当前状态，接着执行尚未执行的工具：'+(error.continuation?.pendingTools||[]).join('、'),safeToResume:true,at:now()};
  }
  const pending=latestTaskWait(j,now());
  if(pending&&!unknown&&cfg().execute){
   j.waitingService=pending;j.status=pending.expired?'needs_reconcile':'paused';j.resumeOnIdle=!pending.expired;
   j.checkpoint={...j.checkpoint,summary:j.checkpoint?.summary||'服务已接收任务，尚未完成',next:'只查询并核对原任务 '+pending.taskId+' 的状态和结果；不重新提交生成、下载或发布',safeToResume:!pending.expired,at:now()};
   j.nextDispatchAt=Math.max(now()+60000,pending.observedAt+60000);
   j.reason=pending.expired?'服务状态需要核对，未判为失败':'真实服务任务仍在处理，不累计空转次数';save();return;
  }
  delete j.waitingService;
  if(['completed','yielded'].includes(reason)&&!unknown&&cfg().execute){
   // A finished model turn is not a finished activity. Continue saved work;
   // a turn that forgot its checkpoint gets one closeout, not a replay.
   const signature=taskProgressSignature(j);
   const prior=j.continuation||{},progress=signature!==prior.signature;
   const stalls=progress?0:(Number(prior.stalls)||0)+1;
   const next=!!(j.checkpoint?.safeToResume&&text(j.checkpoint.next,800));
   const observed=(j.steps||[]).some(s=>s.status==='confirmed')||(j.evidence||[]).some(e=>e.ok&&e.substantive);
   const closeout=!next&&observed&&!j.closeoutAttempted;
   j.continuation={signature,stalls,closeoutOnly:closeout,at:now()};
   j.nextDispatchAt=progress?now():now()+Math.min(300000,60000*2**Math.max(0,stalls-1));
   if((next&&stalls<3)||closeout){
    j.status='paused';j.resumeOnIdle=true;
    j.reason=closeout?'本轮有实际操作但未收尾，下轮核对目标、保存进度或明确结束':'已有安全进度，下轮继续未完成的具体步骤';
    if(closeout)j.closeoutAttempted=true;
   }else if(next&&stalls>=3)j.reason='连续续做没有新增可核对进度，保留检查点，停止空转';
   if(j.lastTurnEnded.silent&&signature===j.dispatchSignature){j.resumeOnIdle=false;j.reason='本轮选择保持安静且没有新进展，保留进度，不定时唤起模型空转；可由新请求或明确恢复继续';}
  }
  if(reason==='failed'){
   j.lastError=text(error?.message||'执行没有取得有效结果',500);
   if(error?.code==='LOCAL_ACTION_MISSING'){
    j.missingActionFailures=(Number(j.missingActionFailures)||0)+1;
    // A model that never selects an actual tool cannot reach the tool breaker.
    // Bound those empty rounds too, while keeping them distinct from tool failures.
    j.resumeOnIdle=!unknown&&j.missingActionFailures<=3;
    if(j.missingActionFailures>3){j.status=unknown?'needs_reconcile':'failed';j.resumeOnIdle=false;j.reason='本时段已连续4次没有实际工具调用，停止自动重试；下一日程需要时再尝试';j.endedAt=now();}
    else if(!unknown)j.reason='本轮没有实际工具调用，等待空闲纠正；累计 '+j.missingActionFailures+' 次';
   }
  }
  save();
 }
 /* 把放久的已结束任务归档：文件别越攒越大，界面上也不再挂着几百条旧进度。 */
 function compact({keepDays=3,keepMax=200}={}){
  const closedStatus=new Set(['completed','failed','cancelled','interrupted','incomplete','unsupported','ended','sleeping']);
  const before=state.jobs.length;
  state.jobs=state.jobs.filter(j=>!(closedStatus.has(j.status)&&now()-Number(j.startedAt||j.endedAt||j.at||0)>keepDays*86400000));
  if(state.jobs.length>keepMax){
   const open=state.jobs.filter(j=>!closedStatus.has(j.status));
   const closed=state.jobs.filter(j=>closedStatus.has(j.status)).sort((a,b)=>Number(b.startedAt||b.at||0)-Number(a.startedAt||a.at||0)).slice(0,Math.max(20,keepMax-open.length));
   state.jobs=[...open,...closed];
  }
  const removed=before-state.jobs.length;
  if(removed)save();
  return {removed,left:state.jobs.length};
 }
 function snapshot(meta){return {config:cfg(),sleeping:asleep(meta),wake:state.wake[scope(meta)]?{...state.wake[scope(meta)],held:(awakeHolds.get(scope(meta))||0)>0}:null,scene:asleep(meta)?sleepScene(meta):activityFor(liveRole(meta)||{meta}),plan:current(meta),frequency:{checkEveryMs:60000,emptyRetryBackoffMs:[60000,120000,240000],servicePollMinMs:60000},jobs:jobs(meta).slice(-25).reverse().map(j=>({...j,...taskCompletion(j),details:scheduleJobDetails({...j,...taskCompletion(j)})})),pending:question(meta),waiting:jobs(meta).filter(j=>j.status==='waiting_user'),recoverable:jobs(meta).filter(j=>['paused','needs_reconcile','interrupted','incomplete'].includes(j.status)).map(j=>({id:j.id,status:j.status,activity:j.scene?.activity,checkpoint:j.checkpoint,reason:j.reason}))};}
 return {compact,evidenceJobs:meta=>jobs(meta).map(j=>({...j,...taskCompletion(j)})),tick,enforceExecution,syncState,reserveFinalReply,asleep,wake,touchAwake,holdAwake,rest,interruptForRequest,record,checkpoint,beginStep,settleStep,resume,finish,request,answer,question,snapshot,job,ended,markShare,deliveryReceipt,close:async()=>{closed=true;for(const j of state.jobs.filter(x=>x.group?.open))if(groupWindow)try{await groupWindow(j.meta,{open:false,scene:j.scene,groupIds:j.group.ids||[],reason:'日程执行已关闭'});}catch{}},reload(){try{state=storage.read();state.wake||={};state.sleep||={};retireOrdinaryQuestions();reconcileArtifactRejections(state,operationJournal(),now());if(reconcileDeliveredLifeShares(state,operationJournal(),deliveryJournal(),now()))try{onReconcile();}catch{}reconcileVerifiedLifeOperations(state,operationJournal(),deliveryJournal(),now());save();}catch{}}};
}


