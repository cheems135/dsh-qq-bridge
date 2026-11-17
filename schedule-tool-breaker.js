import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {LOG_RETENTION_MS} from './log-retention.js';

export const SCHEDULE_TOOL_RULE='【日程工具失败暂停】自主日程执行期间，同一账号、人设和日程时段内，同一个工具累计实际失败超过3次（第4次失败）后，本时段停止调用这个工具。不能通过改参数、换动作、重开回合或改日程标题继续重试。其他工具仍可使用；到下一日程时段确实需要它时才可再次调用，不自动补跑失败动作。用户新发起的聊天请求不继承自主日程的暂停记录；这不代表接口被限流。取消、尚在处理和被暂停拦截不算新的实际失败。';
export function scheduleToolScope(scope,meta){
 return meta?.kind==='user'?null:scope;
}
export function scheduledToolName(name,args={}){
 if(['bridge_tools','bridge_native'].includes(name)&&args.action==='call'&&typeof args.name==='string')return scheduledToolName(args.name,args.arguments||{});
 return String(name||'unknown').slice(0,160);
}
export function toolFailed(value){
 if(!value||typeof value!=='object')return false;
 return value.ok===false||value.isError===true||value.status==='failed'||value.status==='error'||value.value?.ok===false||value.value?.isError===true;
}
const cancelled=e=>e?.name==='AbortError'||['ABORT_ERR','SCHEDULE_TOOL_PAUSED'].includes(e?.code);
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function identity(scope){
 if(!scope?.personaId||!scope.date||!scope.start||!scope.end)return null;
 return hash([scope.accountId||'',scope.personaId,scope.date,scope.start]);
}
export function createScheduleToolBreaker({storage={read:()=>null,write:()=>{}},now=Date.now,onEvent=()=>{}}={}){
 let rows=storage.read()?.rows||[];
 if(!Array.isArray(rows))throw Error('日程工具失败记录格式不正确');
 const locks=new Map(),active=new AsyncLocalStorage();
 function save(){rows=rows.filter(r=>r.at>=now()-LOG_RETENTION_MS).sort((a,b)=>b.at-a.at).slice(0,600);storage.write({version:1,rows});}
 function prune(){const old=rows.length;rows=rows.filter(r=>r.at>=now()-LOG_RETENTION_MS);if(rows.length!==old)save();return old-rows.length;}
 function emit(event){try{onEvent(event);}catch{}}
 function snapshot(scope){const id=identity(scope);return rows.filter(r=>r.scopeId===id).map(r=>({...r,paused:r.failures>3}));}
 async function run(scopeOrRead,name,args,execute){
  const read=()=>typeof scopeOrRead==='function'?scopeOrRead():scopeOrRead,initial=read(),id=identity(initial),tool=scheduledToolName(name,args);
  if(!id)return execute();
  const key=id+':'+tool;
  if(active.getStore()?.has(key))return execute();
  const prior=locks.get(key)||Promise.resolve();let release;const lock=new Promise(r=>release=r);locks.set(key,lock);
  await prior;
  try{
   const scope=read();if(identity(scope)!==id)return run(scopeOrRead,name,args,execute);
   let row=rows.find(r=>r.scopeId===id&&r.tool===tool);
   if(row?.failures>3){
    const message=`${tool} 在当前日程已累计失败 ${row.failures} 次，这个时段先停下；下一个日程需要时再尝试。`;
    emit({status:'blocked',tool,scope,failures:row.failures,message});
    throw Object.assign(Error(message),{code:'SCHEDULE_TOOL_PAUSED',failures:row.failures});
   }
   const fail=error=>{
    if(cancelled(error))return;
    if(!row){row={scopeId:id,tool,failures:0,at:now(),scope:{accountId:scope.accountId||'',personaId:scope.personaId,date:scope.date,start:scope.start,end:scope.end}};rows.push(row);}
    row.failures++;row.at=now();row.lastError=String(error?.message||error||'工具返回失败').slice(0,500);save();
    emit({status:'failed',tool,scope,failures:row.failures,paused:row.failures>3,message:row.lastError});
   };
   const set=new Set(active.getStore()||[]);set.add(key);
   return await active.run(set,async()=>{
    let value;
    try{value=await execute();}catch(error){fail(error);throw error;}
    if(toolFailed(value))fail(Error(String(value.error||value.value?.error||value.message||'工具返回失败')));
    return value;
   });
  }finally{release();if(locks.get(key)===lock)locks.delete(key);}
 }
 return {run,snapshot,prune};
}
