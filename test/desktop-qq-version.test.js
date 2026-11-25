import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createQQInstallationReader, createQQStartupRuntimeReader, readQQConnectionRuntime, readRegisteredQQPath } from '../desktop-napcat.js';
import { hasQQReceiver, startDesktopIfNeeded } from '../local-login.js';
import {createDesktopStartupHealth} from '../desktop-startup-health.js';

function installedFixture() {
  let selected = '9.9.37-54395', stamp = 1, entry = '9.9.23.42430', reads = 0;
  const exe = path.resolve('fixture', 'QQ.exe');
  const cores = new Set(['9.9.37-54395', '9.9.40-60000']);
  const io = {
    statSync: () => ({ size: 100, mtimeMs: stamp, ctimeMs: stamp }),
    readFileSync: () => JSON.stringify({ curVersion: selected }),
    existsSync: file => cores.has(path.basename(path.dirname(file))),
  };
  const read = createQQInstallationReader(() => exe, io, async () => { reads++; return entry; });
  return { read, reads: () => reads, select: value => { selected=value; }, replace: value => { stamp++; entry=value; } };
}

test('entry metadata and the selected QQ core are independent and refresh after an update', async () => {
  const f=installedFixture();
  const [a,b]=await Promise.all([f.read(),f.read()]);
  assert.deepEqual(a,{entryVersion:'9.9.23.42430',coreVersion:'9.9.37-54395',corePresent:true});
  assert.deepEqual(b,a);
  assert.equal(f.reads(),1);
  f.select('9.9.40-60000');
  assert.equal((await f.read()).coreVersion,'9.9.40-60000');
  assert.equal(f.reads(),1);
  f.replace('9.9.40.60000');
  assert.equal((await f.read()).entryVersion,'9.9.40.60000');
  assert.equal(f.reads(),2);
});

test('an incomplete update, missing metadata, or an invalid version never selects some other directory',async()=>{
  const f=installedFixture();
  f.select('9.9.38-55666');
  assert.deepEqual(await f.read(),{entryVersion:'9.9.23.42430',coreVersion:'9.9.38-55666',corePresent:false});
  for(const selected of [null,'','../9.9.37-54395']){
    f.select(selected);
    assert.deepEqual(await f.read(),{entryVersion:'9.9.23.42430',coreVersion:'',corePresent:null});
  }
  const missing=createQQInstallationReader(()=>{throw Error('no installed QQ');});
  assert.equal(await missing(),null);
});

test('QQ lookup reads registry paths with Chinese names and ignores entries with no installed executable',()=>{
  const existing='E:\\软件目录\\QQ 旧版\\QQ.exe';
  const run=(exe,_args,options)=>{
    assert.equal(exe,'powershell.exe');
    assert.equal(options.encoding,'utf8');
    return {status:0,stdout:'"C:\\Tencent\\Old\\Uninstall.exe"\r\n"E:\\软件目录\\QQ 旧版\\Uninstall.exe" /S\r\n'};
  };
  assert.equal(readRegisteredQQPath(run,file=>file===existing),existing);
  assert.equal(readRegisteredQQPath(run,()=>false),'');
});

test('a transport handshake cannot be presented as a confirmed QQ identity',()=>{
  const client={ready:true,qqAccountId:'this-profile',qqSenderId:'123456'};
  assert.equal(hasQQReceiver(client,'this-profile'),true);
  for(const state of [{ready:false},{qqSenderId:''},{qqSenderId:'invalid'},{qqOnline:false}]){
    assert.equal(hasQQReceiver({...client,...state},'this-profile'),false);
  }
  assert.equal(hasQQReceiver(client,'previous-profile'),false);
  assert.equal(hasQQReceiver(null,'this-profile'),false);
});

test('a reconnect reports the version and start time of the QQ process that owns this socket',async()=>{
  const installed=await installedFixture().read();
  assert.equal(installed.coreVersion,'9.9.37-54395');
  const socket={localAddress:'::ffff:127.0.0.1',remoteAddress:'127.0.0.1',localPort:51000,remotePort:3001};
  const original={exe:'C:/Tencent/QQNT/QQ.exe',module:'C:/Tencent/QQNT/versions/9.9.36-53644/QQNT.dll',startedAt:1000};
  const inspect=async endpoint=>{
    assert.deepEqual(endpoint,{clientAddress:'127.0.0.1',serverAddress:'127.0.0.1',clientPort:51000,serverPort:3001});
    return original;
  };
  const expected={coreVersion:'9.9.36-53644',startedAt:1000};
  assert.deepEqual(await readQQConnectionRuntime(socket,2000,inspect),expected);
  assert.deepEqual(await readQQConnectionRuntime(socket,9000,inspect),expected);
  for(const observation of [null,{...original,exe:'C:/Tencent/QQNT/proxy.exe'},
      {...original,module:'C:/Other/versions/9.9.37-54395/QQNT.dll'},{...original,startedAt:9001}]){
    assert.equal(await readQQConnectionRuntime(socket,9000,async()=>observation),null);
  }
  assert.equal(await readQQConnectionRuntime({...socket,remoteAddress:'198.51.100.20'},9000,
    async()=>{assert.fail('A remote receiver cannot be attributed to a local process.');}),null);
});

test('a verified startup can show its loaded build before OneBot opens without borrowing evidence from another attempt',async()=>{
  const exe='C:/Tencent/QQNT/QQ.exe';
  let record={exe,pid:20,createdTicks:'638444736000000000',qq:'123456',setupKey:'current'};
  let profile='first',reads=0,notices=0;
  const read=createQQStartupRuntimeReader(()=>record,()=>profile,()=>record.qq,async()=>profile==='first'?'current':'other',
    async observed=>{
      reads++;
      return observed.pid===20?{exe,module:'C:/Tencent/QQNT/versions/9.9.37-54395/QQNT.dll',startedAt:1000}:null;
    },()=>notices++);
  const expected={coreVersion:'9.9.37-54395',startedAt:1000};
  assert.deepEqual(await read(),expected);
  assert.deepEqual(await read(),expected);
  assert.equal(reads,1);
  assert.equal(notices,1);
  profile='second';
  assert.equal(await read(),null);
  profile='first';
  record={...record,pid:21,profileId:'first'};
  assert.equal(await read(),null);
  assert.equal(reads,2);
});

test('automatic startup reuses a service or transport and honors pauses during discovery',async()=>{
  for(const scenario of ['paused','transport','management','logged-in','paused-during-probe','connected-during-probe','missing']){
    const calls=[];let allowed=scenario!=='paused',open=scenario==='transport';
    const started=await startDesktopIfNeeded({
      canStart:()=>allowed,transportReady:()=>open,readStatus:async()=>{
        calls.push('probe');
        if(scenario==='paused-during-probe')allowed=false;
        if(scenario==='connected-during-probe')open=true;
        return {webuiReachable:scenario==='management',qqLoggedIn:scenario==='logged-in'};
      },start:async()=>{calls.push('start');},
    });
    assert.equal(started,scenario==='missing',scenario);
    assert.equal(calls.includes('start'),scenario==='missing',scenario);
    if(scenario==='paused'||scenario==='transport')assert.deepEqual(calls,[]);
  }
});

function healthFixture(){
  const data=path.resolve('fake-data'),files=new Map(),ticks='638444736000000000';
  let damaged=true,probes=0,core='9.9.37-54395',account='123456',mtime=1;
  const owned=path.join(data,'desktop-qq-process.json');
  const record={pid:17,createdTicks:ticks,exe:path.resolve('qq','QQ.exe'),qq:account};
  files.set(owned,JSON.stringify(record));
  const io={
    readFileSync:file=>{if(!files.has(file))throw Error('missing');return files.get(file);},
    statSync:()=>({size:32,mtimeMs:mtime,ctimeMs:mtime}),mkdirSync(){},
    writeFileSync:(file,value)=>files.set(file,value),renameSync:(from,to)=>{files.set(to,files.get(from));files.delete(from);},
    unlinkSync:file=>files.delete(file),
  };
  function make(){return createDesktopStartupHealth({dataDir:data,io,installation:async()=>({coreVersion:core,entryVersion:'9.9.23.42430'}),
    getExe:()=>record.exe,getLauncher:()=>path.resolve('adapter','launcher.exe'),getDir:()=>path.resolve('adapter'),
    getAccount:()=>account,getProfile:()=>'current',probe:async()=>{probes++;return damaged;}});
  }
  return {make,probes:()=>probes,dismiss:()=>{damaged='QQ_PROCESS_ENDED';},account:v=>{account=v;},core:v=>{core=v;},
    stamp:v=>{mtime=v;},bind:key=>files.set(owned,JSON.stringify({...record,setupKey:key}))};
}

test('only a confirmed QQ dialog stops automatic starts, including after restarting the plugin',async()=>{
  const f=healthFixture(),first=f.make();
  assert.equal(await first.check(),'QQ_FILE_DAMAGED');
  assert.equal(f.probes(),1);
  const reopened=f.make();
  assert.equal(await reopened.check(),'QQ_FILE_DAMAGED');assert.equal(f.probes(),1);
  assert.equal(await reopened.check({manual:true}),'QQ_FILE_DAMAGED');assert.equal(f.probes(),2);
  f.dismiss();
  assert.equal(await reopened.check({manual:true}),'');
  assert.equal(await f.make().check(),'QQ_FILE_DAMAGED');
  await reopened.acknowledge();
  assert.equal(await f.make().check(),'');
  assert.equal(await reopened.check({includeProcessExit:true}),'QQ_PROCESS_ENDED');
});

test('a previous popup cannot be attributed to a different QQ version, component install, or account',async()=>{
  const f=healthFixture(),h=f.make();
  f.bind(await h.key());assert.equal(await h.check(),'QQ_FILE_DAMAGED');
  f.core('9.9.38-55555');assert.equal(await h.check(),'');assert.equal(f.probes(),1);
  f.core('9.9.37-54395');f.stamp(2);assert.equal(await h.check(),'');assert.equal(f.probes(),1);
  f.stamp(1);f.account('654321');assert.equal(await h.check(),'');assert.equal(f.probes(),1);
});

test('a live compatible service clears its own saved failure and an unrelated receiver cannot clear it',async()=>{
  const f=healthFixture(),h=f.make();
  assert.equal(await h.check(),'QQ_FILE_DAMAGED');f.dismiss();
  f.account('654321');await h.acknowledge();
  f.account('123456');assert.equal(await f.make().check(),'QQ_FILE_DAMAGED');
  await h.acknowledge();assert.equal(await f.make().check(),'');
});
