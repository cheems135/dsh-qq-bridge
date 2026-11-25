import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {posix as path} from 'node:path';
import {runInNewContext} from 'node:vm';
import {mobileLoginHold} from '../mobile-napcat.js';
import {loginHold,performLocalLogin,releaseLoginHold} from '../local-login.js';
import {createHash} from 'node:crypto';

// Run the shipping watchdog against virtual files, timers and child processes.
const script=readFileSync(new URL('../tools/mobile-qq-supervisor.mjs',import.meta.url),'utf8')
  .replace(/^import .*;\r?$/gm,'');
const base={qq:'12345',accountId:'profile-A',dataDir:'/virtual/state',dir:'/virtual/program',cacheDir:'/virtual/cache',stateFile:'/virtual/custom/state.json'};
const missing=()=>Object.assign(new Error('missing virtual file'),{code:'ENOENT'});

function watchdog(config,state,grant){
  const timers=[],children=[],kills=[];
  const argv=['node','/virtual/supervisor.mjs','/virtual/config.json'];
  if(grant!==undefined)argv.push(grant);
  const process={argv,pid:444,env:{},on(){},exit(){},kill(pid){kills.push(pid);}};
  const read=file=>{
    if(file===argv[2])return JSON.stringify(config);
    if(file===(config.stateFile||path.join(config.dataDir,'state.json')))return typeof state.value==='string'?state.value:JSON.stringify(state.value);
    throw missing();
  };
  const env={
    process,join:path.join,readFileSync:read,existsSync:()=>true,mkdirSync(){},writeFileSync(){},
    chmodSync(){},statSync:()=>({size:0}),openSync:()=>10,closeSync(){},renameSync(){},
    setTimeout(fn,delay){const timer={fn,delay};timers.push(timer);return timer;},
    clearTimeout(timer){const idx=timers.indexOf(timer);if(idx>=0)timers.splice(idx,1);},
    mobileLoginHold:bound=>mobileLoginHold(bound,read),
    spawn(command,args){const child=new EventEmitter();Object.assign(child,{command,args,pid:100+children.length});children.push(child);return child;}
  };
  runInNewContext(script,env);
  function tick(delay){const i=timers.findIndex(t=>t.delay===delay);assert(i>=0,'missing timer '+delay);timers.splice(i,1)[0].fn();}
  return {tick,qq:()=>children.filter(child=>child.command==='/virtual/program/qq'),kills};
}

test('a manual hold created while crash recovery is pending prevents that account from restarting',()=>{
  const state={value:{qqLoginHolds:[]}},proc=watchdog(base,state);
  proc.tick(700);const child=proc.qq()[0];assert.equal(child.args[2],base.qq);
  child.emit('close');state.value.qqLoginHolds.push({accountId:base.accountId,source:'user',active:true});
  proc.tick(15000);assert.equal(proc.qq().length,1);
  assert.deepEqual(proc.kills,[-100]); // The only remaining child is this watchdog's compositor.
  const cold=watchdog(base,state);cold.tick(700);assert.equal(cold.qq().length,0);
  releaseLoginHold(state.value,base.accountId);
  const resumed=watchdog(base,state);resumed.tick(700);assert.equal(resumed.qq().length,1);
});

test('another profile and a normal chat pause preserve ordinary process recovery',()=>{
  const state={value:{accountPaused:true,qqLoginHolds:[{accountId:'profile-B',active:true,source:'user'}]}};
  const proc=watchdog(base,state);proc.tick(700);
  proc.qq()[0].emit('error',new Error('synthetic crash'));proc.qq()[0].emit('close');
  proc.tick(15000);assert.equal(proc.qq().length,2);assert.deepEqual(proc.kills,[]);
});

test('legacy files use only an exact bound receiver; a default profile has its own empty-string binding',()=>{
  const legacy={...base};delete legacy.accountId;delete legacy.stateFile;
  const check=holds=>!!mobileLoginHold(legacy,()=>JSON.stringify({qqLoginHolds:holds}));
  assert.equal(check([{accountId:'one',active:true,source:'user'}]),false);
  assert.equal(check([{accountId:'two',active:true,receiver:'67890'}]),false);
  assert.equal(check([{accountId:'one',active:true,receiver:'12345'}]),true);
  assert.equal(!!mobileLoginHold({...base,accountId:''},()=>JSON.stringify({qqLoginHolds:[{accountId:'',active:true}]})),true);
  assert.equal(!!mobileLoginHold(base,()=>{throw missing();}),false);
});

test('temporary state read failure defers the launch until the actual hold can be checked',()=>{
  const state={value:'{partial'},proc=watchdog(base,state);
  proc.tick(700);assert.equal(proc.qq().length,0);
  state.value={qqLoginHolds:[{accountId:base.accountId,receiver:base.qq,active:true}]};
  proc.tick(15000);assert.equal(proc.qq().length,0);
});

test('the manual login route may open QQ once for a platform notice and never for a user hold',async()=>{
  const mobile=readFileSync(new URL('../mobile-napcat.js',import.meta.url),'utf8')
    .replace(/^import .*;\r?$/gm,'').replaceAll('export function','function')
    .replace('import.meta.url',"'file:///virtual/mobile-napcat.js'");
  const hold={accountId:base.accountId,receiver:base.qq,time:123,active:true};
  const state={value:{qqLoginHolds:[hold]}},files=new Map(),starts=[];
  const env={join:path.join,loginHold,createHash,URL,process:{execPath:'mock-node'},fileURLToPath:url=>url.pathname,
    existsSync:()=>true,mkdirSync(){},writeFileSync:(file,data)=>files.set(file,JSON.parse(data)),
    readFileSync:file=>{if(file===base.stateFile)return JSON.stringify(state.value);throw missing();},
    connect(){const socket=new EventEmitter();socket.setTimeout=()=>{};socket.destroy=()=>{};
      queueMicrotask(()=>socket.emit('error',new Error('offline synthetic WebUI')));return socket;}};
  const create=runInNewContext(mobile+'\ncreateLocalNapCat',env);
  const adapter=create({getDir:()=>base.dir,getDataDir:()=>base.dataDir,getCacheDir:()=>base.cacheDir,
    getAccount:()=>base.qq,getAccountId:()=>base.accountId,getStateFile:()=>base.stateFile,
    spawnImpl(command,args){starts.push(args);const child=new EventEmitter();child.unref=()=>{};
      queueMicrotask(()=>child.emit('spawn'));return child;}});
  await assert.rejects(adapter.start(),/人工处理/);
  await performLocalLogin({action:'start',qq:base.qq,readStatus:async()=>({webuiReachable:false}),napcat:adapter});
  assert.equal(starts.length,1);
  const [,file,grant]=starts[0],config=files.get(file);
  assert.equal(config.accountId,base.accountId);assert.equal(config.stateFile,base.stateFile);
  assert.equal(grant,String(hold.time));assert(!Object.hasOwn(config,'manualVerification'));
  const restarted=watchdog(config,state,grant);restarted.tick(700);
  assert.equal(restarted.qq().length,1);restarted.qq()[0].emit('close');restarted.tick(15000);
  assert.equal(restarted.qq().length,1);
  const newer=watchdog(config,{value:{qqLoginHolds:[{...hold,time:124}]}},grant);
  newer.tick(700);assert.equal(newer.qq().length,0);
  hold.source='user';
  const interrupted=watchdog(config,state,grant);interrupted.tick(700);assert.equal(interrupted.qq().length,0);
  await assert.rejects(adapter.start({manualVerification:true}),/人工处理/);
  assert.equal(starts.length,1);
});
