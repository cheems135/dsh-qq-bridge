import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,existsSync,mkdirSync,openSync,closeSync,chmodSync,statSync,renameSync} from 'node:fs';
import {join} from 'node:path';
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));
if(!/^\d{5,12}$/.test(config.qq)||!existsSync(join(config.dir,'qq')))throw Error('Invalid local QQ configuration');
mkdirSync(config.dataDir,{recursive:true});mkdirSync(config.cacheDir,{recursive:true});
const pidFile=join(config.dataDir,'mobile-qq-supervisor.pid');
try{const pid=Number(readFileSync(pidFile,'utf8'));const args=readFileSync('/proc/'+pid+'/cmdline','utf8');if(pid!==process.pid&&args.includes(process.argv[1]))process.exit();}catch{}
writeFileSync(pidFile,String(process.pid),{mode:0o600});
const socketDir='/tmp/qq-bridge-mobile-wayland';mkdirSync(socketDir,{recursive:true});chmodSync(socketDir,0o700);
let compositor=null,qq=null,stopping=false,timer=null;
const logFile=join(config.cacheDir,'napcat-mobile.log');
const log=()=>{try{if(statSync(logFile).size>20*1024*1024)renameSync(logFile,logFile+'.previous');}catch{}return openSync(logFile,'a',0o600);};
function groupStop(child){if(!child)return;try{process.kill(-child.pid,'SIGTERM');}catch{try{child.kill('SIGTERM');}catch{}}}
function stop(){if(stopping)return;stopping=true;clearTimeout(timer);groupStop(qq);groupStop(compositor);setTimeout(()=>process.exit(),500);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
const env={...process.env,XDG_RUNTIME_DIR:socketDir,WAYLAND_DISPLAY:'qq-mobile',NAPCAT_WORKDIR:config.dir,LD_LIBRARY_PATH:join(config.dir,'usr/lib')+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:'')};
const out=log();compositor=spawn('weston',['--backend=headless-backend.so','--socket=qq-mobile','--width=1024','--height=768','--no-config','--idle-time=0'],{env,stdio:['ignore',out,out],detached:true});closeSync(out);
compositor.on('error',stop);compositor.on('close',()=>{if(!stopping)stop();});
const compositorDeadline=Date.now()+30000;
function launch(){if(stopping)return;if(!existsSync(join(socketDir,'qq-mobile'))){if(Date.now()>compositorDeadline){stop();return;}timer=setTimeout(launch,700);return;}const out=log();qq=spawn(join(config.dir,'qq'),['--no-sandbox','-q',config.qq,'--disable-gpu','--disable-dev-shm-usage','--ozone-platform=wayland','--enable-features=UseOzonePlatform'],{env,cwd:config.dir,stdio:['ignore',out,out],detached:true});closeSync(out);let finished=false;const retry=()=>{if(finished)return;finished=true;qq=null;if(!stopping)timer=setTimeout(launch,15000);};qq.on('error',retry);qq.on('close',retry);}
timer=setTimeout(launch,700);
