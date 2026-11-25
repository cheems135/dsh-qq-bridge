import test from 'node:test';
import {formScope} from '../ui/form-state.js';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../ui/console-controller.js', import.meta.url), 'utf8');
function fixture(failing = '') {
  const calls = [];
  const nodes = {pane: {}, retryLoad: {}, modal:{hidden:true}};
  const core = {settings: {}, status: {edition: 'desktop'}};
  const ctx = vm.createContext({
    formScope,newFormScope(){ctx.resetScope=true;},
    api: async (_, path) => {
      const key = path.split('/').at(-1);
      calls.push(key);
      if (key === failing) throw Error('HTTP 503');
      return {settings: core, models: {groups: []}, presets: {presets: []}}[key] || {};
    },
    data: null, renderedTab: '', tab: 'overview', models: null, presets: [], thoughts: null, storage: null, login: null, monitor: null,
    featureData: null, deviceProfileData: null, lastSnapshotAt: 0, hubPreview: null, hubSelection: null, hubSearchResult: '',
    alignHomeQQProfile() {}, mobileUiPolicy() {}, initNavigation() {}, renderPill() {}, renderPane() {ctx.renderedTab = ctx.tab;},
    maybeShowOnboarding() {ctx.onboarded = true;}, $: key => nodes[key], toast() {}, esc: String,
  });
  const start = source.indexOf('  var pageResourceLabels');
  vm.runInContext(source.slice(start >= 0 ? start : source.indexOf('  function load(options)'), source.indexOf('  // Open policy values')), ctx);
  return {ctx, calls, nodes, recover() {failing = '';}};
}

test('unavailable model list does not participate in homepage startup', async () => {
  const {ctx, calls} = fixture('models');
  await ctx.load();
  assert.equal(ctx.renderedTab, 'overview');
  assert.equal(calls.includes('models'), false);
  assert.equal(calls.includes('storage'), false);
});

test('critical startup failure leaves retry available and the guide unopened', async () => {
  const f = fixture('settings');
  assert.equal(await f.ctx.load(), false);
  assert.equal(f.ctx.onboarded, undefined);
  assert.match(f.nodes.pane.innerHTML, /retryLoad/);
  f.recover();
  await f.nodes.retryLoad.onclick();
  assert.equal(f.ctx.renderedTab, 'overview');
  assert.equal(f.ctx.onboarded, true);
});

test('parallel consumers share one model read and a failed read cannot populate an editable catalog', async () => {
  const {ctx, calls, recover} = fixture('models');
  const failed = ctx.readPageResource('models');
  assert.equal(ctx.readPageResource('models'), failed);
  await failed.promise;
  assert.equal(failed.status, 'failed');
  assert.equal(ctx.models, null);
  recover();
  ctx.pageResources.delete('models');
  const valid = ctx.readPageResource('models');
  await valid.promise;
  assert.equal(valid.status, 'ready');
  assert.deepEqual(ctx.models.groups, []);
  assert.deepEqual(calls, ['models','models']);
});

test('late response from an old snapshot cannot replace a new account catalog', async () => {
  const {ctx} = fixture();
  let finish;
  ctx.api = () => new Promise(resolve => { finish = resolve; });
  const previous = ctx.readPageResource('presets');
  ctx.pageResources.clear();
  ctx.api = async () => ({presets:[{id:'current'}]});
  await ctx.readPageResource('presets').promise;
  finish({presets:[{id:'old'}]});
  await previous.promise;
  assert.equal(ctx.presets[0].id, 'current');
});

test('switching devices on the same account reloads page resources and ignores the former device response', async () => {
  const {ctx} = fixture();
  Object.assign(ctx, {document:{hidden:false}, syncPending:false, mutationEpoch:0, uiDevice:'desktop', tab:'model'});
  const runtimeStart = source.indexOf('  function runtimeDevice(');
  vm.runInContext(source.slice(runtimeStart, source.indexOf('\n',runtimeStart)),ctx);
  const syncStart = source.indexOf('  async function syncLiveSnapshot(');
  vm.runInContext(source.slice(syncStart, source.indexOf('  function bindEnhancements(',syncStart)),ctx);
  let edition = 'desktop', finishDesktop;
  const modelReads = [];
  ctx.api = async (_,path) => {
    if(path.endsWith('/settings')) return {settings:{activeAccountId:'same'},status:{edition}};
    if(path.endsWith('/models')){
      modelReads.push(edition);
      return edition === 'desktop' ? new Promise(resolve => {finishDesktop=resolve;}) : {groups:['phone catalog']};
    }
    return {};
  };
  await ctx.load();
  const desktop = ctx.readPageResource('models');
  edition='mobile';
  await ctx.syncLiveSnapshot();
  assert.equal(ctx.data.status.edition,'mobile');
  assert.equal(ctx.resetScope,true);
  assert.equal(ctx.pageResources.has('models'),false);
  await ctx.readPageResource('models').promise;
  finishDesktop({groups:['late desktop catalog']});
  await desktop.promise;
  assert.deepEqual(ctx.models.groups,['phone catalog']);
  assert.deepEqual(modelReads,['desktop','mobile']);
});

test('home recent conversation loads on expansion and distinguishes failed history from an empty account', async () => {
  const {ctx,calls,nodes,recover}=fixture('messages');
  const details={open:false},button={},box={isConnected:true,closest:()=>details,querySelector:()=>button};
  nodes.homeRecent=box;
  Object.assign(ctx,{data:{status:{}},icon:()=>'',notesLabel:()=>''});
  vm.runInContext(source.slice(source.indexOf('  async function paintHomeRecent('),source.indexOf('  function viewOverview(')),ctx);
  await ctx.paintHomeRecent();
  assert.deepEqual(calls,[]);
  details.open=true;
  await ctx.paintHomeRecent();
  assert.match(box.innerHTML,/读取失败/);
  assert.doesNotMatch(box.innerHTML,/第一句/);
  recover();
  ctx.api=async()=>({messages:[{text:'fixture message',time:1000}]});
  await button.onclick();
  assert.match(box.innerHTML,/fixture message/);
});

test('home status prioritises a paused connection and pending decisions stay distinct from an unread snapshot',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(source.slice(source.indexOf('  function homeConnection('),source.indexOf('  function homeAction(')),ctx);
  assert.equal(ctx.homeConnection({connected:true}).page,'monitor');
  const paused=ctx.homeConnection({connected:true,accountPaused:true});
  assert.equal(paused.state,'paused');
  assert.equal(paused.page,'connection');
  const guard=ctx.homeConnection({connected:true,accountPaused:true,accountNeedsAttention:true});
  assert.equal(guard.online,false);
  assert.equal(guard.title,'桥接会话需要恢复');
  assert.equal(guard.page,'connection');
  assert.equal(ctx.homeConnection({connected:false}).state,'offline');
  assert.equal(ctx.homePending({}).ready,false);
  const pending=ctx.homePending({decisions:{pending:[{id:'a'}]},life:{waiting:[
    {question:{details:{operationDecisionId:'a'}}},{id:'b',question:{id:'b'}}]}});
  assert.equal(pending.count,2);
  assert.equal(pending.ready,true);
  const empty=ctx.homePending({decisions:{pending:[]},life:{waiting:[]}});
  assert.equal(empty.count,0);
  assert.equal(empty.ready,true);
});

test('connection page reserves an explicit resume action for an account notice', async () => {
  const status = {accountPaused:true,accountNeedsAttention:true};
  const actions = [];
  const buttons = {btnReconnect:{},btnPause:{dataset:{guardAccount:'example'}},btnHoldAccount:{dataset:{guardAccount:'example'}}};
  const ctx = vm.createContext({
    data:{settings:{activeAccountId:'example'},status}, login:{requiresDeviceSwitch:true}, qzoneStateLabel:()=>'离线',
    esc:String, $:id=>buttons[id], toast(){}, load:async()=>{},
    api:async (_method,_path,body)=>{actions.push([body.kind,body.accountId]);return {};},
  });
  vm.runInContext(source.slice(source.indexOf('  function viewConnection('),source.indexOf('  function viewSessions(')),ctx);
  const pane = ctx.viewConnection();
  assert.match(pane,/id="btnReconnect" disabled/);
  assert.match(pane,/id="btnTest" disabled/);
  assert.match(pane,/我已处理，恢复连接/);
  assert.match(pane,/id="btnStart"/);
  assert.match(pane,/id="btnHoldAccount" data-guard-account="example"/);
  const binding = source.slice(source.indexOf("    if ((el = $('btnReconnect')))"),source.indexOf("    if ((el = $('btnTest')))"));
  vm.runInContext('var el;\n'+binding,ctx);
  await buttons.btnReconnect.onclick();
  assert.deepEqual(actions,[]);
  await buttons.btnPause.onclick();
  assert.deepEqual(actions,[['resume','example']]);
  assert.equal(buttons.btnPause.disabled,false);
  ctx.data.settings.activeAccountId = 'switched-since-render';
  await buttons.btnHoldAccount.onclick();
  assert.deepEqual(actions.at(-1),['hold-account','example']);
  status.loginGuard = {userHold:true,manualReason:'当前账号已手动标记受限'};
  const held = ctx.viewConnection();
  assert.match(held,/当前账号已手动标记受限/);
  assert.doesNotMatch(held,/id="(?:btnStart|btnQrRefresh|btnRestartNapCat|btnHoldAccount|qrBox)"/);
  assert.match(held,/我已处理，恢复连接/);
  status.loginGuard = {userHold:false,manualReason:'QQ 要求重新登录'};
  ctx.login = {qqLoggedIn:false,loginPhase:'waiting_qrcode'};
  const expired = ctx.viewConnection();
  assert.match(expired,/桥接用 QQ 会话需要恢复/);
  assert.match(expired,/尝试已有账号登录/);
  assert.match(expired,/好友列表显示在线/);
  ctx.login = {qqLoggedIn:true};
  const restored = ctx.viewConnection();
  assert.match(restored,/QQ 会话已登录，桥接等待恢复/);
  assert.match(restored,/无需重复扫码/);
  assert.doesNotMatch(restored,/id="qrBox"/);
  status.loginGuard.holdSavePending = true;
  status.loginGuard.userHold = true;
  const unsaved = ctx.viewConnection();
  assert.match(unsaved,/id="btnHoldAccount"[^>]*>重新保存暂停状态/);
  assert.doesNotMatch(unsaved,/id="btnStart"/);
  status.loginGuard = {};
  status.accountNeedsAttention = false;
  ctx.login = {requiresDeviceSwitch:true};
  const ordinary = ctx.viewConnection();
  assert.doesNotMatch(ordinary,/id="btnReconnect" disabled|我已处理，恢复连接/);
  assert.match(ordinary,/在本机启用桥接/);
});

test('image size feedback checks the current request and the actual route rather than another API default',()=>{
  const entry={extraNodes:[{fieldName:'aspect_ratio',fieldValue:'9:16'}]};
  const ctx=vm.createContext({studioActiveEntry:()=>entry,connectionState:{effectiveSources:{items:[{kind:'image',source:'local',backend:'local'}]}}});
  vm.runInContext(source.slice(source.indexOf('  function studioExpectedRatio('),source.indexOf('  var videoConnectionState=')),ctx);
  assert.equal(ctx.studioSizeNote({width:512,height:512},'512x512，1:1'),' · 512×512');
  assert.equal(ctx.studioSizeNote({width:512,height:512},'红色杯子'),' · 512×512');
  assert.match(ctx.studioSizeNote({width:512,height:768},'1:1'),/实际返回比例不同/);
  ctx.connectionState.effectiveSources.items[0]={kind:'image',source:'legacy',backend:'api'};
  assert.match(ctx.studioSizeNote({width:512,height:512},''),/画幅设置为 9:16/);
  assert.equal(ctx.studioSizeNote({width:512,height:512},'1：1'),' · 512×512');
  ctx.connectionState.effectiveSources.items[0].source='profile:other';
  assert.equal(ctx.studioSizeNote({width:512,height:512},''),' · 512×512');
});

test('connection page gives each login state its own primary action and keeps operational controls reachable',()=>{
  const ctx=vm.createContext({URL,esc:String,qzoneStateLabel:()=> '待验证',login:{},data:{settings:{activeAccountId:'a',
    accounts:[{id:'a',name:'日常',wsUrl:'ws://user:secret@host:3001/onebot?access_token=sensitive'}]},status:{}}});
  vm.runInContext(source.slice(source.indexOf('  function viewConnection('),source.indexOf('  function viewSessions(')),ctx);
  const render=(status,login)=>{ctx.data.status=status;ctx.login=login;return ctx.viewConnection();};
  const primary=page=>page.match(/<div class="connection-primary">([\s\S]*?)<\/div>/)[1];
  const online=render({connected:true},{qqLoggedIn:true});
  assert.match(primary(online),/data-go="monitor"/);
  assert.match(online,/所有私聊对象/);
  assert.doesNotMatch(online,/secret|sensitive/);
  assert.match(online,/ws:\/\/host:3001\/onebot/);
  assert.match(online,/id="accToken" type="password"/);
  assert.match(online,/id="connectionAdvanced"[\s\S]*?id="btnRestartNapCat"/);
  assert.match(online,/id="connectionSafety"[\s\S]*?id="btnLogout"/);
  const loggedOut=render({connected:false},{qqLoggedIn:false});
  assert.match(primary(loggedOut),/id="btnStart"/);
  const verified=render({connected:false},{selectedAccountId:'a',connected:true,qqLoggedIn:true,
    identity:{id:'123456',nickname:'实际机器人'},qqInstallation:{coreVersion:'9.9.36-53644'}});
  assert.match(primary(verified),/data-go="monitor"/);
  assert.match(verified,/实际机器人/);
  assert.match(verified,/已登录 · 123456/);
  assert.doesNotMatch(verified.split('id="connectionDiagnostics"')[0],/9\.9\.36-53644/);
  assert.match(verified,/id="connectionDiagnostics"[\s\S]*?9\.9\.36-53644/);
  const qr=render({}, {qqLoggedIn:false,qrUpdatedAt:1000,qrAgeSeconds:1});
  assert.match(primary(qr),/id="connectionFocusQr"/);
  const scanned=render({}, {qqLoggedIn:false,loginPhase:'qrcode_scanned'});
  assert.match(scanned,/等待手机 QQ 确认/);assert.equal(primary(scanned),'');
  assert.match(scanned,/id="connectionAdvanced"[\s\S]*?id="btnStart"/);
  const held=render({accountPaused:true,accountNeedsAttention:true,loginGuard:{userHold:true,holdSavePending:true}},{});
  assert.match(primary(held),/id="btnPause"/);assert.match(held,/重新保存暂停状态/);
  assert.doesNotMatch(held,/id="qrBox"|id="btnStart"|id="btnQrRefresh"/);
  for(const page of [online,loggedOut,qr,scanned,held]){
    const ids=Array.from(page.matchAll(/\bid="([^"]+)"/g),match=>match[1]);
    assert.equal(new Set(ids).size,ids.length);
  }
});

test('a partial device profile keeps its retry instead of opening an unpopulated editor', () => {
  const {ctx}=fixture();
  vm.runInContext(source.slice(source.indexOf('  function viewDeviceProfiles('),source.indexOf('  function bindDeviceProfiles(')),ctx);
  for(const profile of [null,{}, {runtimeDevice:'phone',profiles:{}}, {runtimeDevice:'phone',profiles:{phone:{}}}]){
    ctx.deviceProfileData=profile;
    assert.match(ctx.viewDeviceProfiles(),/retryDeviceProfile/);
    assert.doesNotMatch(ctx.viewDeviceProfiles(),/id="profileSave"/);
  }
});
