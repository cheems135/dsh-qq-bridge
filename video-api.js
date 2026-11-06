import {setTimeout as delay} from 'node:timers/promises';
import {connectionRequestUrl,connectionHeaders,readConnectionText,cleanConnectionError} from './service-connections.js';
import {requestWebsite} from './website-mcp-http.js';

export function videoJobUrl(profile,kind,id){
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,299}$/.test(String(id)))throw Error('视频任务编号格式无效');
 const fallback=kind==='videoStatus'?'videos/{id}':'videos/{id}/content';
 const path=connectionRequestUrl(profile,kind,fallback);
 if(!/\{id\}|%7Bid%7D/i.test(path))throw Error('视频查询和下载路径需要包含{id}任务编号占位符');
 return path.replace(/\{id\}|%7Bid%7D/gi,encodeURIComponent(id));
}
function unwrap(value){return value?.data&&!Array.isArray(value.data)?value.data:value;}
function jobId(value){return String(value?.id||value?.task_id||value?.taskId||'');}
function outputUrl(value){return value?.video_url||value?.url||value?.output?.video_url||value?.output?.url||value?.data?.[0]?.url||value?.data?.[0]?.video_url||'';}
async function readBytes(response){
 if(!response.ok){await response.body?.cancel?.();throw Error('视频结果下载返回HTTP '+response.status);}
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>256*1024*1024)throw Error('视频文件超过256MB，未写入不完整结果');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks);
}
export function validateVideo(bytes){
 bytes=Buffer.from(bytes);if(bytes.length<16||bytes.toString('ascii',4,8)!=='ftyp')throw Error('视频接口未返回可确认的MP4文件；可能返回了错误页面');return {bytes,extension:'mp4'};
}
/** Submit once; resume uses the saved job and never sends another generation POST. */
export async function connectionVideo(profile,{prompt,reference,seconds=8,size='720x1280',signal,job,onJob=()=>{},pollMs=4000,waitMs=1800000,assertCurrent=()=>{}}={},fetchImpl=fetch,{download=requestWebsite,sleep=delay}={}){
 if(profile.type!=='openai'||!profile.videoModel)throw Error('请先配置兼容视频接口的连接和视频模型');
 if(!prompt?.trim())throw Error('视频提示词不能为空');
 if(!Number.isFinite(Number(seconds))||Number(seconds)<=0)throw Error('视频时长需要大于零');
 const deadline=AbortSignal.any([AbortSignal.timeout(waitMs),...(signal?[signal]:[])]);
 const check=()=>{deadline.throwIfAborted();assertCurrent();};
 const headers=connectionHeaders(profile);
 const json=async(url,options={})=>{
  check();const r=await fetchImpl(url,{...options,headers:{...headers,...options.headers},redirect:'error',signal:deadline});
  if(!r.ok){let detail='';try{const body=JSON.parse(await readConnectionText(r,64000));detail=String(body.error?.message||body.message||'');}catch{}throw Error('视频接口返回HTTP '+r.status+(detail?'：'+detail:'')+'；未重复提交或更换来源');}
  return unwrap(JSON.parse(await readConnectionText(r)));
 };
 try{
  let state=job;
  if(!state){
   let body,contentHeaders={};
   if(profile.videoMode==='json'){
    contentHeaders={'content-type':'application/json'};body=JSON.stringify({model:profile.videoModel,prompt,seconds:String(seconds),size,...(reference?{input_reference:'data:'+(reference.mediaType||'image/png')+';base64,'+Buffer.from(reference.bytes).toString('base64')}:{})});
   }else{
    body=new FormData();body.append('model',profile.videoModel);body.append('prompt',prompt);body.append('seconds',String(seconds));body.append('size',size);
    if(reference)body.append('input_reference',new Blob([reference.bytes],{type:reference.mediaType||'image/png'}),'reference.png');
   }
   // Persist an uncertain submission marker before dispatch, including network loss.
   await onJob({status:'submitting',id:''});check();
   state=await json(connectionRequestUrl(profile,'video','videos'),{method:'POST',headers:contentHeaders,body});
   if(!jobId(state)&&!outputUrl(state))throw Error('视频接口没有返回任务编号或视频地址；提交状态不确定，请先查服务商记录，不要重复生成');
   await onJob(state);
  }else if(!jobId(state)&&!outputUrl(state))throw Error('上次视频提交结果不确定，未自动再次生成；请先查看服务商任务记录');
  for(;;){
   check();const status=String(state.status||state.state||'').toLowerCase(),id=jobId(state),url=outputUrl(state);
   if(['failed','error','cancelled','canceled','rejected'].includes(status))throw Error('视频任务未完成：'+String(state.error?.message||state.message||status));
   if(url&&!status||['completed','succeeded','success','done'].includes(status)){
    let bytes;
    if(url){
     const target=new URL(url);if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('视频结果地址无效');
     // Result URLs (including signed CDN URLs) never receive the API key.
     if(target.origin===new URL(profile.baseUrl).origin)bytes=await readBytes(await fetchImpl(target.href,{redirect:'error',signal:deadline}));
     else{const r=await download(target.href,{signal:deadline,maxBytes:256*1024*1024,binary:true,timeoutMs:120000});if(r.status!==200)throw Error('视频结果下载失败');bytes=r.bytes;}
    }else bytes=await readBytes(await fetchImpl(videoJobUrl(profile,'videoContent',id),{headers,redirect:'error',signal:deadline}));
    check();return {...validateVideo(bytes),jobId:id};
   }
   if(!id)throw Error('视频任务缺少编号，不能继续查询');
   await sleep(pollMs,undefined,{signal:deadline});check();state=await json(videoJobUrl(profile,'videoStatus',id),{method:'GET'});if(!jobId(state))state={...state,id};await onJob(state);
  }
 }catch(error){if(signal?.aborted)throw signal.reason;throw Error(cleanConnectionError(error,profile.apiKey));}
}
