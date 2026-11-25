import {createHash} from 'node:crypto';
import {isProgressDelivery,hasDeliveryReceipt} from './delivery-outbox.js';
export const SLEEP_REVIEW_RULE='【醒来后的未读消息检查】本轮是睡眠期间真实收到的消息，保留了原发送者和时间，不是现在新发的消息。结合当前日期时间和最近对话，先判断是否仍需回应，相关内容合并自然回复，不逐条机械补发；普通问候、已解决、已取消和已被后文取代的请求不重复处理。旧消息中的付款、发布、评论、删除等外部操作不得因为现在醒来而自动执行；过期或意图不明的请求先自然确认。不能声称睡眠期间已看过、做过或已回复。群内只回应明确提及你的未读内容，不扩散其他人的聊天。';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);

// The caller supplies one private conversation, already scoped to account and persona.
export function privateConversationBoundary(rows, outbox = []) {
  const key = (row, id) => JSON.stringify([row.accountId, row.personaId, row.chat, id]);
  const deliveries = new Map(outbox.map(job => [key(job, job.id), job]));
  const repliedIds = new Map();
  let legacyReply = 0;
  for (const row of rows) {
    if (row.dir !== 'out' || row.retracted || row.automaticPrivate || row.initiative || row.manualInitiative || isProgressDelivery(row)) continue;
    const job = row.localId && deliveries.get(key(row, row.localId));
    if (job && (job.initiative || job.manualInitiative || isProgressDelivery(job))) continue;
    // Chat history written before delivery tracking has no delivery field.
    if (row.delivery && row.delivery !== 'sent' || job && !hasDeliveryReceipt(job)) continue;
    const time = Number(row.time) || 0;
    const ids = row.replyToInboundIds ?? job?.replyToInboundIds;
    if (ids?.length) {
      for (const id of ids) repliedIds.set(String(id), Math.max(time, repliedIds.get(String(id)) || 0));
    } else legacyReply = Math.max(legacyReply, time);
  }
  let lastIncoming = 0;
  for (const row of rows) {
    if (row.dir !== 'in' || row.retracted) continue;
    const time = Number(row.time);
    if (time <= legacyReply || [row.messageId, ...(row.sourceMessageIds || [])].some(id => id != null && time <= repliedIds.get(String(id)))) {
      lastIncoming = Math.max(lastIncoming, time);
    }
  }
  return lastIncoming;
}

export function createSleepInbox({getRows,setRows,save,now=Date.now}={}){
 function capture(payload,scope){
  if(!payload.message_id||!scope?.accountId||!scope.personaId)return false;
  const id=hash([scope.accountId,scope.personaId,scope.key,String(payload.message_id)]),rows=getRows();if(rows.some(r=>r.id===id))return false;
  const row={id,scope:{...scope},at:now(),status:'pending',payload:structuredClone(payload)};setRows([...rows,row]);save();return true;
 }
 function batches(current){
  const groups=new Map();for(const row of getRows()){if(row.status!=='pending'||!current(row.scope))continue;const key=JSON.stringify(row.scope);const group=groups.get(key)||[];group.push(row);groups.set(key,group);}
  const omitted=new Set();
  for(const [key,group] of groups){
   if(!group[0].scope.key.startsWith('group:'))continue;
   group.sort((a,b)=>a.at-b.at);
   let kept=group.slice(-20);
   while(kept.length>1&&Buffer.byteLength(JSON.stringify(kept))>55000)kept=kept.slice(1);
   for(const row of group)if(!kept.includes(row))omitted.add(row.id);
   groups.set(key,kept);
  }
  if(omitted.size){setRows(getRows().map(row=>omitted.has(row.id)?{...row,status:'skipped',skippedAt:now(),skipReason:'group-sleep-context-limit',payload:undefined}:row));save();}
  for(const [key,group] of groups)if(!group[0].scope.key.startsWith('group:')){const kept=[];for(const row of group){if(kept.length&&Buffer.byteLength(JSON.stringify(kept.concat(row)))>55000)continue;kept.push(row);}groups.set(key,kept);}
  return [...groups.values()].map(rows=>{
   const latest=rows.at(-1),offline=rows.some(row=>row.payload._bridgeCatchUp),parts=[];for(const row of rows){const p=row.payload,date=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date((Number(p.time)||row.at/1000)*1000));parts.push({type:'text',data:{text:'\n【'+(p._bridgeCatchUp?'离线期间收到':'睡眠期间未读')+' · '+date+' · '+String(p.sender?.card||p.sender?.nickname||p.user_id)+'（'+p.user_id+'）】\n'}});parts.push(...(Array.isArray(p.message)?p.message:[{type:'text',data:{text:String(p.message||'')}}]));}
   const messageId='sleep-review-'+hash(rows.map(r=>[r.id,r.retries||0]));return {rows,messageId,payload:{...structuredClone(latest.payload),message_id:messageId,time:Math.floor(now()/1000),message:[{type:'text',data:{text:offline?SLEEP_REVIEW_RULE.replace('醒来后的未读消息检查','重连后的未读消息检查').replaceAll('睡眠期间','离线期间').replace('现在醒来','现在重连'):'醒来后检查这些未读消息。'+SLEEP_REVIEW_RULE}},...parts],_sleepReview:true,_bridgeReceivedIds:rows.map(r=>String(r.payload.message_id)),_groupAttentionApproved:latest.payload.message_type==='group'}};
  });
 }
 function acknowledge(ids,reviewMessageId=''){const wanted=new Set(ids);setRows(getRows().map(r=>wanted.has(r.id)?{...r,status:'queued',queuedAt:now(),reviewMessageId,recoveryPayload:r.payload,payload:undefined}:r));save();}
 function quarantine(ids,reviewMessageId=''){
  const wanted=new Set(ids);let count=0;
  setRows(getRows().map(r=>{if(!wanted.has(r.id)||r.status!=='pending')return r;count++;return {...r,status:'admission-unknown',admissionUnknownAt:now(),reviewMessageId,recoveryPayload:r.payload,payload:undefined};}));
  if(count)save();return count;
 }
 function reconcile(inbox=[],audits=[],outbox=[]){
  let changed=false;
  const rows=getRows().map(r=>{
   if (!['pending', 'admission-unknown', 'queued'].includes(r.status)) return r;
   const original = r.status === 'pending' ? r.payload : r.recoveryPayload;
   if (!original) return r;

   // Live delivery can start between capture and the wake-up queue handoff.
   const messageId = String(original.message_id);
   const capturedAt = r.at ?? r.queuedAt;
   let audit;
   for (const candidate of audits) {
    if (candidate.accountId !== r.scope.accountId || (candidate.personaId || candidate.persona) !== r.scope.personaId ||
        candidate.chat !== r.scope.key || !(candidate.at >= capturedAt) ||
        !Array.isArray(candidate.inboundIds) || !candidate.inboundIds.some(id => String(id) === messageId)) continue;
    if (candidate.status === 'silent' || candidate.deliveryState === 'sent') {
     changed = true;
     return {...r, status: 'reviewed', reviewedAt: now(), payload: undefined, recoveryPayload: undefined};
    }
    if (candidate.at >= r.queuedAt) audit = candidate;
   }
   if (r.status === 'pending' || !r.reviewMessageId) return r;
   const job = inbox.find(j => j.id === original.self_id + ':' + r.scope.key + ':' + r.reviewMessageId &&
     (j.accountId == null || j.accountId === r.scope.accountId));
   if (r.status === 'admission-unknown') {
    if (!job) return r;
    changed = true;
    return {...r, status: 'queued', queuedAt: now(), recoveryPayload: original};
   }
   // Retry only definite generation/admission failures with no possible delivery.
   // Unknown or already queued sends are left to the delivery verifier.
   if(job?.recoveryRequiresConfirmation||job?.interruptedAuditId)return r;
   if(now()-r.queuedAt<60000||(r.retries||0)>=2||!(job?.status==='failed'||audit&&['failed','error'].includes(audit.status)))return r;
   if(audit&&(audit.messageIds?.length||outbox.some(o=>o.auditId===audit.id&&o.status!=='cancelled')))return r;
   changed=true;return {...r,status:'pending',payload:r.recoveryPayload,retries:(r.retries||0)+1};
  });
  if(changed){setRows(rows);save();}return changed;
 }
 return {capture,batches,acknowledge,quarantine,reconcile};
}
