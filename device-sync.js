import {buildUnionPlan} from './sync-union.js';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile),CHUNK=3*1024*1024,PORT_PHONE=19482,PORT_PC=19483;
const digest=b=>createHash('sha256').update(b).digest('hex');
const readJSON=(file,fallback={})=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}};
const atomic=(file,bytes)=>{fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,file);};
const jsonBytes=v=>Buffer.from(JSON.stringify(v));
const DATA=new Set(['settings.json','state.json','features.json','usage.json','sticker-notes.json','memories.json','phone-mobile-secrets.json','phone-mobile-secrets.key','phone-payment-ledger.json','website-reading.json','life-execution.json','expression-learning.json']);
export function validKey(key){return typeof key==='string'&&key.length<1200&&!/[\\\x00-\x1f:]/.test(key)&&key.split('/').every(x=>x&&x!=='.'&&x!=='..')&&/^(?:data|cache|memory|persona|humanism|workspace|source|profiles|secrets)\//.test(key);}
export function planSync(left,right,base={},prefer='phone'){
 const work=[],conflicts=[];
 for(const key of new Set([...Object.keys(left),...Object.keys(right)])){
  const a=left[key]?.hash,b=right[key]?.hash,old=base[key];if(a===b)continue;
  let from;
  if(old!==undefined&&a===old)from='phone';else if(old!==undefined&&b===old)from='desktop';
  else if(!a&&old===undefined)from='phone';else if(!b&&old===undefined)from='desktop';
  else{conflicts.push(key);from=prefer;}
  const meta=(from==='desktop'?left:right)[key];work.push({key,from,to:from==='desktop'?'phone':'desktop',hash:meta?.hash,size:meta?.size||0,remove:!meta,conflict:conflicts.includes(key)});
 }
 return{work,conflicts};
}
export function createDeviceSync(options){
 const own=options.device||(process.platform==='win32'?'desktop':'phone'),dir=path.join(options.dataDir,'device-sync'),pairFile=path.join(dir,'pairing.json');
 fs.mkdirSync(dir,{recursive:true});let server=null,closed=false,busy=false,lastError='',forwardOrigin='',codeChanged=false,sending=null,usbTimer=null;
 const statusFile=path.join(dir,'last-sync.json');
 const pairing=()=>readJSON(pairFile);
 const localSettings=()=>readJSON(path.join(options.dataDir,'settings.json'));
 function rootMap(){return{data:options.dataDir,...options.roots(),source:options.sourceDir,profiles:path.join(dir,'profiles')};}
 function resolveKey(key){
  if(!validKey(key))throw Error('同步路径无效');const [kind,...parts]=key.split('/');
  if(kind==='secrets')throw Error('凭据必须通过凭据服务读写');
  if(kind==='data'&&(!DATA.has(parts.join('/'))||parts.length!==1))throw Error('不允许访问该插件运行文件');
  if(kind==='source'&&(parts.includes('node_modules')||parts.includes('.git')||parts.at(-1)==='cordis.patch.yml'||/^media-runtime(?:-mobile|-desktop)?\.json$/.test(parts.at(-1))))throw Error('设备配置不参与版本同步');
  const root=rootMap()[kind];if(!root)throw Error('同步目录不存在');const target=path.resolve(root,...parts),relative=path.relative(path.resolve(root),target);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('同步路径越界');
  let parent=root;for(const part of parts){parent=path.join(parent,part);if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw Error('同步不跟随符号链接');}
  return target;
 }
 function replacePaths(value,toPortable){
  const roots=Object.entries(rootMap()).filter(([k])=>!['source','profiles'].includes(k)).sort((a,b)=>b[1].length-a[1].length);
  const walk=v=>{if(typeof v==='string'){for(const [kind,root]of roots){const marker='@bridge/'+kind,forms=[root,root.replaceAll('\\','/')];if(toPortable){for(const f of forms)v=v.split(f).join(marker);if(v.startsWith(marker))v=v.replaceAll('\\','/');}else if(v.startsWith(marker)){const suffix=v.slice(marker.length).replaceAll('\\','/');v=path.join(root,...suffix.split('/').filter(Boolean));}else v=v.split(marker).join(root);}return v;}if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,w])=>[k,walk(w)]));return v;};return walk(value);
 }
 function deviceProfile(){const s=localSettings();return{device:own,connections:s.accounts||[],voice:{pythonPath:s.voice?.pythonPath||'',pythonLib:s.voice?.pythonLib||''},cacheDir:s.cacheDir||'',memoryDir:s.memoryDir||'',stateChats:readJSON(path.join(options.dataDir,'state.json')).chats||{}};}
 function canonical(key,bytes,toPortable=true){
  if(!key.endsWith('.json')){if(key==='source/client.js'){let s=bytes.toString();s=toPortable?s.replace(/dsh-im-bridge(?:-mobile)?(?![\w-])/g,'dsh-im-bridge-unified'):s.replaceAll('dsh-im-bridge-unified',own==='phone'?'dsh-im-bridge-mobile':'dsh-im-bridge');return Buffer.from(s);}return bytes;}
  let value;try{value=JSON.parse(bytes);}catch{return bytes;}
  value=replacePaths(value,toPortable);
  if(key==='source/package.json')value.name=toPortable?'dsh-im-bridge-unified':own==='phone'?'dsh-im-bridge-mobile':'dsh-im-bridge';
  if(key==='data/settings.json'){
   const local=localSettings();value.cacheDir=toPortable?'@bridge/cache':options.roots().cache;value.memoryDir=toPortable?'@bridge/memory':options.roots().memory;
   if(value.voice){value.voice.pythonPath=toPortable?'@device/voice/pythonPath':local.voice?.pythonPath||'';value.voice.pythonLib=toPortable?'@device/voice/pythonLib':local.voice?.pythonLib||'';}
   for(const account of value.accounts||[]){const ownAccount=(local.accounts||[]).find(a=>a.id===account.id)||(local.accounts||[]).find(a=>a.qq===account.qq);account.wsUrl=toPortable?'@device/onebot/url':ownAccount?.wsUrl||'ws://127.0.0.1:3001';account.token=toPortable?'@device/onebot/token':ownAccount?.token||'';}
  }
  if(key==='data/state.json'){value.chats={};value.accountPaused=true;value.manuallyLoggedOut=false;}
  if(key==='data/features.json')value.generation=0;
  return jsonBytes(value);
 }
 async function capture({flush=true}={}){
  if(flush)await options.flush();atomic(path.join(dir,'profiles',own+'.json'),jsonBytes(deviceProfile()));
  const manifest={};
  const add=(key,file)=>{if(!validKey(key))return;const stat=fs.lstatSync(file);if(stat.isSymbolicLink()||!stat.isFile())return;const bytes=canonical(key,fs.readFileSync(file));manifest[key]={hash:digest(bytes),size:bytes.length,modifiedAt:stat.mtimeMs};};
  for(const name of DATA){const f=path.join(options.dataDir,name);if(fs.existsSync(f))add('data/'+name,f);}
  const walk=(kind,root,relative='')=>{if(!fs.existsSync(root))return;for(const entry of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){if(entry.isSymbolicLink()||['node_modules','.git','.runtime','__pycache__'].includes(entry.name))continue;const rel=(relative?relative+'/':'')+entry.name,key=kind+'/'+rel;if(kind==='cache'&&/^(?:device-sync|backups|maintenance-backups)(?:\/|$)/.test(rel))continue;if(kind==='source'&&(entry.name==='cordis.patch.yml'||/^media-runtime(?:-mobile|-desktop)?\.json$/.test(entry.name)||/\.(?:tgz|png\.bak|pyc)$/.test(entry.name)))continue;if(entry.isDirectory())walk(kind,root,rel);else add(key,path.join(root,rel));}};
  for(const [kind,root]of Object.entries(rootMap()))if(kind!=='data')walk(kind,root);
  const credential=await options.credential();if(credential){const b=jsonBytes({deepseekKey:credential});manifest['secrets/deepseek.json']={hash:digest(b),size:b.length};}
  return{device:own,protocolVersion:2,version:readJSON(path.join(options.sourceDir,'package.json')).version||options.status().version,files:manifest};
 }
 async function read(key){if(key==='secrets/deepseek.json')return jsonBytes({deepseekKey:await options.credential()||''});return canonical(key,fs.readFileSync(resolveKey(key)));}
 async function rpc(origin,route,body){const p=pairing();if(!p.token||!origin)throw Error('请先通过数据线连接已配对设备');let response;try{response=await fetch(origin+route,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+p.token,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(120000)});}catch{throw Error('数据线连接中断，或另一端插件尚未启动');}let value;try{value=await response.json();}catch{throw Error('设备未返回有效同步结果');}if(!response.ok)throw Error(value.error||'设备同步请求失败');return value;}
 async function connect(){
  if(options.connectPeer){forwardOrigin=await options.connectPeer();return forwardOrigin;}
  const p=pairing();if(!p.token)throw Error('设备尚未配对');if(own==='phone')return'http://127.0.0.1:'+PORT_PC;
  const adb=p.adbPath;if(!adb||!p.serial)throw Error('电脑未配置配对手机');
  const call=async args=>(await execute(adb,['-s',p.serial,...args],{windowsHide:true,timeout:15000,maxBuffer:1024*1024})).stdout.trim();
  try{if(await call(['get-state'])!=='device')throw Error();if(forwardOrigin){const list=await call(['forward','--list']),port=new URL(forwardOrigin).port;if(!list.split(/\r?\n/).some(line=>line.trim().split(/\s+/)[1]==='tcp:'+port))forwardOrigin='';}if(!forwardOrigin){const port=Number(await call(['forward','tcp:0','tcp:'+PORT_PHONE]));forwardOrigin='http://127.0.0.1:'+port;}await call(['reverse','tcp:'+PORT_PC,'tcp:'+PORT_PC]);return forwardOrigin;}catch{forwardOrigin='';throw Error('未检测到已授权的配对手机，请连接数据线并打开DSHBox');}
 }
 async function peerCall(route,body){let origin=own==='desktop'?forwardOrigin:'http://127.0.0.1:'+PORT_PC;if(!origin)origin=await connect();try{return await rpc(origin,route,body);}catch(error){if(own==='desktop'){forwardOrigin='';throw error;}throw error;}}
 const local={
  async status(){return{...options.status(),protocolVersion:2,paired:!!pairing().token,busy,lastSync:readJSON(statusFile,null),codeReloadRequired:codeChanged};},
  async pause(){await options.pause();await options.flush();return{paused:true};},
  async select(body){if(!['desktop','phone'].includes(body.device))throw Error('运行设备无效');atomic(path.join(dir,'active-device.json'),jsonBytes({device:body.device,at:Date.now()}));return{selected:body.device};},
  async resume(){if(!allowRun())throw Error('当前设备处于待机，请从设备与同步页切换运行设备');await options.resume();return{paused:false};},
  async manifest(body={}){return capture({flush:body.flush!==false});},
  async chunk(body){if(!Number.isSafeInteger(body.offset)||body.offset<0)throw Error('同步偏移无效');if(!sending||sending.key!==body.key||sending.hash!==body.hash){const bytes=await read(body.key);if(digest(bytes)!==body.hash)throw Error('数据在读取期间发生变化，请重新同步');sending={key:body.key,hash:body.hash,bytes};}const bytes=sending.bytes,data=bytes.subarray(body.offset,body.offset+CHUNK).toString('base64');if(body.offset+CHUNK>=bytes.length)sending=null;return{data};},
  async stage(body){if(!/^[a-f0-9-]{36}$/.test(body.id)||!validKey(body.key)||!Number.isSafeInteger(body.offset)||body.offset<0||body.offset>2**40)throw Error('同步分块参数无效');resolveKey(body.key==='secrets/deepseek.json'?'data/settings.json':body.key);const file=path.join(dir,'stage',body.id,digest(body.key));fs.mkdirSync(path.dirname(file),{recursive:true});const bytes=Buffer.from(body.data||'','base64');if(bytes.length>CHUNK)throw Error('分块过大');const size=fs.existsSync(file)?fs.statSync(file).size:0;if(size!==body.offset)throw Error('同步分块顺序无效');fs.appendFileSync(file,bytes,{mode:0o600});return{size:size+bytes.length};},
  async commit(body){
   if(!options.status().paused)throw Error('写入前必须暂停当前桥接');if(!/^[a-f0-9-]{36}$/.test(body.id)||!Array.isArray(body.items)||body.items.length>200000)throw Error('提交参数无效');
   const backup=path.join(dir,'backups',body.id),prepared=[];fs.mkdirSync(backup,{recursive:true});
   for(const item of body.items){if(!validKey(item.key))throw Error('同步路径无效');const target=item.key==='secrets/deepseek.json'?null:resolveKey(item.key);let bytes=null;if(!item.remove){const stage=path.join(dir,'stage',body.id,digest(item.key));bytes=fs.readFileSync(stage);if(digest(bytes)!==item.hash||bytes.length!==item.size)throw Error('同步校验失败，未覆盖本地数据');bytes=canonical(item.key,bytes,false);}const old=target?(fs.existsSync(target)?fs.readFileSync(target):null):jsonBytes({deepseekKey:await options.credential()||''});if(old)atomic(path.join(backup,digest(item.key)),old);prepared.push({item,target,bytes,old});}
   atomic(path.join(backup,'manifest.json'),jsonBytes(prepared.map(x=>({key:x.item.key,existed:!!x.old,remove:x.item.remove}))));
   try{for(const p of prepared){if(p.target){if(p.item.remove){if(fs.existsSync(p.target))fs.unlinkSync(p.target);}else atomic(p.target,p.bytes);if(p.item.key.startsWith('source/'))codeChanged=true;}else await options.credential(p.bytes?JSON.parse(p.bytes).deepseekKey:'');}if(!body.deferReload)await options.reload();}
   catch{for(const p of prepared){if(p.target){if(p.old)atomic(p.target,p.old);else if(fs.existsSync(p.target))fs.unlinkSync(p.target);}else await options.credential(JSON.parse(p.old).deepseekKey);}try{await options.reload();}catch{}throw Error('同步应用失败，已回退本次本地写入，请保持两端暂停后重试');}
   for(const p of prepared)if(!p.item.remove){try{fs.unlinkSync(path.join(dir,'stage',body.id,digest(p.item.key)));}catch{}}
   return{committed:prepared.length,backup:true,codeReloadRequired:codeChanged};
  },
 };
 const invoke=(side,method,body)=>side===own?local[method](body):peerCall('/'+method,body||{});
 async function synchronize({activate}={}){
  if(activate!==undefined&&!['desktop','phone'].includes(activate))throw Error('运行设备无效');
  if(own!=='desktop')return peerCall('/coordinate',{activate});if(busy)throw Error('已有同步或切换正在进行');busy=true;lastError='';
  try{
   await connect();const before={desktop:await local.status(),phone:await peerCall('/status')};
   await local.pause();await peerCall('/pause',{});
   const [a,b]=await Promise.all([local.manifest(),peerCall('/manifest',{})]);
   const readFrom=async(side,key,meta)=>{const chunks=[];for(let offset=0;offset<meta.size||offset===0;offset+=CHUNK){const part=await invoke(side,'chunk',{key,hash:meta.hash,offset});chunks.push(Buffer.from(part.data,'base64'));}const bytes=Buffer.concat(chunks);if(bytes.length!==meta.size||digest(bytes)!==meta.hash)throw Error('同步读取校验失败');return bytes;};
   const plan=await buildUnionPlan(a,b,{read:readFrom}),id=randomUUID();
   const legacyPeer=before.phone.protocolVersion!==2;
   const work=legacyPeer?plan.work.filter(x=>x.key.startsWith('source/')):plan.work;
   if(legacyPeer&&!work.length)throw Error('另一端仍在运行旧版同步，请先重载另一端插件，再使用一键合并同步');
   const codeReloadRequired=work.some(x=>x.key.startsWith('source/'));
   for(const item of work){if(item.remove)continue;for(let offset=0;offset<item.size||offset===0;offset+=CHUNK){const data=item.bytes?item.bytes.subarray(offset,offset+CHUNK).toString('base64'):(await invoke(item.from,'chunk',{key:item.sourceKey||item.key,hash:item.hash,offset})).data;await invoke(item.to,'stage',{id,key:item.key,offset,data});}}
   // Both sides are fully staged before any local file is replaced.
   for(const side of ['desktop','phone']){const items=work.filter(x=>x.to===side).map(({bytes,from,sourceKey,...item})=>item);if(items.length)await invoke(side,'commit',{id,items,deferReload:codeReloadRequired});}
   const [afterA,afterB]=await Promise.all([local.manifest({flush:!codeReloadRequired}),peerCall('/manifest',{flush:!codeReloadRequired})]);const agreed={};for(const [key,value]of Object.entries(afterA.files))if(value.hash===afterB.files[key]?.hash)agreed[key]=value.hash;
   for(const item of work){const after=item.to==='desktop'?afterA:afterB;if(item.remove?!!after.files[item.key]:after.files[item.key]?.hash!==item.hash)throw Error('同步后校验未通过，保留两端暂停与恢复副本：'+item.key);}
   atomic(path.join(dir,'base.json'),jsonBytes({pairId:pairing().pairId,files:agreed}));
   const target=activate||(!before.phone.paused?'phone':!before.desktop.paused?'desktop':null);
   if(target){for(const side of ['desktop','phone'])await invoke(side,'select',{device:target});if(!codeReloadRequired&&!legacyPeer)await invoke(target,'resume',{});}
   const report={ok:true,at:Date.now(),files:work.length,bytes:work.reduce((n,x)=>n+x.size,0),conflicts:plan.conflicts.length,conflictPolicy:'union',versionPolicy:'higher-version',sourceDevice:plan.sourceSide,selectedVersion:plan.version,dataMerged:!legacyPeer,activeDevice:codeReloadRequired?'paused':target||'paused',versions:{desktop:afterA.version,phone:afterB.version},verifiedFiles:Object.keys(agreed).length,backup:true,codeReloadRequired,needsReload:codeReloadRequired,legacyVersionUpgradeOnly:legacyPeer};atomic(statusFile,jsonBytes(report));return report;
  }catch(error){lastError=error.message;throw error;}finally{busy=false;}
 }
 async function summary(){
  const self=await local.status();let peer=null,connectionError='';try{if(own==='desktop')await connect();peer=await peerCall('/status');}catch(error){connectionError=error.message;}
  return{self,peer,usbConnected:!!peer,busy:busy||peer?.busy,lastSync:self.lastSync||peer?.lastSync||null,error:lastError||connectionError,scope:'插件设置、密钥、支付保险箱、聊天记录、记忆、日程、学习、成长、图片、语音、附件与插件源码；设备自己的QQ连接及运行工具单独适配。'};
 }
 async function activateLocal(){
  if(busy)throw Error('已有同步或切换正在进行');busy=true;lastError='';
  try{
   let peer=null;try{await connect();peer=await peerCall('/status');}catch{}
   if(peer){await peerCall('/pause',{});await peerCall('/select',{device:own});}
   await local.pause();await local.select({device:own});await options.resume({explicit:true});
   return{ok:true,activeDevice:own,peerCoordinated:!!peer,localOnly:!peer,...await local.status()};
  }catch(error){lastError=error.message;throw error;}finally{busy=false;}
 }
 async function coordinate(body){if(!['sync','switch','status','activate-local'].includes(body.action||'sync'))throw Error('不支持的设备操作');if(body.action==='status')return summary();if(body.action==='activate-local')return activateLocal();if(body.action==='switch'&&!['phone','desktop'].includes(body.device))throw Error('运行设备无效');return synchronize({activate:body.activate|| (body.action==='switch'?body.device:undefined)});}
 const reply=(res,code,v)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(v));};
 async function bodyOf(req){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>5*1024*1024)throw Error('同步请求过大');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}
 async function handle(req,res,authenticated=false){
  try{const route=new URL(req.url,'http://localhost').pathname;if(authenticated){const p=pairing(),a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+(p.token||''));if(!p.token||req.headers.origin||a.length!==b.length||!timingSafeEqual(a,b))return reply(res,401,{error:'设备配对验证失败'});}
   else{if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)return reply(res,403,{error:'拒绝跨站设备操作'});if(req.method!=='GET'&&!String(req.headers['content-type']||'').startsWith('application/json'))return reply(res,415,{error:'需要JSON请求'});}
   if(route==='/im-bridge/device-sync'&&req.method==='GET')return reply(res,200,await summary());
   if(route==='/im-bridge/device-sync'&&req.method==='POST')return reply(res,200,await coordinate(await bodyOf(req)));
   if(!authenticated)return reply(res,404,{error:'设备操作不存在'});
   if(route==='/status'&&req.method==='GET')return reply(res,200,await local.status());
   if(req.method!=='POST')return reply(res,405,{error:'需要POST'});const body=await bodyOf(req),method=route.slice(1);
   if(method==='coordinate')return reply(res,200,await coordinate(body));
   if(method==='phone'){if(own!=='phone')throw Error('仅手机端提供手机操作');return reply(res,200,await options.phone(body));}
   if(!['pause','resume','select','manifest','chunk','stage','commit'].includes(method))return reply(res,404,{error:'不支持的设备操作'});
   return reply(res,200,await local[method](body));
  }catch(error){return reply(res,400,{error:String(error.message||'设备操作失败').slice(0,300)});}
 }
 async function start(){options.register({kind:'exact',path:'/im-bridge/device-sync',handler:(req,res)=>void handle(req,res)});server=createServer((req,res)=>void handle(req,res,true));server.requestTimeout=120000;server.maxConnections=8;await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(own==='phone'?PORT_PHONE:PORT_PC,'127.0.0.1',resolve);});server.unref();if(own==='desktop'&&!options.connectPeer){void connect().catch(()=>{});usbTimer=setInterval(()=>{if(!closed&&!busy)void connect().catch(()=>{});},10000);usbTimer.unref();}}
 function close(){closed=true;if(usbTimer)clearInterval(usbTimer);server?.close();if(own==='desktop'&&forwardOrigin&&!options.connectPeer){const p=pairing(),port=new URL(forwardOrigin).port;void execute(p.adbPath,['-s',p.serial,'forward','--remove','tcp:'+port],{windowsHide:true}).catch(()=>{});}}
 function allowRun(){const selected=readJSON(path.join(dir,'active-device.json'));return !selected.device||selected.device===own;}
 return{start,close,summary,synchronize,coordinate,activateLocal,local,resolveKey,canonical,allowRun,phoneRequest:body=>peerCall('/phone',body)};
}
