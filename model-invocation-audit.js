import {randomUUID} from 'node:crypto';
import {redactInvocation} from './invocation-journal.js';
import {isProgressDelivery, deliveryMatchesAudit, replyDeliveryState} from './delivery-outbox.js';
export function recoverInterruptedChatAudits(audits=[],outbox=[],{accountId,keys=[],before=Date.now(),now=Date.now()}={}){
 const allowed=new Set(keys);let count=0;
 for(const audit of audits){
  if(audit.accountId!==accountId||!allowed.has(audit.chat)||!['queued','running'].includes(audit.status)||audit.at>=before)continue;
  const rows=outbox.filter(row=>deliveryMatchesAudit(row,audit));
  const formal=rows.filter(row=>!isProgressDelivery(row));
  audit.status='cancelled';audit.recoveredAt=now;audit.durationUnknown=true;
  audit.error='插件重新加载，上一轮未取得结束回执；已保留生成与发送记录，不自动重发';
  if(formal.length)audit.deliveryState=replyDeliveryState(formal,true);
  else if(rows.length){
    audit.deliveryState='unknown';
    audit.deliveryReason='仅找到等待提示的记录，尚无正式答复的 QQ 回执';
  }
  count++;
 }
 return count;
}
export function invocationErrorStatus(error){
 if(error?.code==='LOCAL_ANALYSIS_DEFERRED'||/^(?:聊天优先，后台分析等待空闲时段|后台本地分析暂缓：)/.test(String(error?.message||'')))return 'deferred';
 return error?.name==='AbortError'?'cancelled':'failed';
}
export function modelPurpose(system=''){
 const text=String(system);
 if(text.includes('【持续视听】'))return '持续视听理解与互动';
 const head=text.slice(0,130);
 if(/个人记忆整理|记忆检索扩展|记忆归档/.test(text))return '整理或检索记忆';
 if(/【日历分层记忆】/.test(text))return '归档日历记忆';
 if(/(?:一天一篇的私人日记|自主私人日记)/.test(head))return '撰写私人日记';
 if(/任务事实核对/.test(head))return '核对任务完成证据';
 if(/表达形式判断/.test(head))return '选择文字或媒体表达';
 if(/相处状态分析/.test(head))return '判断对话情绪';
 if(/对话记忆接续摘要/.test(head))return '整理上下文接续摘要';
 if(/后台自主行为选择/.test(head))return '选择主动行为';
 if(/有据学习/.test(head))return '整理学习资料';
 if(/操作前情境核对/.test(text))return '核对操作意图与表达';
 if(/角色参考图外观提取/.test(text))return '分析角色参考图';
 for(const [pattern,purpose]of [[/image art director|图像艺术指导|图片语言修正/i,'编写生图提示词'],[/图像细节核对|画面.*核对/,'核对生图要求'],[/日程|schedule|calendar/i,'规划或更新日程'],[/记忆|memory|归档/i,'整理或检索记忆'],[/情绪|mood/i,'判断对话情绪'],[/视频|video/i,'理解或规划视频'],[/人设|persona/i,'处理人设或对话资料']])if(pattern.test(text))return purpose;
 return '后台文字分析';
}
export async function auditModelCompletion({record,scope={},backend,provider='',model='',system='',input,run,now=Date.now}){
 const id='model:'+randomUUID(),at=now(),purpose=modelPurpose(system);let usage=null;
 record({id,at,tool:'model.complete',kind:'chat',status:'started',purpose,provider,model,backend,input,systemPrompt:system,executionSummary:'已发起模型请求，等待结果',billing:backend==='api'?'API 请求可能计费，以服务商账单为准':'本地推理，不通过桥接调用云端模型'},scope);
 try{const output=await run(value=>{usage=value;});record({id,status:'returned',output,usage,elapsedMs:now()-at,executionSummary:'模型已返回文字；这不等于媒体生成或 QQ 送达'},scope);return output;}
 catch(error){const status=invocationErrorStatus(error);record({id,status,error:String(error.message||error),usage,elapsedMs:now()-at,executionSummary:status==='deferred'?'后台分析暂缓，让当前 QQ 请求先执行；尚未取得分析结果':'本次调用没有完整完成，没有用其他模型伪装成功'},scope);throw error;}
}
export function chatAuditInvocations(audits=[],accountId=''){
 return audits.filter(a=>a.accountId===accountId).slice(-160).map(a=>({id:'chat:'+a.id,at:a.at,updatedAt:a.endedAt||a.at,accountId:a.accountId,personaId:a.persona,chat:a.chat,auditId:a.id,tool:'chat.reply',kind:'chat',purpose:a.chat?.startsWith('group:')?'回复群聊':'回复私聊',backend:a.local?'local':'api',model:a.model,actualModel:a.actualModel||null,input:a.input,output:a.answer||'',modelExplanation:a.modelExplanation||'',usage:a.usage||null,status:['completed','silent'].includes(a.status)?'returned':['failed','cancelled','error'].includes(a.status)?(a.status==='error'?'failed':a.status):'started',error:a.error,elapsedMs:!a.durationUnknown&&a.endedAt?Math.max(0,a.endedAt-a.at):undefined,deliveryState:a.deliveryState||'',executionSummary:a.deliveryState==='sent'?'已生成并收到 QQ 发送回执':a.status==='completed'?'已生成，送达状态请看发送回执':['failed','error'].includes(a.status)?'没有完成回复':a.status==='cancelled'?'任务已取消':'正在处理，尚未得到最终结果',billing:a.local?'本地聊天；其他独立工具来源另行记录':'API 聊天可能计费，以服务商账单为准'}));
}
export function describeInvocation(row){
 if(row.status==='failed'&&invocationErrorStatus({message:row.error})==='deferred')row={...row,status:'deferred',executionSummary:'后台分析暂缓，让 QQ 请求优先；这不是工具执行失败'};
 const tool=String(row.tool||''),known={bridge_device:'观察或操作设备',bridge_browser:'浏览网页或操作网页',bridge_qq_read:'读取 QQ 聊天记录与图片',bridge_qq_api:'调用 QQ 功能',bridge_watch:'观看并分析视频',bridge_audio:'分析或处理音频',bridge_drawing:'在画布上绘画',bridge_social_image:'准备分享配图',bridge_capabilities:'查询当前可用工具'};
 const purpose=(tool==='model.complete'&&row.systemPrompt?modelPurpose(row.systemPrompt):row.purpose)||known[tool]||(/search|搜索/i.test(tool)?'搜索资料':/read|浏览|watch|bilibili/i.test(tool)?'读取或观看内容':row.kind==='image'?'生成图片':row.kind==='video'?'生成视频':row.kind==='speech'?'合成语音':'执行工具');
 return {...row,purpose,executionSummary:row.executionSummary||(['returned'].includes(row.status)?'工具已返回结果；发送情况以回执为准':row.status==='failed'?'工具没有完成':row.status==='cancelled'?'工具任务已取消':'工具正在处理')};
}
export function invocationViewRows(rows,audits,{accountId='',backend='',kind=''}={}){
 return [...rows,...chatAuditInvocations(audits,accountId)].filter(r=>(!backend||r.backend===backend)&&(!kind||r.kind===kind)).sort((a,b)=>b.at-a.at).slice(0,240).map(r=>redactInvocation(describeInvocation(r)));
}
