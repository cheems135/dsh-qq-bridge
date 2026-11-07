// A quality preference, not a site allowlist: other valid image hosts remain usable.
export function preferredPhotoSource(value){
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&['unsplash.com','pexels.com'].some(host=>url.hostname===host||url.hostname.endsWith('.'+host));}catch{return false;}
}
export async function readPhotoResponse(response,limit=12*1024*1024){
 if(Number(response.headers?.get?.('content-length'))>limit){await response.body?.cancel?.();throw Error('搜索图片超过大小上限');}
 if(!response.body){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>limit)throw Error('搜索图片超过大小上限');return bytes;}
 let size=0;const chunks=[];
 for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('搜索图片超过大小上限');chunks.push(Buffer.from(chunk));}
 return Buffer.concat(chunks);
}
