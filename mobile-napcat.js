import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync,readlinkSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connect} from 'node:net';
import {createHash} from 'node:crypto';
import {loginHold} from './local-login.js';

// A detached supervisor can outlive the bridge. Consult the same on-device
// state that its owning profile uses, even when another profile is now active.
export function mobileLoginHold(config,read=readFileSync) {
  let state;
  try {
    state=JSON.parse(read(config.stateFile || join(config.dataDir,'state.json'),'utf8'));
  } catch(error) {
    if(error.code==='ENOENT')return false;
    throw error;
  }
  if(typeof config.accountId==='string')return loginHold(state,config.accountId);
  // Old launcher files bind only the QQ receiver. An unbound manual hold for
  // some profile cannot be attributed to one of these older files.
  return Array.isArray(state.qqLoginHolds) && state.qqLoginHolds.find(row=>
    row?.active && String(row.receiver || '')===String(config.qq));
}

export function createLocalNapCat({getDir,getAccount,getAccountId,getStateFile,getDataDir,getCacheDir,spawnImpl=spawn}={}){
  let starting=null;
  const supervisor=fileURLToPath(new URL('./tools/mobile-qq-supervisor.mjs',import.meta.url));
  const proc=pid=>{try{return readFileSync('/proc/'+pid+'/cmdline','utf8').split('\0').filter(Boolean);}catch{return [];}};
  function matching(){const dir=realpathSync(getDir()),qq=String(getAccount());const found=[];for(const pid of readdirSync('/proc').filter(n=>/^\d+$/.test(n))){const args=proc(pid);if(!args.length||!/(?:^|\/)qq$/.test(args[0])||!args.some((v,i)=>v==='-q'&&args[i+1]===qq))continue;let cwd='',workdir='',pwd='';try{cwd=realpathSync(readlinkSync('/proc/'+pid+'/cwd'));}catch{}try{const env=Object.fromEntries(readFileSync('/proc/'+pid+'/environ','utf8').split('\0').map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));workdir=env.NAPCAT_WORKDIR||'';pwd=env.PWD||'';}catch{}
    // PRoot exposes the loader's /proc cwd as '/'; require both guest markers and the exact account in that case.
    if(cwd===dir||(cwd==='/'&&workdir===dir&&pwd===dir&&(args[0]==='./qq'||args[0]===join(dir,'qq'))))found.push(Number(pid));}return found;}
  function readPid(file){try{return Number(readFileSync(file,'utf8').trim());}catch{return 0;}}
  function stats(){let qq=0;try{qq=matching().length;}catch{}const pid=readPid(join(getDataDir(),'mobile-qq-supervisor.pid'));return {qqProcesses:qq,napcatProcesses:proc(pid).some(a=>a===supervisor)?1:0};}
  function webPort(){try{const c=JSON.parse(readFileSync(join(getDir(),'config','webui.json'),'utf8'));return Number(c.port)||6099;}catch{return 6099;}}
  async function listening(){return await new Promise(resolve=>{let done=false;const s=connect({host:'127.0.0.1',port:webPort()}),finish=value=>{if(done)return;done=true;s.destroy();resolve(value);};s.setTimeout(1200);s.once('connect',()=>finish(true));s.once('error',()=>finish(false));s.once('timeout',()=>finish(false));});}
  async function startOnce({manualVerification=false}={}){
    const dir=getDir(),qq=String(getAccount());if(!/^\d{5,12}$/.test(qq)||!existsSync(join(dir,'qq')))throw Error('请先配置手机本机的QQ/NapCat目录与机器人账号');
    const config={dir,qq,accountId:getAccountId?.(),dataDir:getDataDir(),cacheDir:getCacheDir(),stateFile:getStateFile?.()};
    const hold=mobileLoginHold(config);
    const verify=manualVerification===true && hold && hold.source!=='user' && String(hold.receiver)===qq && Number.isSafeInteger(hold.time) && hold.time>0;
    if(hold && !verify)throw Error('当前 QQ 账号需要人工处理，请在连接页确认后恢复');
    if(await listening())return {already:true,scheduled:false,via:'phone-local',message:'手机本机QQ登录服务已运行，请检查扫码状态。'};
    if(getAccountId && getAccountId()!==config.accountId)throw Error('账号已切换，本次启动已取消');
    const binding=createHash('sha256').update(JSON.stringify(config)).digest('hex');
    const file=join(config.dataDir,'mobile-qq-config-'+binding+'.json');mkdirSync(config.dataDir,{recursive:true});writeFileSync(file,JSON.stringify(config),{mode:0o600});
    const args=verify?[supervisor,file,String(hold.time)]:[supervisor,file];
    const child=spawnImpl(process.execPath,args,{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('手机本机QQ服务未能启动')));});child.unref();return {scheduled:true,started:false,via:'phone-local',message:'已启动手机本机QQ服务，等待登录和本地OneBot连接。'};
  }
  function start(options){if(!starting)starting=startOnce(options).finally(()=>{starting=null;});return starting;}
  function stop(){let stopped=0;const pid=readPid(join(getDataDir(),'mobile-qq-supervisor.pid'));if(proc(pid).some(a=>a===supervisor)){try{process.kill(pid,'SIGTERM');stopped++;}catch{}}
    // Retire only the earlier deployment's verified watchdog for this same QQ installation.
    const old=readPid('/tmp/qq-supervise.pid'),oldScript=join(dirname(getDir()),'supervise.sh');if(proc(old).some(a=>a===oldScript)){try{process.kill(old,'SIGTERM');stopped++;}catch{}}
    for(const id of matching())try{process.kill(id,'SIGTERM');stopped++;}catch{}return stopped;
  }
  return {start,stop,stats};
}
