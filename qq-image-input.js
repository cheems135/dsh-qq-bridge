import {existsSync,readFileSync,statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const IMAGE_INPUT_REVISION='20261029-platform-image-resolution-v1';
const MAX=16*1024*1024;
const sized=bytes=>{if(!bytes?.length)throw Error('图片内容为空');if(bytes.length>MAX)throw Error('图片超过16MB');return new Uint8Array(bytes);};
export function createQqImageInput({getImage,fetchImpl=globalThis.fetch,fsImpl={existsSync,readFileSync,statSync},onResult=()=>{}}={}){
 async function direct(value){
  if(typeof value!=='string'||!value)return null;
  if(value.startsWith('base64://')){if(value.length>Math.ceil(MAX*4/3)+16)throw Error('图片超过16MB');return sized(Buffer.from(value.slice(9),'base64'));}
  if(/^data:image\/[\w.+-]+;base64,/i.test(value)){const data=value.slice(value.indexOf(',')+1);if(data.length>Math.ceil(MAX*4/3)+8)throw Error('图片超过16MB');return sized(Buffer.from(data,'base64'));}
  if(/^https?:\/\//i.test(value)){
   const response=await fetchImpl(value,{headers:{'user-agent':'Mozilla/5.0 QQBridge','referer':'https://qzone.qq.com/'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw Error('QQ图片下载HTTP '+response.status);
   if(Number(response.headers?.get?.('content-length'))>MAX)throw Error('图片超过16MB');
   if(!response.body?.getReader)return sized(Buffer.from(await response.arrayBuffer()));
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX)throw Error('图片超过16MB');chunks.push(Buffer.from(value));}return sized(Buffer.concat(chunks));}
   finally{try{await reader.cancel();}catch{}}
  }
  let file=value;if(/^file:/i.test(file))file=fileURLToPath(file);
  if(fsImpl.existsSync(file)&&fsImpl.statSync(file).isFile()){if(fsImpl.statSync(file).size>MAX)throw Error('图片超过16MB');return sized(fsImpl.readFileSync(file));}
  return null;
 }
 async function read(input={}){
  const data=typeof input==='string'?{file:input}:input||{},tried=new Set(),failures=[];
  async function candidates(value,source){for(const item of [value.url,value.file,value.path,value.file_path,value.image,value.base64?'base64://'+String(value.base64).replace(/^base64:\/\//,''):'']){
   if(typeof item!=='string'||!item||tried.has(item))continue;tried.add(item);
   try{const bytes=await direct(item);if(bytes){onResult({ok:true,source,bytes:bytes.length});return bytes;}}catch(error){failures.push(String(error?.message||error).replace(/https?:\/\/\S+/g,'[图片地址]').slice(0,160));}
  }return null;}
  let bytes=await candidates(data,'message');if(bytes)return bytes;
  for(const id of new Set([data.file_id,data.file,data.image_id,data.id].filter(v=>typeof v==='string'&&v&&v.length<=1000&&!/^base64:\/\//.test(v)))){
   if(typeof getImage!=='function')break;
   try{const resolved=await getImage(id),value=resolved?.data&&typeof resolved.data==='object'?resolved.data:resolved;
    bytes=await candidates(typeof value==='string'?{file:value}:value||{},'get_image');if(bytes)return bytes;
   }catch(error){failures.push('QQ重新取图：'+String(error?.message||error).replace(/https?:\/\/\S+/g,'[图片地址]').slice(0,100));}
  }
  const error=failures.at(-1)||'QQ未提供可用的原图地址，图片标识也未解析成功';onResult({ok:false,error});throw Error(error);
 }
 return {read};
}
