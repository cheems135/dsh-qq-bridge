import test from 'node:test';import assert from 'node:assert/strict';
import {localOneBotAccount} from '../local-onebot.js';import {performLocalLogin} from '../local-login.js';
test('account recovery requires unique local endpoint and exact credential match',()=>{
 const options={wsUrl:'ws://127.0.0.1:3001',napcatDir:'/test',token:'fixture'};
 const io={readdirSync:()=>['onebot11_123456.json','onebot11_234567.json'],readFileSync:p=>JSON.stringify({network:{websocketServers:[{enable:true,port:p.includes('123456')?3001:3002,token:'fixture'}]}})};
 assert.equal(localOneBotAccount(options,io),'123456');assert.equal(localOneBotAccount({...options,token:'wrong'},io),'');assert.equal(localOneBotAccount({...options,wsUrl:'ws://example.com:3001'},io),'');
 io.readFileSync=()=>JSON.stringify({network:{websocketServers:[{enable:true,port:3001,token:'fixture'}]}});assert.equal(localOneBotAccount(options,io),'');
});
test('online management without QQ core cannot claim QR readiness or start extra process',async()=>{
 let called=0;await assert.rejects(performLocalLogin({action:'start',qq:'123456',readStatus:async()=>({webuiReachable:true,coreReady:false}),napcat:{start:()=>called++},client:{getQuickLoginList:()=>called++},getQr:()=>called++,refreshQr:()=>called++}),/内核尚未就绪/);assert.equal(called,0);
});
test('refresh rejection is visible rather than false login scheduled',async()=>{
 await assert.rejects(performLocalLogin({action:'start',qq:'123456',readStatus:async()=>({webuiReachable:true,coreReady:true}),napcat:{},client:{getQuickLoginList:async()=>[]},getQr:async()=>({available:false}),refreshQr:async()=>{throw Object.assign(Error('二维码未就绪'),{code:'QR_NOT_READY'});}}),/未就绪/);
});
