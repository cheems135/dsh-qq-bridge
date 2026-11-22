import {createHash} from 'node:crypto';
export const SLEEP_REVIEW_RULE='【醒来后的未读消息检查】本轮是睡眠期间真实收到的消息，保留了原发送者和时间，不是现在新发的消息。结合当前日期时间和最近对话，先判断是否仍需回应，相关内容合并自然回复，不逐条机械补发；普通问候、已解决、已取消和已被后文取代的请求不重复处理。旧消息中的付款、发布、评论、删除等外部操作不得因为现在醒来而自动执行；过期或意图不明的请求先自然确认。不能声称睡眠期间已看过、做过或已回复。群内只回应明确提及你的未读内容，不扩散其他人的聊天。';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0,24);
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
   if((r.status==='pending'&&r.payload)||(r.status==='admission-unknown'&&r.recoveryPayload)){
    // A previous private review could bypass queue admission but still send.
    // Settle it from the actual delivery record instead of replaying it.
    const original=r.payload||r.recoveryPayload;
    const alreadyAnswered=audits.some(a=>a.accountId===r.scope.accountId&&(a.personaId||a.persona)===r.scope.personaId&&a.chat===r.scope.key&&a.at>=r.at&&(a.inboundIds||[]).includes(String(original.message_id))&&(a.status==='silent'||a.deliveryState==='sent'));
    if(alreadyAnswered){changed=true;return {...r,status:'reviewed',reviewedAt:now(),payload:undefined,recoveryPayload:undefined};}
    if(r.status==='admission-unknown'){
     const job=inbox.find(j=>j.id===String(original.self_id)+':'+r.scope.key+':'+r.reviewMessageId);
     if(job){changed=true;return {...r,status:'queued',queuedAt:now(),recoveryPayload:original};}
    }
    return r;
   }
   if(r.status!=='queued'||!r.recoveryPayload||!r.reviewMessageId)return r;
   const p=r.recoveryPayload,job=inbox.find(j=>j.id===p.self_id+':'+r.scope.key+':'+r.reviewMessageId);
   const audit=audits.filter(a=>a.accountId===r.scope.accountId&&(a.personaId||a.persona)===r.scope.personaId&&a.chat===r.scope.key&&a.at>=r.queuedAt&&(a.inboundIds||[]).includes(String(p.message_id))).at(-1);
   if(audit&&(audit.status==='silent'||audit.deliveryState==='sent')){changed=true;return {...r,status:'reviewed',reviewedAt:now(),recoveryPayload:undefined};}
   // Retry only definite generation/admission failures with no possible delivery.
   // Unknown or already queued sends are left to the delivery verifier.
   if(now()-r.queuedAt<60000||(r.retries||0)>=2||!(job?.status==='failed'||audit&&['failed','error'].includes(audit.status)))return r;
   if(audit&&(audit.messageIds?.length||outbox.some(o=>o.auditId===audit.id&&o.status!=='cancelled')))return r;
   changed=true;return {...r,status:'pending',payload:r.recoveryPayload,retries:(r.retries||0)+1};
  });
  if(changed){setRows(rows);save();}return changed;
 }
 return {capture,batches,acknowledge,quarantine,reconcile};
}
