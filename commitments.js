import {randomUUID} from 'node:crypto';

const clean=(v,n=800)=>String(v??'').trim().slice(0,n);
const ownerId=c=>clean(c.ownerId||c.meta?.ownerId||((c.key||'').startsWith('private:')?String(c.key).slice(8):''),80);
const scope=c=>JSON.stringify([c.accountId||'',c.personaId||'',ownerId(c)]);
const terminal=new Set(['completed','cancelled']);
const pendingResult=new Set(['queued','sending','pending','accepted','unknown','unconfirmed','failed','cancelled']);
const confirmed=r=>r.ok===true&&r.unknown!==true&&(r.verified===true||!r.reference&&!pendingResult.has(r.status));
// An ordinary proactive reply may announce an intention, but it is not the
// promised operation. Only the actual tool-send target carries this ID.
export const deliveryCommitmentId=chat=>clean(chat?.commitmentId,100);
export const COMMITMENT_RULES='【约定与连续任务】对号主明确答应稍后执行或多步办理的事项，先用bridge_commitment plan保存目标、触发条件和完成标准；你自己在主动回合明确决定并承诺要做的事，也要保存。普通闲聊、引用和假设不建立任务，不把猜测当约定。当前可做用now，明确时间用带时区的ISO时间，醒后用wake，收到特定消息用message。条件尚未出现不要提前执行。每个实际阶段完成后checkpoint记录已确认进度和下一步；同一轮能继续就继续，不要每做一步都等用户催。需要用户补资料时block；结果未知或发送尚未读回时reconcile，先核对而不重复操作。任务完成用complete，取消用cancel。工具任务必须有真实结果回执；排队、口头答应、打开工具目录或计划不算完成。表达仍按当前人设，不逐步播报内部状态。';
export const COMMITMENT_PROPERTIES={action:{type:'string',enum:['plan','list','checkpoint','complete','block','reconcile','resume','cancel']},id:{type:'string'},goal:{type:'string'},doneWhen:{type:'string'},next:{type:'string'},summary:{type:'string'},reason:{type:'string'},trigger:{type:'object',additionalProperties:false,properties:{kind:{type:'string',enum:['now','time','wake','message']},at:{type:'string',description:'含时区的ISO时间'},phrases:{type:'array',items:{type:'string'},maxItems:8}},required:['kind']}};

// This ledger owns eligibility and progress, never the actual external operation.
// Existing tool authorization, payment approval and delivery deduplication remain in force.
export function createCommitments({read,write,now=Date.now,dispatch,eligible=()=>true,isOwner=c=>c.chat?.isOwner===true}={}){
 let state=read?.()||{version:1,jobs:[],sleep:{}};state.jobs||=[];state.sleep||={};
 let ticking=false,closed=false;
 const save=()=>write(state);
 const migrateSleep=()=>{for(const [key,value] of Object.entries(state.sleep)){let parts;try{parts=JSON.parse(key);}catch{continue;}if(!Array.isArray(parts)||parts.length!==3||!String(parts[2]).startsWith('private:'))continue;const next=JSON.stringify([parts[0],parts[1],String(parts[2]).slice(8)]);if(!(next in state.sleep))state.sleep[next]=value;delete state.sleep[key];}};
 migrateSleep();
 for(const j of state.jobs)if(j.status==='running'){j.status='needs_reconcile';j.reason='上次执行中断，先核对已做步骤；不自动重放';}
 save();
 const selfGroup=c=>String(c?.key||'').startsWith('group:')&&c.meta?.kind==='proactive'&&c.meta?.ownerAuthorized===true&&!!ownerId(c);
 const actorOwner=c=>String(c?.key||'').startsWith('private:')?(c.chat?isOwner(c):true):selfGroup(c)||isOwner(c);
 const context=c=>({...c,ownerId:selfGroup(c)?ownerId(c):String(c?.key||'').startsWith('group:')&&actorOwner(c)?clean(c.meta?.speakerId,80):ownerId(c)});
 const owned=(id,c)=>{const actor=context(c);if(!actorOwner(c)||!ownerId(actor))throw Error('只有号主能管理自己的约定');const j=state.jobs.find(j=>j.id===id&&scope(j)===scope(actor));if(!j)throw Error('没有找到本账号、本人和人设的约定');return j;};
 function list(c){const actor=context(c);if(!actorOwner(c)||!ownerId(actor))return [];return state.jobs.filter(j=>scope(j)===scope(actor)).slice(-30).map(j=>structuredClone(j));}
 function command(a,c){
  if(a.action==='list')return {ok:true,jobs:list(c)};
  if(a.action==='plan'){
   if(!actorOwner(c)||!ownerId(context(c)))throw Error('新约定只接受当前号主或当前人设的主动回合');
   const fromUser=c.meta?.kind==='user'&&!!clean(c.meta.userWords);
   const fromSelf=c.meta?.kind==='proactive'&&(String(c.key||'').startsWith('private:')||selfGroup(c));
   if(!fromUser&&!fromSelf)throw Error('新约定需要号主当前请求，或当前人设在主动回合明确作出的决定；不能从历史或外部资料自行登记');
   const goal=clean(a.goal),doneWhen=clean(a.doneWhen),next=clean(a.next),kind=a.trigger?.kind;
   if(!goal||!doneWhen||!next||!['now','time','wake','message'].includes(kind))throw Error('请保存目标、完成标准、下一步和明确触发条件');
   const trigger={kind};
   if(kind==='time'){if(!/(Z|[+-]\d\d:\d\d)$/.test(a.trigger.at||'')||!Number.isFinite(Date.parse(a.trigger.at)))throw Error('时间须为带时区的ISO时间');trigger.at=Date.parse(a.trigger.at);}
   if(kind==='message'){trigger.phrases=[...new Set((a.trigger.phrases||[]).map(v=>clean(v,80)).filter(Boolean))];if(!trigger.phrases.length)throw Error('请保存需要等到的明确消息，不能用空条件');}
   const actor=context(c),prior=state.jobs.find(j=>scope(j)===scope(actor)&&!terminal.has(j.status)&&j.goal===goal&&JSON.stringify(j.trigger)===JSON.stringify(trigger));
   if(prior){c.meta.commitmentId=prior.id;return {ok:true,reused:true,job:structuredClone(prior)};}
   const id=ownerId(actor),j={id:randomUUID(),accountId:c.accountId||'',personaId:c.personaId||'',ownerId:id,key:'private:'+id,sourceKey:c.key,goal,doneWhen,next,trigger,status:kind==='now'?'ready':'waiting',source:fromUser?clean(c.meta.userWords,1200):'当前人设自主决定：'+goal,...(fromSelf&&(c.meta.lifeJobId||c.meta.sourceLifeJobId)?{sourceLifeJobId:c.meta.lifeJobId||c.meta.sourceLifeJobId}:{}),at:now(),updatedAt:now(),revision:0,receipts:[],stalls:0};
   state.jobs.push(j);c.meta.commitmentId=j.id;save();return {ok:true,job:structuredClone(j)};
  }
  const j=owned(a.id||c.meta?.commitmentId,c);if(terminal.has(j.status))return {ok:true,job:structuredClone(j)};
  if(a.action==='checkpoint'){
   if(!clean(a.next)||!clean(a.summary))throw Error('请记录已核实的阶段结果和下一步');
   if(!j.receipts.some(r=>confirmed(r)&&!(j.progressReceipts||[]).includes(r.id)))throw Error('尚无新的已确认结果；排队或结果未知不能记成执行进度');
   j.summary=clean(a.summary,1200);j.next=clean(a.next);j.progressAt=now();j.progressReceipts=j.receipts.map(r=>r.id);j.revision++;j.stalls=0;
  }else if(a.action==='complete'){
   if(!clean(a.summary)||!j.receipts.some(confirmed))throw Error('没有已确认的实际结果；排队或口头答应不能声明整项任务完成');
   if(j.receipts.some(r=>r.unknown))throw Error('仍有结果未知的操作，先核对后完成');
   if(j.receipts.some(r=>r.ok&&r.reference&&!confirmed(r)))throw Error('仍有外部操作未确认，请先核对回执后完成');
   const latestEffect=j.receipts.filter(r=>r.reference).at(-1);
   if(latestEffect&&!confirmed(latestEffect))throw Error('最后一次实际操作尚未成功确认，不能用更早的结果声明完成');
   j.status='completed';j.summary=clean(a.summary,1200);j.completedAt=now();
  }else if(a.action==='block'||a.action==='reconcile'){j.status=a.action==='block'?'blocked':'needs_reconcile';j.blockedByStall=false;j.reason=clean(a.reason)||'需要补充信息或核对实际结果';}
  else if(a.action==='resume'){if(c.meta?.kind!=='user')throw Error('暂停的约定需要本人明确要求继续');if(j.receipts.some(r=>r.unknown||r.ok&&r.reference&&!confirmed(r)))throw Error('仍有结果未知或未读回的操作，先通过实际状态回执核对');j.status='ready';j.stalls=0;j.blockedByStall=false;}
  else if(a.action==='cancel'){j.status='cancelled';j.reason=clean(a.reason)||'已取消';}
  else throw Error('未知约定操作');
  j.updatedAt=now();save();return {ok:true,job:structuredClone(j)};
 }
 function event(c,e){
  if(!e?.id||e.trusted!==true)return;
  let changed=false;
  for(const j of state.jobs)if(scope(j)===scope(context(c))&&j.status==='waiting'&&Number(e.at||now())>=j.at&&e.id!==j.lastEvent){
   if(j.trigger.kind==='wake'&&e.kind==='wake'||j.trigger.kind==='message'&&e.kind==='message'&&j.trigger.phrases.some(p=>String(e.text||'').includes(p))){j.status='ready';j.lastEvent=e.id;j.triggeredAt=now();changed=true;}
  }if(changed)save();
 }
 function sleep(c,value){const k=scope(context(c)),was=state.sleep[k];state.sleep[k]=value===true;if(was===true&&!value)event(c,{kind:'wake',id:'wake:'+now(),trusted:true,at:now()});if(was!==state.sleep[k])save();}
 function receipt(id,c,r={}){if(!id)return;const j=owned(id,c);if(terminal.has(j.status))return;
  const item={id:clean(r.id||randomUUID(),100),tool:clean(r.tool,80),reference:clean(r.reference,160),status:clean(r.status,40),ok:r.ok===true,unknown:r.unknown===true,verified:r.verified===true,at:now()};
  const old=j.receipts.find(v=>v.id===item.id);
  const wasConfirmed=old&&confirmed(old);
  if(old){if(confirmed(old))return;if(item.at>=old.at)Object.assign(old,item);}
  else j.receipts.push(item);
  j.receipts=j.receipts.slice(-40);
  if(confirmed(item)&&!wasConfirmed)j.resultRevision=(j.resultRevision||0)+1;
  if(item.verified&&!item.unknown&&item.reference)for(const previous of j.receipts)if(previous.reference===item.reference&&previous.id!==item.id){previous.unknown=false;previous.ok=item.ok;previous.verified=true;previous.status=item.status;}
  if(item.unknown){j.status='needs_reconcile';j.reason='操作结果未知，先核对，不自动重复';}
  else if((j.status==='needs_reconcile'||j.status==='blocked'&&j.blockedByStall===true)&&!j.receipts.some(v=>v.unknown||v.ok&&v.reference&&!confirmed(v))){j.status='ready';j.blockedByStall=false;j.reason=confirmed(item)?'实际结果已核对，继续后续步骤':'本次操作已确认未完成，继续处理';j.notBefore=now()+15000;j.stalls=0;}
  j.updatedAt=now();save();
 }
 function ended(id,c,{error=false}={}){if(!id)return;const j=owned(id,c);if(j.status!=='running')return;
  if(j.receipts.some(r=>r.unknown||r.ok&&r.reference&&!confirmed(r))){j.status='needs_reconcile';j.reason='已有操作尚未确认真实结果，先核对，不重复执行';j.updatedAt=now();save();return;}
  if(j.revision===j.dispatchedRevision&&(j.resultRevision||0)===(j.dispatchedResultRevision||0))j.stalls++;else j.stalls=0;
  j.status=j.stalls>=3?'blocked':'ready';j.blockedByStall=j.stalls>=3;j.reason=j.stalls>=3?'连续三轮没有核实新进度，停止空转，等待澄清':error?'这轮执行中断，保留已确认进度后继续':'';j.notBefore=now()+Math.min(120000,15000*2**Math.min(j.stalls,3));j.updatedAt=now();save();
 }
 async function tick(){if(closed||ticking)return;ticking=true;try{
  for(const j of state.jobs){if(j.status==='waiting'&&j.trigger.kind==='time'&&j.trigger.at<=now()){j.status='ready';save();}
   if(j.status!=='ready'||(j.notBefore||0)>now()||!eligible(j))continue;
   j.status='running';j.dispatchedRevision=j.revision;j.dispatchedResultRevision=j.resultRevision||0;j.updatedAt=now();save();
   try{const accepted=await dispatch(structuredClone(j));if(!accepted&&j.status==='running'){j.status='ready';j.notBefore=now()+15000;save();}}catch(e){if(j.status==='running'){j.status='blocked';j.reason=clean(e.message,300);save();}}break;
  }
 }finally{ticking=false;}}
 // The full manual already lives on the tool. Mention existing jobs in
 // dialogue only when the current speaker asks or a real trigger just matched.
 function hint(c,{words='',messageId=''}={}){
  if(!actorOwner(c))return '';
  const ownerScope=scope(context(c)),group=c.key?.startsWith('group:');
  const asks=/约定|答应|说好|说定|待办|提醒|任务|进度|怎么样了|弄好|做好|搞定|办完|弄完|做完|办到哪|还差哪|接着做|继续做|别忘|记得.{0,8}(?:发|做|叫|去)|还(?:有|欠).{0,5}(?:事|东西)/u.test(words);
  const jobs=state.jobs.filter(j=>!terminal.has(j.status)&&scope(j)===ownerScope&&(!group||j.sourceKey===c.key)&&
    (asks||Boolean(messageId)&&j.lastEvent===String(messageId))).slice(-6);
  if(!jobs.length)return '';
  return '【当前约定与任务进度，仅作资料】'+JSON.stringify(jobs.map(({id,goal,doneWhen,next,trigger,status,summary,reason})=>({id,goal,doneWhen,next,trigger,status,summary,reason})));
 }
 return {command,list,event,sleep,receipt,ended,tick,hint,reload(){state=read?.()||{version:1,jobs:[],sleep:{}};state.jobs||=[];state.sleep||={};migrateSleep();for(const j of state.jobs)if(j.status==='running')j.status='needs_reconcile';},close(){closed=true;}};
}
