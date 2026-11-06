import {readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createServiceConnections,detectConnection,cleanConnectionError,connectionUrl} from './service-connections.js';
import {createConnectionAdapter,providerForConnection} from './service-adapters.js';
export function installServiceConnections({ctx,dataDir,writeAtomic,onApply=()=>{},getLegacyMode=()=>false,getLegacyComplement=()=>false,isProfileInUse=()=>false,fetchImpl=fetch,apiOnly=false}){
  let handle;const file=join(dataDir,'service-connections.json');
  function register(state){
    const llm=ctx.get('llm'),providers=state.profiles.filter(p=>['openai','anthropic','responses'].includes(p.type)&&p.chatModel).map(p=>providerForConnection(p.id));
    if(handle){handle.replace(providers);return;}
    if(providers.length){if(!llm?.registerAdapter)throw Error('当前宿主不支持连接适配器，请升级 DSH 或继续使用原模型配置');ctx.effect(()=>{handle=llm.registerAdapter(providers,createConnectionAdapter({connections,attachments:ctx.get('attachments'),fetchImpl}));return handle;});}
  }
  const connections=createServiceConnections({apiOnly,getLegacyMode,getLegacyComplement,isProfileInUse,storage:{read(){try{if(statSync(file).size>4*1024*1024)throw Error('连接配置过大');return JSON.parse(readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}},write:data=>writeAtomic(file,data)},onChange:(state,flags)=>{register(state);onApply(state,flags);}});
  register(connections.raw());
  const web=ctx.get('webServer');if(web)ctx.effect(()=>web.register({kind:'exact',path:'/im-bridge/service-connections',handler(req,res){
    const send=(status,data)=>{if(!res.writableEnded){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}};
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'拒绝跨站修改连接'});}catch{return send(403,{error:'连接来源无效'});}
    if(req.method==='GET'){try{return send(200,{...connections.snapshot(),adapterSupported:!!ctx.get('llm')?.registerAdapter});}catch{return send(500,{error:'连接配置无法读取'});}}
    if(req.method!=='POST')return send(405,{error:'请使用 GET 或 POST'});
    let body='',large=false;req.setEncoding('utf8');req.on('data',chunk=>{if(large)return;body+=chunk;if(Buffer.byteLength(body)>131072){large=true;body='';send(413,{error:'连接请求过大'});}});req.on('end',()=>{if(large)return;void(async()=>{let input;
      try{
        input=JSON.parse(body||'{}');let result;
        if(input.action==='detect'){
          let apiKey=input.apiKey;if(!apiKey&&input.id){const old=connections.profile(input.id);if(old.apiKey&&new URL(connectionUrl(input.baseUrl)).origin!==new URL(old.baseUrl).origin)throw Error('服务所属站点已改变，请填写新站点的密钥后再检测');apiKey=old.apiKey;}
          result={detection:await detectConnection({...input,apiKey},{fetchImpl,apiOnly})};
        }else if(input.action==='save')result={profile:connections.save(input)};
        else if(input.action==='use')result=connections.use(input.id,input.kind);
        else if(input.action==='routes')result=connections.saveRoutes(input.routes||{});
        else if(input.action==='remove')result=connections.remove(input.id);
        else throw Error('未知连接操作');
        send(200,{ok:true,...result});
      }catch(error){send(400,{error:cleanConnectionError(error,input?.apiKey)});}
    })();});
  }}));
  return {...connections,adapterSupported:()=>!!ctx.get('llm')?.registerAdapter};
}
