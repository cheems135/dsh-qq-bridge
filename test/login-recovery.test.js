import test from 'node:test';import assert from 'node:assert/strict';
import {localOneBotAccount} from '../local-onebot.js';import {currentQQLoginView,performLocalLogin} from '../local-login.js';
test('account recovery requires unique local endpoint and exact credential match',()=>{
 const options={wsUrl:'ws://127.0.0.1:3001',napcatDir:'/test',token:'fixture'};
 const io={readdirSync:()=>['onebot11_123456.json','onebot11_234567.json'],readFileSync:p=>JSON.stringify({network:{websocketServers:[{enable:true,port:p.includes('123456')?3001:3002,token:'fixture'}]}})};
 assert.equal(localOneBotAccount(options,io),'123456');assert.equal(localOneBotAccount({...options,token:'wrong'},io),'');assert.equal(localOneBotAccount({...options,wsUrl:'ws://example.com:3001'},io),'');
 io.readFileSync=()=>JSON.stringify({network:{websocketServers:[{enable:true,port:3001,token:'fixture'}]}});assert.equal(localOneBotAccount(options,io),'');
});
test('online management without QQ core cannot claim QR readiness or start extra process',async()=>{
 let called=0;await assert.rejects(performLocalLogin({action:'start',qq:'123456',readStatus:async()=>({webuiReachable:true,coreReady:false}),napcat:{start:()=>called++},client:{getQuickLoginList:()=>called++},getQr:()=>called++,refreshQr:()=>called++}),/尚未就绪/);assert.equal(called,0);
});
test('an active NapCat QR survives an old process failure and can be used to log in again',async()=>{
 const state={webuiReachable:true,coreReady:false,qqLoggedIn:false,status:'waiting_qrcode',hasLiveQr:true};
 assert.deepEqual(currentQQLoginView({state,qr:{available:true},verified:false,transportOpen:false,processFault:'QQ_PROCESS_ENDED',local:true}),{
   qqLoggedIn:false,loginPhase:'waiting_qrcode',startupError:'',canScan:true,qrAvailable:true,
 });
 const result=await performLocalLogin({action:'start',qq:'123456',readStatus:async()=>state,
   napcat:{start:()=>assert.fail('The existing login process should be reused')},client:{getQuickLoginList:async()=>[]},
   getQr:async()=>({available:true}),refreshQr:()=>assert.fail('The existing QR is usable')});
 assert.equal(result.scheduled,true);
});
test('verified receiver supersedes an older logged-out sample and hides its QR',()=>{
 const state={webuiReachable:true,qqLoggedIn:false,hasLiveQr:true,status:'waiting_qrcode'};
 assert.deepEqual(currentQQLoginView({state,qr:{available:true},verified:true,transportOpen:true,processFault:'QQ_FILE_DAMAGED',local:true}),{
   qqLoggedIn:true,loginPhase:'ready',startupError:'',canScan:false,qrAvailable:false,
 });
});
test('refresh rejection is visible rather than false login scheduled',async()=>{
 await assert.rejects(performLocalLogin({action:'start',qq:'123456',readStatus:async()=>({webuiReachable:true,coreReady:true}),napcat:{},client:{getQuickLoginList:async()=>[]},getQr:async()=>({available:false}),refreshQr:async()=>{throw Object.assign(Error('二维码未就绪'),{code:'QR_NOT_READY'});}}),/未就绪/);
});
