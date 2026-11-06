const {biliVideoId}=await import(new URL('./bilibili-service.js'+new URL(import.meta.url).search,import.meta.url));
export function isBiliVideoLink(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&(u.hostname==='b23.tv'||['bilibili.com','www.bilibili.com'].includes(u.hostname)&&/^\/video\//.test(u.pathname));}catch{return false;}}
export async function resolveBiliVideoLink(value,{fetchImpl=fetch,signal}={}){
 let url=String(value||'');
 for(let hop=0;hop<4;hop++){
  if(!isBiliVideoLink(url))throw Error('不是支持的B站视频地址');
  const u=new URL(url);if(u.hostname!=='b23.tv'){const bvid=biliVideoId(url),page=Number(u.searchParams.get('p')||1);return {bvid,page:Number.isInteger(page)&&page>0?Math.min(page,100):1};}
  signal?.throwIfAborted();const response=await fetchImpl(url,{redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
  try{const location=response.headers.get('location');if(response.status<300||response.status>=400||!location)throw Error('B站短链接没有返回可读取的视频地址');url=new URL(location,url).href;}finally{try{await response.body?.cancel();}catch{}}
 }
 throw Error('B站短链接跳转次数过多');
}
