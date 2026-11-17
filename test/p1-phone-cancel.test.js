import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import vm from 'node:vm';
import {createDeviceSync} from '../device-sync.js';
import {createPlatformPhoneController} from '../device-platform.js';
import {createMobilePhoneController} from '../mobile-phone-controller.js';
const wait=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
let root,sync,pc,native,control,events,mode='cooperative',effects=0,signalSeen;
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
test.before(async()=>{
 root=fs.mkdtempSync(join(process.env.TEMP||process.cwd(),'phone-cancel-'));const sourceDir=join(root,'source');fs.mkdirSync(sourceDir);fs.writeFileSync(join(sourceDir,'package.json'),'{"version":"1.62.9"}');fs.mkdirSync(join(root,'device-sync'));fs.writeFileSync(join(root,'device-sync/pairing.json'),'{"token":"isolated-phone-cancel-test"}');
 native=createMobilePhoneController({getConfig:()=>({enabled:true}),getCacheDir:()=>root,authorize:()=>true,getAgent:async()=>({id:'test-owner'}),getTools:()=>({schemas:()=>['screen','open'].map(n=>({name:'mcp__phone__'+n})),execute:async request=>{
  signalSeen=request.signal;events.entered.resolve();
  if(mode==='instant')return {content:[{type:'text',text:'actual fixture response'}]};
  if(mode==='cooperative')await new Promise((resolve,reject)=>{const stop=()=>{events.cancelled.resolve();reject(request.signal.reason);};request.signal.addEventListener('abort',stop,{once:true});if(request.signal.aborted)stop();else events.finish.promise.then(()=>{request.signal.removeEventListener('abort',stop);resolve();});});
  else await events.finish.promise;
  effects++;return {content:[{type:'text',text:'actual fixture response'}]};
 }})});
 // Run the actual host phone callback, not a test-only replacement for signal forwarding.
 const start=source.indexOf('    phone:async',source.indexOf('deviceSync=createDeviceSync(')),end=source.indexOf('\n    register:route',start),phone=source.slice(start,end).trim().replace(/^phone:/,'').replace(/,$/,'');
 const context={settings:{agency:{phone:true},activeAccountId:'test'},featureState:{generation:1},phoneController:native};vm.createContext(context);const receiver=vm.runInContext('('+phone+')',context);
 sync=createDeviceSync({device:'phone',dataDir:root,sourceDir,roots:()=>({cache:root}),register:()=>{},status:()=>({paused:true}),phone:receiver});await sync.start();
 pc=createDeviceSync({device:'desktop',dataDir:root,sourceDir,roots:()=>({cache:root}),connectPeer:async()=> 'http://127.0.0.1:19482',status:()=>({paused:true})});
 control=createPlatformPhoneController({getConfig:()=>({enabled:true}),authorize:()=>true,peer:()=>pc});
});
test.beforeEach(()=>{mode='cooperative';effects=0;events={entered:wait(),finish:wait(),cancelled:wait()};signalSeen=null;});
test.after(()=>{control?.cancel();sync?.close();pc?.close();});
test('P1 B02 pre-aborted calls dispatch no native tools',async()=>{const c=new AbortController();c.abort();await assert.rejects(control.act({action:'observe'},{signal:c.signal}));assert.equal(signalSeen,null);assert.equal(effects,0);});
test('P1 B02 real RPC signal cancellation reaches the corresponding native tool',async()=>{
 const c=new AbortController(),run=control.act({action:'observe'},{signal:c.signal}),rejected=assert.rejects(run,/abort/i);await events.entered.promise;c.abort();await rejected;await events.cancelled.promise;assert.equal(signalSeen.aborted,true);assert.equal(effects,0);
});
test('P1 B02 explicit cancel reaches native tool over the independent RPC socket',async()=>{
 const run=control.act({action:'launch',package:'fixture.only'}),rejected=assert.rejects(run,/abort/i);await events.entered.promise;control.cancel();await rejected;await events.cancelled.promise;assert.equal(effects,0);
});
test('P1 B02 cancelling a status request does not cancel another native operation',async()=>{
 const run=control.act({action:'observe'});await events.entered.promise;const c=new AbortController();c.abort();await assert.rejects(control.act({action:'status'},{signal:c.signal}));assert.equal(signalSeen.aborted,false);events.finish.resolve();assert.equal((await run).ok,true);assert.equal(effects,1);
});
test('P1 B02 normal completed response is retained; socket close after response is not cancellation',async()=>{mode='instant';const r=await control.act({action:'observe'});assert.equal(r.ui,'actual fixture response');assert.equal(r.completed,false);assert.equal(signalSeen.aborted,false);});
test('P1 B02 late result from an uncooperative tool is discarded after cancellation',async()=>{
 mode='uncooperative';const run=control.act({action:'observe'}),rejected=assert.rejects(run,/abort/i);await events.entered.promise;control.cancel();await rejected;
 // A disconnected socket aborts the actual native signal even if its implementation ignores it.
 await new Promise(resolve=>{if(signalSeen.aborted)resolve();else signalSeen.addEventListener('abort',resolve,{once:true});});assert.equal(signalSeen.aborted,true);events.finish.resolve();
 // Wait for the adapter's finally block before starting another operation.
 await new Promise(r=>setImmediate(r));mode='instant';assert.equal((await control.act({action:'observe'})).ok,true);assert.equal(effects,1);
});
test('P1 B02 service close aborts an in-flight native request',async()=>{
 const run=control.act({action:'observe'}),rejected=assert.rejects(run);await events.entered.promise;sync.close();await events.cancelled.promise;await rejected;assert.equal(effects,0);
});
test('P1 B02 host cancellation and disposal both invoke phone cancellation',()=>{
 const start=source.indexOf("  function cancelFeatureWork("),end=source.indexOf('\n  const groupAttention',start);assert(start>=0&&end>start);let cancellations=0;
 const context={phoneController:{cancel:()=>cancellations++},videoReader:null,localInitiative:null,localGroupWindow:{clear:()=>{}},localTurns:new Map(),groupAttention:new Map(),groupTranscripts:new Map(),clearTimeout, outboxWakeTimer:null,deliveryVerificationTimer:null,deliveryHistoryCache:new Map(),socialReadbackTimer:null,socialReadbacks:new Map(),featureState:{outbox:[],inbox:[]},inboxTimers:new Map(),outboundWaiters:new Set(),saveFeatures:()=>{}};vm.createContext(context);vm.runInContext(source.slice(start,end)+'\ncancelFeatureWork();',context);assert.equal(cancellations,1);
 assert(source.includes('stopped = true;\n    phoneController?.cancel();'));
});
