import {redactInvocation} from './invocation-journal.js';

// Generation and QQ delivery are different stages of the same media task.
// A text receipt must never turn a failed image/voice generation into success.
export function mediaExecutionSummary(tasks=[],outbox=[]){
 const items=tasks.map(task=>{const job=outbox.find(j=>j.id===task.deliveryId||j.mediaTaskId===task.id),status=job?.status||task.status,verification=job?.verification||task.verification;return {id:task.id,kind:task.kind,status,stage:job?'delivery':['pending','waiting_service'].includes(status)?'generation':status==='generated'?'generated':'generation',deliveryId:job?.id||task.deliveryId||'',messageId:job?.messageId||'',observed:verification?.state==='observed',recipient:verification?.recipient||'unknown',error:String(job?.error||task.error||'').slice(0,500)};});
 let state='none';if(items.length){const sent=items.filter(i=>i.status==='sent'),failed=items.filter(i=>['failed','cancelled'].includes(i.status));state=items.some(i=>i.status==='unknown')?'unknown':failed.length?(sent.length?'partial':'failed'):items.some(i=>i.status!=='sent')?'pending':items.every(i=>i.observed)?'observed':'accepted';}
 return {state,items,completed:state==='observed'||state==='accepted',recipient:'unknown',failures:items.filter(i=>['failed','cancelled','unknown'].includes(i.status))};
}
export function speechSourceReadiness({enabled=true,source='legacy',desktop=true,localVoice=true,engine='none',profile}={}){
 if(!enabled)return {available:false,reason:'当前对话的语音发送已关闭'};
 if(source==='local')return desktop&&localVoice?{available:true,reason:''}:{available:false,reason:desktop?'本地语音已关闭':'手机版仅支持 API 语音'};
 if(source.startsWith('profile:'))return profile?.type==='openai'&&!!profile.speechModel&&!!profile.voice?{available:true,reason:''}:{available:false,reason:'所选语音 API 尚未配置模型或音色'};
 return engine&&engine!=='none'?{available:true,reason:''}:{available:false,reason:'语音开关已开启，但尚未选择语音服务；请在语音或连接与搭配页选择来源'};
}

export function videoMediaTasks(videoJobs) {
  return videoJobs.flatMap(job => {
    let scope;
    try { scope=JSON.parse(job.scope); } catch { return []; }
    if (!scope?.personaId || !scope.chat || scope.delivery==='local-outbox') return [];
    const status=job.status==='pending_check'?'unknown':job.status==='delivery_pending'?'generated':
      ['generated','queued','sent','failed','cancelled'].includes(job.status)?job.status:job.remote?'waiting_service':'pending';
    return [{...scope,id:job.id,auditId:job.auditId||'',kind:'video',backend:job.backend,status,
      at:job.at,updatedAt:job.updatedAt,file:job.file,deliveryId:job.deliveryId,error:job.error}];
  });
}

// A task's registration is local. Only a correlated QQ acknowledgement proves platform acceptance.
export function mediaConversationFacts({mediaTasks,videoJobs,outbox,scope,since,now}) {
  const matches=row=>row.accountId===scope.accountId && row.personaId===scope.personaId && row.chat===scope.key;
  const tasks=[...mediaTasks,...videoMediaTasks(videoJobs)].filter(matches);
  if (!tasks.length) return [];
  const byId=new Map(), byTask=new Map();
  for (const job of outbox) {
    if (!matches(job)) continue;
    if (job.id) byId.set(job.id,job);
    if (job.mediaTaskId) byTask.set(job.mediaTaskId,job);
    if (job.deliveryKey?.startsWith('video:')) byTask.set(job.deliveryKey.slice(6),job);
  }
  const facts=[];
  for (const task of tasks) {
    if (!task.id) continue;
    const delivery=byTask.get(task.id)||byId.get(task.deliveryId);
    const at=Math.max(Number(task.updatedAt||task.at)||0,Number(delivery?.updatedAt||delivery?.at)||0);
    if (at<=since || at>now) continue;
    let status=delivery?.status||task.status;
    if (status==='sent') {
      const receipt=delivery||task;
      status=!receipt.messageId?'unknown':receipt.verification?.state==='observed'?'observed':'accepted';
    } else if (status==='pending') status='registered';
    const fact={tool:'media.'+task.kind,taskId:task.id,at,status};
    if (delivery?.id || task.deliveryId) fact.deliveryId=delivery?.id||task.deliveryId;
    const error=delivery?.error||task.error;
    if (error && ['unknown','failed','cancelled'].includes(status)) fact.error=redactInvocation(String(error)).slice(0,140);
    facts.push(fact);
  }
  return facts;
}
