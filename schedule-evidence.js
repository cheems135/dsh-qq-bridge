export const TASK_MEMORY_RULE='【任务事实核对】日程、愿望和角色说“做完了”都不是完成证据。任务必须区分计划未执行、执行中、已核对完成、失败、已暂停和结果待核实。只有程序提供 actuallyCompleted=true 且有真实结果回执才可写成已完成；关闭实际任务时只能记录计划。模型卸载、等待推理、心跳延迟和设备离线都不等于角色睡眠，不能补写已睡过或已执行。';
export function taskCompletion(job){
 if(!job)return {executionStatus:'not_executed',actuallyCompleted:false};
 const unresolved=(job.steps||[]).some(s=>!s.idempotent&&['started','unknown'].includes(s.status));
 const verified=job.status==='completed'&&!unresolved&&(job.evidence||[]).some(e=>e.ok===true&&e.substantive===true);
 return {executionStatus:verified?'verified_completed':unresolved||job.status==='completed'?'unknown':['queued','running','participating'].includes(job.status)?'in_progress':job.status==='failed'?'failed':['paused','interrupted','incomplete','needs_reconcile'].includes(job.status)?'paused':'not_executed',actuallyCompleted:verified,taskId:job.id};
}
const labels={not_executed:'计划未执行',in_progress:'执行中，未确认完成',verified_completed:'已核对完成',unknown:'结果待核实',paused:'已暂停，未确认完成',failed:'执行失败'};
export function taskEvent(body,sources){
 const rows=sources.filter(s=>s.executionStatus);if(!rows.length)return {};
 const status=rows.every(s=>s.executionStatus===rows[0].executionStatus)?rows[0].executionStatus:'unknown';
 const actuallyCompleted=status==='verified_completed'&&rows.every(s=>s.actuallyCompleted===true);
 const executionStatus=actuallyCompleted?'verified_completed':status==='verified_completed'?'unknown':status;
 const source=rows[0],content=!actuallyCompleted&&source.taskDescription?source.taskDescription:String(body).replace(/^【(?:计划未执行|执行中，未确认完成|已核对完成|结果待核实|已暂停，未确认完成|执行失败)】/,'');
 return {executionStatus,actuallyCompleted,text:'【'+(labels[executionStatus]||labels.unknown)+'】'+content};
}
export const offlineSlot=slot=>slot?.offline===true||/^离线(?:睡眠|休息)/.test(String(slot?.activity||''));
