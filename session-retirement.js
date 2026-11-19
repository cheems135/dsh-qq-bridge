import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const RETAINED_CONVERSATION_SESSIONS=5;
const sameConversation=(a,b)=>a?.accountId===b.accountId&&a?.personaId===b.personaId&&a?.key===b.key;

export function retainedConversationIds(rows,scope,currentId){
  const ids=new Set(currentId?[currentId]:[]);
  const recent=rows.filter(row=>sameConversation(row,scope)).toReversed().sort((a,b)=>(Number(b.at)||0)-(Number(a.at)||0));
  for(const row of recent){
    if(ids.size>=RETAINED_CONVERSATION_SESSIONS)break;
    if(row.previousId)ids.add(row.previousId);
  }
  return ids;
}

export function precedingConversationSessions(rows,currentId){
  const bySuccessor=new Map();
  for(const row of rows)if(row.previousId&&row.currentId)bySuccessor.set(row.currentId,row);
  const seen=new Set([currentId]),result=[];
  for(let row=bySuccessor.get(currentId);row&&!seen.has(row.previousId);row=bySuccessor.get(row.previousId)){
    seen.add(row.previousId);
    result.push(row);
  }
  return result;
}

export function verifiedConversationArchive(archive,scope,id){
  if(!archive||typeof archive!=='object')return false;
  const {sha256,storedAt,...payload}=archive;
  return archive.version===1&&sameConversation(archive.scope,scope)&&archive.sessionId===id&&archive.header?.id===id&&
    Array.isArray(archive.events)&&digest(payload)===sha256;
}

// A summary is not a complete archive. Read back the full transcript before removal.
export async function retireConversation({previousId,currentId,scope,readSession,storage,preserveMessages,remove,isProtected=()=>false,now=Date.now}){
 if(!previousId||previousId===currentId||isProtected(previousId))return {status:'skipped',reason:'当前会话、运行中的任务或没有上一会话'};
 const source=await readSession(previousId);
 if(source===null)return {status:'absent',reason:'上一会话已不存在，没有删除其他会话'};
 if(!source?.header||source.header.id!==previousId||!Array.isArray(source.events))throw Error('旧对话原始资料不完整，保留旧对话');
 const file='session-'+digest([scope,previousId])+'.json',payload={version:1,scope,sessionId:previousId,header:source.header,events:source.events};
 const hash=digest(payload);storage.write(file,{...payload,sha256:hash,storedAt:now()});
 const restored=storage.read(file),{sha256,storedAt,...contents}=restored;
 if(sha256!==hash||digest(contents)!==hash)throw Error('记忆存档读回校验失败，保留旧对话');
 if(await preserveMessages()!==true)throw Error('原话记忆未确认完整保存，保留旧对话');
 if(previousId===currentId||isProtected(previousId))return {status:'preserved',reason:'存档完成后状态改变，未清理对话',file};
 const result=await remove(previousId);
 return {status:'retired',mode:result?.mode||'deleted',file,sha256:hash,eventCount:source.events.length};
}
