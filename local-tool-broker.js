import {randomUUID, timingSafeEqual} from 'node:crypto';
import {requestLocalJson} from './local-transport.js';

const cancelled=()=>Object.assign(new Error('本地工具会话已结束'),{name:'AbortError'});
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const jsonSize=value=>Buffer.byteLength(JSON.stringify(value));

/** Reverse requests: only the initiating host polls and executes its own tools.
 * The gateway never accepts a callback URL or executes a host command itself.
 */
export function createLocalToolBroker({now=Date.now,ttlMs=20*60000,maxSessions=16,pollMs=20000}={}){
  const sessions=new Map();
  function close(item){
    if(!item)return; sessions.delete(item.id);item.waiter?.([]);
    for(const job of item.calls.values())job.reject(cancelled());item.calls.clear();
  }
  function access(auth){
    const item=sessions.get(auth?.id);
    if(!item||!same(item.secret,auth?.secret))throw Error('工具会话不存在或凭证不符');
    if(now()-item.at>ttlMs){close(item);throw Error('工具会话已过期');}
    item.at=now();return item;
  }
  const sweep=()=>{for(const item of sessions.values())if(now()-item.at>ttlMs)close(item);};
  const timer=setInterval(sweep,60000);timer.unref?.();
  function create(tools){
    sweep();if(sessions.size>=maxSessions)throw Error('本地工具会话过多');
    if(!Array.isArray(tools)||tools.length>16||jsonSize(tools)>32000)throw Error('工具定义过多或过大');
    const seen=new Set();
    for(const tool of tools){
      if(!/^bridge_[A-Za-z0-9_]{1,64}$/.test(tool?.name)||seen.has(tool.name)||tool.parameters?.type!=='object')throw Error('工具定义无效');
      seen.add(tool.name);
    }
    const item={id:randomUUID(),secret:randomUUID(),at:now(),tools:structuredClone(tools),used:false,finished:false,calls:new Map(),waiter:null};
    sessions.set(item.id,item);return {id:item.id,secret:item.secret};
  }
  function claim(auth,signal){
    const item=access(auth);if(item.used)throw Error('这个工具会话已用于另一轮，不能重放');item.used=true;
    const abort=()=>close(item);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){close(item);throw cancelled();}
    const tools=Object.fromEntries(item.tools.map(tool=>[tool.name,{...tool,kind:'data',execute:(args)=>{
      if(!sessions.has(item.id)||item.finished||signal?.aborted)return Promise.reject(cancelled());
      if(jsonSize(args)>64000)return Promise.reject(Error('工具参数过大'));
      return new Promise((resolve,reject)=>{
        const id=randomUUID();item.calls.set(id,{id,name:tool.name,arguments:args,resolve,reject,delivered:false});
        item.waiter?.(take(item));
      });
    }}]));
    return {tools,close(){signal?.removeEventListener('abort',abort);item.finished=true;item.waiter?.([]);for(const job of item.calls.values())job.reject(cancelled());item.calls.clear();}};
  }
  function take(item){const job=[...item.calls.values()].find(job=>!job.delivered);if(!job)return [];job.delivered=true;return [{id:job.id,name:job.name,arguments:job.arguments}];}
  async function poll(auth,signal){
    const item=access(auth);if(item.waiter)throw Error('这个工具会话已有正在等待的接收端');
    if(item.finished)return [];const jobs=take(item);if(jobs.length)return jobs;
    if(signal?.aborted)throw cancelled();
    return new Promise(resolve=>{
      const done=jobs=>{clearTimeout(wait);signal?.removeEventListener('abort',abort);if(item.waiter===done)item.waiter=null;resolve(jobs);};
      const abort=()=>done([]),wait=setTimeout(()=>done([]),pollMs);
      item.waiter=done;signal?.addEventListener('abort',abort,{once:true});
    });
  }
  function result(auth,id,value){
    const item=access(auth),job=item.calls.get(id);
    if(!job||!job.delivered)throw Error('工具结果没有对应的待处理调用，不能重放');
    if(jsonSize(value)>6*1024*1024)throw Error('工具结果过大');
    item.calls.delete(id);job.resolve(value);
  }
  return {create,claim,poll,result,done:auth=>access(auth).finished,close:auth=>close(access(auth)),dispose(){clearInterval(timer);for(const item of sessions.values())close(item);},size:()=>sessions.size};
}

export async function runWithHostTools({baseUrl,messages,tools,signal,turnContext,onEvent,origin='qq',request=requestLocalJson}){
  const base=baseUrl.replace(/\/+$/,''),controller=new AbortController();
  const abort=()=>controller.abort(signal?.reason||cancelled());
  if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
  const descriptors=Object.entries(tools).map(([name,tool])=>({name,description:tool.description,parameters:tool.parameters,repeatable:tool.repeatable===true}));
  let auth,pump,pumpError;
  async function call(route,body,options={}){
    const response=await request(base+route,{method:'POST',body,signal:controller.signal,...options});
    if(!response.ok)throw Error(String(response.body?.error?.message||'本地工具请求失败'));
    return response.body;
  }
  try{
    auth=(await call('/v1/local/tools/session',{tools:descriptors})).session;
    pump=(async()=>{
      while(!controller.signal.aborted){
        const response=await call('/v1/local/tools/poll',{session:auth},{timeoutMs:30000});
        if(response.done)break;
        for(const job of response.calls||[]){
          if(controller.signal.aborted)break;
          let result;
          try{
            if(!Object.hasOwn(tools,job.name))throw Error('本轮没有这个工具');
            result=await tools[job.name].execute(job.arguments,{signal:controller.signal});
          }catch(error){result={ok:false,error:String(error?.message||error).slice(0,1000)};}
          if(!controller.signal.aborted)await call('/v1/local/tools/result',{session:auth,callId:job.id,result});
        }
      }
    })().catch(error=>{if(!controller.signal.aborted){pumpError=error;controller.abort(error);}});
    const result=await call('/v1/local/turn',{messages,toolSession:auth,origin,stream:typeof onEvent==='function',...(turnContext?{turnContext}:{})},{onEvent});
    if(pumpError)throw pumpError;
    return {ok:true,status:200,body:result};
  }finally{
    controller.abort();signal?.removeEventListener('abort',abort);await pump;
    if(auth)try{await request(base+'/v1/local/tools/close',{method:'POST',body:{session:auth},timeoutMs:2000});}catch{}
  }
}
