import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createServer} from 'node:http';
import {createDeviceSync} from '../device-sync.js';

async function fixture(t,{failStage=false,hold=false,scanDelay=0,sameVersion=false,reloadWrites=false}={}){
 const root=fs.mkdtempSync(path.join(process.cwd(),'sync-progress-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 let paused={desktop:true,phone:true},origin,release,entered;const gate=new Promise(r=>release=r),staged=new Promise(r=>entered=r);
 function options(device){const dataDir=path.join(root,device),sourceDir=path.join(dataDir,'source'),cache=path.join(dataDir,'cache');for(const d of [dataDir,sourceDir,cache,path.join(dataDir,'device-sync')])fs.mkdirSync(d,{recursive:true});fs.writeFileSync(path.join(dataDir,'settings.json'),JSON.stringify({owners:['11111'],localChat:{enabled:device==='desktop'}}));fs.writeFileSync(path.join(sourceDir,'package.json'),JSON.stringify({version:device==='desktop'||sameVersion?'1.62.8':'1.58.0'}));fs.writeFileSync(path.join(dataDir,'device-sync/pairing.json'),JSON.stringify({token:'synthetic-pair'}));return {device,dataDir,sourceDir,roots:()=>({cache}),connectPeer:async()=>origin,flush:async()=>{if(device==='desktop'&&scanDelay){const until=Date.now()+scanDelay;while(Date.now()<until){}}},credential:async()=>'',status:()=>({device,version:device==='desktop'||sameVersion?'1.62.8':'1.58.0',paused:paused[device]}),pause:async()=>paused[device]=true,resume:async()=>paused[device]=false,reload:async()=>{if(reloadWrites){const file=path.join(dataDir,'settings.json'),value=JSON.parse(fs.readFileSync(file));value._loadedByRuntime=true;fs.writeFileSync(file,JSON.stringify(value));}}};}
 const pcOptions=options('desktop'),phoneOptions=options('phone');fs.writeFileSync(path.join(pcOptions.roots().cache,'proof.txt'),'actual file content');
 const phone=createDeviceSync(phoneOptions),pc=createDeviceSync(pcOptions);t.after(()=>{phone.close();pc.close();});
 const server=createServer(async(req,res)=>{try{assert.equal(req.headers.authorization,'Bearer synthetic-pair');let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{},name=req.url.slice(1);if(name==='stage'){entered();if(hold)await gate;if(failStage)throw Error('synthetic staging error');}const result=await phone.local[name](body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(result));}catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});server.keepAliveTimeout=10;await new Promise(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+server.address().port;t.after(()=>{server.closeAllConnections();server.close();});return {pc,phone,pcOptions,phoneOptions,release,staged};
}

test('USB progress describes a real staged transfer and success only follows post-write hash verification',async t=>{
 const f=await fixture(t,{hold:true}),task=f.pc.synchronize();await f.staged;
 const running=await f.pc.local.status();assert.equal(running.busy,true);assert.equal(running.progress.status,'running');assert.equal(running.progress.phase,'transferring');assert.ok(running.progress.filesTotal>0);assert.equal(running.lastSync,null);
 f.release();const report=await task;assert.equal(report.ok,true);assert.ok(report.verifiedFiles>0);assert.equal(fs.readFileSync(path.join(f.phoneOptions.roots().cache,'proof.txt'),'utf8'),'actual file content');
 const done=await f.pc.local.status();assert.equal(done.busy,false);assert.equal(done.progress.status,'completed');assert.equal(done.progress.bytesDone,done.progress.bytesTotal);assert.equal(done.progress.filesDone,done.progress.filesTotal);
 const restarted=createDeviceSync(f.pcOptions);t.after(()=>restarted.close());assert.equal((await restarted.local.status()).progress.status,'completed');
});

test('a staging error persists the exact failed phase and never reports old success as this transfer',async t=>{
 const f=await fixture(t,{failStage:true});await assert.rejects(f.pc.synchronize(),/synthetic staging error/);const state=await f.pc.local.status();assert.equal(state.busy,false);assert.equal(state.progress.status,'failed');assert.equal(state.progress.phase,'transferring');assert.match(state.progress.error,/staging error/);assert.equal(state.lastSync,null);assert.equal(JSON.parse(fs.readFileSync(path.join(f.phoneOptions.sourceDir,'package.json'))).version,'1.58.0');
 const restarted=createDeviceSync(f.pcOptions);t.after(()=>restarted.close());assert.equal((await restarted.local.status()).progress.status,'failed');
});


test('slow synchronous scans cannot reuse an expired USB HTTP keep-alive connection',async t=>{
 const f=await fixture(t,{scanDelay:60});const result=await f.pc.synchronize();assert.equal(result.ok,true);assert.equal((await f.pc.local.status()).progress.status,'completed');assert.equal(fs.readFileSync(path.join(f.phoneOptions.roots().cache,'proof.txt'),'utf8'),'actual file content');
});


test('verification manifests do not regenerate the device profile after merged settings were applied',async t=>{
 const f=await fixture(t),profile=path.join(f.pcOptions.dataDir,'device-sync/profiles/desktop.json');await f.pc.local.manifest();const original=fs.readFileSync(profile);
 const settingsFile=path.join(f.pcOptions.dataDir,'settings.json');fs.writeFileSync(settingsFile,JSON.stringify({owners:['11111'],accounts:[{id:'new-merged-account',qq:'22222'}]}));
 const snapshot=await f.pc.local.manifest({flush:false});assert.deepEqual(fs.readFileSync(profile),original);assert.ok(snapshot.files['profiles/desktop.json']);
});


test('data-only synchronization verifies before runtime normalization or profile saves change bytes',async t=>{
 const f=await fixture(t,{sameVersion:true,reloadWrites:true});const result=await f.pc.synchronize();assert.equal(result.ok,true);assert.equal(result.codeReloadRequired,false);assert.equal((await f.pc.local.status()).progress.status,'completed');
 for(const opts of [f.pcOptions,f.phoneOptions])assert.equal(JSON.parse(fs.readFileSync(path.join(opts.dataDir,'settings.json')))._loadedByRuntime,true);
});
