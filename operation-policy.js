import {createHash,randomUUID} from 'node:crypto';
import {operationRisk} from './life-permissions.js';

const copy=x=>JSON.parse(JSON.stringify(x));
const stable=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(stable):Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,stable(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const clean=x=>String(x??'').trim();
const scope=x=>[clean(x.accountId),clean(x.personaId),clean(x.ownerId)].join('\0');
const isPaymentDecision=x=>x?.kind==='payment'||x?.effect==='payment'||x?.operation?.effect==='payment';
const APPROVE=/^(?:同意|允许|确认|可以|好|yes|approve|同意这次|允许这次)[。.!！\s]*$/i;
const DENY=/^(?:不同意|不允许|不要|不用|不行|算了|取消|拒绝|no|deny)[。.!！\s]*$/i;

function objectValues(value,out=[],seen=new Set()){
 if(!value||typeof value!=='object'||seen.has(value))return out;
 seen.add(value);out.push(value);
 for(const item of Object.values(value))if(item&&typeof item==='object')objectValues(item,out,seen);
 return out;
}
function firstField(values,keys){for(const value of values)for(const key of keys){const item=clean(value?.[key]);if(item)return item;}return '';}

// Only controller/host code may construct `trusted`. Model-supplied intent is a
// hint, never a claim that a command or an on-screen target is safe.
export function describeOperation(args={},trusted={}){
 const values=objectValues(args);
 const action=clean(args.action||firstField(values.slice(1),['action'])||trusted.action),tool=clean(trusted.toolName||args.toolName||args.name),url=clean(trusted.url||firstField(values,['url']));
 const explicitTarget=clean(!['phone','computer'].includes(args.target)?args.target:'');
 const target=clean(trusted.target||explicitTarget||firstField(values,['path','file','filename','file_path','filePath','directory','recipient','to','target'])||url);
 const operation={tool,action,target,url,
  text:clean(trusted.contentText??firstField(values,['text','value'])),command:clean(firstField(values,['command','cmd','code','script','patch'])),
  merchant:clean(trusted.merchant||firstField(values,['merchant'])),amount:clean(trusted.amount??firstField(values,['amount'])),currency:clean(trusted.currency||firstField(values,['currency'])),
  // Ref/window/coordinates bind the confirmed gesture to the observed target.
  ref:clean(args.ref),windowId:clean(args.windowId||trusted.windowId),x:args.x??null,y:args.y??null,key:clean(args.key),
  observationId:clean(trusted.observationId),label:clean(trusted.label),
  // Bind every actual provider/tool parameter, including nested payloads. A
  // model cannot keep a display summary unchanged while changing the real body.
  parameters:Object.fromEntries(Object.entries(args).filter(([key])=>!['decisionId','toolName'].includes(key)))};
 if(trusted.password===true||trusted.containsCredentials===true){operation.privateInputDigest=digest({text:operation.text,command:operation.command,parameters:operation.parameters});operation.text='';operation.command='';operation.parameters={privateInputDigest:operation.privateInputDigest};}
 const effect=operationRisk({...args,action,toolName:tool,url,command:operation.command},trusted);
 const kind=effect==='payment'?'payment':'';
 const isCommand=!!operation.command||/(?:^|[_:./-])(?:pwsh|powershell|exec|shell|bash|terminal|run_code|python|node|execute_code|apply_patch)(?:$|[_:./-])/i.test(tool);
 const safeReadCommand=isCommand&&/^(?:Get-Date|Get-Location|Get-Process|Get-ChildItem(?:\s+-LiteralPath\s+(?:'[^']*'|"[^"]*"))?)(?:\s+-[A-Za-z]+(?:\s+\d+)?)?\s*$/i.test(operation.command)&&!kind;
 return {operation,effect,kind,unknownCommand:false,safeReadCommand,fingerprint:digest(operation),requiresDecision:kind==='payment'};
}

const CONSENT=/(?:拿|用|放|开|搞|做|决定|看着办|随你|去吧|行|可以|好)/;
/** 只有 permission 这类低风险动作（切桌面、原始点击）接受口语同意；
 *  支付、隐私、删除、发布、登录仍只认明确的“同意/允许”。 */
export function permissionConsent(value){
 const s=clean(value);if(!s||s.length>60)return false;
 if(DENY.test(s)||/[？?]|但是|不过|除非|如果|先别|不要|不能|不允许|不同意|不批准|拒绝/.test(s))return false;
 return CONSENT.test(s);
}

export function approvalAnswer(value){
 const s=clean(value);
 if(DENY.test(s)||/^(?:先)?(?:别付(?:款)?|别买|不付(?:款)?|不买了|先不买|取消这笔)[。.!！\s]*$/.test(s)||/^(?:我)?(?:明确)?(?:不同意|不允许|不批准|拒绝)[^？?]{0,60}$/.test(s))return 'deny';
 if(APPROVE.test(s)||/^(?:行|付(?:款)?吧|支付吧|买吧|下单吧|这笔可以付)[。.!！\s]*$/.test(s))return 'approve';
 if(s.length>100||/[？?]|但是|不过|除非|如果|先别|不要|不能|不允许|不同意|不批准/.test(s))return 'unrelated';
 return /^(?:我)?(?:明确)?(?:同意|允许|批准|授权|确认|可以)/.test(s)&&/付款|支付|购买|下单|买(?:吧|这个|这件|这笔)|付这笔/.test(s)?'approve':'unrelated';
}

/** A shared, persisted permission ledger. It neither executes nor statically
 * certifies arbitrary shell programs. Those must retain a real host guard. */
export function createOperationPolicy({storage,now=()=>Date.now(),ttlMs=10*60_000,onEvent=()=>{}}={}){
 let state;try{state=storage?.read();}catch(e){if(e.code!=='ENOENT')throw e;}
 state=state&&Array.isArray(state.decisions)?state:{version:1,decisions:[],events:[]};state.events||=[];state.grants=Array.isArray(state.grants)?state.grants:[];
 const cancelledAt=now();let migrated=false;
 state.decisions=state.decisions.map(item=>{
  if(['pending','approved'].includes(item.status)&&!isPaymentDecision(item)){migrated=true;return {...item,status:'cancelled',cancelledAt,reason:'非付款操作不再需要插件许可'};}
  return item;
 });
 if(Array.isArray(state.loginWorkflows))for(const item of state.loginWorkflows)if(item.status==='active'){item.status='cancelled';migrated=true;}
 if(state.grants.length){state.grants=[];migrated=true;}
 if(migrated)storage?.write(state);
 const save=()=>storage?.write(state);
 const event=(type,item,extra={})=>{const e={id:randomUUID(),type,at:now(),decisionId:item?.id||'',scope:item?.scope||'',...extra};state.events=state.events.concat(e).slice(-400);onEvent(e);save();};
 function propose(meta,args,trusted={},question=''){
  const d=describeOperation(args,trusted);
  if(d.effect!=='payment')return {ok:true,ordinary:true,requiresDecision:false,operation:d.operation};
  if(!clean(meta?.ownerId)||!clean(meta?.personaId))throw Error('缺少真实号主或角色，不能申请操作许可');
  if(d.kind==='payment'&&(!d.operation.merchant||!d.operation.amount||!d.operation.currency))throw Error('请先核对商家、金额和币种');
  if(!d.operation.target&&!d.operation.command)throw Error('请先明确准确付款目标');
  const existing=state.decisions.find(x=>x.scope===scope(meta)&&x.fingerprint===d.fingerprint&&x.status==='pending'&&x.expiresAt>now());if(existing)return copy(existing);
  const item={id:randomUUID(),scope:scope(meta),kind:'payment',effect:'payment',fingerprint:d.fingerprint,operation:d.operation,question:clean(question).slice(0,600),status:'pending',createdAt:now(),expiresAt:now()+ttlMs};
  state.decisions=state.decisions.concat(item).slice(-200);event('requested',item);return copy(item);
 }
 function answer(id,meta,value,{source='user',questionId=id}={}){
  const item=state.decisions.find(x=>x.id===id&&x.scope===scope(meta));
  if(!item||questionId!==id||source!=='user'||String(meta.chat||'')!=='private:'+clean(meta.ownerId))throw Error('回答必须关联本人的这一个待决定问题');
  if(item.status!=='pending'||item.expiresAt<=now())throw Error('该操作许可已处理或过期，请重新核对');
  const verdict=approvalAnswer(value);
  if(verdict==='unrelated')return {ok:false,unrelated:true};
  if(!isPaymentDecision(item))throw Error('这份旧许可不再适用于付款');
  item.status=verdict==='approve'?'approved':'denied';item.answeredAt=now();event(item.status,item);return {ok:true,id:item.id,status:item.status};
 }
 function check(meta,args,trusted={},options={}){
  const d=describeOperation(args,trusted);
  if(d.effect!=='payment')return {ok:true,ordinary:true,requiresDecision:false,effect:d.effect,fingerprint:d.fingerprint};
  const paymentError=message=>{const err=Error(message);err.code='DECISION_REQUIRED';err.operation=d;throw err;};
  if(!d.operation.merchant||!d.operation.amount||!d.operation.currency)paymentError('付款前需要明确商家、金额和币种并询问本人');
  if(!d.operation.target&&!d.operation.command)paymentError('付款前需要明确准确目标和完整内容并询问本人');
  const matching=options.allowMatchingGrant?state.decisions.find(x=>x.scope===scope(meta)&&isPaymentDecision(x)&&x.fingerprint===d.fingerprint&&x.status==='approved'&&x.expiresAt>now()):null;
  const id=clean(args.decisionId||options.decisionId||matching?.id),item=state.decisions.find(x=>x.id===id&&x.scope===scope(meta));
  if(!item||!isPaymentDecision(item)||item.status!=='approved'||item.expiresAt<=now()||item.fingerprint!==d.fingerprint)paymentError('这一步需要本人明确允许并确认当前准确付款目标、金额和内容；旧许可、过期许可或已使用许可不能复用');
  return {ok:true,ordinary:false,requiresDecision:true,decisionId:item.id,fingerprint:d.fingerprint,scope:item.scope,effect:d.effect};
 }
 // Call once immediately before the real side effect. A preflight check alone
 // does not spend a grant; retrying an unknown outcome does require a new one.
 function consume(receipt){if(receipt?.ordinary)return receipt;const item=state.decisions.find(x=>x.id===receipt?.decisionId&&x.scope===receipt?.scope),operation=item?.operation;if(!item||!isPaymentDecision(item)||item.status!=='approved'||item.expiresAt<=now()||item.fingerprint!==receipt.fingerprint)throw Error('许可已使用或状态变化，未重放付款操作');if(!operation?.merchant||!operation?.amount||!operation?.currency||(!operation?.target&&!operation?.command))throw Error('付款许可缺少商家、金额、币种或准确目标，不能执行');item.status='consumed';item.usedAt=now();event('consumed',item);return {...receipt,consumed:true};}
 function invalidate(meta,reason='任务改变'){if(Array.isArray(state.loginWorkflows))for(const item of state.loginWorkflows)if(item.scope===scope(meta)&&item.status==='active')item.status='cancelled';for(const item of state.decisions)if(item.scope===scope(meta)&&['pending','approved'].includes(item.status)){item.status='cancelled';item.reason=clean(reason).slice(0,160);}save();}
 function snapshot(meta){return {pending:state.decisions.filter(x=>x.scope===scope(meta)&&isPaymentDecision(x)&&x.status==='pending'&&x.expiresAt>now()).map(copy),recent:state.decisions.filter(x=>x.scope===scope(meta)).slice(-20).map(copy)};}
 function recordUserInstruction(){return null;}
 return {propose,answer,check,consume,invalidate,snapshot,recordUserInstruction};
}
