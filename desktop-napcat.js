import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export function desktopLaunchPlan({dir,qq,custom='',qqPath,env=process.env},exists=fs.existsSync){
 if(!/^\d{5,12}$/.test(String(qq)))throw Error('请先配置本机QQ账号');
 const native=path.join(dir,'NapCatWinBootMain.exe'),hook=path.join(dir,'NapCatWinBootHook.dll');
 const file=custom||(exists(native)?native:exists(path.join(dir,'launcher-user.bat'))?path.join(dir,'launcher-user.bat'):path.join(dir,'launcher.bat'));
 if(!exists(file))throw Error('没有找到电脑NapCat启动器');
 const common={cwd:dir,windowsHide:true,detached:false,env:{...env,NAPCAT_PATCH_PACKAGE:path.join(dir,'qqnt.json'),NAPCAT_LOAD_PATH:path.join(dir,'loadNapCat.js'),NAPCAT_INJECT_PATH:hook,NAPCAT_LAUNCHER_PATH:native,NAPCAT_MAIN_PATH:path.join(dir,'napcat.mjs')}};
 if(path.basename(file).toLowerCase()==='napcatwinbootmain.exe'){
  if(!qqPath||!exists(qqPath)||!exists(hook))throw Error('没有找到本机QQ程序或NapCat注入组件');
  return{file,args:[qqPath,hook,'-q',String(qq)],options:common};
 }
 if(/\.(?:bat|cmd)$/i.test(file))return{file:'cmd.exe',args:['/d','/s','/c','""'+file+'" -q '+qq+' < nul"'],options:{...common,windowsVerbatimArguments:true}};
 if(/\.ps1$/i.test(file))return{file:'powershell.exe',args:['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-File',file,'-q',String(qq)],options:common};
 return{file,args:['-q',String(qq)],options:common};
}

export function createDesktopNapCat(options){
 const io=options.fs||fs,launch=options.spawnImpl||spawn,run=options.spawnSyncImpl||spawnSync;
 const recordFile=path.join(options.getDataDir(),'desktop-qq-process.json');
 let starting=null;
 const account=()=>{const qq=String(options.getAccount()||'');if(!/^\d{5,12}$/.test(qq))throw Error('无法确定当前机器人账号');return qq;};
 const launcher=()=>{const custom=options.getLauncher?.();if(custom)return custom;const dir=options.getDir(),native=path.join(dir,'NapCatWinBootMain.exe');return io.existsSync(native)?native:io.existsSync(path.join(dir,'launcher-user.bat'))?path.join(dir,'launcher-user.bat'):path.join(dir,'launcher.bat');};
 function qqPath(){
  const candidates=[options.getQQPath?.(),path.join(process.env.ProgramFiles||'C:/Program Files','Tencent','QQNT','QQ.exe'),path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Tencent','QQNT','QQ.exe')].filter(Boolean);
  for(const p of candidates)if(io.existsSync(p))return p;
  const r=run('reg.exe',['query','HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\QQ','/v','UninstallString'],{windowsHide:true,encoding:'utf8',timeout:5000});
  const raw=String(r.stdout||'').match(/REG_(?:EXPAND_)?SZ\s+(.+)/)?.[1]?.trim(),uninstall=raw?.match(/^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|$)/i);
  const file=uninstall&&path.join(path.dirname(uninstall[1]||uninstall[2]),'QQ.exe');if(file&&io.existsSync(file))return file;
  throw Error('没有找到本机QQ安装路径');
 }
 async function startOnce(){
  const dir=options.getDir(),qq=account(),file=launcher(),native=/NapCatWinBootMain\.exe$/i.test(file);
  const plan=desktopLaunchPlan({dir,qq,custom:options.getLauncher?.()||'',qqPath:native?qqPath():undefined},p=>io.existsSync(p));
  const log=path.join(options.getCacheDir?.()||options.getDataDir(),'napcat-desktop.log');io.mkdirSync(path.dirname(log),{recursive:true});
  const fd=io.openSync(log,'a',0o600);let child;try{child=launch(plan.file,plan.args,{...plan.options,stdio:['ignore',fd,fd]});}finally{io.closeSync(fd);}
  await new Promise((resolve,reject)=>{let timer=null,done=false;const finish=error=>{if(done)return;done=true;if(timer)clearTimeout(timer);error?reject(error):resolve();};child.once('error',()=>finish(Error('电脑QQ启动请求失败，请检查本机启动日志')));child.once('exit',code=>finish(code===0?null:Error('电脑QQ启动器提前退出，请在连接页检查状态')));child.once('spawn',()=>{timer=setTimeout(()=>finish(),1800);});});
  child.unref();rememberProcess(child.pid);hideConsoles();return{scheduled:true,started:false,via:'windows-hidden-native',message:'已在后台启动本机QQ桥接服务，登录和连接状态以实际回执为准。'};
 }
 function start(){if(!starting)starting=startOnce().finally(()=>{starting=null;});return starting;}
 function rememberProcess(parent){
  if(!Number.isSafeInteger(parent)||parent<=0)return;
  const script=`Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" | Where-Object { $_.ParentProcessId -eq ${parent} } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;createdTicks=$_.CreationDate.ToUniversalTime().Ticks.ToString();exe=$_.ExecutablePath} } | ConvertTo-Json -Compress`;
  try{const r=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000}),v=JSON.parse(r.stdout||'[]'),rows=Array.isArray(v)?v:[v],root=rows.find(p=>p.pid&&p.exe&&path.basename(p.exe).toLowerCase()==='qq.exe');if(root){io.mkdirSync(path.dirname(recordFile),{recursive:true});io.writeFileSync(recordFile,JSON.stringify({...root,qq:account()}),{mode:0o600});}}catch{}
 }
 function stop(){
  const qq=account(),pattern=String.raw`(?:^|\s)(?:-q|--qq)\s+"?${qq}"?(?=\s|$)`;
  const recordPath=recordFile.replaceAll("'","''");
  const script=["$ErrorActionPreference='Stop'",`$bridgeRecord=$null;if(Test-Path -LiteralPath '${recordPath}'){$bridgeRecord=Get-Content -LiteralPath '${recordPath}' -Raw | ConvertFrom-Json}`,`$bridgeBots=@(Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" | Where-Object { ($_.CommandLine -match '${pattern}') -or ($bridgeRecord -and $bridgeRecord.qq -eq '${qq}' -and $_.ProcessId -eq $bridgeRecord.pid -and $_.ExecutablePath -eq $bridgeRecord.exe -and $_.CreationDate.ToUniversalTime().Ticks.ToString() -eq $bridgeRecord.createdTicks) })`,'$bridgeParents=@($bridgeBots | ForEach-Object { $_.ParentProcessId })',`$bridgeBoots=@(Get-CimInstance Win32_Process -Filter "Name='NapCatWinBootMain.exe'" | Where-Object { ($_.ProcessId -in $bridgeParents) -or ($_.CommandLine -match '${pattern}') })`,'$bridgeBots | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }','$bridgeBoots | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }','Write-Output ($bridgeBots.Count+$bridgeBoots.Count)'].join('\r\n');
  const r=run('powershell.exe',['-NoLogo','-NonInteractive','-NoProfile','-Command',script],{windowsHide:true,encoding:'utf8',timeout:15000});if(r.error||r.status!==0)throw Error('未能停止当前QQ账号进程，请在NapCat检查');return Number(String(r.stdout).trim())||0;
 }
 function stats(){const r=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'QQ.exe' -or $_.Name -eq 'NapCatWinBootMain.exe' } | Select-Object Name | ConvertTo-Json -Compress"],{windowsHide:true,encoding:'utf8',timeout:10000});try{const value=JSON.parse(r.stdout||'[]'),all=Array.isArray(value)?value:[value];return{qqProcesses:all.filter(p=>p.Name==='QQ.exe').length,napcatProcesses:all.filter(p=>p.Name==='NapCatWinBootMain.exe').length};}catch{return{qqProcesses:0,napcatProcesses:0};}}
 function hideConsoles(){const r=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./tools/hide-napcat-console.ps1',import.meta.url)),'-Account',account(),'-NapcatDir',options.getDir(),'-LaunchRecord',recordFile],{windowsHide:true,encoding:'utf8',timeout:10000});try{return JSON.parse(r.stdout);}catch{return{hidden:0};}}
 return{launcher,start,stop,stats,hideConsoles};
}
