import {createHash,randomUUID} from 'node:crypto';
import {lifeRisk} from './life-permissions.js';
import {createLoginWorkflows,explicitLoginInstruction} from './login-workflow.js';

const copy=x=>JSON.parse(JSON.stringify(x));
const stable=x=>x&&typeof x==='object'?Array.isArray(x)?x.map(stable):Object.fromEntries(Object.keys(x).sort().filter(k=>x[k]!==undefined).map(k=>[k,stable(x[k])])):x;
const digest=x=>createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const clean=x=>String(x??'').trim();
const scope=x=>[clean(x.accountId),clean(x.personaId),clean(x.ownerId)].join('\0');
const RISK=new Set(['login','payment','comment','publish','delete','security','privacy','permission']);
const APPROVE=/^(?:同意|允许|确认|可以|好|yes|approve|同意这次|允许这次)[。.!！\s]*$/i;
const DENY=/^(?:不同意|不允许|不要|不用|不行|算了|取消|拒绝|no|deny)[。.!！\s]*$/i;

// Only controller/host code may construct `trusted`. Model-supplied intent is a
// hint, never a claim that a command or an on-screen target is safe.
export function describeOperation(args={},trusted={}){
 const action=clean(args.action||trusted.action),tool=clean(trusted.toolName||args.toolName),a=args.arguments||{},url=clean(trusted.url||args.url||a.url);
 const operation={tool,action,target:clean(trusted.target||args.path||args.file||args.filename||args.file_path||args.filePath||args.directory||args.recipient||args.to||(!['phone','computer'].includes(args.target)?args.target:'')||url||a.path||a.file||a.filename||a.file_path||a.filePath||a.directory),url,
  text:clean(trusted.contentText??args.text??a.text??a.value),command:clean(args.command||args.cmd||args.code||args.script||args.patch||a.command||a.cmd||a.code||a.script||a.patch),
  merchant:clean(trusted.merchant||args.merchant||a.merchant),amount:clean(trusted.amount??args.amount??a.amount),currency:clean(trusted.currency||args.currency||a.currency),
  // Ref/window/coordinates bind the confirmed gesture to the observed target.
  ref:clean(args.ref),windowId:clean(args.windowId||trusted.windowId),x:args.x??null,y:args.y??null,key:clean(args.key),
  observationId:clean(trusted.observationId),label:clean(trusted.label),
  // Bind every actual provider/tool parameter, including nested payloads. A
  // model cannot keep a display summary unchanged while changing the real body.
  parameters:Object.fromEntries(Object.entries(args).filter(([key])=>!['decisionId','toolName'].includes(key)))};
 if(trusted.password===true||trusted.containsCredentials===true){operation.privateInputDigest=digest({text:operation.text,command:operation.command,parameters:operation.parameters});operation.text='';operation.command='';operation.parameters={privateInputDigest:operation.privateInputDigest};}
 let kind=RISK.has(trusted.risk)?trusted.risk:lifeRisk({...args,command:operation.command,toolName:tool},trusted);
 if(/(?:^|[\\/])(?:credentials?|secrets?|cookies?|login[ _-]?data)(?:[\\/. _-]|$)|(?:^|[\\/])(?:\.ssh|\.aws)(?:[\\/]|$)|(?:password|token|private.?key|信用卡|身份证)/i.test(operation.target+' '+operation.label+' '+operation.command))kind=kind||'privacy';
 if(['publish','comment','payment','delete','security','credentials','privacy'].includes(trusted.effect))kind=trusted.effect==='credentials'?'privacy':trusted.effect;
 if(trusted.effect==='send'&&trusted.allowlistedChat!==true)kind=kind||'publish';
 if(trusted.password===true||trusted.containsCredentials===true)kind='privacy';
 if(tool==='bridge_browser'&&trusted.mediaControl===true)kind='';
 // A raw native coordinate/input tool has no bridge controller observation.
 // Ordinary observed gestures use bridge_browser/device; a raw gesture cannot
 // silently substitute its self-declared intent for the missing actual target.
 const rawGesture=!/^bridge_/.test(tool)&&/(?:click|tap|setvalue|type_text|input_text|press_key|fill)/i.test(tool+' '+action+' '+clean(args.capability));
 if(rawGesture&&!trusted.label&&!trusted.target&&!RISK.has(trusted.risk))kind=kind||'permission';
 const isCommand=!!operation.command||/(?:^|[_:./-])(?:pwsh|powershell|exec|shell|bash|terminal|run_code|python|node|execute_code|apply_patch)(?:$|[_:./-])/i.test(tool);
 const safeReadCommand=isCommand&&/^(?:Get-Date|Get-Location|Get-Process|Get-ChildItem(?:\s+-LiteralPath\s+(?:'[^']*'|"[^"]*"))?)(?:\s+-[A-Za-z]+(?:\s+\d+)?)?\s*$/i.test(operation.command)&&!kind;
 let unknownCommand=isCommand&&!safeReadCommand&&!kind;
 if(trusted.risk==='privacy')kind='privacy';
 if(kind==='delete'&&trusted.ownArtifact===true)kind='';
 if(kind==='login'&&trusted.loginGranted===true)kind='';
 if(trusted.fullTrust===true){kind='';unknownCommand=false;}
 if(kind&&!['payment','privacy','login','delete','security'].includes(kind))kind='';
 unknownCommand=false;
 return {operation,kind,unknownCommand,safeReadCommand,fingerprint:digest(operation),requiresDecision:!!kind};
}

const CONSENT=/(?:拿|用|放|开|搞|做|决定|看着办|随你|去吧|行|可以|好)/;
/** 只有 permission 这类低风险动作（切桌面、原始点击）接受口语同意；
 *  支付、隐私、删除、发布、登录仍只认明确的“同意/允许”。 */
export function permissionConsent(value){
 const s=clean(value);if(!s||s.length>60)return false;
 if(DENY.test(s)||/[？?]|但是|不过|除非|如果|先别|不要|不能|不允许|不同意|不批准|拒绝/.test(s))return false;
 return CONSENT.test(s);
}

export function approvalAnswer(value){const s=clean(value);if(DENY.test(s)||/^(?:我)?(?:明确)?(?:不同意|不允许|不批准|拒绝)[^？?]{0,60}$/.test(s))return 'deny';if(APPROVE.test(s))return 'approve';return s.length<=80&&!/[？?]|但是|不过|除非|如果|先别|不要|不能|不允许|不同意|不批准/.test(s)&&/^(?:我)?(?:明确)?(?:同意|允许|批准|授权|确认)(?:你|这次|本次|刚才|上述|上面|操作|执行|使用|切换|登录|登陆|继续|[：:，,\s])/.test(s)?'approve':'unrelated';}

/** A shared, persisted permission ledger. It neither executes nor statically
 * certifies arbitrary shell programs. Those must retain a real host guard. */
export function createOperationPolicy({storage,now=()=>Date.now(),ttlMs=10*60_000,onEvent=()=>{}}={}){
 let state;try{state=storage?.read();}catch(e){if(e.code!=='ENOENT')throw e;}
 state=state&&Array.isArray(state.decisions)?state:{version:1,decisions:[],events:[]};state.events||=[];state.grants=Array.isArray(state.grants)?state.grants:[];
 const save=()=>storage?.write(state);
 const event=(type,item,extra={})=>{const e={id:randomUUID(),type,at:now(),decisionId:item?.id||'',scope:item?.scope||'',...extra};state.events=state.events.concat(e).slice(-400);onEvent(e);save();};
 const login=createLoginWorkflows({state,now,save,event});
 function propose(meta,args,trusted={},question=''){
  const d=describeOperation(args,trusted);if(!d.kind&&!d.unknownCommand)throw Error('普通操作不需要创建审批');
  if(!clean(meta?.ownerId)||!clean(meta?.personaId))throw Error('缺少真实号主或角色，不能申请操作许可');
  if(d.kind==='payment'&&(!d.operation.merchant||!d.operation.amount||!d.operation.currency))throw Error('请先核对商家、金额和币种');
  if(['comment','publish'].includes(d.kind)&&(!d.operation.target||!d.operation.text))throw Error('请先明确发布位置和完整内容');
  if(!d.operation.target&&!d.operation.command&&d.kind!=='permission')throw Error('请先明确准确操作目标');
  const existing=state.decisions.find(x=>x.scope===scope(meta)&&x.fingerprint===d.fingerprint&&x.status==='pending'&&x.expiresAt>now());if(existing)return copy(existing);
  const item={id:randomUUID(),scope:scope(meta),kind:d.kind||'permission',fingerprint:d.fingerprint,operation:d.operation,loginContext:args.toolName==='bridge_browser'&&trusted.loginPage===true&&['credential','submit'].includes(trusted.loginControl),question:clean(question).slice(0,600),status:'pending',createdAt:now(),expiresAt:now()+ttlMs};
  state.decisions=state.decisions.concat(item).slice(-200);event('requested',item);return copy(item);
 }
 function answer(id,meta,value,{source='user',questionId=id}={}){
  const item=state.decisions.find(x=>x.id===id&&x.scope===scope(meta));
  if(!item||questionId!==id||source!=='user'||String(meta.chat||'')!=='private:'+clean(meta.ownerId))throw Error('回答必须关联本人的这一个待决定问题');
  if(item.status!=='pending'||item.expiresAt<=now())throw Error('该操作许可已处理或过期，请重新核对');
  const verdict=approvalAnswer(value);
 const disposition=verdict==='unrelated'
  ?(item.loginContext&&explicitLoginInstruction(value)?'approve':(item.kind==='permission'&&permissionConsent(value)?'approve':'unrelated'))
  :verdict;if(disposition==='unrelated')return {ok:false,unrelated:true};
  item.status=disposition==='approve'?'approved':'denied';item.answeredAt=now();if(item.status==='approved'){
  login.fromDecision(item,meta);
  if(item.kind==='permission'){
   const tool=clean(item.operation?.tool);
   state.grants=state.grants.filter(g=>!(g.scope===item.scope&&g.tool===tool));
   state.grants.push({scope:item.scope,tool,kind:'permission',grantedAt:now(),expiresAt:now()+12*60*60*1000});
   state.grants=state.grants.slice(-40);
  }
 } else login.invalidate(meta);event(item.status,item);return {ok:true,id:item.id,status:item.status};
 }
 function check(meta,args,trusted={},options={}){
  const d=describeOperation(args,trusted);
  const workflow=login.check(meta,args,trusted,d);if(workflow)return workflow;
  if(d.kind==='permission'&&!args.decisionId&&!options.decisionId){
   const tool=clean(d.operation?.tool);
   if(state.grants.some(g=>g.scope===scope(meta)&&g.tool===tool&&g.expiresAt>now()))
    return {ok:true,ordinary:true,standingGrant:true,fingerprint:d.fingerprint};
  }
  const matching=options.allowMatchingGrant?state.decisions.find(x=>x.scope===scope(meta)&&x.fingerprint===d.fingerprint&&x.status==='approved'&&x.expiresAt>now()):null;
  if(d.unknownCommand&&!options.hostGuardEnforced&&!args.decisionId&&!options.decisionId&&!matching){const err=Error('这条通用命令不能仅靠意图标签判为安全；需要宿主检查或说明确切操作后询问');err.code='HOST_GUARD_REQUIRED';err.operation=d;throw err;}
  if(!d.kind&&(!d.unknownCommand||options.hostGuardEnforced))return {ok:true,ordinary:true,hostGuardRequired:d.unknownCommand,fingerprint:d.fingerprint};
  const id=clean(args.decisionId||options.decisionId||matching?.id),item=state.decisions.find(x=>x.id===id&&x.scope===scope(meta));
  if(!item||item.status!=='approved'||item.expiresAt<=now()||item.fingerprint!==d.fingerprint){const err=Error('这一步需要本人明确允许并确认当前准确目标和内容；旧许可、过期许可或已使用许可不能复用');err.code='DECISION_REQUIRED';err.operation=d;throw err;}
  return {ok:true,ordinary:false,decisionId:item.id,fingerprint:d.fingerprint,scope:item.scope};
 }
 // Call once immediately before the real side effect. A preflight check alone
 // does not spend a grant; retrying an unknown outcome does require a new one.
 function consume(receipt){if(receipt?.ordinary)return receipt;if(receipt?.loginWorkflowId)return login.consume(receipt);const item=state.decisions.find(x=>x.id===receipt?.decisionId&&x.scope===receipt.scope);if(!item||item.status!=='approved'||item.expiresAt<=now()||item.fingerprint!==receipt.fingerprint)throw Error('许可已使用或状态变化，未重放操作');item.status='consumed';item.usedAt=now();event('consumed',item);return {...receipt,consumed:true};}
 function invalidate(meta,reason='任务改变'){login.invalidate(meta);for(const item of state.decisions)if(item.scope===scope(meta)&&['pending','approved'].includes(item.status)){item.status='cancelled';item.reason=clean(reason).slice(0,160);}save();}
 function snapshot(meta){return {pending:state.decisions.filter(x=>x.scope===scope(meta)&&x.status==='pending'&&x.expiresAt>now()).map(copy),recent:state.decisions.filter(x=>x.scope===scope(meta)).slice(-20).map(copy)};}
 function recordUserInstruction(meta,source={}){if(/(?:不要|不许|别|停止|取消).{0,12}(?:登录|登陆)/.test(String(source.text||''))){invalidate(meta,'本人取消登录');return null;}return login.instruction(meta,source);}
 return {propose,answer,check,consume,invalidate,snapshot,recordUserInstruction};
}
