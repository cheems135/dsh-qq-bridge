import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
