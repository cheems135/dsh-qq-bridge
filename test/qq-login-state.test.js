import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createNapCatLoginClient} from '../napcat-login-client.js';
import {performLocalLogin} from '../local-login.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');

test('login reads the live local account before the bridge is connected, even when paused and no account was configured',async()=>{
 let reads=0;const start=source.indexOf('  async function readLoginState('),end=source.indexOf('  async function qrMeta(',start);
 const scope={loginSnapshot:null,loginSnapshotAt:0,loginSnapshotPending:null,qrMemory:{url:'',at:0},lastSelfId:'',socket:null,Date,
  localLoginAccount:required=>{assert.equal(required,false);return '';},qrFileInfo:()=>({exists:false}),
  loginClient:{getStatus:async()=>({isLogin:true,isOffline:false,loginPhase:'ready'}),getLoginInfo:async()=>{reads++;return {uin:'12345678',online:true};}}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end)+'this.readLoginState=readLoginState;',scope);
 const result=await scope.readLoginState(true);assert.equal(result.qqLoggedIn,true);assert.equal(result.status,'ready');assert.equal(result.error,'');assert.equal(scope.lastSelfId,'12345678');assert.equal(reads,1);
});

test('a live account different from the configured bot is not silently adopted',async()=>{
 const start=source.indexOf('  async function readLoginState('),end=source.indexOf('  async function qrMeta(',start);
 const scope={loginSnapshot:null,loginSnapshotAt:0,loginSnapshotPending:null,qrMemory:{url:'',at:0},lastSelfId:'',socket:null,Date,localLoginAccount:()=> '11111111',qrFileInfo:()=>({exists:false}),loginClient:{getStatus:async()=>({isLogin:true,isOffline:false}),getLoginInfo:async()=>({uin:'22222222',online:true})}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end)+'this.readLoginState=readLoginState;',scope);
 const result=await scope.readLoginState(true);assert.match(result.error,/不一致/);assert.equal(scope.lastSelfId,'');assert.notEqual(result.qqLoggedIn,true);
});

test('first QR login can reuse an already running NapCat without a configured account, never restarts an unidentified QQ process',async()=>{
 let stops=0,starts=0,quick=0;
 const options={action:'start',qq:'',readStatus:async()=>({webuiReachable:true,status:'waiting_qrcode',qqLoggedIn:false}),napcat:{stop:async()=>stops++,start:async()=>starts++},client:{getQuickLoginList:async()=>['12345678'],setQuickLogin:async()=>quick++},getQr:async()=>({available:true}),refreshQr:async()=>{throw Error('already valid');}};
 assert.equal((await performLocalLogin(options)).scheduled,true);assert.equal(starts+stops+quick,0);
 await assert.rejects(performLocalLogin({...options,action:'restart'}),/未停止任何/);assert.equal(stops,0);
});

test('NapCat login info uses authenticated read-only endpoint and validates account identifiers',async()=>{
 const calls=[];const client=createNapCatLoginClient({napcatDir:'x',readFile:()=>JSON.stringify({host:'127.0.0.1',port:6099,token:'test'}),exists:()=>false,transport:async o=>{calls.push(o.url);return {code:0,data:o.url.endsWith('auth/login')?{Credential:'credential'}:{uin:'12345678',online:true}};}});
 assert.deepEqual(await client.getLoginInfo(),{uin:'12345678',online:true});assert.equal(calls.length,2);assert.ok(calls[1].endsWith('/api/QQLogin/GetQQLoginInfo'));
});
