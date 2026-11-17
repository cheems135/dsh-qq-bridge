// Generation and QQ delivery are different stages of the same media task.
// A text receipt must never turn a failed image/voice generation into success.
export function mediaExecutionSummary(tasks=[],outbox=[]){
 const items=tasks.map(task=>{const job=outbox.find(j=>j.id===task.deliveryId||j.mediaTaskId===task.id),status=job?.status||task.status,verification=job?.verification||task.verification;return {id:task.id,kind:task.kind,status,stage:job?'delivery':['pending','waiting_service'].includes(status)?'generation':status==='generated'?'generated':'generation',deliveryId:job?.id||task.deliveryId||'',messageId:job?.messageId||'',observed:verification?.state==='observed',recipient:verification?.recipient||'unknown',error:String(job?.error||task.error||'').slice(0,500)};});
 let state='none';if(items.length){const sent=items.filter(i=>i.status==='sent'),failed=items.filter(i=>['failed','cancelled'].includes(i.status));state=items.some(i=>i.status==='unknown')?'unknown':failed.length?(sent.length?'partial':'failed'):items.some(i=>i.status!=='sent')?'pending':items.every(i=>i.observed)?'observed':'accepted';}
 return {state,items,completed:state==='observed'||state==='accepted',recipient:'unknown',failures:items.filter(i=>['failed','cancelled','unknown'].includes(i.status))};
}
export function speechSourceReadiness({enabled=true,source='legacy',desktop=true,localVoice=true,engine='none',profile}={}){
 if(!enabled)return {available:false,reason:'当前对话的语音发送已关闭'};
 if(source==='local')return desktop&&localVoice?{available:true,reason:''}:{available:false,reason:desktop?'本地语音已关闭':'手机版仅支持 API 语音'};
 if(source.startsWith('profile:'))return profile?.type==='openai'&&!!profile.speechModel&&!!profile.voice?{available:true,reason:''}:{available:false,reason:'所选语音 API 尚未配置模型或音色'};
 return engine&&engine!=='none'?{available:true,reason:''}:{available:false,reason:'语音开关已开启，但尚未选择语音服务；请在语音或连接与搭配页选择来源'};
}
