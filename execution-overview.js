import {redactInvocation} from './invocation-journal.js';

const terminalFailure = new Set(['failed', 'error', 'cancelled']);
const pending = new Set(['pending', 'waiting_service', 'queued', 'sending', 'started', 'submitted', 'running']);
const labels = {unknown:'结果待核对', failed:'未完成', partial:'部分步骤未完成', running:'处理中', queued:'等待发送',
  generated:'媒体已生成，尚无发送回执', observed:'已在 QQ 记录读回', accepted:'QQ 已接收，等待读回',
  returned:'已返回结果，未记录 QQ 发送', silent:'本轮未发送消息'};
const str = value => String(value ?? '');
const scopeKey = row => JSON.stringify([str(row.accountId), str(row.personaId ?? row.persona)]);
const joinKey = (row, id) => scopeKey(row) + ':' + str(id);
const sameScope = (a,b) => scopeKey(a) === scopeKey(b) && !!str(a.personaId ?? a.persona);

// Read-only projection. Never infer an association from proximity in time, text,
// model, or destination: simultaneous private/group/background turns overlap.
export function executionOverview({audits=[], records=[], mediaTasks=[], videoJobs=[], outbox=[], accountId='', allowed=()=>true,
  backend='', kind='', cost=()=>null, limit=80}={}) {
  const visible = row => str(row.accountId)===str(accountId) && allowed(str(row.chat));
  const groups = new Map(), auditMap = new Map(), taskMap = new Map();
  const ensure = (key,row,audit=null) => {
    if(!groups.has(key)) groups.set(key,{id:key, auditId:audit?.id||'', accountId:row.accountId,
      personaId:row.personaId??row.persona??'', chat:row.chat||'', at:Number(row.at)||0,
      updatedAt:Number(row.updatedAt||row.endedAt||row.at)||0, audit, records:[], tasks:[], deliveries:[]});
    return groups.get(key);
  };
  for(const a of audits.filter(visible)) {
    const group=ensure('request:'+joinKey(a,a.id),a,a);
    if(a.persona||a.personaId) auditMap.set(joinKey(a,a.id),group);
  }
  const byAudit = row => row.auditId && auditMap.get(joinKey(row,row.auditId));
  const videos=videoJobs.flatMap(job=>{
    try{
      const scope=JSON.parse(job.scope);if(!scope||!scope.personaId||!scope.chat||scope.delivery==='local-outbox')return [];
      const status=job.status==='pending_check'?'unknown':job.status==='delivery_pending'?'generated':
        ['generated','queued','sent','failed','cancelled'].includes(job.status)?job.status:'pending';
      return [{...scope,id:job.id,auditId:job.auditId||'',kind:'video',backend:job.backend,status,at:job.at,updatedAt:job.updatedAt,file:job.file,deliveryId:job.deliveryId,error:job.error}];
    }catch{return [];}
  });
  for(const task of [...mediaTasks,...videos].filter(visible)) {
    const group=byAudit(task)||ensure('media:'+joinKey(task,task.id),task);
    group.tasks.push(task);taskMap.set(joinKey(task,task.id),group);
  }
  for(const job of outbox.filter(visible)) {
    const taskGroup=job.mediaTaskId && taskMap.get(joinKey(job,job.mediaTaskId));
    const linkedTaskGroup=taskGroup && sameScope(job,taskGroup) ? taskGroup : [...groups.values()].find(g=>g.tasks.some(t=>t.deliveryId===job.id&&sameScope(t,job)));
    const group=byAudit(job)||linkedTaskGroup||ensure('delivery:'+joinKey(job,job.id),job);
    group.deliveries.push(job);
  }
  const uniqueRecords = new Map();
  for(const row of records.filter(visible)) {
    const key=joinKey(row,row.id),previous=uniqueRecords.get(key);
    if(!previous||Number(row.updatedAt||row.at)>=Number(previous.updatedAt||previous.at))uniqueRecords.set(key,row);
  }
  for(const row of uniqueRecords.values()) {
    const taskId=row.arguments?.mediaTaskId,taskGroup=taskId&&taskMap.get(joinKey(row,taskId));
    const group=byAudit(row)||(taskGroup&&sameScope(row,taskGroup)?taskGroup:null)||ensure('call:'+joinKey(row,row.id),row);
    group.records.push(row);
  }
  return [...groups.values()].filter(g=>{
    const matches=g.records.some(r=>(!backend||r.backend===backend)&&(!kind||r.kind===kind)) ||
      g.tasks.some(t=>(!backend||t.backend===backend)&&(!kind||(t.kind==='voice'?'speech':t.kind)===kind));
    return !backend&&!kind || matches;
  }).map(g=>{
    const a=g.audit, rows=g.records, tasks=g.tasks, jobs=g.deliveries;
    const isSent=j=>j.status==='sent'&&!!j.messageId;
    const unknown=jobs.some(j=>j.status==='unknown'||j.status==='sent'&&!j.messageId)||tasks.some(t=>t.status==='unknown');
    const failures=[...(a&&terminalFailure.has(a.status)?[a]:[]),...jobs.filter(j=>terminalFailure.has(j.status)),...tasks.filter(t=>terminalFailure.has(t.status))];
    const sent=jobs.filter(isSent);
    let state=unknown?'unknown':failures.length?(sent.length?'partial':'failed'):
      tasks.some(t=>['pending','waiting_service'].includes(t.status))||a&&['queued','running'].includes(a.status)?'running':
      jobs.some(j=>pending.has(j.status))?'queued':
      tasks.some(t=>!jobs.some(j=>j.mediaTaskId===t.id||j.id===t.deliveryId))?'generated':
      rows.some(r=>pending.has(r.status))?'running':
      jobs.length&&sent.length===jobs.length?(sent.every(j=>j.verification?.state==='observed')?'observed':'accepted'):
      !a&&rows.length&&rows.every(r=>terminalFailure.has(r.status))?'failed':a?.status==='silent'?'silent':'returned';
    // A retained task without a delivery record is not evidence of completion.
    if(state==='generated'&&tasks.some(t=>t.status==='sent'||t.status==='queued'))state='unknown';
    const steps=[];
    if(a)steps.push({id:'input:'+a.id,type:'input',at:a.at,label:'收到请求',status:a.status,text:a.userWords||a.input||''});
    for(const r of rows)steps.push({id:'call:'+r.id,type:'invocation',recordId:r.id,at:r.at,label:r.purpose||r.tool||'执行工具',status:r.status,backend:r.backend,model:r.actualModel||r.model||'',error:r.error||''});
    for(const t of tasks)steps.push({id:'media:'+t.id,type:'media',at:t.updatedAt||t.at,label:({image:'图片',voice:'语音',speech:'语音',video:'视频'}[t.kind]||'媒体')+'任务',status:t.status,file:t.file||'',error:t.error||''});
    for(const j of jobs)steps.push({id:'delivery:'+j.id,type:'delivery',at:j.updatedAt||j.sentAt||j.at,label:'发送至 '+j.chat,status:j.status,messageId:j.messageId||'',
      verification:j.verification?.state||'',error:j.error||'',text:(j.segments||[]).map(s=>s.type==='text'?s.data?.text:'['+s.type+']').join('').slice(0,2000)});
    const billable=rows.filter(r=>r.backend==='api'&&(r.tool==='model.complete'||r.tool==='chat.reply'||(!r.id.startsWith('media-task:')&&['image','speech','video'].includes(r.kind))));
    let estimated=0,priced=0;
    for(const r of billable){if(!r.usage)continue;const amount=cost(r.usage,r.at);if(Number.isFinite(amount)&&amount>=0){estimated+=amount;priced++;}}
    const timestamps=[g.at,g.updatedAt,...rows.map(r=>r.updatedAt||r.at),...tasks.map(t=>t.updatedAt||t.at),...jobs.map(j=>j.updatedAt||j.sentAt||j.at)].map(Number).filter(Number.isFinite);
    return {id:g.id,auditId:g.auditId,chat:g.chat,personaId:g.personaId,at:g.at,updatedAt:Math.max(0,...timestamps),
      state,label:labels[state],input:a?.userWords||a?.input||rows.find(r=>r.input)?.input||'',output:a?.answer||'',
      sources:a?.sources||null,linked:!!a,recordIds:rows.map(r=>r.id),steps:steps.sort((x,y)=>(Number(x.at)||0)-(Number(y.at)||0)),
      failedCalls:rows.filter(r=>terminalFailure.has(r.status)).length,
      cost:{estimated,priced,unpriced:billable.length-priced,basis:'按插件现有 token 单价估算；未上报用量的媒体费用另计'},
      recipient:'unknown',coverage:'仅汇总仍保留的记录；缺少记录不代表未执行，QQ 回执或读回也不代表对方已读'};
  }).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,limit).map(redactInvocation);
}
