export const IMAGE_CONTRACT_REVISION='20261114-node-contract-v2';
const id=n=>String(n.nodeId)+':'+n.fieldName;
export function checkedImageNodes(nodes,discovery){
 const fields=new Map((discovery?.fields||[]).map(f=>[id(f),f]));
 return nodes.map(node=>{
  const field=fields.get(id(node));if(!field)return {...node};
  let value=node.fieldValue;
  const fail=why=>{throw Object.assign(Error('节点 '+id(node)+'（'+(field.label||field.fieldName)+'）'+why+'；尚未提交生成请求'),{code:'IMAGE_PARAMETER_INVALID'});};
  if(['LIST','COMBO','BOOLEAN'].includes(field.type)&&field.options?.length){
   const options=field.options.map(o=>String(o.value));
   if(!options.includes(String(value))){
    const matches=options.filter(o=>o.replace(/\s*\([^)]*\)\s*$/,'').trim()===String(value).trim());
    if(matches.length!==1)fail('的取值不在服务允许的选项中');
    value=matches[0];
   }
  }
  if(field.type==='NUMBER'){
   if(value===''||!Number.isFinite(Number(value)))fail('必须是有效数字');
   const number=Number(value);
   if(field.integer&&!Number.isInteger(number))fail('必须是整数');
   if(Number.isFinite(field.min)&&number<field.min||Number.isFinite(field.max)&&number>field.max)fail('超出了节点允许的数值范围');
  }
  return {...node,fieldValue:value};
 });
}
export function runningHubSubmission(config,nodes){
 const app=config.mode==='app',target=String(app?config.webappId:config.workflowId);
 if(app&&config.discovery?.submitProtocol==='legacy')return {path:'/task/openapi/ai-app/run',payload:{apiKey:config.apiKey,webappId:target,nodeInfoList:nodes,instanceType:config.instanceType||'default',usePersonalQueue:config.usePersonalQueue==='true'?'true':'false'}};
 return {path:'/openapi/v2/run/'+(app?'ai-app/':'workflow/')+target,payload:{nodeInfoList:nodes,instanceType:config.instanceType||'lite',usePersonalQueue:config.usePersonalQueue==='true'?'true':'false'}};
}
export function runningHubTaskId(value){return String(value?.taskId||value?.data?.taskId||'');}
export function runningHubImageUrls(value){
 const found=new Set();
 const walk=(v,depth=0)=>{
  if(depth>12)return;
  if(typeof v==='string'){if(/^https?:\/\//i.test(v)&&/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(v))found.add(v);return;}
  if(Array.isArray(v))for(const item of v)walk(item,depth+1);
  else if(v&&typeof v==='object'){
   // Signed object-store URLs need not have a file extension.
   const url=v.fileUrl||v.url||v.imageUrl;
   if(typeof url==='string'&&/^https?:\/\//i.test(url)&&(/image|png|jpe?g|webp|gif/i.test(String(v.fileType||v.type||v.mediaType||''))||/\.(?:png|jpe?g|webp|gif)(?:\?|$)/i.test(url)))found.add(url);
   for(const [key,item] of Object.entries(v))if(!/api.?key|token|cookie|authorization|prompt/i.test(key))walk(item,depth+1);
  }
 };
 walk(value);return [...found];
}
export async function runningHubResults({request,config,taskId,state,wait=ms=>new Promise(r=>setTimeout(r,ms))}){
 let urls=runningHubImageUrls(state?.results||state?.data||[]);
 const receipts=[];
 for(let attempt=0;!urls.length&&attempt<3;attempt++){
  if(attempt)await wait(1500);
  try{const result=await request(config,'/task/openapi/outputs',{apiKey:config.apiKey,taskId});receipts.push(result);urls=runningHubImageUrls(result.data||result.results||[]);}catch(error){receipts.push({error:String(error.message).slice(0,180)});}
 }
 if(urls.length)return {urls,receipts};
 throw Object.assign(Error('生成平台已结束任务，但没有返回可用图片。已核查原任务结果，不会重新提交扣费；请检查应用输出节点。任务 '+taskId),{code:'IMAGE_EMPTY_OUTPUT',taskId,deliveryUnknown:true,requiresReview:true,billing:state?.usage||state?.data?.usage||null,outputReceipts:receipts});
}
export async function downloadRunningHubImage({urls,taskId,sniffImage,refresh,fetchImpl=fetch}){
 let candidates=urls,lastError;
 for(let attempt=0;attempt<2;attempt++)try{
  const response=await fetchImpl(candidates[0],{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  const mediaType=sniffImage(new Uint8Array(bytes.subarray(0,16)));
  if(!mediaType||bytes.length>48*1024*1024)throw Error('返回文件不是可验证的图片或体积异常');
  return {bytes,mediaType};
 }catch(error){
  lastError=error;
  if(!attempt&&refresh)try{const value=await refresh();if(value?.urls?.length)candidates=value.urls;}catch{}
 }
 throw Object.assign(Error('图片任务已生成，但下载尚未核实成功；保留原任务 '+taskId+'，不重新生成扣费（'+String(lastError?.message||'下载失败').slice(0,100)+'）'),{code:'IMAGE_DOWNLOAD_UNVERIFIED',taskId,deliveryUnknown:true});
}
