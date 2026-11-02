import {existsSync,readFileSync,readdirSync,writeFileSync,mkdirSync,readlinkSync,realpathSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {connect} from 'node:net';

export function createLocalNapCat({getDir,getAccount,getDataDir,getCacheDir,spawnImpl=spawn}={}){
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
  async function startOnce(){
    const dir=getDir(),qq=String(getAccount());if(!/^\d{5,12}$/.test(qq)||!existsSync(join(dir,'qq')))throw Error('请先配置手机本机的QQ/NapCat目录与机器人账号');
    if(await listening())return {already:true,scheduled:false,via:'phone-local',message:'手机本机QQ登录服务已运行，请检查扫码状态。'};
    const file=join(getDataDir(),'mobile-qq-config.json');mkdirSync(getDataDir(),{recursive:true});writeFileSync(file,JSON.stringify({dir,qq,dataDir:getDataDir(),cacheDir:getCacheDir()}),{mode:0o600});
    const child=spawnImpl(process.execPath,[supervisor,file],{detached:true,stdio:'ignore',windowsHide:true});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Error('手机本机QQ服务未能启动')));});child.unref();return {scheduled:true,started:false,via:'phone-local',message:'已启动手机本机QQ服务，等待登录和本地OneBot连接。'};
  }
  function start(){if(!starting)starting=startOnce().finally(()=>{starting=null;});return starting;}
  function stop(){let stopped=0;const pid=readPid(join(getDataDir(),'mobile-qq-supervisor.pid'));if(proc(pid).some(a=>a===supervisor)){try{process.kill(pid,'SIGTERM');stopped++;}catch{}}
    // Retire only the earlier deployment's verified watchdog for this same QQ installation.
    const old=readPid('/tmp/qq-supervise.pid'),oldScript=join(dirname(getDir()),'supervise.sh');if(proc(old).some(a=>a===oldScript)){try{process.kill(old,'SIGTERM');stopped++;}catch{}}
    for(const id of matching())try{process.kill(id,'SIGTERM');stopped++;}catch{}return stopped;
  }
  return {start,stop,stats};
}
