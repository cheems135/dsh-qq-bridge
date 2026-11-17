import {randomBytes} from 'node:crypto';
import {normalizeSharedFrame,sharedTokenMatches} from './shared-visual-input.js';

const secret=()=>randomBytes(32).toString('base64url');
// An optional, phone-only transport. No host APK patch, ADB or cloud token is used.
export function createMobileOverlayBridge({panelContext,valid,command,list,transcribe,now=Date.now,platform=process.platform}={}){
 let closed=false;const tickets=new Map(),leases=new Map();
 const same=(a,b)=>a.key===b.key&&a.accountId===b.accountId&&a.personaId===b.personaId;
 function current(context){try{return valid(context,{target:'phone'})&&same(context,panelContext(context.key));}catch{return false;}}
 function prune(){for(const [t,p]of tickets)if(p.expires<=now()||!current(p.context))tickets.delete(t);for(const [t,p]of leases)if(p.expires<=now()||!current(p.context)){leases.delete(t);p.latest=null;}}
 function requireLease(token){prune();if(closed)throw Error('插件已关闭');const lease=[...leases.values()].find(l=>sharedTokenMatches(token,l.token));if(!lease)throw Error('连接已失效，请回插件重新连接悬浮球');lease.expires=now()+5*60_000;return lease;}
 function sessionFor(lease){return list().find(s=>same(s,lease.context)&&s.captureSource==='native');}
 function paired(context,baseUrl){
  if(closed||platform==='win32')throw Error('独立手机悬浮球仅在手机版使用');if(!current(context))throw Error('请先启用当前手机账号和陪伴功能');prune();
  const base=new URL(baseUrl);if(base.protocol!=='http:'||base.hostname!=='127.0.0.1'||!base.port)throw Error('悬浮球只连接本机插件');
  // Never include API credentials, QQ credentials, or a durable bearer in a URL.
  for(const [t,p]of tickets)if(p.context.key===context.key)tickets.delete(t);
  const ticket=secret();tickets.set(ticket,{context:{...context},expires:now()+120_000});
  const fragment=new URLSearchParams({base:base.origin,ticket}).toString();return {ok:true,url:'dshcompanion://connect#'+fragment,expiresIn:120,packageName:'io.dsh.companion.overlay'};
 }
 async function execute(body,token){
  if(closed||platform==='win32')throw Error('手机悬浮接口不可用');
  if(body.action==='claim'){
   prune();const p=tickets.get(body.ticket);if(!p)throw Error('安装连接已过期，请回插件重新点击连接');tickets.delete(body.ticket);
   for(const [t,l]of leases)if(l.context.key===p.context.key){l.latest=null;leases.delete(t);}
   const token=secret(),lease={token,context:p.context,expires:now()+5*60_000,connectedAt:now(),latest:null,sessionId:null};leases.set(token,lease);return {ok:true,token,protocol:1};
  }
  const lease=requireLease(token),context=lease.context;let session=sessionFor(lease);
  if(body.action==='status'&&typeof body.sourceVisible==='boolean')lease.sourceVisible=body.sourceVisible;
  if(body.action==='status')return {ok:true,session:session||null,connected:true,protocol:1};
  if(body.action==='start'){
   session=await command({action:'start',target:'phone',captureSource:'native',mode:'watch',profile:body.profile,audio:false,control:false,sourceLabel:'手机系统屏幕共享'},context,{fromPanel:true});
   lease.sessionId=session.id;lease.latest=null;lease.connectedAt=now();return {ok:true,session};
  }
  if(!session||body.id!==session.id||lease.sessionId!==session.id)throw Error('陪伴会话已经切换，请重新连接');
  if(body.action==='frame'){
   if(session.status!=='running')return {ok:true,accepted:false};
   const frame=normalizeSharedFrame(body.frame,session.budget,now());
   if(lease.latest&&frame.capturedAt<=lease.latest.capturedAt)return {ok:true,accepted:false};
   frame.coverage='Android MediaProjection 持续屏幕共享中的最新画面；未采集系统声音';frame.audioState='not-captured';delete frame.audioChunk;
   lease.latest=frame;return {ok:true,accepted:true};
  }
  if(body.action==='transcribe'){
   if(session.status!=='running'||!transcribe)throw Error('请先开始陪伴，并配置 API 语音识别');
   const text=await transcribe(body.audio,context);
   requireLease(token);if(sessionFor(lease)?.id!==session.id||sessionFor(lease)?.status!=='running')throw Error('会话已改变，未返回旧录音的转写');return {ok:true,text};
  }
  if(!['input','pause','resume','stop','disconnect'].includes(body.action))throw Error('未知悬浮球操作');
  if(body.action==='resume')lease.connectedAt=now();
  const result=await command({action:body.action==='disconnect'?'stop':body.action,id:session.id,text:body.text},context,{fromPanel:true});
  if(['pause','stop','disconnect'].includes(body.action))lease.latest=null;
  if(body.action==='disconnect')leases.delete(token);
  return {ok:true,...(body.action==='input'?{receipt:result}:{session:result})};
 }
 function capture(options,context,budget){
  prune();const lease=[...leases.values()].find(l=>same(l.context,context)&&l.sessionId===context.visualSessionId);
  if(!lease)throw Error('独立悬浮球已断开，请回插件重新连接');
  if(lease.sourceVisible===false)return {pending:true,reason:'所选共享应用暂时不可见，返回该应用后继续观察'};
  if(!lease.latest){if(now()-lease.connectedAt<20_000)return {pending:true};throw Error('没有收到系统共享画面，请检查手机屏幕共享是否仍在运行');}
  if(now()-lease.latest.capturedAt>budget.maxAgeMs)throw Error('系统共享画面已停止更新，请重新连接屏幕共享');
  return {...lease.latest};
 }
 function handler(req,res){
  const send=(code,value)=>{if(!res.writableEnded){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));}};
  const peer=req.socket?.remoteAddress;if(peer&&!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer))return send(403,{error:'只接受本机连接'});
  if(req.headers.origin||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'请通过原生陪伴组件连接'});
  if(req.method!=='POST')return send(405,{error:'请使用POST'});
  let size=0,chunks=[],large=false;req.setTimeout?.(15000,()=>req.destroy());
  req.on('data',part=>{size+=Buffer.byteLength(part);if(size>3_000_000){large=true;chunks=[];}else if(!large)chunks.push(Buffer.from(part));});
  req.on('error',()=>{});req.on('end',()=>{if(large)return send(413,{error:'请求过大'});void(async()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');const token=String(req.headers.authorization||'').replace(/^Bearer /,'');send(200,await execute(body,token));}catch(e){send(400,{error:String(e.message).slice(0,400)});}})();});
 }
 return {pair:paired,execute,capture,handler,status:()=>{prune();return {supported:platform!=='win32',connected:leases.size>0,protocol:1};},close(){closed=true;tickets.clear();for(const l of leases.values())l.latest=null;leases.clear();}};
}
