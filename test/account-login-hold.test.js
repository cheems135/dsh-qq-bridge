import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {manualLoginNotice,loginHold,recordLoginHold,recordUserLoginHold,releaseLoginHold,preserveLoginWindow,loginControlRequestStatus} from '../local-login.js';
import {bindQueuedSenders,knownUnsentRetry} from '../delivery-outbox.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const offline={post_type:'notice',notice_type:'bot_offline',time:100,self_id:12345,user_id:12345,
  tag:'下线通知',message:'你的帐号当前登录已失效，请重新登录。'};

test('only a bound bot_offline notice with explicit instructions requires human attention',()=>{
  for(const message of ['你的帐号当前登录已失效，请重新登录。','当前账号已被冻结','请先在手机上完成安全验证']){
    assert.ok(manualLoginNotice({...offline,message},'12345'));
  }
  for(const event of [{...offline,post_type:'message'},{...offline,notice_type:'group_ban'},{...offline,self_id:88888},
    {...offline,user_id:88888},{...offline,time:undefined},{...offline,message:'网络连接中断'},{...offline,message:'您的帐号在别处登录'},
    {...offline,message:'该群暂时禁止发言'},{...offline,message:'账号未被冻结，无需重新登录'},{...offline,message:'不需要重新登录或进行身份验证'},
    {retcode:1,message:offline.message}]){
    assert.equal(manualLoginNotice(event,'12345'),'');
  }
  assert.equal(manualLoginNotice(offline,undefined),'');
});

function connectionFixture(){
  const body=source.match(/^  function connectSocket\(\) \{[\s\S]*?^  \}/m)[0];
  const action=kind=>{
    const mark="case '"+kind+"':";
    const switchAt=source.indexOf("case 'activate-local':"),start=source.indexOf(mark,switchAt);
    return source.slice(start,source.indexOf("case '",start+mark.length));
  };
  const sockets=[],effects=[],timers=[],issues=[],state={};
  const pendingCalls=new Map();
  const settings={activeAccountId:'one'},disk={ok:true};
  const jobs=['queued','sending','unknown'].map((status,i)=>({id:'job'+i,status,accountId:'one',qqSenderId:'12345'}));
  const deps={
    deviceSync:null, cfg:{wsUrl:'ws://fixture'}, settings,state,qzoneSessionManager:null,
    featureState:{outbox:jobs},bindQueuedSenders,manualLoginNotice,recordLoginHold,recordUserLoginHold,loginHold,releaseLoginHold,
    diagnosticFailure:error=>error.message,loginControlRequestStatus,jsonResponse:(_res,status)=>status,pendingCalls,repairLocalOneBotBinding(){},saveFeatures(){},saveState:()=>disk.ok,refreshInitiativeTimers(){},log(){},
    setTimeout(fn){timers.push(fn);return{unref(){}};},setInterval(){return 1;},clearTimeout(){},clearInterval(){},
    armDeliveryVerification(){},flushOutbox(){},observeRecipientReply(){},handlePayload(){},
    captureQQRuntime(){},
    request:()=>new Promise(()=>{}),recoverUncertainInbox(){effects.push('recover');},resumeQueuedInbox(){},catchUpMissedMessages:async()=>{},
    reportBridgeIssue(event){issues.push(event);},
    MiniWebSocket:class{constructor(url,opts){Object.assign(this,opts);sockets.push(this);}
      open(){this.closed=false;this.ready=true;this.onOpen();}close(){this.closed=true;this.ready=false;}
      fail(error){this.close();this.onClose(error);}},
  };
  const startCheck=source.indexOf("if(['hold-account','resume'].includes(action.kind)");
  const check=source.slice(startCheck,source.indexOf("if (action.kind === 'switchLevel')",startCheck));
  const bridge=Function(...Object.keys(deps),`
    let socket,lastSelfId='',stopped=false,accountPaused=false,loginActionRevision=0,reconnectTimer=null,heartbeat,qzoneWarmTimer,qzoneConnectionRevision=0,lastDisconnectAt,reconnectDelay;
    `+body+`;return {connectSocket,paused:()=>accountPaused,act:(action,req={method:'POST',headers:{}})=>{const res={};`+check+";switch(action.kind){"+['resume','reconnect','hold-account','test'].map(action).join('\n')+"}}};")(...Object.values(deps));
  return {bridge,sockets,effects,timers,issues,state,disk,jobs,settings,pendingCalls};
}

test('OneBot reconnect reuses a pending handshake and rejects an obsolete retry after manual reconnect',()=>{
  const {bridge,sockets,timers}=connectionFixture();
  bridge.connectSocket();
  sockets[0].ready=false;
  bridge.connectSocket();
  assert.equal(sockets.length,1);
  sockets[0].fail(new Error('connection refused'));
  const firstRetry=timers.at(-1);
  bridge.act({kind:'reconnect'});
  assert.equal(sockets.length,2);
  bridge.connectSocket();
  firstRetry();
  assert.equal(sockets.length,2);
  sockets[1].fail(new Error('peer closed'));
  const currentRetry=timers.at(-1);
  firstRetry();
  assert.equal(sockets.length,2);
  currentRetry();
  currentRetry();
  assert.equal(sockets.length,3);
  assert.equal(sockets.filter(s=>!s.closed).length,1);
});

test('active socket pauses only the current profile, keeps pending jobs, and cannot replay ambiguous sends',async()=>{
  let submittedError;
  const {bridge,sockets,effects,timers,issues,state,jobs,pendingCalls}=connectionFixture();
  const deliver=(socket,payload)=>socket.onMessage(JSON.stringify(payload));
  const bind=socket=>deliver(socket,{post_type:'meta_event',self_id:12345});
  bridge.connectSocket();const socket=sockets[0];
  deliver(socket,offline);assert.deepEqual(effects,[]);assert.equal(bridge.paused(),false);
  bind(socket);assert.deepEqual(effects,['recover']);
  deliver(socket,{...offline,self_id:98765,user_id:98765});
  deliver(socket,{...offline,post_type:'message'});deliver(socket,{...offline,message:'普通掉线'});
  assert.equal(bridge.paused(),false);assert.equal(socket.qqSenderId,'12345');
  const priorTimers=timers.length;
  pendingCalls.set('send',{name:'send_msg',reject:error=>submittedError=error});
  deliver(socket,offline);
  assert.equal(bridge.paused(),true);assert.equal(socket.ready,false);
  assert.equal(issues.length,1);assert.equal(timers.length,priorTimers);
  assert.equal(submittedError.deliveryUnknown,true);assert.equal(knownUnsentRetry({at:Date.now()},submittedError),null);
  assert.deepEqual(jobs.map(job=>job.status),['queued','sending','unknown']);
  assert.ok(loginHold(JSON.parse(JSON.stringify(state)),'one'));assert.ok(!loginHold(state,'other'));
  assert.throws(()=>bridge.act({kind:'reconnect'}),/处理/);bridge.connectSocket();assert.equal(sockets.length,1);
  bridge.act({kind:'resume'});assert.equal(bridge.paused(),false);assert.ok(!loginHold(state,'one'));assert.equal(sockets.length,2);
  bind(sockets[1]);deliver(sockets[1],offline);assert.equal(bridge.paused(),false);
  deliver(socket,{...offline,time:101});assert.equal(bridge.paused(),false);
  deliver(sockets[1],{...offline,time:102});assert.equal(bridge.paused(),true);
});

test('operator can stop an offline account, without borrowing another receiver or claiming persistence on disk failure',()=>{
  const {bridge,sockets,state,disk,settings}=connectionFixture();
  const hold={kind:'hold-account',accountId:'one'},resume={kind:'resume',accountId:'one'};
  assert.equal(bridge.act(hold,{method:'GET'}),405);
  assert.equal(bridge.act(hold,{method:'POST',headers:{origin:'http://other',host:'localhost:1234'}}),403);
  assert.equal(bridge.act(hold,{method:'POST',headers:{origin:'null',host:'localhost:1234'}}),403);
  assert.throws(()=>bridge.act({...hold,accountId:'stale'}),/账号已改变/);
  disk.ok=false;
  assert.throws(()=>bridge.act(hold),/未能持久化/);
  assert.equal(bridge.paused(),true);
  assert.equal(loginHold(state,'one').source,'user');
  assert.equal(loginHold(state,'one').receiver,undefined);
  assert.throws(()=>bridge.act(resume),/保留暂停/);
  bridge.connectSocket();assert.equal(sockets.length,0);
  disk.ok=true;bridge.act(hold,{method:'POST',headers:{origin:'http://localhost:1234',host:'localhost:1234'}});
  assert.equal(loginHold(JSON.parse(JSON.stringify(state)),'one').source,'user');
  settings.activeAccountId='two';assert.ok(!loginHold(state,'two'));assert.throws(()=>bridge.act(resume),/账号已改变/);
  settings.activeAccountId='one';assert.throws(()=>bridge.act({kind:'reconnect'}),/处理/);
  assert.throws(()=>bridge.act({kind:'test'}),/未加入测试消息/);
  bridge.act(resume);assert.equal(sockets.length,1);assert.ok(!loginHold(state,'one'));
});

test('manual hold on a bound connection records its receiver and submitted calls are not eligible for replay',()=>{
  const {bridge,sockets,state,pendingCalls}=connectionFixture();
  bridge.connectSocket();
  sockets[0].onMessage(JSON.stringify({post_type:'meta_event',self_id:12345}));
  let error;pendingCalls.set('send',{reject:value=>error=value});
  bridge.act({kind:'hold-account',accountId:'one'});
  assert.equal(loginHold(state,'one').receiver,'12345');
  assert.equal(error.deliveryUnknown,true);assert.equal(knownUnsentRetry({at:Date.now()},error),null);
});

test('watchdog preserves explicit login work, retains normal crash recovery and rechecks account and connection after waiting',async()=>{
  const body=source.match(/^  async function recoverNapCat\([^]*?^  \}/m)[0];
  function fixture(read, startupFailure){
    const environment={scope:'one',status:read,socket:null};
    const effects=[],timers=[];
    const deps={settings:{activeAccountId:'one'},cfg:{napcat:{dir:'test'}},state:{},stopped:false,accountPaused:false,
      loginHold,loginScopeKey:()=>environment.scope,currentLoginClient:()=>({getStatus:()=>environment.status()}),
      localLoginAccount:()=> '12345',localNapCat:{startupFailure},preserveLoginWindow,guardConfig:()=>({}),join:()=>'',existsSync:()=>false,log(){},
      clearTimeout(){},setTimeout:fn=>{timers.push(fn);return 1;},killNapCatProcesses:()=>effects.push('stop'),
      startNapCatLauncher:async()=>effects.push('start')};
    const runtime=Function(...Object.keys(deps),`let lastDisconnectAt=1,lastRecoverAt=0,recoverWindowStart=0,recoverCount=0,recoveryLaunchTimer=null,socket=null;`+
      body+`;return {run:()=>recoverNapCat('watchdog'),changeConnection:()=>{lastDisconnectAt++}};`)(...Object.values(deps));
    return {runtime,effects,timers,environment};
  }
  for(const status of [{loginPhase:'waiting_qrcode'},{loginPhase:'generating_qrcode'},{loginPhase:'qrcode_scanned'},
      {qrLoginAccepted:true},{loginPhase:'offline',hasLoginError:true}]){
    let probes=0;const {runtime,effects}=fixture(async()=>{probes++;return status;});
    assert.equal(await runtime.run(),false);assert.equal(await runtime.run(),false);
    assert.equal(probes,1);assert.deepEqual(effects,[]);
  }
  for(const read of [async()=>({loginPhase:'offline'}),async()=>{throw Object.assign(Error('down'),{code:'WEBUI_UNAVAILABLE'});}]){
    const {runtime,effects,timers}=fixture(read);assert.equal(await runtime.run(),true);timers[0]();assert.deepEqual(effects,['stop','start']);
  }
  for(const state of [null, {coreReady:false}]){
    const {runtime,effects,timers}=fixture(async()=>state, async()=>'QQ_FILE_DAMAGED');
    assert.equal(await runtime.run(),false);
    assert.deepEqual(effects,[]);
    assert.deepEqual(timers,[]);
  }
  let complete;const pending=fixture(()=>new Promise(resolve=>complete=resolve)),waiting=pending.runtime.run();
  pending.environment.scope='other';complete({loginPhase:'offline'});assert.equal(await waiting,false);assert.deepEqual(pending.effects,[]);
  const delayed=fixture(async()=>({loginPhase:'offline'}));await delayed.runtime.run();delayed.runtime.changeConnection();delayed.timers[0]();
  assert.deepEqual(delayed.effects,['stop']);
});

test('every manual login mutation rejects an operator hold before any request, and a hold arriving during status prevents starting',async()=>{
  const start=source.indexOf("const input = JSON.parse(body || '{}'), action=input.action;");
  const body=source.slice(start,source.indexOf('const standby=',start));
  const check=source.match(/^  function assertLoginAction\([^]*?^  \}/m)[0];
  const state={},settings={activeAccountId:'one'},effects=[];
  let revision=0,onRead=()=>{};
  const deps={settings,state,loginHold,stopped:false,loginScopeKey:()=>String(revision),jsonResponse(){},res:{},
    readLoginState:async()=>{effects.push('read');onRead();},requestFreshQr:async()=>effects.push('qr'),
    localLoginAccount:()=> '12345',performLocalLogin:async()=>effects.push('start'),localNapCat:{},currentLoginClient:()=>({})};
  const run=Function(...Object.keys(deps),check+';return async body=>{'+body+'};')(...Object.values(deps));
  recordUserLoginHold(state,'one');
  for(const action of ['start','restart','qr-refresh'])await assert.rejects(run(JSON.stringify({action})),/手动标记/);
  assert.deepEqual(effects,[]);
  releaseLoginHold(state,'one');onRead=()=>{recordUserLoginHold(state,'one');revision++;};
  await assert.rejects(run('{"action":"start"}'),/已改变/);assert.deepEqual(effects,['read']);
});

test('an outstanding old WebUI identity lookup cannot overwrite the active account or its cached status',async()=>{
  const body=source.match(/^  async function readLoginState\([^]*?^  \}/m)[0];
  let profile='one',finish;
  const client={getStatus:async()=>({isLogin:true,coreReady:true,loginPhase:'ready'}),
    getLoginInfo:()=>profile==='one'?new Promise(resolve=>finish=resolve):Promise.resolve({uin:'22222'})};
  const deps={loginScopeKey:()=>profile,currentLoginClient:()=>client,localLoginAccount:()=>'',bridgeQQReady:()=>false,socket:null};
  const run=Function(...Object.keys(deps),`let loginSnapshotScope='',loginSnapshot=null,loginSnapshotPending=null,loginSnapshotAt=0,qrMemory={},lastSelfId='';`+
    body+`;return {read:readLoginState,id:()=>lastSelfId};`)(...Object.values(deps));
  const old=run.read(true);await new Promise(resolve=>setImmediate(resolve));profile='two';
  assert.equal((await run.read()).qqLoggedIn,true);assert.equal(run.id(),'22222');
  finish({uin:'11111'});await assert.rejects(old,/账号已改变/);
  assert.equal(run.id(),'22222');assert.equal((await run.read()).qqLoggedIn,true);
});
