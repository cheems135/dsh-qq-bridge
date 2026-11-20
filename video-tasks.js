import {createHash,randomUUID} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function createVideoTasks({jobs,save,prepare,generate,deliver,authorize,record=()=>{},now=Date.now}){
 const pending=new Map();
 const visible=(job,c)=>job.scope===c.scope;
 function summary(job){return {id:job.id,status:job.status,taskId:job.remote?.id||job.remote?.task_id||job.remote?.taskId||'',file:job.file||'',deliveryId:job.deliveryId||'',error:job.error||'',seconds:job.seconds,at:job.at};}
 async function run(args,c){
  authorize(c);
  if(args.action==='status')return {ok:true,jobs:jobs().filter(j=>visible(j,c)).map(summary)};
  let job;
  if(args.action==='resume'){
   job=jobs().find(j=>j.id===args.id&&visible(j,c));if(!job)throw Error('当前对话没有这个视频任务');
   if(job.stamp!==c.stamp)throw Error('该视频任务的账号、人设或视频连接已改变，请先核对旧任务');
  }else{
   if(!String(args.prompt||'').trim())throw Error('请描述想生成的视频');
   const key=hash([c.scope,c.auditId||c.callId,args,c.stamp,c.generationOnly===true]);job=jobs().find(j=>j.key===key);
   if(!job){job={id:randomUUID(),key,scope:c.scope,stamp:c.stamp,auditId:c.auditId||'',args:{...args},status:'preparing',at:now()};jobs().push(job);save();}
  }
  c={...c,recordId:job.id};
  if(pending.has(job.id))return pending.get(job.id);
  const work=(async()=>{
   const check=()=>{c.signal?.throwIfAborted();authorize(c);if(c.currentStamp&&c.currentStamp()!==job.stamp)throw Error('视频生成期间账号、人设或连接已改变，旧结果未发送');};
   try{
    check();
    if(!job.prepared){const prepared=await prepare(job.args,c);check();job.prepared=prepared;job.seconds=prepared.seconds;save();record(job,'prepared');}
    if(!job.file){
     const result=await generate(job.prepared,{context:c,job:job.remote,assertCurrent:check,onJob:async value=>{job.remote=value;job.status=String(value.status||'pending');save();record(job,'progress');}});
     check();job.file=result.file;job.status='generated';save();record(job,'generated');
    }
    check();
    job.error='';
    if(c.generationOnly===true)return {ok:true,...summary(job),queued:false,coverage:'视频文件已生成，交由本地对话的可靠发送队列发送；此处没有重复入队'};
    if(!job.deliveryId){const id=await deliver(job,c);if(!id)throw Error('视频已生成，但没有进入QQ发送队列；可恢复此任务，不必重新生成');job.deliveryId=id;job.status='queued';save();record(job,'queued');}
    return {ok:true,...summary(job),coverage:'视频文件已实际生成并排入QQ持久发送队列；是否送达以发送记录的平台回执为准，不要再次发送同一文件'};
   }catch(error){job.status=job.file?'delivery_pending':job.remote?'pending_check':'failed';job.error=String(error.message||error);save();record(job,'failed');throw error;}
  })();pending.set(job.id,work);try{return await work;}finally{pending.delete(job.id);}
 }
 return {run};
}
export const VIDEO_PARAMETERS={type:'object',additionalProperties:false,properties:{action:{type:'string',enum:['generate','status','resume']},prompt:{type:'string',description:'完整视频需求，保留场景、构图和指定人物'},seconds:{type:'number',exclusiveMinimum:0,description:'整段视频的时长'},aspectRatio:{type:'string',description:'画幅，例如横屏 16:9，竖屏 9:16'},size:{type:'string',description:'兼容视频 API 的宽x高，RunningHub 不填此字段'},actionPrompt:{type:'string',description:'按时间写肢体动作、镜头变化、台词、环境声及收尾'},cameraMotion:{type:'string'},id:{type:'string',description:'resume使用status返回的当前对话任务ID'}},required:['action']};
