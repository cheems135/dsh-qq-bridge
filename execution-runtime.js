import {createHash,randomUUID} from 'node:crypto';
import {describeOperation} from './operation-policy.js';
import {nativeDesktopDelegation} from './native-desktop.js';
import {serviceTaskEvidence} from './task-progress.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const OBSERVE=new Set(['observe','windows','snapshot','screenshot','scroll','wait','tabs','switch','back','focus','navigate','launch','capabilities','status','get','list','read','recent','targets','schema']);
const ADMIN=new Set(['bridge_capabilities','bridge_operation_request','bridge_life_request','bridge_life_checkpoint','bridge_task','bridge_life_finish','bridge_life_adjust','bridge_qq_read','bridge_qq_api','bridge_context','bridge_screen_share','bridge_workspace','bridge_recharge','bridge_game','bridge_storage','bridge_drawing']);
export function isReconciliationObservation(exec={}){
 return ['ops_read_files','ops_glob','ops_grep'].includes(exec.name);
}
export function executableOperation(name,args={}){
 if(name==='bridge_native')return {...args.arguments,toolName:args.name,decisionId:args.decisionId||args.arguments?.decisionId};
 return {...args,toolName:name};
}
export function operationEffect(args={},trusted={}){
 if(isReconciliationObservation({name:args.toolName}))return 'read';
 if(args.toolName==='bridge_life_artifact')return args.action==='import'?'local':'read';
 const d=describeOperation(args,trusted);if(d.effect||d.kind)return d.effect||d.kind;
 // Watching is a composite observation: navigate -> actual media play ->
 // screenshots. Classify it consistently with its controller observations so
 // the same host execution is not mistaken for a changed write target.
 if(args.toolName==='bridge_watch'&&['','start','next','status','pause','resume','seek','stop'].includes(String(args.action||'')))return 'read';
 if(args.toolName==='bridge_browser'&&trusted.mediaControl===true&&['play','pause','seek'].includes(args.action))return 'read';
 if(args.toolName==='bridge_life_qq'&&args.action==='send'||args.toolName==='bridge_life_share'&&args.action==='send')return 'send';
 if(d.unknownCommand)return 'command';
 return OBSERVE.has(args.action)||/^(?:get|read|list|search|find|fetch|inspect|observe|screenshot)(?:[_./-]|$)/.test(args.toolName||'')?'read':args.action==='type'||args.action==='fill'?'input':args.action==='click'||args.action==='press'?'gesture':'local';
}
/** Keeps real host executions/parents as identities. No model-supplied token,
 * tool description or callId is treated as authority. */
export function createExecutionRuntime({policy,metaFor,trustedFor=()=>({}),journal=()=>{},getLife=()=>null,getDelivery=()=>null,now=()=>Date.now()}={}){
 const entries=new WeakMap(),observations=new Map(),screens=new Map();
 function trusted(args,context,extra={}){return {...trustedFor(args,context,observations.get(context.sessionId)),...extra};}
 function entry(exec,context,args,extra={}){
  const actual=args||executableOperation(exec.name,exec.arguments||{}),t=trusted(actual,context,extra),d=describeOperation(actual,t),old=entries.get(exec);
  if(old&&old.fingerprint===d.fingerprint)return old;
  if(old?.started){
    /* 只读动作（搜索、读页面、读视频画面）不会造成副作用，同一次调用里参数被
       补全（比如补上 toolName、动作）时按同一次执行继续，不再报目标已变化。
       写操作、点击、发送仍然要求目标完全一致。 */
    if(old.effect==='read'&&operationEffect(actual,t)==='read'){old.fingerprint=d.fingerprint;old.args=actual;old.trusted=t;return old;}
    throw Error('一次执行的实际目标已变化，不能复用执行许可');
  }
  const parent=exec.parent&&entries.get(exec.parent),sameParent=parent?.fingerprint===d.fingerprint;
  const receipt=sameParent?parent.receipt:policy.check(metaFor(context),actual,t,{allowMatchingGrant:true});
  const item={id:randomUUID(),exec,context,args:actual,trusted:t,fingerprint:d.fingerprint,receipt,effect:operationEffect(actual,t),started:false,at:now(),parent:sameParent?parent:null};entries.set(exec,item);return item;
 }
 function preview(exec,context){
  try{
   const delegated=nativeDesktopDelegation(exec);if(delegated){const p=entries.get(delegated.parent);if(OBSERVE.has(delegated.input.action)||p?.started){entries.set(exec,{delegate:true,parent:p,context,args:delegated.input});return; }return '桌面动作没有经过实际执行前的目标检查';}
   if(ADMIN.has(exec.name)||exec.name==='bridge_native'&&exec.arguments?.action==='schema')return;
   // These controllers validate and normalize their real target, then call
   // begin() immediately before a side effect.
   if(['bridge_browser','bridge_device','bridge_life_qq','bridge_life_share'].includes(exec.name))return;
   entry(exec,context);
  }catch(e){return String(e.message||e);}
 }
 function emit(item,status,extra={}){journal({id:item.id,at:item.at,updatedAt:now(),accountId:item.context.accountId,personaId:item.context.personaId,chat:item.context.key,tool:item.args.toolName||item.exec.name,action:item.args.action||'',effect:item.effect,target:describeOperation(item.args,item.trusted).operation.target,contentHash:hash({text:item.args.text||'',command:item.args.command||item.args.code||item.args.script||''}),status,verified:false,...extra});}
 function begin(exec,context,args,extra={}){
  const item=entry(exec,context,args,extra);if(item.delegate)return item;if(item.started)return item;
  if(item.parent?.started){item.started=true;item.inherited=true;return item;}
  policy.consume(item.receipt);item.started=true;emit(item,'started');
  const life=getLife(),jobId=context.meta?.lifeJobId;if(life&&jobId){const read=item.effect==='read';try{const begun=life.beginStep(jobId,{accountId:context.accountId,personaId:context.personaId},{key:item.id,effect:item.effect,target:describeOperation(item.args,item.trusted).operation.target,details:{fingerprint:item.fingerprint,tool:item.args.toolName||item.exec.name},idempotent:read});item.stepId=begun.step.id;}catch(e){if(!read)throw e;}}
  return item;
 }
 function beginHost(exec,context){
  const delegated=nativeDesktopDelegation(exec);if(delegated){const denial=preview(exec,context);if(denial)throw Error(denial);return entries.get(exec);}
  if(ADMIN.has(exec.name)||/^bridge_/.test(exec.name))return;
  return begin(exec,context);
 }
 function observe(exec,context,result){
  const value=result?.value??result;if(value&&typeof value==='object'){const row={...value,observedAt:now(),toolName:exec.name};observations.set(context.sessionId,row);if(value.ui||value.data?.nodes)screens.set(context.sessionId,row);}
 }
 function finish(exec,context,result,{error}={}){
  observe(exec,context,result);const item=entries.get(exec);if(!item||item.delegate||!item.started||item.finished||item.inherited)return;
  item.finished=true;const value=result?.value??result,failed=!!error||result?.isError===true||value?.ok===false;
  const loginGesture=item.args.toolName==='bridge_browser'&&item.trusted.loginPage===true&&['credential','submit'].includes(item.trusted.loginControl)&&!item.trusted.oauthConsent&&['login','privacy'].includes(item.effect);
  // The host already returned an authoritative foreground process receipt.
  // Exit zero confirms that execution finished, not an external delivery/payment.
  const processCompleted=exec.name==='ops_bash'&&result?.value===value&&value?.status==='completed'&&value?.kind==='foreground'&&value?.exitCode===0&&!value?.timedOut&&!value?.aborted&&!value?.signal;
  const processConfirmed=processCompleted&&['delete','command'].includes(item.effect);
  const unsafe=!loginGesture&&!['read','local','input','gesture'].includes(item.effect),queued=value?.queued===true,verified=processConfirmed||value?.verified===true||(item.effect!=='send'&&!value?.deliveryId&&!value?.deliveryIds?.length&&(value?.status==='sent'||!!value?.messageId||!!value?.message_id));
  const audioInputRejected=item.args.toolName==='bridge_audio'&&failed&&/^请提供网易云歌曲链接、分享卡片或真实音频地址/.test(String(error||''))&&!value?.taskId&&!value?.deliveryId&&!value?.deliveryIds?.length;
  const notApplied=audioInputRejected||(item.effect==='send'||item.args.toolName==='bridge_life_artifact')&&failed&&value?.status!=='unknown'&&value?.queued===false&&value?.submitted===false&&!value?.deliveryId&&!value?.deliveryIds?.length;
  const status=notApplied?'not_applied':failed?(item.effect==='read'?'failed':'unknown'):queued?'unknown':unsafe&&!verified?'accepted':'confirmed';
  emit(item,status,{verified:!failed&&(verified||!unsafe),deliveryIds:value?.deliveryIds||[value?.deliveryId].filter(Boolean),error:String(error||value?.error||'').slice(0,200),coverage:queued?'已排队，尚未取得平台确认':String(value?.coverage||'').slice(0,350)});
  if(item.stepId){const life=getLife();try{const deliveryIds=value?.deliveryIds||[value?.deliveryId].filter(Boolean);life?.settleStep(context.meta.lifeJobId,{accountId:context.accountId,personaId:context.personaId},item.stepId,{status:status==='accepted'?'unknown':status,evidence:{serviceTask:serviceTaskEvidence(value,exec.name,now()),operationId:item.id,error:String(error||value?.error||'').slice(0,300),coverage:String(value?.coverage||'').slice(0,350),verified:!failed&&(verified||!unsafe),deliveryId:value?.deliveryId||'',deliveryIds}});for(const id of deliveryIds){const delivery=getDelivery(id);if(delivery)life?.deliveryReceipt(id,delivery);}}catch{}}
 }
 function requested(context,name,args,question,extra={}){const actual=executableOperation(name,args),t=trusted(actual,context,extra);return policy.propose(metaFor(context),actual,t,question);}
 return {preview,begin,beginHost,finish,observe,requested,trusted,entryFor:exec=>entries.get(exec),observationFor:id=>observations.get(id),screenFor:id=>screens.get(id)};
}

