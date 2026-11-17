// Jobs are provided from the host's account/persona-scoped execution ledger.
export function initiativeGrounding(jobs=[],now=Date.now()){
 const recent=jobs.filter(j=>Math.max(Number(j.updatedAt)||0,Number(j.endedAt)||0,...(j.evidence||[]).map(e=>Number(e.at)||0))>now-86400000).slice(-4);
 const rows=recent.map(j=>({task:String(j.scene?.activity||'').slice(0,120),status:j.status,completed:j.actuallyCompleted===true,evidence:(j.evidence||[]).filter(e=>e.ok===true&&e.substantive===true).slice(-3).map(e=>({tool:e.tool,coverage:String(e.coverage||'').slice(0,160),file:e.file,url:e.url,complete:e.complete===true,partial:e.partial===true}))}));
 return '【实际执行依据】'+JSON.stringify(rows)+'\n只有这里的成功步骤支持对应的实际操作；页面文字不证明听过音频，查看文件不证明已修改或整理。旧聊天自述不能作为已完成证据。没有对应结果时可以表达想法、期待或去实际尝试，不虚构发现、数量和已完成经历；有情绪或新想法仍可自然主动开口。';
}
