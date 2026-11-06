import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {websiteUrl} from './website-reading.js';

export function publicWebsiteIp(address) {
  if (isIP(address) === 4) {
    const [a,b,c] = address.split('.').map(Number);
    return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51)||a===203&&b===0&&c===113);
  }
  return isIP(address) === 6 && /^[23]/.test(address) && !/^(?:2002:|3ffe:|2001:(?:0*:|db8:|0?2:|0?10:|0?20:))/i.test(address);
}

export function checkedWebsiteUrl(value, origin) {
  const safe = websiteUrl(value);
  if (!safe) throw Error('请填写不含凭据的公开 HTTP/HTTPS 网站地址');
  const url = new URL(safe);
  if (origin && url.origin !== origin) throw Error('网站工具只访问识别时确定的同一站点，跨站地址需要单独添加');
  return url;
}

/** Resolve once, reject private addresses, then pin the connection to that result.
 * No cookies, bearer headers, shell commands or browser scripts are accepted.
 */
export async function requestWebsite(url, {signal, origin, maxBytes=2*1024*1024, resolve=lookup, request, binary=false, timeoutMs=15000}={}) {
  const deadline = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal?[signal]:[])]);
  let current = checkedWebsiteUrl(url, origin);
  for (let hop=0; hop<5; hop++) {
    deadline.throwIfAborted();
    const addresses = await resolve(current.hostname, {all:true,verbatim:true});
    deadline.throwIfAborted();
    if (!addresses.length || addresses.some(row=>!publicWebsiteIp(row.address))) throw Error('网站解析到了非公开地址，未发出请求');
    const pinned = addresses[0];
    const result = await new Promise((done, reject)=>{
      const send = request || (current.protocol==='https:'?https.request:http.request);
      const req = send(current, {method:'GET',agent:false,signal:deadline,headers:{accept:'text/html,application/json,application/xml,text/xml;q=0.9,*/*;q=0.1','accept-encoding':'identity','user-agent':'QQBridge-WebsiteMCP/1.0'},lookup:(_host, options, callback)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)}, res=>{
        if ([301,302,303,307,308].includes(res.statusCode)) { res.resume(); done({redirect:res.headers.location}); return; }
        if (Number(res.headers['content-length'])>maxBytes) { res.destroy(); reject(Error('网站响应过大')); return; }
        let size=0;const chunks=[];
        res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(Error('网站响应过大'));return;}chunks.push(chunk);});
        res.on('end',()=>done({status:res.statusCode,type:String(res.headers['content-type']||''),...(binary?{bytes:Buffer.concat(chunks)}:{text:Buffer.concat(chunks).toString('utf8')}),url:current.href}));
        res.on('error',reject);
      });
      req.on('error',reject);req.end();
    });
    if (!result.redirect) return result;
    current = checkedWebsiteUrl(new URL(result.redirect,current).href, origin);
  }
  throw Error('网站重定向次数过多');
}
