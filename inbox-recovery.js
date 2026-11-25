import {isProgressDelivery} from './delivery-outbox.js';

// Admission acknowledges the handoff, not a completed reply. Never automatically
// replay a handoff interrupted by reload: it may have executed external tools.
export function recoverInterruptedAdmissions(inbox,audits,{accountId,personaFor,now=Date.now()}={}){
 let count=0;
 for(const job of inbox){
  if(job.status!=='admitted'||job.accountId!==accountId||now-job.at>24*3600000)continue;
  const ids=(job.payload?._bridgeReceivedIds||job.receivedIds||[job.payload?.message_id]).filter(v=>v!=null).map(String);
  if(!ids.length)continue;
  const candidates=audits.filter(a=>a.accountId===accountId&&a.chat===job.key&&a.at>=job.at&&a.at>=(job.retryAfter||0)&&ids.every(id=>(a.inboundIds||[]).map(String).includes(id))).sort((a,b)=>b.at-a.at);
  const audit=candidates[0];
  if(!audit||audit.status!=='cancelled'||!audit.recoveredAt||!audit.durationUnknown||audit.deliveryState==='sent'||personaFor&&audit.persona!==personaFor(job.key))continue;
  job.status='failed';job.interruptedAuditId=audit.id;job.recoveryRequiresConfirmation=true;
  job.error='提交 DSH 后因插件重载中断，尚无完整回复确认；请核对任务及发送记录后恢复';count++;
 }
 return count;
}

export function settleInterruptedAdmissions(inbox,audits,{accountId}={}){
 let count=0;
 for(const job of inbox){
  if(!job.interruptedAuditId||job.accountId!==accountId)continue;
  const original=audits.find(a=>a.id===job.interruptedAuditId&&a.accountId===accountId&&a.chat===job.key);
  const ids=(job.payload?._bridgeReceivedIds||job.receivedIds||[]).map(String);if(!original||!ids.length)continue;
  const completed=audits.some(a=>a.accountId===accountId&&a.chat===job.key&&a.persona===original.persona&&a.at>=original.at&&ids.every(id=>(a.inboundIds||[]).map(String).includes(id))&&
    (a.status==='silent'||a.status==='completed'&&a.deliveryState==='sent'));
  if(!completed)continue;
  job.status='admitted';job.error='';delete job.recoveryRequiresConfirmation;delete job.interruptedAuditId;delete job.payload;count++;
 }
 return count;
}

export async function restoreInboxPayload(job,readMessage,{selfId,current=()=>true}={}){
 const ids=[...new Set((job.receivedIds||[]).filter(v=>v!=null).map(String))];
 const expected=/^(\d+):/.exec(job.id)?.[1];
 if(!ids.length||!selfId||expected&&expected!==String(selfId)||!current())throw Error('原输入的账号范围未确认，未重新提交');
 const group=job.key.startsWith('group:'),target=job.key.split(':')[1],rows=[];
 for(const id of ids){
  const row=await readMessage(id);
  if(!current())throw Error('取回原消息期间会话已改变，未重新提交');
  const sender=String(row?.user_id??row?.sender?.user_id??'');
  if(!row||String(row.message_id)!==id||row.message_type!==(group?'group':'private')||!sender||row.self_id!=null&&String(row.self_id)!==String(selfId)||
    group&&String(row.group_id)!==target||!group&&sender!==target||rows.length&&String(rows[0].user_id??rows[0].sender?.user_id)!==sender||!Array.isArray(row.message))throw Error('取回消息与原编号、联系人或群范围不一致，未重新提交');
  rows.push(row);
 }
 const first=rows[0];
 return {...first,post_type:'message',self_id:String(selfId),user_id:first.user_id??first.sender.user_id,
  message_id:ids[0],_bridgeReceivedAt:job.at,_bridgeReceivedIds:ids,
  message:rows.flatMap((row,i)=>[...(i?[{type:'text',data:{text:'\n'}}]:[]),...row.message])};
}

// This exact rejection happens before any model submission. Repair only the
// private review that was incorrectly tagged as approved group attention.
export function repairPrivateReviewAdmission(inbox,{activeAccountId,selfId}={}){
 const seen=new Set();let repaired=0;
 for(const job of [...inbox].reverse()){
  const p=job.payload;
  if(job.accountId!==activeAccountId||String(p?.self_id)!==String(selfId)||job.status!=='failed'||job.error!=='当前联系人不再允许访问'||!p?._sleepReview||p.message_type!=='private'||p._groupAttentionApproved!==true)continue;
  const ids=(p._bridgeReceivedIds||job.receivedIds||[]).map(String).sort();if(!ids.length)continue;
  const key=JSON.stringify([job.accountId,job.key,ids]);
  if(seen.has(key)){job.status='cancelled';job.error='相同未读消息已并入较新的恢复任务';continue;}
  seen.add(key);delete p._groupAttentionApproved;job.status='queued';job.error='';repaired++;
 }
 return repaired;
}

// Saving must preserve live job references used by a drain that is still running.
export function retainInbox(inbox, recordsAllowed) {
  const retained = [];
  let admittedCount = 0, otherHistoryCount = 0;
  for (let i = inbox.length - 1; i >= 0; i--) {
    const job = inbox[i];
    if (!recordsAllowed(job.key,job.accountId)) continue;
    if (job.status === 'admitted') {
      if (++admittedCount > 1000) continue;
    } else if (!['queued', 'processing', 'uncertain'].includes(job.status)) {
      if (++otherHistoryCount > 200) continue;
    }
    retained.push(job);
  }
  return retained.reverse();
}

export function markInterruptedInbox(inbox) {
  for (const job of inbox) {
    if (job.status !== 'processing') continue;
    job.status = 'uncertain';
    job.error = '重启前未确认是否已提交模型';
  }
}

function idsOf(values) {
  return (Array.isArray(values) ? values : []).filter(id => id != null && id !== '').map(String);
}

function recoveryDecision(job, accountId, {audits, auditById, outbox, outboxById, messages, mediaTasks}) {
  const inbound = new Set([...idsOf(job.receivedIds), ...idsOf(job.payload._bridgeReceivedIds)]);
  if (!inbound.size && job.payload.message_id != null) inbound.add(String(job.payload.message_id));
  const matches = ids => ids.some(id => inbound.has(id));
  const confirmed = new Set();
  function confirm(ids) {
    for (const id of ids) if (inbound.has(id)) confirmed.add(id);
    return confirmed.size > 0 && confirmed.size === inbound.size;
  }
  const inScope = row => row.chat === job.key &&
    (accountId == null || row.accountId == null || row.accountId === accountId);
  // A legacy unscoped row may justify holding a retry, but cannot confirm
  // admission for a known account. Two legacy, unscoped rows retain their scope.
  const sameAccount = row => (row.accountId ?? null) === (accountId ?? null);
  let hold = false;
  for (const audit of audits) {
    const ids = idsOf(audit.inboundIds);
    if (!inScope(audit) || audit.at < job.at || !matches(ids)) continue;
    if (sameAccount(audit) && audit.status === 'silent' && confirm(ids)) return 'admitted';
    if (audit.status !== 'queued' || audit.submissionStartedAt !== 0 || audit.singingAttempted ||
        audit.outboxIds?.some(id => !isProgressDelivery(outboxById.get(id))) || audit.mediaExecution?.items?.length) hold = true;
  }
  function inspect(row, at, status, directIds, canConfirm) {
    if (!inScope(row) || !(at >= job.at) || row.initiative || row.automaticPrivate || row.manualInitiative || isProgressDelivery(row)) return false;
    const audit = auditById.get(row.auditId);
    const source = directIds.length ? directIds : audit && inScope(audit) ? idsOf(audit.inboundIds) : [];
    if (source.length && inbound.size && !matches(source)) return false;
    if (source.length && canConfirm && sameAccount(row) &&
        (directIds.length || sameAccount(audit)) && ['queued', 'sent'].includes(status) && confirm(source)) return true;
    // With no usable source, a later legacy send might be this request. Never
    // replay a paid or irreversible action merely because its audit has expired.
    hold = true;
    return false;
  }
  for (const row of outbox) {
    const ids = idsOf(row.replyToInboundIds ?? [row.sourceMessageId]);
    if (inspect(row, row.at, row.status, ids, true)) return 'admitted';
  }
  for (const row of messages) {
    if (row.dir !== 'out') continue;
    const delivery = outboxById.get(row.localId);
    if (delivery && delivery.chat === row.chat && delivery.accountId === row.accountId) continue;
    if (inspect(row, row.time, row.delivery, idsOf(row.replyToInboundIds), true)) return 'admitted';
  }
  for (const task of mediaTasks) inspect(task, task.at, task.status, idsOf(task.replyToInboundIds), false);
  return hold ? 'failed' : 'queued';
}

export function reconcileUncertainInbox(inbox, {
  audits = [], outbox = [], messages = [], mediaTasks = [], activeAccountId, selfId, now = Date.now()
}) {
  const cutoff = now - 24 * 3600_000;
  const auditById = new Map(audits.filter(row => row.id).map(row => [row.id, row]));
  const outboxById = new Map(outbox.filter(row => row.id).map(row => [row.id, row]));
  let retried = 0, blocked = 0, unavailable = 0, admitted = 0;
  for (const job of inbox) {
    if (job.status !== 'uncertain') continue;
    if (job.accountId != null && activeAccountId != null && job.accountId !== activeAccountId) continue;
    const originalSelf = job.payload?.self_id ?? /^(\d+):/.exec(job.id)?.[1];
    if (originalSelf != null && (activeAccountId != null || selfId) && String(originalSelf) !== String(selfId || '')) continue;
    if(job.interruptedAuditId&&job.recoveryRequiresConfirmation){job.status='failed';blocked++;continue;}
    if (!job.payload || job.at < cutoff) {
      job.status = 'failed';
      job.error ||= job.at < cutoff ? '恢复窗口已过，未自动重试' : '缺少原始消息，未自动重试';
      unavailable++;
      continue;
    }
    if (activeAccountId != null && job.accountId == null && originalSelf == null) continue;
    const accountId = job.accountId ?? (originalSelf != null && selfId ? activeAccountId : undefined);
    job.status = recoveryDecision(job, accountId, {audits, auditById, outbox, outboxById, messages, mediaTasks});
    if (job.status === 'admitted') {
      delete job.payload;
      job.error = '';
      admitted++;
    } else if (job.status === 'failed') {
      job.error = '存在待核对的提交或发送记录，未自动重试；可在面板确认后重试';
      job.recoveryRequiresConfirmation = true;
      blocked++;
    } else {
      job.error = '';
      retried++;
    }
  }
  return {retried, blocked, unavailable, admitted};
}
