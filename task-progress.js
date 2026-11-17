// Accept service receipts, never a model's prose claim that work is running.
export function serviceTaskEvidence(raw,tool='',now=Date.now()){
 const value=raw?.value??raw;if(!value||typeof value!=='object')return null;
 const data=value.data&&typeof value.data==='object'?value.data:value;
 const taskId=String(value.taskId||value.promptId||data.taskId||data.promptId||'').slice(0,160);
 const status=String(value.status||value.state||data.status||data.state||(value.queued===true?'queued':'')).toLowerCase();
 if(!taskId)return null;
 const state=/^(queued|pending|running|processing|waiting|waiting_service|downloading|accepted)$/.test(status)?'waiting':/^(success|succeeded|completed|complete|done|sent)$/.test(status)?'completed':/^(failed|error|cancelled|canceled)$/.test(status)?'failed':'';
 if(!state)return null;
 if((value.ok===false||value.error)&&state!=='failed')return null;
 const deadline=Number(value.deadlineAt||data.deadlineAt);
 return {taskId,tool,state,status,observedAt:now,deadlineAt:Number.isFinite(deadline)&&deadline>0?deadline:now+15*60000};
}
export function latestTaskWait(job,now=Date.now()){
 const tasks=new Map();for(const s of job.steps||[]){const t=s.evidence?.serviceTask;if(t?.taskId)tasks.set(t.taskId,t);}
 const pending=[...tasks.values()].filter(t=>t.state==='waiting').sort((a,b)=>a.observedAt-b.observedAt);
 return pending.length?{...pending[0],expired:now>=pending[0].deadlineAt}:null;
}
