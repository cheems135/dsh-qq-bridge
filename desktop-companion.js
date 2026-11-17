import {StringDecoder} from 'node:string_decoder';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const helper=fileURLToPath(new URL('./tools/companion-native.ps1',import.meta.url));
export function createDesktopCompanion({getCacheDir,spawnImpl=spawn,platform=process.platform,valid=()=>true,onWindowClosed=()=>{}}={}){
 let worker=null,output='',errors='',closed=false;const pending=new Map(),windows=new Map();
 function rejectAll(error){for(const item of pending.values())item.finish(error);pending.clear();}
 function ensureWorker(){
  if(closed||platform!=='win32')throw Error('桌面识屏仅在电脑版可用');if(worker)return worker;
  const child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',helper,'-Mode','capture'],{windowsHide:true,stdio:['pipe','pipe','pipe']});worker=child;output='';errors='';const decoder=new StringDecoder('utf8');
  child.stderr.on('data',b=>errors=(errors+b).slice(-2000));
  child.stdout.on('data',b=>{if(worker!==child)return;output+=decoder.write(b);if(output.length>5000000){child.kill();rejectAll(Error('屏幕采集结果过大，未送入模型'));return;}let cut;while((cut=output.indexOf('\n'))>=0){const line=output.slice(0,cut).trim();output=output.slice(cut+1);try{const row=JSON.parse(line),item=pending.get(row.id);if(item)item.finish(row.error?Error(row.error):null,row.result);}catch{}}});
  child.stdin.on('error',()=>{});child.on('error',e=>{if(worker===child){worker=null;rejectAll(Error('无法启动桌面采集组件：'+e.message));}});
  child.on('exit',()=>{if(worker===child){worker=null;rejectAll(Error('桌面采集组件已退出：'+errors.slice(-300)));}});return child;
 }
 function request(args,signal){return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Object.assign(Error('屏幕读取已取消'),{name:'AbortError'}));let child;try{child=ensureWorker();}catch(e){reject(e);return;}
  const id=randomUUID();let done=false;const abort=()=>finish(Object.assign(Error('屏幕读取已取消'),{name:'AbortError'}));
  const timer=setTimeout(()=>{finish(Error('屏幕采集超时，请检查桌面是否已解锁'));if(!pending.size&&worker===child)child.kill();},20000);
  function finish(error,value){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);pending.delete(id);error?reject(error):resolve(value);}
  pending.set(id,{finish});signal?.addEventListener('abort',abort,{once:true});child.stdin.write(JSON.stringify({...args,id})+'\n',error=>{if(error)finish(error);});
 });}
 const readState=entry=>{try{return JSON.parse(readFileSync(entry.stateFile,'utf8').replace(/^\uFEFF/,''));}catch{return null;}};
 function closeWindow(key){const entry=windows.get(key);if(!entry)return;windows.delete(key);clearInterval(entry.guard);entry.child.kill();}
 async function open({baseUrl,key,context}){
  if(closed||platform!=='win32')throw Error('独立桌面悬浮球仅在电脑版可用');if(!valid(context))throw Error('当前账号或桌面权限已改变');
  const url=new URL(baseUrl);if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password)throw Error('悬浮球只连接本机插件');
  const previous=windows.get(key);if(previous&&valid(previous.context)&&readState(previous)?.state==='ready')return {...readState(previous),native:true};if(previous?.ready&&valid(previous.context))return previous.ready;if(previous)closeWindow(key);
  const dir=join(getCacheDir(),'companion-desktop');mkdirSync(dir,{recursive:true});const stateFile=join(dir,randomUUID()+'.json'),token=randomUUID()+randomUUID();
  const child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-STA','-ExecutionPolicy','Bypass','-File',helper,'-Mode','window','-BaseUrl',url.origin,'-Key',key,'-Token',token,'-StateFile',stateFile],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const entry={child,stateFile,token,context};windows.set(key,entry);let error='';child.stderr.on('data',b=>error=(error+b).slice(-1500));child.stdout.on('data',()=>{});child.on('error',e=>{error=e.message;clearInterval(entry.guard);if(windows.get(key)===entry)windows.delete(key);});child.on('exit',()=>{clearInterval(entry.guard);if(windows.get(key)===entry){windows.delete(key);try{onWindowClosed(context);}catch{}}});
  entry.guard=setInterval(()=>{if(closed||!valid(context))closeWindow(key);},1500);entry.guard.unref?.();
  entry.ready=(async()=>{for(let n=0;n<100;n++){const state=readState(entry);if(state?.state==='ready')return {...state,native:true};if(windows.get(key)!==entry)throw Error('悬浮窗未能打开：'+error.slice(-400));await new Promise(r=>setTimeout(r,150));}
   closeWindow(key);throw Error('独立悬浮窗启动超时：'+error.slice(-300));})();
  try{return await entry.ready;}finally{entry.ready=null;}
 }
 return {capture:(options,context,budget)=>request({action:'capture',windowId:options.windowId||'',maxEdge:budget.maxEdge,quality:budget.quality},context.signal),sources:signal=>request({action:'sources'},signal),open,closeWindow,
  acceptsToken:token=>[...windows.values()].some(e=>e.token===token&&valid(e.context)),status:()=>({supported:platform==='win32',captureBackend:'windows-native-gdi',windows:[...windows.entries()].map(([key,e])=>({key,...readState(e)}))}),
  close(){closed=true;for(const key of windows.keys())closeWindow(key);worker?.kill();worker=null;rejectAll(Error('插件已关闭，屏幕采集已结束'));}};
}
