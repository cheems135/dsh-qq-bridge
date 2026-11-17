import {createHash} from 'node:crypto';
const clean=(v,n=240)=>String(v??'').replace(/[\u0000-\u0008]/g,'').trim().slice(0,n);
export function taskProgressSignature(job){
 const steps=[...new Set((job.steps||[]).filter(s=>s.status==='confirmed').map(s=>s.fingerprint||JSON.stringify([s.effect,s.target])))].sort();
 const evidence=[...new Set((job.evidence||[]).filter(e=>e.ok&&e.substantive).map(e=>JSON.stringify([e.tool,e.kind,e.file,e.sha256,e.url,e.coverage,e.status])))].sort();
 return createHash('sha256').update(JSON.stringify([steps,evidence])).digest('hex');
}
export function scheduleJobDetails(job){
 return {id:job.id,activity:job.scene?.activity||'',goal:job.scene?.goal||'',status:job.status,note:clean(job.note),reason:clean(job.reason),actuallyCompleted:job.actuallyCompleted===true,
  checkpoint:job.checkpoint?{summary:clean(job.checkpoint.summary,400),next:clean(job.checkpoint.next,300),at:job.checkpoint.at,safeToResume:job.checkpoint.safeToResume===true}:null,
  lastDispatchAt:job.lastDispatchAt||job.startedAt||0,dispatchCount:job.dispatchCount||0,nextDispatchAt:job.nextDispatchAt||0,
  steps:(job.steps||[]).slice(-8).map(s=>({id:s.id,tool:s.tool||'',effect:s.effect,target:clean(s.target,350),status:s.status,at:s.at,checkedAt:s.checkedAt,error:clean(s.evidence?.error),coverage:clean(s.evidence?.coverage,350),serviceTask:s.evidence?.serviceTask||null,verified:s.evidence?.verified===true,deliveryIds:s.evidence?.deliveryIds||[]})),
  evidence:(job.evidence||[]).filter(e=>e.ok&&e.substantive).slice(-3).map(e=>({kind:e.kind,tool:e.tool,url:e.url,coverage:clean(e.coverage)}))};
}
export function conversationScene(doc,now,planned,active=false){
 const c=doc.conversations?.at(-1);if(!c||!active&&c.until<=now)return null;
 return {...planned,activity:c.key.startsWith('group:')?'正在群聊中交流':'正在和你聊天',taskKind:'conversation',actual:true,planned:false,conversation:true,requested:true,
  date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(now)),startedAt:c.startedAt,until:c.until,key:c.key,topic:c.topic,status:c.status,
  goal:c.topic?'接续当前话题：'+c.topic:'接续当前对话',priorActivity:planned?.activity||'',coverage:'真实收到的聊天或平台已接收的回复；不代表原日程任务已完成'};
}
