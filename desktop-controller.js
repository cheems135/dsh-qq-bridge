import {spawn} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export function createDesktopController({getCacheDir,authorize=()=>true,spawnImpl=spawn,platform=process.platform,nativeExecute,beforeAction}={}){
 const actions=['observe','windows','shortcuts','launch-shortcut','click','scroll','type','press','focus','launch'];let busy=false;
 async function act(args={},context={}){
  if(platform!=='win32')throw Error('当前运行在手机，请使用手机的Pilot工具');
  if(!authorize(context))throw Error('当前对话没有电脑操作权限');
  if(busy)throw Error('电脑上还有另一项操作正在执行');
  if(!actions.includes(args.action))throw Error('不支持的电脑操作');
  if(args.action==='launch-shortcut'&&(!String(args.shortcut||'').trim()||/[\\/:*?"<>|]/.test(args.shortcut)))throw Error('先列出shortcuts，再使用其中准确的shortcut名称');
  if(args.action==='click'&&![args.x,args.y].every(n=>Number.isInteger(n)&&n>=-30000&&n<=30000))throw Error('点击坐标无效');
  if(args.action==='launch')throw Error('打开桌面应用请先shortcuts列出实际快捷方式，再launch-shortcut；没有快捷方式先询问本人');
  if(args.action==='launch'&&!['browser','notepad','calculator','explorer'].includes(args.app))throw Error('请选择browser、notepad、calculator或explorer；其他应用可通过桌面开始菜单打开');
  if(args.action==='launch'&&args.url){const u=new URL(args.url);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('只打开不含凭据的网页地址');}
  if(String(args.text||'').length>6000)throw Error('单次输入过长，请分段输入');
  if(['click','scroll','type','press'].includes(args.action)&&!/^\d+$/.test(String(args.windowId||'')))throw Error('先observe电脑并使用返回的windowId，避免操作错窗口');
  if(beforeAction&&['click','type','press'].includes(args.action)){const observed=await act({action:'observe'},{...context,operationObservation:true});if(!authorize(context))throw Error('观察后设备权限已改变');await beforeAction(args,context,observed);}
  const dir=join(getCacheDir(),'desktop');mkdirSync(dir,{recursive:true});const input={...args,file:join(dir,'desktop-'+randomUUID()+'.png')};busy=true;
  try{if(nativeExecute){const native=await nativeExecute(input,context);if(native){if(!authorize(context))throw Error('权限已改变，旧桌面结果停止');return native;}}return await new Promise((resolve,reject)=>{
   let output='',error='',done=false;const child=spawnImpl('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./tools/desktop-action.ps1',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe']});
   const timer=setTimeout(()=>{if(done)return;done=true;child.kill();reject(Error('电脑操作超时'));},35000);
   const abort=()=>child.kill();context.signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',b=>output=(output+b).slice(-100000));child.stderr.on('data',b=>error=(error+b).slice(-1000));
   child.on('error',()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('电脑操作组件无法启动'));});
   child.on('close',code=>{context.signal?.removeEventListener('abort',abort);if(done)return;done=true;clearTimeout(timer);try{if(!authorize(context))throw Error('权限已改变，旧操作停止');if(code!==0)throw Error(error.split('\n')[0]||'电脑操作未完成');resolve(JSON.parse(output));}catch(e){reject(e);}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(input));
  });}finally{busy=false;}
 }
 return {act,status:()=>({available:platform==='win32',backend:'windows-input-and-capture',actions})};
}
