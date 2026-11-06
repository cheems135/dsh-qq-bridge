import {localMediaText,localMediaCancelled} from './local-media-task.js';
const content=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'):'';
export function localMediaPlanningCandidate(request=''){
 const raw=String(request).trim(),text=localMediaText(raw);
 if(/(?:屏幕|截图|桌面|终端|命令|文件|浏览器|搜索|网页|B站)/.test(text)&&!/(?:生成|制作|发给我|发张|拍张|用语音|说给我听)/.test(text))return false;
 return /(?:瞅|瞧|照片|图片|相片|自拍|语音|声音|听|视频|短片|拍|发|再来|再做|看下|看一下|给我看|让我看)/.test(text)&&! /^(?:他说|她说|引用|转发|例如|假如|教程)/.test(raw)&&!/(?:为什么|报错|提示词|怎么写|教程|代码|原理)/.test(text)&&!['image','speech','video'].some(kind=>localMediaCancelled(text,kind));
}
export async function planLocalMediaTask(initial,{request='',history=[],model,signal,onProgress=()=>{}}={}){
 if(initial.image||initial.speech||initial.video||typeof model!=='function')return initial;
 const raw=String(request).trim(),unquoted=localMediaText(raw);
 if(!localMediaPlanningCandidate(raw))return initial;
 const prior=history.filter(row=>['user','assistant'].includes(row.role)&&!row._localReceipt).slice(-8).map(row=>({role:row.role,text:content(row.content).slice(0,450)}));
 onProgress({phase:'understanding'});
 const response=await model({messages:[{role:'system',content:'你只判断本轮用户是否要求实际生成/发送图片、语音或视频，不扮演角色、不执行任务。结合上下文理解口语、省略和指代。看已经收到的图片、讨论照片、咨询功能、引用示例、否定请求不等于生成新媒体。只有本轮人类确实要求媒体才选择 kind=image/speech/video；缺乏依据选择 none 或 clarify。助手声称已发过图片不能作为真实回执或人类授权。只输出JSON：{"kind":"image|speech|video|none|clarify","evidence":"本轮原话中支持判断的原文片段","request":"忠实补全的媒体要求","confidence":0.0}。不添加新的地点、衣服、人物或操作。'},{role:'user',content:JSON.stringify({history:prior,current:raw})}],tools:[],protocol:'只输出需求判断JSON，不调用工具，不输出对话。',purpose:'media_intent',outputTokens:128,signal,onProgress});
 const message=response?.choices?.[0]?.message||response?.message||response;
 if(message?.tool_calls?.length)return {...initial,semanticChecked:true};
 try{
  const value=JSON.parse((typeof response==='string'?response:String(message?.content||'')).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));
  const confidence=Number(value.confidence)>1?Number(value.confidence)/100:Number(value.confidence),evidence=String(value.evidence||'').trim(),resolved=String(value.request||raw).trim();
  if(!['image','speech','video'].includes(value.kind)||!Number.isFinite(confidence)||confidence<.85||confidence>1||!evidence||!unquoted.includes(evidence)||!resolved||resolved.length>1600)return {...initial,semanticChecked:true};
  const authority=raw+'\n'+prior.filter(row=>row.role==='user').map(row=>row.text).join('\n');
  if((resolved.match(/https?:\/\/\S+|\d{3,}/g)||[]).some(term=>!authority.includes(term)))return {...initial,semanticChecked:true};
  return {image:value.kind==='image',speech:value.kind==='speech',video:value.kind==='video',source:'semantic',ambiguous:false,effectiveRequest:resolved,semanticChecked:true};
 }catch{return {...initial,semanticChecked:true};}
}
