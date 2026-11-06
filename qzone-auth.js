import {qzoneJson} from './qzone-protocol.js';
const fail=(code,message)=>Object.assign(Error(message),{code});
const normalizeUin=value=>String(value??'').replace(/^o/,'').replace(/^0+(?=\d)/,'');
const cookieFields=cookie=>Object.fromEntries(String(cookie).split(';').map(item=>{const index=item.indexOf('=');return index<0?['','']:[item.slice(0,index).trim(),item.slice(index+1).trim()];}));
export function qzoneCredentials(cookie,uin,expectedUin=''){
 cookie=String(cookie||'');uin=normalizeUin(uin);
 if(!/^\d{5,20}$/.test(uin)||/[\r\n]/.test(cookie)||!cookie)throw fail('QZONE_AUTH_REQUIRED','QQ 登录后才能取得空间凭据');
 const fields=cookieFields(cookie),key=fields.p_skey||fields.skey||'',cookieUin=normalizeUin(fields.p_uin||fields.uin||'');
 if(!key||cookieUin&&cookieUin!==uin||expectedUin&&normalizeUin(expectedUin)!==uin)throw fail('QZONE_AUTH_REQUIRED','空间凭据与当前 QQ 登录不一致');
 let gtk=5381;for(const char of key)gtk=(gtk*33+char.charCodeAt(0))|0;
 return {uin,cookie,gtk:gtk&0x7fffffff};
}
export async function loadQzoneCredentials(request,{expectedUin='',signal}={}){
 signal?.throwIfAborted();
 const login=await request('get_login_info',{},12000);signal?.throwIfAborted();
 const uin=normalizeUin(login?.user_id||login?.uin);
 if(!/^\d{5,20}$/.test(uin))throw fail('QZONE_AUTH_REQUIRED','QQ 尚未完成登录');
 let combined;
 try{combined=await request('get_credentials',{domain:'qzone.qq.com'},12000);}catch{signal?.throwIfAborted();}
 signal?.throwIfAborted();
 if(combined?.cookies)try{return qzoneCredentials(combined.cookies,uin,expectedUin);}catch{}
 const cookies=await request('get_cookies',{domain:'qzone.qq.com'},12000);signal?.throwIfAborted();
 return qzoneCredentials(cookies?.cookies,uin,expectedUin);
}
async function responseText(response,limit=2*1024*1024){
 if(Number(response.headers?.get?.('content-length'))>limit)throw fail('QZONE_RESPONSE_INVALID','空间检查返回内容过大');
 if(!response.body?.getReader){const raw=await response.text();if(Buffer.byteLength(raw)>limit)throw fail('QZONE_RESPONSE_INVALID','空间检查返回内容过大');return raw;}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw fail('QZONE_RESPONSE_INVALID','空间检查返回内容过大');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
 return Buffer.concat(chunks).toString('utf8');
}
export async function probeQzoneCredentials(auth,{fetchImpl=fetch,signal}={}){
 const url=new URL('https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more');
 for(const [key,value]of Object.entries({uin:auth.uin,scope:1,view:1,daylist:'',uinlist:'',gid:'',flag:1,filter:'all',applist:'all',refresh:1,pagenum:0,begintime:0,dayspac:1,sidomain:'qzonestyle.gtimg.cn',useutf8:1,outputhtmlfeed:1,g_tk:auth.gtk,format:'json',count:1,num:1}))url.searchParams.set(key,String(value));
 const response=await fetchImpl(url.href,{method:'GET',headers:{cookie:auth.cookie,referer:'https://user.qzone.qq.com/'+auth.uin,'user-agent':'Mozilla/5.0'},redirect:'manual',signal:AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])])});
 if(response.status===401||response.status>=300&&response.status<400)throw fail('QZONE_AUTH_REQUIRED','空间需要重新登录或验证');
 if(response.status===429)throw fail('QZONE_THROTTLED','空间暂时限制了检查频率');
 if([404,405].includes(response.status))throw fail('QZONE_UNSUPPORTED','当前空间验证接口不可用');
 if(!response.ok)throw fail('QZONE_NETWORK','空间检查暂时没有连通');
 const raw=await responseText(response);
 if(/访问过于频繁|too many requests/i.test(raw))throw fail('QZONE_THROTTLED','空间暂时限制了检查频率');
 if(/<html|<!doctype/i.test(raw)&&/请先登录|需要登录|安全验证|请输入验证码|ptlogin|tcaptcha/i.test(raw))throw fail('QZONE_AUTH_REQUIRED','空间需要重新登录或验证');
 const value=qzoneJson(raw),data=value.data;
 if(!data||typeof data!=='object'||!(data.main&&typeof data.main==='object'||Array.isArray(data.data)))throw fail('QZONE_RESPONSE_INVALID','空间验证没有返回可核对的登录结果');
 return {ok:true,readOnly:true,coverage:'自己的空间只读请求已通过；发布与评论仍以实际回执为准'};
}
