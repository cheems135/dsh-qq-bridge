import {existsSync,lstatSync,readFileSync,writeFileSync,readdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
export const LOG_RETENTION_MS=7*24*60*60*1000;
const ACTIVE=new Set(['started','submitted','queued','processing','sending','running','waiting_user','unknown','pending']);
export function recordTime(row){for(const key of ['updatedAt','recordedAt','endedAt','at','time','startedAt']){const v=row?.[key],n=typeof v==='number'?v:Date.parse(v);if(Number.isFinite(n)&&n>0)return n;}return 0;}
export function recentRecords(rows=[],now=Date.now(),{preserveActive=false}={}){return rows.filter(row=>preserveActive&&ACTIVE.has(row.status)||!recordTime(row)||recordTime(row)>=now-LOG_RETENTION_MS);}
// Only diagnostic collections are eligible. Messages, memories, plans and delivery
// queues remain intact, including receipts required to avoid replaying side effects.
export function pruneDiagnosticState(state,now=Date.now()){
 let removed=0;for(const key of ['bridgeIssues','invocations','audits','operations','modelRoutes','deviceActivity','apiTaskResults','qqSendTasks'])if(Array.isArray(state[key])){const rows=state[key],next=recentRecords(rows,now);removed+=rows.length-next.length;state[key]=next;}
 return removed;
}
export function pruneLogFile(file,{now=Date.now(),jsonl=false}={}){
 if(!existsSync(file)||lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile())return 0;
 const text=readFileSync(file,'utf8'),cutoff=now-LOG_RETENTION_MS;let keep=lstatSync(file).mtimeMs>=cutoff,removed=0;const kept=[];
 for(const line of text.split(/(?<=\n)/u)){
  if(!line)continue;
  let at=0;
  if(jsonl){try{at=recordTime(JSON.parse(line));}catch{}}
  else{const m=line.match(/^\[?(\d{4}-\d{2}-\d{2}T[^\]\s]+)/);if(m)at=Date.parse(m[1]);}
  if(Number.isFinite(at)&&at>0)keep=at>=cutoff;
  if(keep)kept.push(line);else removed++;
 }
 if(removed)writeFileSync(file,kept.join(''));
 return removed;
}
export function pruneOperationLogs(dir,{now=Date.now()}={}){
 if(!existsSync(dir)||lstatSync(dir).isSymbolicLink())return 0;
 let removed=0;for(const name of readdirSync(dir))if(/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)){
  const file=join(dir,name);if(lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile())continue;
  removed+=pruneLogFile(file,{now,jsonl:true});
  if(lstatSync(file).size===0&&Date.parse(name.slice(0,10)+'T23:59:59+08:00')<now-LOG_RETENTION_MS)unlinkSync(file);
 }
 return removed;
}
