import {sharingExpression} from './api-initiative.js';
import {CONTINUATION_RULE} from './life-execution.js';
import {assertScheduleReading,SCHEDULE_READING_RULE,scheduleReadingEvidence} from './schedule-reading.js';

/** Local-only autonomous turn. The host supplies the same checked tools as QQ,
 * but this cue is never logged or authorized as a human request. */
export const LOCAL_AUTONOMY_RULES='【本地自主行动】现在没有用户新消息。以下是你自己的活动提示，不是号主命令。不必逐项汇报，也不用为了回复而找话。结合人设、日程与真实记忆选择是否行动；没有想做的事可只返回[skip]。需要看视频、读网页、画画或分享时实际调用工具，拿到真实结果再形成感想，不能把打开页面、计划或口头承诺说成已经完成。先用bridge_tools发现工具及参数。继续保留付款确认、评论开关、白名单、睡眠与空间开关；空间只在今天获准的提醒机会或明确安排中考虑，不反复刷评论。能后台完成就后台操作，不反复刷新视频页面。用户消息到来立即让路。日程任务结束时用bridge_life_finish根据真实证据记录，没完成就保留进度，不冒充完成。已经用工具发到QQ的内容不要在最终回复重复，末尾用[skip]；不需要分享时也用[skip]。';
export const LOCAL_LIFE_ACTION_RULES='【日程实际行动】推进当前任务，不重排计划代替执行。先发现工具及schema，按真实能力寻找可行方法。bridge_life_adjust mode=start记录开始；有理由改计划用mode=plan。视频要实际播放观察，游戏要实际操作；画画优先bridge_drawing真实画布，明确要AI生图才用bridge_art；听歌要取得实际音频。未知结果先核对，不重复发送或发布。切换前用bridge_life_checkpoint保存进度和下一步，作品用bridge_life_artifact登记。付款核对收款方、金额、币种后通过bridge_life_request等本人同意；登录与普通操作不逐项申请，评论保留独立开关。想聊天分享用bridge_life_qq或bridge_life_share并核对回执；工具已发出的正文不再重复。计划不是经历；只有实际证据可标记完成，结束用bridge_life_finish，未完成如实记进度。';

export async function executeLocalAutonomy({context,run,assertCurrent,guardTool,record=()=>{},deliver=()=>{},finish=()=>{},getLifeJob=()=>context.lifeJob}){
 let reason='completed',failure,finalBody='';
 const invocation={id:context.id,tool:'local_autonomy',kind:'tool'};
 try{
  assertCurrent();
  const messages=[{role:'system',content:context.persona,_localContextKind:'persona'},
   {role:'system',content:LOCAL_AUTONOMY_RULES+'\n'+(context.lifeJob?LOCAL_LIFE_ACTION_RULES+CONTINUATION_RULE+'\n'+SCHEDULE_READING_RULE+'\n当前任务的程序阅读证据：'+JSON.stringify(scheduleReadingEvidence(context.lifeJob)):context.rules||'')+'\n'+sharingExpression({recent:(context.history||[]).filter(row=>row.role==='assistant').map(row=>row.content)}),_localContextKind:'instruction'},
   ...(context.recipient?[{role:'system',content:context.recipient,_localContextKind:'identity'}]:[]),
   ...(context.history||[]),{role:'user',content:'【自主活动提示，不是用户消息】\n'+context.cue+(context.lifeJob?'\n当前任务与真实进度：'+JSON.stringify(context.lifeJob):'')}];
  record({...invocation,status:'started',arguments:{messages}});
  const response=await run({messages,origin:'initiative',turnContext:{...context.turnContext,toolsEnabled:true,autonomous:true,expectAction:context.expectAction===true},signal:context.signal,
   guardTool:async(name,args,execute)=>{assertCurrent();const result=await guardTool(name,args,execute);assertCurrent();return result;},
   onEvent:event=>{if(event.event==='invocation'||event.type==='invocation')record(event.record);}});
  assertCurrent();
  const result=response.body;finalBody=String(result?.text||'');
  for(const row of result?.invocations||[])record(row);
  if(!response.ok)throw Error(result?.error?.message||result?.error||'本地主动任务没有完成');
  if(result?.error)throw Error(result.error);
  const failures=(result?.receipts||[]).filter(r=>!r.ok&&!r.informational&&!r.rejected&&!(result?.continuation&&r.limited));
  if(failures.length)throw Error(failures.map(r=>r.error||'工具没有完成').join('；'));
  if(context.lifeJob&&result?.continuation?.reason==='tool-budget'){
   reason='yielded';failure={code:'LOCAL_TASK_YIELD',continuation:result.continuation};
  record({...invocation,status:'deferred',result:{continuation:result.continuation,receipts:result.receipts||[]}});
   return {ok:true,pending:true,continuation:result.continuation};
  }
  if(context.expectAction&&(result?.text||'').trim()!=='[skip]'&&!result?.receipts?.some(r=>r.ok&&!r.informational&&!r.rejected)&&!result?.attachments?.length)throw Object.assign(Error('主动活动没有实际工具执行回执，未把口头描述当成完成结果'),{code:'LOCAL_ACTION_MISSING'});
  // Deliver only actual returned content, never synthesize a completion claim.
  if(context.lifeJob)assertScheduleReading(result?.text,getLifeJob());
  await deliver(result||{});
  record({...invocation,status:'returned',result:{receipts:result?.receipts||[],text:result?.text||'',attachments:result?.attachments||[]}});
  return {ok:true,receipts:result?.receipts||[]};
 }catch(error){failure=error;reason=error.name==='AbortError'?'cancelled':'failed';record({...invocation,status:reason,error:String(error.message)});throw error;}
 finally{await finish(reason,failure,{body:finalBody});}
}
