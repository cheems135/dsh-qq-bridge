import fs from 'node:fs';
import path from 'node:path';
import {execFile,spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createDesktopStartupHealth} from './desktop-startup-health.js';

const qqBuildPattern=/^\d{1,4}(?:\.\d{1,5}){2}[.-]\d{1,9}$/;

function loopbackAddress(address) {
 const normalized=String(address||'').toLowerCase().replace(/^::ffff:/,'');
 return normalized==='127.0.0.1'||normalized==='::1' ? normalized : '';
}

function inspectQQProcess(lines, env) {
 const script=["$ErrorActionPreference='Stop'","[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)",...lines,
  "if($owner.ProcessName -ine 'QQ'){return}",
  "$start=$owner.StartTime; $exe=$owner.Path",
  "$cores=@($owner.Modules | Where-Object { $_.ModuleName -ieq 'QQNT.dll' } | Select-Object -ExpandProperty FileName -Unique)",
  "if($cores.Count -ne 1 -or !$exe -or (Get-Process -Id $owner.Id).StartTime -ne $start){return}",
  "[pscustomobject]@{exe=$exe;module=$cores[0];startedAt=([DateTimeOffset]$start).ToUnixTimeMilliseconds()} | ConvertTo-Json -Compress",
 ].join('\n');
 return new Promise(resolve=>execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
  windowsHide:true,timeout:6000,encoding:'utf8',env:{...process.env,...env},
 },(error,output)=>{
  try{resolve(error||!output.trim()?null:JSON.parse(output));}catch{resolve(null);}
 }));
}

function readEstablishedQQProcess({clientPort,serverPort,clientAddress,serverAddress}) {
 return inspectQQProcess([
  "function Address([string]$value) { $ip=[Net.IPAddress]::Parse($value); if($ip.IsIPv4MappedToIPv6){$ip=$ip.MapToIPv4()}; $ip.ToString() }",
  "$peers=@(Get-NetTCPConnection -LocalPort ([uint16]$env:DSH_QQ_SERVER_PORT) -RemotePort ([uint16]$env:DSH_QQ_CLIENT_PORT) -State Established | Where-Object { (Address $_.LocalAddress) -eq $env:DSH_QQ_SERVER_ADDRESS -and (Address $_.RemoteAddress) -eq $env:DSH_QQ_CLIENT_ADDRESS })",
  "if($peers.Count -ne 1){return}",
  "$owner=Get-Process -Id $peers[0].OwningProcess",
 ],{DSH_QQ_CLIENT_PORT:String(clientPort),DSH_QQ_SERVER_PORT:String(serverPort),
  DSH_QQ_CLIENT_ADDRESS:clientAddress,DSH_QQ_SERVER_ADDRESS:serverAddress});
}

function parseQQRuntime(observation) {
 const {exe,module,startedAt}=observation||{};
 if(typeof exe!=='string'||typeof module!=='string'||!path.win32.isAbsolute(exe)||!path.win32.isAbsolute(module)||
    path.win32.basename(exe).toLowerCase()!=='qq.exe'||
    !Number.isSafeInteger(startedAt)||startedAt<=0)return null;
 const versions=path.win32.join(path.win32.dirname(exe),'versions');
 const [coreVersion,file,...rest]=path.win32.relative(versions,module).split(path.win32.sep);
 if(!qqBuildPattern.test(coreVersion)||file?.toLowerCase()!=='qqnt.dll'||rest.length)return null;
 return {coreVersion,startedAt};
}

export async function readQQConnectionRuntime(socket, connectedAt, inspect=readEstablishedQQProcess) {
 const clientAddress=loopbackAddress(socket?.localAddress),serverAddress=loopbackAddress(socket?.remoteAddress);
 const clientPort=socket?.localPort,serverPort=socket?.remotePort;
 if(!clientAddress||!serverAddress||!Number.isSafeInteger(connectedAt)||connectedAt<=0||
    ![clientPort,serverPort].every(port=>Number.isInteger(port)&&port>0&&port<=65535))return null;
 const runtime=parseQQRuntime(await inspect({clientPort,serverPort,clientAddress,serverAddress}));
 return runtime&&runtime.startedAt<=connectedAt?runtime:null;
}

function readOwnedQQProcess(record) {
 return inspectQQProcess([
  "$pidValue=[uint32]$env:DSH_QQ_ATTEMPT_PID",
  "$meta=Get-CimInstance Win32_Process -Filter ('ProcessId='+$pidValue)",
  "if(!$meta -or $meta.Name -ine 'QQ.exe' -or $meta.ExecutablePath -ine $env:DSH_QQ_ATTEMPT_EXE -or $meta.CreationDate.ToUniversalTime().Ticks.ToString() -ne $env:DSH_QQ_ATTEMPT_TICKS){return}",
  "$owner=Get-Process -Id $pidValue",
  "if([Math]::Abs(($owner.StartTime - $meta.CreationDate).TotalMilliseconds) -gt 2){return}",
 ],{DSH_QQ_ATTEMPT_PID:String(record.pid),DSH_QQ_ATTEMPT_TICKS:record.createdTicks,DSH_QQ_ATTEMPT_EXE:record.exe});
}

export function createQQStartupRuntimeReader(readRecord, currentProfile, currentAccount, currentSetupKey, inspect=readOwnedQQProcess, onObserved) {
 let cached;
 function accountInScope(){
  try{return currentAccount();}catch{return '';}
 }
 return async function readStartupRuntime() {
  const record=readRecord(),profile=currentProfile(),account=accountInScope();
  if(!record||!account||record.qq!==account||!Number.isSafeInteger(record.pid)||record.pid<=0||
     !/^\d{10,22}$/.test(record.createdTicks||'')||typeof record.exe!=='string')return null;
  if(record.profileId===undefined ? !record.setupKey||record.setupKey!==await currentSetupKey() : record.profileId!==profile)return null;
  const key=JSON.stringify([profile,account,record.pid,record.createdTicks,record.exe]);
  if(!cached||cached.key!==key||(!cached.runtime&&Date.now()-cached.at>=12000)){
   const entry={key,at:Date.now(),runtime:null};
   entry.pending=Promise.resolve().then(()=>inspect(record)).then(parseQQRuntime).catch(()=>null).then(runtime=>entry.runtime=runtime);
   cached=entry;
  }
  const entry=cached,result=await entry.pending,newRecord=readRecord();
  if(currentProfile()!==profile||accountInScope()!==account||newRecord?.pid!==record.pid||newRecord.createdTicks!==record.createdTicks)return null;
  if(result&&!entry.logged){entry.logged=true;onObserved?.(result);}
  return result;
 };
}

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

function executableVersion(file) {
 const script = "(Get-Item -LiteralPath $env:DSH_QQ_VERSION_FILE -ErrorAction Stop).VersionInfo.FileVersion";
 return new Promise(resolve => execFile('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive','-Command',script], {
  windowsHide:true, timeout:4000, encoding:'utf8', env:{...process.env,DSH_QQ_VERSION_FILE:file},
 }, (error, output) => resolve(error ? '' : output.trim())));
}

export function createQQInstallationReader(getExe, io=fs, fileVersion=executableVersion) {
 let cached=null;
 const validBuild=value=>typeof value==='string' && qqBuildPattern.test(value);
 return async function readInstallation() {
  let exe,stat;
  try { exe=getExe(); stat=io.statSync(exe); } catch { return null; }
  const key=[exe,stat.size,stat.mtimeMs,stat.ctimeMs].join('|');
  if (!cached || cached.key!==key || (cached.retryAt && Date.now()>=cached.retryAt)) {
   const current={key,retryAt:0};
   current.pending=Promise.resolve().then(()=>fileVersion(exe)).catch(()=>'').then(value=>{
    if(validBuild(value))return value;
    current.retryAt=Date.now()+60000;
    return '';
   });
   cached=current;
  }
  const entryVersion=await cached.pending;
  const versions=path.join(path.dirname(exe),'versions');
  let selected='';
  try { selected=JSON.parse(io.readFileSync(path.join(versions,'config.json'),'utf8').replace(/^\uFEFF/, '')).curVersion; } catch { /* Entry-only or updating. */ }
  if(!validBuild(selected))return {entryVersion,coreVersion:'',corePresent:null};
  return {entryVersion,coreVersion:selected,corePresent:io.existsSync(path.join(versions,selected,'QQNT.dll'))};
 };
}

export function readRegisteredQQPath(run=spawnSync, exists=fs.existsSync) {
 const script=String.raw`
  [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
  $roots=@('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\QQ',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\QQ',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\QQ')
  foreach($root in $roots){
    $value=Get-ItemPropertyValue -LiteralPath $root -Name UninstallString -ErrorAction SilentlyContinue
    if($value){$value}
  }
 `;
 const result=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{
  windowsHide:true,encoding:'utf8',timeout:5000,
 });
 if(result.status!==0)return '';
 for(const value of String(result.stdout||'').split(/\r?\n/)){
  const match=value.trim().match(/^"([^"]+\.exe)"|^(.+?\.exe)(?:\s|$)/i);
  const uninstall=match&&(match[1]||match[2]);
  if(!uninstall||!/^[a-z]:[\\/]/i.test(uninstall))continue;
  const candidate=path.win32.join(path.win32.dirname(uninstall),'QQ.exe');
  if(exists(candidate))return candidate;
 }
 return '';
}

export function createDesktopNapCat(options){
 const io=options.fs||fs,launch=options.spawnImpl||spawn,run=options.spawnSyncImpl||spawnSync;
 const recordFile=path.join(options.getDataDir(),'desktop-qq-process.json');
 let starting=null, lastLaunch=null, registeredPath='', checkedRegistryAt=0;
 const account=()=>{const qq=String(options.getAccount()||'');if(!/^\d{5,12}$/.test(qq))throw Error('无法确定当前机器人账号');return qq;};
 const launcher=()=>{const custom=options.getLauncher?.();if(custom)return custom;const dir=options.getDir(),native=path.join(dir,'NapCatWinBootMain.exe');return io.existsSync(native)?native:io.existsSync(path.join(dir,'launcher-user.bat'))?path.join(dir,'launcher-user.bat'):path.join(dir,'launcher.bat');};
 function qqPath(){
  const configured=options.getQQPath?.();
  if(configured&&io.existsSync(configured))return configured;
  const now=Date.now();
  if(now-checkedRegistryAt>=10000){
   registeredPath=readRegisteredQQPath(run,p=>io.existsSync(p));
   checkedRegistryAt=now;
  }
  const candidates=[registeredPath,path.join(process.env.ProgramFiles||'C:/Program Files','Tencent','QQNT','QQ.exe'),
   path.join(process.env['ProgramFiles(x86)']||'C:/Program Files (x86)','Tencent','QQNT','QQ.exe')].filter(Boolean);
  for(const p of candidates)if(io.existsSync(p))return p;
  throw Error('没有找到本机QQ安装路径');
 }
 const installation=createQQInstallationReader(qqPath,io,options.readFileVersion);
 const health=createDesktopStartupHealth({dataDir:options.getDataDir(),installation,getExe:qqPath,getLauncher:launcher,
  getDir:options.getDir,getAccount:options.getAccount,getProfile:()=>options.getAccountId?.()||'',io,probe:options.probeStartupDialog});
 const readStartupRuntime=createQQStartupRuntimeReader(()=>{
  try{return JSON.parse(io.readFileSync(recordFile,'utf8'));}catch{return null;}
 },()=>options.getAccountId?.()||'',()=>String(options.getAccount()||''),health.key,undefined,options.onStartupRuntime);
 function startupPhase(){
  if(!lastLaunch || lastLaunch.profile!==(options.getAccountId?.()||'') || lastLaunch.dir!==options.getDir())return '';
  return Date.now()-lastLaunch.at<60000 ? 'starting' : 'startup_unconfirmed';
 }
 async function startOnce(requestScope){
  const profileAtLaunch=options.getAccountId?.()||'';
  const dir=options.getDir(),qq=account(),file=launcher(),native=/NapCatWinBootMain\.exe$/i.test(file);
  const build=installation(),setupKey=health.key();
  const plan=desktopLaunchPlan({dir,qq,custom:options.getLauncher?.()||'',qqPath:native?qqPath():undefined},p=>io.existsSync(p));
  const log=path.join(options.getCacheDir?.()||options.getDataDir(),'napcat-desktop.log');io.mkdirSync(path.dirname(log),{recursive:true});
  const fd=io.openSync(log,'a',0o600);let child;try{child=launch(plan.file,plan.args,{...plan.options,stdio:['ignore',fd,fd]});}finally{io.closeSync(fd);}
  await new Promise((resolve,reject)=>{let timer=null,done=false;const finish=error=>{if(done)return;done=true;if(timer)clearTimeout(timer);error?reject(error):resolve();};child.once('error',()=>finish(Error('电脑QQ启动请求失败，请检查本机启动日志')));child.once('exit',code=>finish(code===0?null:Error('电脑QQ启动器提前退出，请在连接页检查状态')));child.once('spawn',()=>{timer=setTimeout(()=>finish(),1800);});});
  child.unref();
  const attempt={at:Date.now(),profile:profileAtLaunch,dir,scope:requestScope};
  lastLaunch=attempt;
  if(rememberProcess(child.pid,qq,await setupKey,profileAtLaunch))observeStartup(attempt);
  hideConsoles();
  return {scheduled:true,started:false,via:'windows-hidden-native',qqInstallation:await build,message:'本机启动请求已提交，正在等待 QQ 服务确认。'};
 }
 function start({manualVerification=false}={}){
  if(starting)return starting;
  const requestScope=options.getLaunchScope?.();
  starting=(async()=>{
   const fault=await health.check({manual:manualVerification});
   if(options.getLaunchScope?.()!==requestScope)throw Error('账号或连接状态已改变，本次启动已取消');
   if(fault)throw Object.assign(Error('桥接启动的 QQ 报告文件已损坏。请核对当前 QQ 与连接组件版本。'),{code:fault});
   if(startupPhase()==='starting')return {scheduled:true,started:false,message:'已提交本次启动请求，正在等待 QQ 服务确认。'};
   return startOnce(requestScope);
  })().finally(()=>{starting=null;});
  return starting;
 }
 function observeStartup(attempt) {
  const probe=async()=>{
   if(lastLaunch!==attempt||attempt.scope!==options.getLaunchScope?.())return '';
   void readStartupRuntime().catch(()=>{});
   return health.check();
  };
  void probe().then(fault=>{
   if(fault||lastLaunch!==attempt)return;
   const timer=setTimeout(()=>{void probe().catch(()=>{});},13000);
   timer.unref();
  }).catch(()=>{});
 }
 function rememberProcess(parent,qq,setupKey,profileId){
  if(!Number.isSafeInteger(parent)||parent<=0)return false;
  const script=`[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" | Where-Object { $_.ParentProcessId -eq ${parent} } | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId;createdTicks=$_.CreationDate.ToUniversalTime().Ticks.ToString();exe=$_.ExecutablePath} } | ConvertTo-Json -Compress`;
  try {
   const result=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,encoding:'utf8',timeout:10000});
   const value=JSON.parse(result.stdout||'[]');
   const rows=Array.isArray(value)?value:[value];
   const root=rows.find(p=>p.pid&&p.exe&&path.basename(p.exe).toLowerCase()==='qq.exe');
   if(!root)return false;
   io.mkdirSync(path.dirname(recordFile),{recursive:true});
   io.writeFileSync(recordFile,JSON.stringify({...root,qq,setupKey,profileId}),{mode:0o600});
   return true;
  } catch { return false; }
 }
 function stop(){
  const qq=account(),pattern=String.raw`(?:^|\s)(?:-q|--qq)\s+"?${qq}"?(?=\s|$)`;
  const recordPath=recordFile.replaceAll("'","''");
  const script=["$ErrorActionPreference='Stop'",`$bridgeRecord=$null;if(Test-Path -LiteralPath '${recordPath}'){$bridgeRecord=Get-Content -LiteralPath '${recordPath}' -Raw | ConvertFrom-Json}`,`$bridgeBots=@(Get-CimInstance Win32_Process -Filter "Name='QQ.exe'" | Where-Object { ($_.CommandLine -match '${pattern}') -or ($bridgeRecord -and $bridgeRecord.qq -eq '${qq}' -and $_.ProcessId -eq $bridgeRecord.pid -and $_.ExecutablePath -eq $bridgeRecord.exe -and $_.CreationDate.ToUniversalTime().Ticks.ToString() -eq $bridgeRecord.createdTicks) })`,'$bridgeParents=@($bridgeBots | ForEach-Object { $_.ParentProcessId })',`$bridgeBoots=@(Get-CimInstance Win32_Process -Filter "Name='NapCatWinBootMain.exe'" | Where-Object { ($_.ProcessId -in $bridgeParents) -or ($_.CommandLine -match '${pattern}') })`,'$bridgeBots | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }','$bridgeBoots | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop }','Write-Output ($bridgeBots.Count+$bridgeBoots.Count)'].join('\r\n');
  const r=run('powershell.exe',['-NoLogo','-NonInteractive','-NoProfile','-Command',script],{windowsHide:true,encoding:'utf8',timeout:15000});if(r.error||r.status!==0)throw Error('未能停止当前QQ账号进程，请在NapCat检查');lastLaunch=null;return Number(String(r.stdout).trim())||0;
 }
 function stats(){const r=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'QQ.exe' -or $_.Name -eq 'NapCatWinBootMain.exe' } | Select-Object Name | ConvertTo-Json -Compress"],{windowsHide:true,encoding:'utf8',timeout:10000});try{const value=JSON.parse(r.stdout||'[]'),all=Array.isArray(value)?value:[value];return{qqProcesses:all.filter(p=>p.Name==='QQ.exe').length,napcatProcesses:all.filter(p=>p.Name==='NapCatWinBootMain.exe').length};}catch{return{qqProcesses:0,napcatProcesses:0};}}
 function hideConsoles(){const r=run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-WindowStyle','Hidden','-ExecutionPolicy','Bypass','-File',fileURLToPath(new URL('./tools/hide-napcat-console.ps1',import.meta.url)),'-Account',account(),'-NapcatDir',options.getDir(),'-LaunchRecord',recordFile],{windowsHide:true,encoding:'utf8',timeout:10000});try{return JSON.parse(r.stdout);}catch{return{hidden:0};}}
 return{launcher,start,stop,stats,hideConsoles,installation,readConnectionRuntime:readQQConnectionRuntime,readStartupRuntime,startupPhase,startupFailure:health.check,
  acknowledgeStartup:verified=>{if(verified){lastLaunch=null;return health.acknowledge();}}};
}
