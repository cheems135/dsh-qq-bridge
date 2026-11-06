import {randomUUID} from 'node:crypto';

const phases=new Set(['preparing','waiting_gpu','waiting_comfy','model','understanding','vision','image_prompt','speech','tool','tool_done','repair','repaired','context','complete']);
const origins=new Set(['qq','preview','api','speech','analysis']);

// Transient metadata only: no prompts, chat text, account IDs or tool arguments.
export function createLocalRunStatus({now=Date.now,limit=12}={}) {
  const active=new Map(),recent=[];const startedAt=now();
  const publicRow=row=>({...row,elapsedMs:Math.max(0,(row.finishedAt||now())-row.startedAt)});
  return {
    start(kind='turn',origin='api'){
      const row={id:randomUUID(),kind,origin:origins.has(origin)?origin:'api',status:'running',phase:'preparing',startedAt:now(),updatedAt:now(),round:0,tools:0};active.set(row.id,row);return row.id;
    },
    update(id,event={}){
      const row=active.get(id);if(!row)return;
      if(phases.has(event.phase))row.phase=event.phase;
      if(origins.has(event.origin))row.origin=event.origin;
      if(['quality','speed'].includes(event.priority))row.priority=event.priority;
      if(['dialogue','tools'].includes(event.mode))row.mode=event.mode;
      if(event.mediaTask)row.mediaTask={source:['direct','followup','semantic','unresolved','none'].includes(event.mediaTask.source)?event.mediaTask.source:'none',requested:(event.mediaTask.requested||[]).filter(kind=>['image','speech','video'].includes(kind)),ambiguous:event.mediaTask.ambiguous===true};
      if(Number.isFinite(event.outputTokens))row.outputTokens=Math.max(32,Math.min(32768,event.outputTokens));
      if(event.features&&typeof event.features==='object')row.features=Object.fromEntries(['memory','meme','learning','expression','mood','intent','life','pending'].filter(key=>Number(event.features[key])>0).map(key=>[key,Math.min(100,Number(event.features[key]))]));
      if(Number.isInteger(event.round))row.round=event.round+1;
      if(event.tool)row.tool=String(event.tool).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,80);
      if(event.phase==='tool_done')row.tools++;
      if(event.phase==='repair')row.repairReason=String(event.reason||'repetition').slice(0,60);
      if(event.phase==='repaired')row.repaired=true;
      if(event.context){
        const data=event.context;
        row.context={limit:Number(data.limit)||0,inputEstimate:Number(data.inputEstimate)||0,inputBudget:Number(data.inputBudget)||0,droppedMessages:Number(data.droppedMessages)||0,reset:row.context?.reset===true||data.reset===true,mode:String(data.mode||'normal'),continuity:data.continuity===true,retainedMessages:Number(data.retainedMessages)||0,recentReserve:Number(data.recentReserve)||0,promptCompacted:row.context?.promptCompacted===true||data.promptCompacted===true,personaCompacted:row.context?.personaCompacted===true||data.personaCompacted===true,compactedSections:(data.compactedSections||[]).filter(kind=>['protocol','memory','repetition','receipts','observation','persona'].includes(kind)),systemEstimate:Number(data.systemEstimate)||0,userEstimate:Number(data.userEstimate)||0,protocolEstimate:Number(data.protocolEstimate)||0,...(data.node?{node:{used_tokens:Number(data.node.used_tokens)||0,context_limit:Number(data.node.context_limit)||0,trimmed_messages:Number(data.node.trimmed_messages)||0}}:{})};
      }
      row.updatedAt=now();
    },
    finish(id,{result,error,cancelled=false}={}){
      const row=active.get(id);if(!row)return;
      active.delete(id);row.finishedAt=now();row.updatedAt=row.finishedAt;row.phase='complete';
      row.status=cancelled?'cancelled':error?'failed':result?.partial||result?.receipts?.some(r=>!r.ok)?'partial':'succeeded';
      if(error)row.error=String(error?.message||error).replace(/data:[^\s]+|https?:\/\/\S+/g,'[地址]').slice(0,300);
      if(result){
        const receipts=result.receipts||[],attachments=result.attachments||[];
        row.result={textChars:String(result.text||'').length,spokenChars:String(result.spokenText||'').length,images:attachments.filter(a=>a.kind==='image').length,speech:attachments.filter(a=>a.kind==='speech').length,videos:attachments.filter(a=>a.kind==='video').length,toolsOk:receipts.filter(r=>r.ok).length,toolsFailed:receipts.filter(r=>!r.ok).length};
      }
      recent.unshift(row);recent.splice(limit);return publicRow(row);
    },
    snapshot(){return {startedAt,active:[...active.values()].map(publicRow),recent:recent.map(publicRow)};},
  };
}
