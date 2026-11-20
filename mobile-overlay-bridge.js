import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {readFileSync,statSync} from 'node:fs';
import {normalizeSharedFrame,sharedTokenMatches} from './shared-visual-input.js';

const secret=()=>randomBytes(32).toString('base64url');
const rpcPath='/im-bridge/mobile-overlay';
const apkPath=rpcPath+'.apk';
const connectPath='/im-bridge/companion-connect';
const installPath='/im-bridge/companion-install';
const application='io.dsh.companion.overlay';
const apkFile=new URL('./assets/mobile-companion.apk',import.meta.url);
const handoffPage=(title,body)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1.25rem;color:#17334a;background:#f5faff}a,button{font:inherit;display:inline-block;padding:.55rem .8rem;border:1px solid #b9d3e5;border-radius:.6rem;background:#fff;color:#194d79;margin:0 .4rem .6rem 0}a[hidden],button[hidden],textarea[hidden]{display:none}textarea{display:block;width:100%;box-sizing:border-box}</style>
<main><h1>${title}</h1>${body}</main></html>`;
const downloadLink=`<a href="${apkPath}">下载组件 APK</a>`;
const installPage=handoffPage('安装屏幕陪伴组件',`<p>下载后，从浏览器的下载列表打开安装包，在 Android 安装器中确认。装好后回 QQ 桥接连接悬浮球。</p>${downloadLink}`);
const connectPage=handoffPage('连接屏幕陪伴',`<p id="state" role="status">正在读取连接信息…</p><a id="open" hidden>打开屏幕陪伴组件</a><button id="copy" hidden type="button">复制连接信息</button><textarea id="value" rows="3" readonly hidden aria-label="连接信息"></textarea><p>还未安装组件时，可以先下载并在 Android 安装器中确认。</p>${downloadLink}<script src="${connectPath}.js" defer></script>`);
const connectScript=`
const state=document.getElementById('state');
const link=document.getElementById('open');
const copy=document.getElementById('copy');
const value=document.getElementById('value');
const args=new URLSearchParams(location.hash.slice(1));
const ticket=args.get('ticket');
const expiresAt=Number(args.get('expiresAt'));
if(/^[A-Za-z0-9_-]{43}$/.test(ticket||'')&&expiresAt>Date.now()){
 const url='dshcompanion://connect#'+new URLSearchParams({base:location.origin,ticket}).toString();
 link.href=url;
 link.hidden=false;
 copy.hidden=false;
 state.textContent='打开屏幕陪伴组件后，按 Android 提示选择共享画面。打不开时，可复制连接信息后在组件里粘贴。';
 link.addEventListener('click',event=>{
  if(Date.now()>=expiresAt){event.preventDefault();state.textContent='连接已过期，请回 QQ 桥接刷新连接。';}
 });
 copy.addEventListener('click',async()=>{
  if(Date.now()>=expiresAt){state.textContent='连接已过期，请回 QQ 桥接刷新连接。';return;}
  try{await navigator.clipboard.writeText(url);state.textContent='已复制。请到屏幕陪伴组件粘贴连接信息。';}
  catch{value.value=url;value.hidden=false;value.focus();value.select();}
 });
}else{
 state.textContent='连接已过期或不完整，请回 QQ 桥接重新点连接。';
}
`;

function installerAvailable(){
 try{return statSync(apkFile).isFile();}catch{return false;}
}

export function serveMobileOverlayApk(req,res){
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{allow:'GET, HEAD'}).end();return;}
 try{
  const bytes=readFileSync(apkFile);
  res.writeHead(200,{'content-type':'application/vnd.android.package-archive','content-disposition':'attachment; filename="DSH-Companion.apk"','content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:bytes);
 }catch{
  res.writeHead(404,{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}).end('当前插件包缺少屏幕陪伴组件');
 }
}

function serveHandoff(req,res){
 if(req.method!=='GET'){res.writeHead(405,{allow:'GET'}).end();return;}
 const script=req.url.endsWith('.js');
 res.writeHead(200,{'content-type':script?'text/javascript; charset=utf-8':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"});
 res.end(script?connectScript:req.url===installPath?installPage:connectPage);
}

// An optional, phone-only transport. No host APK patch, ADB or cloud token is used.
export function createMobileOverlayBridge({panelContext,valid,command,list,transcribe,now=Date.now,platform=process.platform}={}){
 let closed=false,nativeEndpoint;const tickets=new Map(),leases=new Map();
 const same=(a,b)=>a.key===b.key&&a.accountId===b.accountId&&a.personaId===b.personaId;
 function current(context){try{return valid(context,{target:'phone'})&&same(context,panelContext(context.key));}catch{return false;}}
 function prune(){for(const [t,p]of tickets)if(p.expires<=now()||!current(p.context))tickets.delete(t);for(const [t,p]of leases)if(p.expires<=now()||!current(p.context)){leases.delete(t);p.latest=null;}}
 function requireLease(token){prune();if(closed)throw Error('插件已关闭');const lease=[...leases.values()].find(l=>sharedTokenMatches(token,l.token));if(!lease)throw Error('连接已失效，请回插件重新连接悬浮球');lease.expires=now()+5*60_000;return lease;}
 function sessionFor(lease){return list().find(s=>same(s,lease.context)&&s.captureSource==='native');}
 function nativeOrigin(){
  if(!nativeEndpoint){
   // The companion owns its own credentials. The host web server requires
   // a separate DSH client credential and cannot receive the APK's claim.
   const server=createServer((req,res)=>{
    if(req.headers.host!=='127.0.0.1:'+server.address().port){
     res.writeHead(404).end();return;
    }
    if(req.url===rpcPath)return handler(req,res);
    if(req.url===apkPath)return serveMobileOverlayApk(req,res);
    if([installPath,connectPath,connectPath+'.js'].includes(req.url))return serveHandoff(req,res);
    res.writeHead(404).end();
   });
   const ready=new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port));
   });
   server.unref();
   nativeEndpoint={server,ready};
   ready.catch(()=>{nativeEndpoint=undefined;});
  }
  return nativeEndpoint.ready;
 }
 async function paired(context){
  if(closed||platform==='win32')throw Error('独立手机悬浮球仅在手机版使用');if(!current(context))throw Error('请先启用当前手机账号和陪伴功能');prune();
  const base=await nativeOrigin();
  if(closed||!current(context))throw Error('当前账号或陪伴服务已改变，请重新连接悬浮球');
  // Never include API credentials, QQ credentials, or a durable bearer in a URL.
  for(const [t,p]of tickets)if(p.context.key===context.key)tickets.delete(t);
  const ticket=secret(),expiresAt=now()+120_000;
  tickets.set(ticket,{context:{...context},expires:expiresAt});
  return {ok:true,url:'dshcompanion://connect#'+new URLSearchParams({base,ticket}),handoffUrl:base+connectPath+'#'+new URLSearchParams({ticket,expiresAt}),expiresAt,expiresIn:120,packageName:application};
 }
 async function installer(){
  if(closed||platform==='win32'||!installerAvailable())return {available:false};
  return {available:true,url:await nativeOrigin()+installPath};
 }
 async function execute(body,token){
  if(closed||platform==='win32')throw Error('手机悬浮接口不可用');
  if(body.action==='claim'){
   prune();const p=tickets.get(body.ticket);if(!p)throw Error('安装连接已过期，请回插件重新点击连接');tickets.delete(body.ticket);
   for(const [t,l]of leases)if(l.context.key===p.context.key){l.latest=null;leases.delete(t);}
   const token=secret(),lease={token,context:p.context,expires:now()+5*60_000,connectedAt:now(),latest:null,sessionId:null};leases.set(token,lease);return {ok:true,token,protocol:1};
  }
  const lease=requireLease(token),context=lease.context;let session=sessionFor(lease);
  if(body.action==='status'&&typeof body.sourceVisible==='boolean'&&body.sourceVisible!==lease.sourceVisible){
   lease.sourceVisible=body.sourceVisible;
   if(!lease.sourceVisible)lease.latest=null;
   else lease.connectedAt=now();
  }
  if(body.action==='status')return {ok:true,session:session||null,connected:true,protocol:1};
  if(body.action==='start'){
   session=await command({action:'start',target:'phone',captureSource:'native',mode:'watch',profile:body.profile,audio:false,control:false,sourceLabel:'手机系统屏幕共享'},context,{fromPanel:true});
   lease.sessionId=session.id;lease.latest=null;lease.connectedAt=now();return {ok:true,session};
  }
  if(!session||body.id!==session.id||lease.sessionId!==session.id)throw Error('陪伴会话已经切换，请重新连接');
  if(body.action==='frame'){
   if(session.status!=='running'||lease.sourceVisible===false)return {ok:true,accepted:false};
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
 function resetCapture(id){
  for(const lease of leases.values()){
   if(lease.sessionId!==id)continue;
   lease.latest=null;
   lease.connectedAt=now();
  }
 }
 function status(context){
  prune();
  const active=[...leases.values()].flatMap(lease=>{
   if(context&&!same(lease.context,context))return [];
   const session=sessionFor(lease);
   return session?.id===lease.sessionId&&['running','paused'].includes(session.status)?[{lease,session}]:[];
  });
  const ready=active.some(({lease,session})=>session.status==='running'&&lease.sourceVisible!==false&&lease.latest&&now()-lease.latest.capturedAt<=session.budget.maxAgeMs);
  return {supported:platform!=='win32',connected:active.length>0,ready,protocol:1};
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
 function close(){
  if(closed)return;
  closed=true;tickets.clear();for(const l of leases.values())l.latest=null;leases.clear();
  if(nativeEndpoint){const {server,ready}=nativeEndpoint;void ready.then(()=>{server.close();server.closeAllConnections();},()=>{});}
 }
 return {pair:paired,installer,execute,capture,resetCapture,handler,status,close};
}
