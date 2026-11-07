import {randomUUID} from 'node:crypto';
import {apiOnlyConnections,assertMobileConnection,mobileApiMessage} from './mobile-api-policy.js';
export const CONNECTION_TYPES=['openai','anthropic','responses','comfyui','voicelab','runninghub'];
export function connectionUrl(value){
  const url=new URL(String(value||'').trim());
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error('连接地址需要是不含账号、密钥和查询参数的 HTTP/HTTPS 地址');
  url.pathname=url.pathname.replace(/\/(?:chat\/completions|images\/(?:generations|edits)|audio\/speech|videos|responses|messages)\/?$/,'').replace(/\/+$/,'');return url.href.replace(/\/$/,'');
}
export function connectionEndpoint(base,path){return base.replace(/\/+$/,'')+'/'+path.replace(/^\//,'');}
export function normalizeConnectionPaths(input={},base){
  const origin=new URL(base).origin,paths={};
  for(const kind of ['chat','image','speech',...['video','videoStatus','videoContent'].filter(k=>Object.hasOwn(input||{},k))]){
    const value=String(input?.[kind]||'').trim();if(!value){paths[kind]='';continue;}
    if(value.length>1000||/[\u0000-\u0020\\]/.test(value))throw Error('自定义接口路径无效');
    const url=new URL(value,base.replace(/\/+$/,'')+'/');
    if(url.origin!==origin||url.username||url.password||url.search||url.hash)throw Error('自定义接口必须属于当前服务站点，且不含密钥、查询参数或片段');
    paths[kind]=['videoStatus','videoContent'].includes(kind)?url.pathname.replace(/%7Bid%7D/gi,'{id}'):url.pathname;
  }
  return paths;
}
export function connectionRequestUrl(profile,kind,fallback){
  const override=normalizeConnectionPaths(profile.paths,profile.baseUrl)[kind];
  return override?new URL(override,profile.baseUrl).href:connectionEndpoint(profile.baseUrl,fallback);
}
export function connectionHeaders(profile){return {'user-agent':'qq-bridge/1.48.0',...(profile.apiKey?(profile.type==='anthropic'?{'x-api-key':profile.apiKey,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+profile.apiKey}):{} )};}
export function cleanConnectionError(error,key=''){return String(error?.message||error||'连接未完成').split(key||'\u0000').join('[密钥已隐藏]').replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').slice(0,240);}
export function publicConnection(profile){const {apiKey,...safe}=profile;return {...safe,hasKey:!!apiKey};}
export const defaultServiceRoutes=()=>({enabled:false,chat:'host',image:'legacy',speech:'legacy'});
export async function detectConnection(input,{fetchImpl=fetch,signal,apiOnly=false}={}){
  assertMobileConnection(input.type,apiOnly);
  const original=String(input.baseUrl||''),base=connectionUrl(original),url=new URL(base),key=String(input.apiKey||'').trim();
  if(/(^|\.)runninghub\.(cn|ai)$/i.test(url.hostname))return {type:'runninghub',baseUrl:base,models:[],evidence:['识别为 RunningHub，继续使用原有工作流配置，不推测节点或调用方式'],capabilities:{workflow:'required'},checkedAt:Date.now()};
  const controller=AbortSignal.any([AbortSignal.timeout(20000),...(signal?[signal]:[])]),evidence=[];
  const get=async(path,type='openai')=>{
    try{const r=await fetchImpl(connectionEndpoint(base,path),{method:'GET',headers:connectionHeaders({type,apiKey:key}),redirect:'error',signal:controller});if(!r.ok){evidence.push(path+'：HTTP '+r.status);await r.body?.cancel?.();return null;}const text=await readConnectionText(r,2*1024*1024);return JSON.parse(text);}catch(e){if(controller.aborted)throw Error('连接检测超时或已取消');evidence.push(path+'：未取得可识别信息');return null;}
  };
  if(!apiOnly&&!/\/v\d(?:beta)?$/.test(url.pathname)){
    const stats=await get('system_stats');if(stats?.system&&Array.isArray(stats.devices))return {type:'comfyui',baseUrl:base,models:[],evidence:['已取得 ComfyUI system_stats；模型和生成能力由导入的工作流决定'],capabilities:{workflow:'required'},checkedAt:Date.now()};
    const voice=await get('api/status');if(voice&&typeof voice.busy==='boolean'&&voice.phase!==undefined&&voice.pid!==undefined)return {type:'voicelab',baseUrl:base,models:[],evidence:['已取得 VoiceLab 状态；合成使用本地语音服务'],capabilities:{speech:'verified-service'},checkedAt:Date.now()};
  }
  const hinted=input.type&&input.type!=='auto'?input.type:/\/messages\/?$/.test(original)||/anthropic|claude/.test(url.hostname)?'anthropic':/\/responses\/?$/.test(original)?'responses':'openai';
  for(const candidate of [...new Set([base, /\/v\d+$/.test(url.pathname)?base:base+'/v1'])]){
    let listing;
    const type=hinted==='anthropic'?'anthropic':'openai';
    try{const r=await fetchImpl(candidate+'/models',{method:'GET',headers:connectionHeaders({type,apiKey:key}),redirect:'error',signal:controller});if(r.ok)listing=JSON.parse(await readConnectionText(r,2*1024*1024));else {evidence.push(new URL(candidate).pathname+'/models：HTTP '+r.status);await r.body?.cancel?.();}}catch{if(controller.aborted)throw Error('连接检测超时或已取消');}
    if(Array.isArray(listing?.data)){
      const models=[...new Set(listing.data.map(x=>String(x?.id||'').trim()).filter(x=>x&&x.length<=200))].slice(0,300);
      if(models.length)return {type:hinted,baseUrl:candidate,models,evidence:['已验证模型列表 GET '+new URL(candidate).pathname+'/models','模型列表不证明图片、语音、视觉或工具能力；生成接口仅按所选协议配置，尚未执行付费调用'],capabilities:{chat:'listed',image:'unverified',speech:'unverified',video:'unverified'},checkedAt:Date.now()};
    }
  }
  if(!apiOnly&&!/\/v\d+$/.test(url.pathname)){
    const tags=await get('api/tags');if(Array.isArray(tags?.models)&&tags.models.length)return {type:'openai',baseUrl:base+'/v1',models:tags.models.map(x=>x.name||x.model).filter(Boolean).slice(0,300),evidence:['已取得 Ollama 模型列表；使用它的 OpenAI 兼容入口','未执行模型推理，具体多模态能力仍待验证'],capabilities:{chat:'listed',image:'unverified',speech:'unverified',video:'unverified'},checkedAt:Date.now()};
  }
  return {type:input.type&&input.type!=='auto'?input.type:'unknown',baseUrl:base,models:[],evidence:[...evidence.slice(-6),'无法仅凭地址与密钥确认协议；可手动选择类型、填写模型，或补充接口文档。没有发送试生成请求。'],capabilities:{chat:'unknown',image:'unknown',speech:'unknown',video:'unknown'},checkedAt:Date.now()};
}
export async function readConnectionText(response,limit=4*1024*1024){
  if(!response.body){const text=await response.text();if(Buffer.byteLength(text)>limit)throw Error('接口响应过大');return text;}
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('接口响应过大');chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks).toString('utf8');
}
export function createServiceConnections({storage,onChange=()=>{},getLegacyMode=()=>false,getLegacyComplement=()=>false,isProfileInUse=()=>false,apiOnly=false}){
  const load=()=>{const raw=storage.read();return apiOnlyConnections(raw&&Array.isArray(raw.profiles)?raw:{version:1,profiles:[],routes:defaultServiceRoutes()},apiOnly);};
  const snapshot=()=>{const s=load();return {...s,apiOnly,profiles:s.profiles.filter(p=>!apiOnly||['openai','anthropic','responses','runninghub'].includes(p.type)).map(publicConnection)};};
  const route=kind=>{const s=load();return s.routes?.enabled?s.routes[kind]||'legacy':'legacy';};
  function commit(state,flags){const previous=load();storage.write(state);try{onChange(state,flags);}catch(error){storage.write(previous);try{onChange(previous,{rollback:true});}catch{}throw error;}}
  function profile(id){const found=load().profiles.find(p=>p.id===String(id).replace(/^profile:/,''));if(!found)throw Error('所选连接已移除，请重新选择');assertMobileConnection(found.type,apiOnly);return found;}
  function save(input){
    const state=load(),old=state.profiles.find(p=>p.id===input.id),id=old?.id||'conn_'+randomUUID().replaceAll('-','').slice(0,12);
    const type=input.type??old?.type,baseUrl=connectionUrl(input.baseUrl??old?.baseUrl);
    assertMobileConnection(type,apiOnly);
    if(!old&&state.profiles.length>=30)throw Error('最多保存 30 个连接');
    if(!CONNECTION_TYPES.includes(type))throw Error('先识别或手动选择连接类型');
    if(old?.apiKey&&!input.apiKey&&!input.clearKey&&new URL(baseUrl).origin!==new URL(old.baseUrl).origin)throw Error('服务所属站点已改变，请重新填写该站点的密钥，旧密钥不会自动发送过去');
    const p={id,name:String(input.name??old?.name??'未命名连接').trim().slice(0,80),type,baseUrl,apiKey:input.clearKey?'':String(input.apiKey||old?.apiKey||'').trim().slice(0,4000),chatModel:String(input.chatModel??old?.chatModel??'').trim().slice(0,200),imageModel:String(input.imageModel??old?.imageModel??'').trim().slice(0,200),speechModel:String(input.speechModel??old?.speechModel??'').trim().slice(0,200),voice:String(input.voice??old?.voice??'').trim().slice(0,120),imageMode:(input.imageMode??old?.imageMode)==='edits'?'edits':'generations',models:Array.isArray(input.models)?input.models.filter(x=>typeof x==='string'&&x.length<=200).slice(0,300):old?.models||[],evidence:Array.isArray(input.evidence)?input.evidence.map(x=>String(x).slice(0,200)).slice(0,8):old?.evidence||[]};
    p.paths=normalizeConnectionPaths(input.paths===undefined?old?.paths:input.paths,p.baseUrl);
    p.videoModel=String(input.videoModel??old?.videoModel??'').trim().slice(0,200);
    p.videoMode=(input.videoMode||old?.videoMode)==='json'?'json':'multipart';
    p.audioFormat=(input.audioFormat||old?.audioFormat)==='mp3'?'mp3':'wav';
    state.profiles=state.profiles.filter(x=>x.id!==id).concat(p);commit(state);return publicConnection(p);
  }
  function saveRoutes(input){
    if(apiOnly&&['chat','image','speech'].some(kind=>input[kind]==='local'))throw Error(mobileApiMessage);
    const state=load(),routes={enabled:input.enabled===true,chat:String(input.chat||'host'),image:String(input.image||'legacy'),speech:String(input.speech||'legacy')};
    for(const kind of ['chat','image','speech']){
      const value=routes[kind];if(['local',kind==='chat'?'host':'legacy'].includes(value))continue;
      const p=state.profiles.find(x=>'profile:'+x.id===value);if(!p)throw Error('所选连接不存在：'+kind);
      if(!['openai','responses','anthropic'].includes(p.type)||kind!=='chat'&&p.type!=='openai')throw Error('该连接类型不能直接用于此项；ComfyUI 和 VoiceLab 请使用本地选项，RunningHub 沿用图片页');
      if(!p[kind==='chat'?'chatModel':kind==='image'?'imageModel':'speechModel'])throw Error('请先为所选连接填写对应模型');
      if(kind==='speech'&&!p.voice)throw Error('请先为语音连接填写音色 ID');
    }
    if(routes.enabled&&!state.routes?.enabled){state.legacyLocalEnabled=getLegacyMode()===true;state.legacyApiComplement=getLegacyComplement()===true;}
    state.routes=routes;commit(state,{routes:true});
    return snapshot();
  }
  function remove(id){const state=load();if(Object.values(state.routes||{}).includes('profile:'+id)||isProfileInUse(id))throw Error('此连接仍在搭配或聊天模型中使用，请先切换来源');state.profiles=state.profiles.filter(x=>x.id!==id);commit(state);return snapshot();}
  function use(id,kind){
    if(!['chat','image','speech'].includes(kind))throw Error('请选择聊天、图片或语音用途');
    const p=profile(id),state=load(),local=getLegacyMode()===true;
    const routes=state.routes?.enabled?{...state.routes}:{enabled:true,chat:local?'local':'host',image:local?'local':'legacy',speech:local?'local':'legacy'};
    routes.enabled=true;routes[kind]='profile:'+p.id;return saveRoutes(routes);
  }
  function selectChatModel(selection){
    const state=load(),custom=selection?.provider?.startsWith('qq-connection-');
    if(!custom&&!state.routes?.enabled)return;
    let chat='host';
    if(custom){
      const p=state.profiles.find(p=>'qq-connection-'+p.id===selection.provider);
      if(!p||!['openai','anthropic','responses'].includes(p.type))throw Error('所选聊天连接不存在或协议不支持聊天');
      if(!selection.model?.trim())throw Error('请填写聊天模型');
      p.chatModel=selection.model.trim().slice(0,200);chat='profile:'+p.id;
    }
    if(state.routes?.enabled)state.routes={...state.routes,chat};
    commit(state,{routes:state.routes?.enabled===true});
  }
  return {snapshot,save,saveRoutes,use,selectChatModel,remove,route,profile,raw:load};
}
