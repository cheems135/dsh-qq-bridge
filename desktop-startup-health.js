import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const errorCode='QQ_FILE_DAMAGED';

function readJson(io, file) {
  try { return JSON.parse(io.readFileSync(file,'utf8')); } catch { return null; }
}

async function readDialog(record) {
  const script=fileURLToPath(new URL('./tools/read-qq-startup-error.ps1',import.meta.url));
  const result=await new Promise(resolve=>execFile('powershell.exe',[
    '-NoLogo','-NoProfile','-NonInteractive','-File',script,'-TargetPid',String(record.pid),
    '-CreatedTicks',record.createdTicks,'-ExpectedExe',record.exe,
  ],{windowsHide:true,timeout:6000,encoding:'utf8'},(error,output)=>resolve(error?null:output.trim())));
  if(result!==null)return result;

  // Windows can disallow the dialog script. A read-only PID query can still establish an exit.
  const verify="try { Get-Process -Id ([int]$env:DSH_QQ_DIAG_PID) -ErrorAction Stop | Out-Null } catch { if($_.CategoryInfo.Category -eq 'ObjectNotFound') { 'QQ_PROCESS_ENDED' } }";
  return new Promise(resolve=>execFile('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',verify],{
    windowsHide:true,timeout:4000,encoding:'utf8',env:{...process.env,DSH_QQ_DIAG_PID:String(record.pid)},
  },(error,output)=>resolve(!error&&output.trim()==='QQ_PROCESS_ENDED'?'QQ_PROCESS_ENDED':'')));
}

export function createDesktopStartupHealth({dataDir, installation, getExe, getLauncher, getDir, getAccount, getProfile, io=fs, probe=readDialog, now=Date.now}) {
  const marker=path.join(dataDir,'desktop-qq-startup-failure.json');
  const owned=path.join(dataDir,'desktop-qq-process.json');
  let fault=readJson(io,marker),cached=null,revision=0;
  function stamp(file) {
    try { const s=io.statSync(file); return [file,s.size,s.mtimeMs,s.ctimeMs]; } catch { return [file]; }
  }
  async function scope() {
    try {
      const exe=getExe(),dir=getDir(),account=String(getAccount()||''),profile=getProfile()||'';
      if(!/^\d{5,12}$/.test(account))return null;
      const build=await installation();
      if(!build)return null;
      const versions=path.join(path.dirname(exe),'versions');
      const files=[stamp(exe),stamp(getLauncher()),stamp(path.join(dir,'napcat.mjs'))];
      if(build.coreVersion)files.push(stamp(path.join(versions,build.coreVersion,'QQNT.dll')));
      const key=createHash('sha256').update(JSON.stringify([profile,account,build.coreVersion,build.entryVersion,files])).digest('hex');
      const times=files.concat([stamp(path.join(versions,'config.json'))]).flatMap(f=>f.slice(2)).filter(Number.isFinite);
      return {key,account,updatedAt:Math.max(0,...times)};
    } catch { return null; }
  }
  function persist(key) {
    const tmp=marker+'.'+randomUUID()+'.tmp';
    fault={code:errorCode,key,at:now()};
    try {
      io.mkdirSync(dataDir,{recursive:true});io.writeFileSync(tmp,JSON.stringify(fault),{mode:0o600});io.renameSync(tmp,marker);
    } catch { try{io.unlinkSync(tmp);}catch{} }
  }
  function forget() {
    revision++;cached=null;
    if(!fault)return;
    const previous=fault;fault=null;
    try { if(readJson(io,marker)?.key===previous.key)io.unlinkSync(marker); } catch {}
  }
  async function check({manual=false,includeProcessExit=false}={}) {
    const epoch=revision,s=await scope();
    if(!s||epoch!==revision)return '';
    const known=fault?.code===errorCode&&fault.key===s.key;
    if(known&&!manual)return errorCode;
    const record=readJson(io,owned);
    if(record?.qq!==s.account || !Number.isSafeInteger(record.pid) || record.pid<=0 ||
       typeof record.exe!=='string' || path.basename(record.exe).toLowerCase()!=='qq.exe' ||
       typeof record.createdTicks!=='string' || !/^\d{10,22}$/.test(record.createdTicks)) {
      return '';
    }
    // Win32_Process.CreationDate was serialized as UTC .NET DateTime ticks.
    const createdAt=Number(BigInt(record.createdTicks)/10000n-62135596800000n);
    if(record.setupKey ? record.setupKey!==s.key : createdAt+2000<s.updatedAt)return '';
    const id=[s.key,record.pid,record.createdTicks].join('/');
    if(!cached || cached.id!==id || (!cached.gone && (now()-cached.at>12000 || (manual&&known)))){
      cached={id,at:now(),promise:Promise.resolve().then(()=>probe(record)).catch(()=>'')};
    }
    const observation=cached,found=await observation.promise;
    if(epoch!==revision || cached!==observation || (await scope())?.key!==s.key || epoch!==revision)return '';
    if(found===true || found===errorCode){if(!known)persist(s.key);return errorCode;}
    if(found==='QQ_PROCESS_ENDED'){
      observation.gone=true;
      if(includeProcessExit)return found;
    }
    // Dismissing the dialog permits a manual retry. Only a ready QQ core clears the fault.
    return '';
  }
  async function acknowledge(){
    revision++;cached=null;
    if(fault && fault.key===(await scope())?.key)forget();
  }
  return {check,acknowledge,key:async()=>(await scope())?.key||''};
}
