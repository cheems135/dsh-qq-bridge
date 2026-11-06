import {createHash,randomUUID} from 'node:crypto';
import {describeOperation} from './operation-policy.js';
import {nativeDesktopDelegation} from './native-desktop.js';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const OBSERVE=new Set(['observe','windows','snapshot','screenshot','scroll','wait','tabs','switch','back','focus','navigate','launch','capabilities','status','get','list','read','recent','targets','schema']);
const ADMIN=new Set(['bridge_capabilities','bridge_operation_request','bridge_life_request','bridge_life_checkpoint','bridge_task','bridge_life_finish','bridge_life_adjust','bridge_qq_read','bridge_qq_api','bridge_screen_share','bridge_workspace','bridge_recharge','bridge_game','bridge_storage','bridge_drawing']);
export function executableOperation(name,args={}){
 if(name==='bridge_native')return {...args.arguments,toolName:args.name,decisionId:args.decisionId||args.arguments?.decisionId};
 return {...args,toolName:name};
}
export function operationEffect(args={},trusted={}){
 const d=describeOperation(args,trusted);if(d.effect||d.kind)return d.effect||d.kind;
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
  if(old?.started)throw Error('一次执行的实际目标已变化，不能复用执行许可');
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
  const life=getLife(),jobId=context.meta?.lifeJobId;if(life&&jobId){const read=item.effect==='read';try{const begun=life.beginStep(jobId,{accountId:context.accountId,personaId:context.personaId},{key:item.id,effect:item.effect,target:describeOperation(item.args,item.trusted).operation.target,details:{fingerprint:item.fingerprint},idempotent:read});item.stepId=begun.step.id;}catch(e){if(!read)throw e;}}
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
  const unsafe=!loginGesture&&!['read','local','input','gesture'].includes(item.effect),queued=value?.queued===true,verified=value?.verified===true||(item.effect!=='send'&&!value?.deliveryId&&!value?.deliveryIds?.length&&(value?.status==='sent'||!!value?.messageId||!!value?.message_id));
  const status=failed?'unknown':queued?'unknown':unsafe&&!verified?'accepted':'confirmed';
  emit(item,status,{verified:!failed&&(verified||!unsafe),deliveryIds:value?.deliveryIds||[value?.deliveryId].filter(Boolean),error:error?String(error).slice(0,200):'',coverage:queued?'已排队，尚未取得平台确认':String(value?.coverage||'').slice(0,350)});
  if(item.stepId){const life=getLife();try{const deliveryIds=value?.deliveryIds||[value?.deliveryId].filter(Boolean);life?.settleStep(context.meta.lifeJobId,{accountId:context.accountId,personaId:context.personaId},item.stepId,{status:failed||queued||unsafe&&!verified?'unknown':'confirmed',evidence:{operationId:item.id,verified:!failed&&(verified||!unsafe),deliveryId:value?.deliveryId||'',deliveryIds}});for(const id of deliveryIds){const delivery=getDelivery(id);if(delivery)life?.deliveryReceipt(id,delivery);}}catch{}}
 }
 function requested(context,name,args,question,extra={}){const actual=executableOperation(name,args),t=trusted(actual,context,extra);return policy.propose(metaFor(context),actual,t,question);}
 return {preview,begin,beginHost,finish,observe,requested,trusted,entryFor:exec=>entries.get(exec),observationFor:id=>observations.get(id),screenFor:id=>screens.get(id)};
}
