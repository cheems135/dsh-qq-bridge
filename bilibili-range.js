import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const CHUNK_BYTES=256*1024;
const CACHE_CHUNKS=8;
const MAX_CONNECTIONS=4;

// FFmpeg sees a seekable local input. Only the caller's validated CDN URL can
// supply bytes, and a decoder that stops reading cancels its upstream request.
export async function openBilibiliRange({loadChunk,formatOf,signal}){
  const first=await loadChunk(0,CHUNK_BYTES-1,signal);
  const length=first.total;
  const format=formatOf(first.bytes);
  const cache=new Map([[0,first.bytes]]);
  const lifetime=new AbortController();
  const route='/video/'+randomUUID();
  let active=0,lastError=null;

  async function* chunks(start,end,requestSignal){
    let position=start;
    while(position<=end){
      requestSignal.throwIfAborted();
      const offset=Math.floor(position/CHUNK_BYTES)*CHUNK_BYTES;
      let bytes=cache.get(offset);
      if(!bytes){
        try{
          const part=await loadChunk(offset,Math.min(offset+CHUNK_BYTES-1,length-1),requestSignal);
          if(part.total!==length)throw Object.assign(Error('B站视频资源在读取期间发生变化'),{code:'VIDEO_RESOURCE'});
          bytes=part.bytes;
        }catch(error){
          if(!requestSignal.aborted)lastError=error;
          throw error;
        }
      }
      cache.delete(offset);
      cache.set(offset,bytes);
      if(cache.size>CACHE_CHUNKS)cache.delete(cache.keys().next().value);
      const slice=bytes.subarray(position-offset,end-offset+1);
      position+=slice.length;
      yield slice;
    }
  }

  const server=createServer(async(req,res)=>{
    if(req.url!==route||!['GET','HEAD'].includes(req.method)){res.writeHead(404).end();return;}
    const range=req.headers.range;
    const match=typeof range==='string'?range.match(/^bytes=(\d+)-(\d*)$/):null;
    const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||length-1),length-1);
    if((range&&!match)||!Number.isSafeInteger(start)||start>end){
      res.writeHead(416,{'Content-Range':'bytes */'+length}).end();
      return;
    }
    if(active>=MAX_CONNECTIONS){res.writeHead(503).end();return;}
    const headers={'Content-Length':end-start+1,'Accept-Ranges':'bytes','Content-Type':'application/octet-stream'};
    if(range)headers['Content-Range']='bytes '+start+'-'+end+'/'+length;
    res.writeHead(range?206:200,headers);
    if(req.method==='HEAD'){res.end();return;}
    active++;
    const request=new AbortController();
    res.once('close',()=>request.abort());
    const requestSignal=AbortSignal.any([lifetime.signal,request.signal]);
    try{
      await pipeline(Readable.from(chunks(start,end,requestSignal),{objectMode:false}),res);
    }catch{ /* Closing the FFmpeg input also closes the upstream request. */ }
    finally{active--;}
  });
  server.keepAliveTimeout=1000;
  function close(){
    if(lifetime.signal.aborted)return;
    lifetime.abort();
    server.close();
    server.closeAllConnections();
    cache.clear();
  }
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
    signal?.throwIfAborted();
  }catch(error){close();throw error;}
  server.unref();
  return {
    url:'http://127.0.0.1:'+server.address().port+route,
    inputOptions:['-protocol_whitelist','http,tcp','-rw_timeout','8000000','-probesize','524288','-analyzeduration','1000000','-f',format],
    lastError:()=>lastError,
    close,
  };
}
