import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createDeviceSync,standbyReason} from '../device-sync.js';

test('an explicitly selected other device always puts this machine on standby',()=>{
 assert.equal(standbyReason({own:'desktop',selected:'phone',paired:true,qqReady:true}),'other-device');
 assert.equal(standbyReason({own:'phone',selected:'desktop',paired:true,qqReady:true}),'other-device');
 assert.equal(standbyReason({own:'desktop',selected:'desktop',paired:true,qqReady:false}),'');
 assert.equal(standbyReason({own:'desktop',selected:''}),'');
});

test('a paired desktop with no QQ connection stops spending after the grace period',()=>{
 const now=10_000_000,since=now-6*60*1000;
 assert.equal(standbyReason({own:'desktop',selected:'desktop',paired:true,qqReady:false,since,now}),'no-qq');
 assert.equal(standbyReason({own:'desktop',selected:'desktop',paired:true,qqReady:false,since:now-60*1000,now}),'');
 assert.equal(standbyReason({own:'desktop',selected:'desktop',paired:true,qqReady:true,since,now}),'');
 assert.equal(standbyReason({own:'desktop',selected:'desktop',paired:false,qqReady:false,since,now}),'');
 assert.equal(standbyReason({own:'phone',selected:'phone',paired:true,qqReady:false,since,now}),'');
});

test('device sync exposes the pairing token and the selected runtime device',async t=>{
 const root=fs.mkdtempSync(path.join(process.cwd(),'standby-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=path.join(root,'device-sync');fs.mkdirSync(dir,{recursive:true});
 const options={device:'desktop',dataDir:root,sourceDir:root,roots:()=>({cache:root}),credential:async()=>'',status:()=>({device:'desktop',version:'x',paused:false}),flush:async()=>{},pause:async()=>{},resume:async()=>{},reload:async()=>{},connectPeer:async()=>'http://127.0.0.1:1',register:()=>{},log:()=>{}};
 const sync=createDeviceSync(options);t.after(()=>sync.close());
 assert.equal(sync.paired(),false);
 assert.equal(sync.activeDevice(),'');
 fs.writeFileSync(path.join(dir,'pairing.json'),JSON.stringify({token:'synthetic'}));
 assert.equal(sync.paired(),true);
 fs.writeFileSync(path.join(dir,'active-device.json'),JSON.stringify({device:'phone'}));
 assert.equal(sync.activeDevice(),'phone');
 assert.equal(sync.allowRun(),false);
});
