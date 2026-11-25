import test from 'node:test';
import assert from 'node:assert/strict';
import {startDesktopIfNeeded,performLocalLogin} from '../local-login.js';
import {createNapCatLoginClient} from '../napcat-login-client.js';

test('startup tries the saved account once in an existing QR window without restarting QQ or refreshing its QR',async()=>{
  let attempts=0;
  const started=await startDesktopIfNeeded({canStart:()=>true,transportReady:()=>false,
    readStatus:async()=>({webuiReachable:true,coreReady:false,status:'waiting_qrcode',hasLiveQr:true}),
    start:()=>assert.fail('the current QQ process must remain'),quickLogin:async()=>{attempts++;}});
  assert.equal(started,false);assert.equal(attempts,1);
});

test('a cold startup waits for login readiness and never retries its one saved-account request',async()=>{
  let reads=0,starts=0,attempts=0;
  const result=await startDesktopIfNeeded({canStart:()=>true,transportReady:()=>false,
    readStatus:async()=>++reads<3?{webuiReachable:reads>1,coreReady:false,status:'core_not_ready'}:{webuiReachable:true,status:'waiting_qrcode',hasLiveQr:true,coreReady:false},
    start:async()=>{starts++;},quickLogin:async()=>{attempts++;},delay:async()=>{}});
  assert.equal(result,true);assert.equal(starts,1);assert.equal(attempts,1);
});

test('already logged-in, scanned QR, account mismatch and user pause prevent saved-account operations',async()=>{
  for(const status of [{qqLoggedIn:true},{status:'qrcode_scanned'},{status:'initializing'},{status:'account_mismatch'},{hasLoginError:true}]){
    await startDesktopIfNeeded({canStart:()=>true,transportReady:()=>false,readStatus:async()=>({webuiReachable:true,...status}),start:()=>assert.fail('no restart'),quickLogin:()=>assert.fail('preserve current authentication')});
  }
  let allowed=true;await startDesktopIfNeeded({canStart:()=>allowed,transportReady:()=>false,readStatus:async()=>({webuiReachable:false}),start:async()=>{allowed=false;},quickLogin:()=>assert.fail('cancelled startup'),delay:async()=>{}});
});

function clientFixture({readbackMismatch=false}={}){
  let saved='',writes=0;const calls=[];
  const client=createNapCatLoginClient({napcatDir:'fixture',exists:()=>false,
    readFile:()=>JSON.stringify({host:'127.0.0.1',port:6099,token:'fixture'}),
    transport:async args=>{const method=args.url.split('/').at(-1);calls.push(method);let data;
      if(method==='login')data={Credential:'fixture-credential'};
      else if(method==='GetQuickLoginQQ')data=readbackMismatch?'':saved;
      else if(method==='SetQuickLoginQQ'){saved=args.body.uin;writes++;data={};}
      else throw Error(method);
      return {code:0,data};}});
  return {client,calls,writes:()=>writes};
}

test('the selected startup account is persisted through the official API and read back',async()=>{
  const f=clientFixture();assert.equal(await f.client.getQuickLoginAccount(),'');
  assert.equal((await f.client.setQuickLoginAccount('123456')).saved,true);
  assert.equal(await f.client.getQuickLoginAccount(),'123456');assert.equal(f.writes(),1);
  await assert.rejects(f.client.setQuickLoginAccount('not-an-account'),e=>e.code==='ACCOUNT_INVALID');assert.equal(f.writes(),1);
  const broken=clientFixture({readbackMismatch:true});await assert.rejects(broken.client.setQuickLoginAccount('123456'),e=>e.code==='QUICK_ACCOUNT_NOT_SAVED');
});

test('an explicit history login also remembers the chosen account without asking for another QR',async()=>{
  const calls=[];const result=await performLocalLogin({action:'start',qq:'123456',readStatus:async()=>({webuiReachable:true,status:'waiting_qrcode',hasLiveQr:true}),napcat:{},
    client:{getQuickLoginList:async()=>['123456'],setQuickLogin:async id=>calls.push(['login',id]),setQuickLoginAccount:async id=>calls.push(['remember',id])},
    getQr:()=>assert.fail('history is available'),refreshQr:()=>assert.fail('keep existing window')});
  assert.equal(result.remembered,true);assert.deepEqual(calls,[['login','123456'],['remember','123456']]);
});
