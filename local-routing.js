import {resolveLocalMediaTask} from './local-media-task.js';
import {estimateTokens} from './local-context.js';

export function localRequirements(text='',{images=false,voiceInput=false,structured=false,outputTokens=0,inputTokens=0,toolTask=false,history=[]}={}){
 const value=String(text);
 const native=/(?:终端|命令行|powershell|cmd\b|bash\b|执行.{0,12}(?:脚本|代码|命令)|运行.{0,12}(?:脚本|代码)|(?:读|写|保存|修改|删除).{0,8}(?:文件|目录))/i.test(value);
 const special=/(?:按谱|清唱|唱一首|唱歌|表情包|收藏表情|转发消息)/.test(value);
 const tools=toolTask||native||/(?:搜索|搜一下|查找|查询|联网|浏览|打开|登录|扫码|B站|哔哩|bilibili|刷视频|读(?:取)?网页|播放|评论|点赞|收藏|日程|计划|提醒|任务|画布|手绘|玩游戏|签名|空间动态)/i.test(value);
 const {image,speech,video}=resolveLocalMediaTask(value,{history});
 return {text:true,json:structured||/\bJSON\b/i.test(value),tools:tools||image||speech||video,externalTools:tools,vision:images,asr:voiceInput,image,speech,video,native,special,outputTokens:Math.max(0,Number(outputTokens)||0),inputTokens:inputTokens||estimateTokens(value)};
}
export function chooseLocalRoute(snapshot,requirements={}, {enabled=true,hostTools=true,apiComplement=false}={}){
 const api=reason=>({target:apiComplement?'api':'unavailable',reason});
 if(!enabled)return {target:'api',reason:'已选择 API 模式'};
 if(!snapshot)return api('本地服务暂不可用');
 if(snapshot.serviceReachable===false)return api('本地服务暂不可用');
 if(snapshot.busy)return {target:'wait',reason:'本地任务排队中，空闲后继续本轮'};
 if(snapshot.status==='unavailable')return api(snapshot.reason||'本地服务暂不可用');
 const features=snapshot.features||{};
 for(const key of ['text','json','tools','vision','asr','image','speech','video','native','special']){
  if(!requirements[key])continue;
  const entry=features[key];if(entry?.supported!==true)return api(entry?.reason||'本地能力尚未验证：'+key);
 }
 if(requirements.externalTools&&!hostTools)return api('当前对象未开放本地设备工具，沿用宿主权限流程');
 if(requirements.inputTokens>Math.max(512,(snapshot.contextWindow||4096)-(snapshot.maxOutputTokens||512)-256))return api('本轮必要输入超出本地容量');
 if(requirements.outputTokens>(snapshot.maxOutputTokens||512))return api('本轮所需输出长度超出本地配置');
 return {target:'local',reason:'本轮所需能力已通过本地检查'};
}

// Foreground turns wait without starting an inference or replaying a cloud call.
// Re-check the account/persona/stop scope after every asynchronous boundary.
export async function waitForLocalRoute({getSnapshot,requirements,options={},signal,isCurrent=()=>true,onWaiting=()=>{},timeoutMs=900000,intervalMs=1000,now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
 const started=now();
 for(;;){
  if(signal?.aborted||!isCurrent())throw Object.assign(Error('本地排队已取消'),{name:'AbortError'});
  const snapshot=await getSnapshot();
  if(signal?.aborted||!isCurrent())throw Object.assign(Error('本地排队已取消'),{name:'AbortError'});
  const decision=chooseLocalRoute(snapshot,requirements,options);
  if(decision.target!=='wait')return {snapshot,decision};
  if(now()-started>=timeoutMs)throw Object.assign(Error('本地任务排队等待超时，已有任务保留运行'),{code:'LOCAL_QUEUE_TIMEOUT'});
  onWaiting({elapsedMs:now()-started,snapshot});
  await sleep(intervalMs);
 }
}

export function localCompletionInput(input){
 if(typeof input==='string')return {supported:true,images:false,content:input};
 if(!Array.isArray(input))return {supported:false,images:false,content:''};
 const content=[];let images=false;
 for(const part of input){
  if(part?.type==='text'){content.push({type:'text',text:String(part.text||'')});continue;}
  if(part?.type==='image_url'&&/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(part.image_url?.url||'')){content.push(part);images=true;continue;}
  if(part?.type==='image'&&typeof part.data==='string'&&/^image\/(?:png|jpe?g|webp|gif)$/.test(part.mediaType||'')){content.push({type:'image_url',image_url:{url:'data:'+part.mediaType+';base64,'+part.data}});images=true;continue;}
  return {supported:false,images,content:''};
 }
 return {supported:true,images,content};
}

export function createModelRouter({local,api,getSnapshot,onRoute=()=>{}}={}){
 return {async complete(request){
  if(request.signal?.aborted)throw request.signal.reason;
  if(request.enabled===false){onRoute({target:'api',reason:'已选择 API 模式'},request);return api(request);}
  const snapshot=await getSnapshot(request),decision=chooseLocalRoute(snapshot,request.requirements,{hostTools:true,apiComplement:request.apiComplement===true});onRoute(decision,request);
  if(decision.target==='api')return api(request);
  if(decision.target!=='local')throw Object.assign(Error('本地模式暂不可用：'+decision.reason+'；本轮没有调用 API'),{code:snapshot?.busy?'LOCAL_ANALYSIS_DEFERRED':'LOCAL_CAPABILITY_UNAVAILABLE'});
  // A failed local inference is never replayed against a cloud model.
  return local(request);
 }};
}
