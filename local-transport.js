import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {StringDecoder} from 'node:string_decoder';

/** Long local generations use one connection and one explicit total deadline.
 * No implicit fetch headers timeout, connection reuse, or automatic POST retry.
 */
export function requestLocalJson(address, {method = 'GET', body, signal, timeoutMs = 900000, maxBytes = 16 * 1024 * 1024,onEvent} = {}) {
  const url = new URL(address);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname.toLowerCase()) || url.username || url.password) {
    return Promise.reject(new Error('本地请求只允许本机回环地址'));
  }
  return new Promise((resolve, reject) => {
    let request, timer, settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) { request?.destroy(); reject(error); } else resolve(value);
    };
    const abort = () => finish(signal?.reason || Object.assign(new Error('本地任务已取消'), {name: 'AbortError'}));
    if (signal?.aborted) { abort(); return; }
    let data;
    try { data = body === undefined ? undefined : Buffer.from(JSON.stringify(body)); }
    catch (error) { finish(error); return; }
    timer = setTimeout(() => finish(Object.assign(new Error(`本地网关等待超时（${Math.round(timeoutMs / 1000)} 秒）；未重试生成`), {code: 'LOCAL_DEADLINE'})), timeoutMs);
    timer.unref?.();
    signal?.addEventListener('abort', abort, {once: true});
    request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method, agent: false,
      headers: data ? {'content-type': 'application/json', 'content-length': data.length} : {},
    }, response => {
      const chunks = [];
      const streaming=String(response.headers['content-type']||'').includes('application/x-ndjson');
      const decoder=new StringDecoder('utf8');let pending='',result=null;
      const parseLine=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.event==='result')result={ok:event.status>=200&&event.status<300,status:event.status,body:event.body};else if(['text','notice','invocation'].includes(event.event))onEvent?.(event);};
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { response.destroy(); finish(new Error('本地网关响应过大')); }
        else if(streaming){try{pending+=decoder.write(chunk);let index;while((index=pending.indexOf('\n'))>=0){parseLine(pending.slice(0,index));pending=pending.slice(index+1);}}catch(error){finish(error);}}
        else chunks.push(chunk);
      });
      response.on('error', error => finish(new Error('本地网关响应中断（' + (error.code || 'NETWORK_ERROR') + '）；未重试生成', {cause: error})));
      response.on('end', () => {
        if (settled) return;
        if(streaming){try{pending+=decoder.end();if(pending.trim())parseLine(pending);if(!result)throw Error('本地连接中断，尚未收到完整结果');finish(null,result);}catch(error){finish(error);}return;}
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { finish(new Error('本地网关返回的不是有效 JSON（HTTP ' + response.statusCode + '）')); return; }
        finish(null, {ok: response.statusCode >= 200 && response.statusCode < 300, status: response.statusCode, body: value});
      });
    });
    request.on('error', error => {
      const detail = error.code === 'ECONNREFUSED' ? '未连接到本地网关，请运行 start-local-ai.bat' : '本地网关连接中断';
      finish(Object.assign(new Error(`${detail}（${error.code || 'NETWORK_ERROR'}，端口 ${url.port || (url.protocol === 'https:' ? 443 : 80)}）；未重试生成`, {cause: error}), {code: error.code}));
    });
    request.end(data);
  });
}

export function localReplyDelay({localOwner = false, replyDelayMs = 3000, mergeMs = 300,priority='speed'} = {}) {
  const delay = Math.min(15000, Math.max(0, Number(replyDelayMs) || 0));
  return localOwner ? Math.min(delay, Math.min(2000, Math.max(priority==='quality'?1200:0, Number(mergeMs) || 0))) : delay;
}

export function localErrorDetail(error) {
  const message = String(error?.message || error);
  const code = error?.cause?.code || error?.code;
  return message === 'fetch failed' && code ? `${message}（${code}）` : message;
}
