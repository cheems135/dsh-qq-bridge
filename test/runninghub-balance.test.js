import {readConsoleSource} from './console-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parseRunningHubBalance,runningHubBalanceEntries} from '../runninghub-balance.js';
import {createImageStudio} from '../image-studio.js';
import {walletConfig,walletState,createWalletAwareness} from '../wallet-awareness.js';
const account=(data,billingSource='auto')=>{const p=parseRunningHubBalance(data,{billingSource,updatedAt:1});return {...p,entries:runningHubBalanceEntries(p)};};
test('reads official singular remainPoint and keeps fractional precision',()=>{
  const p=account({remainPoint:88.5,remainCoins:'99999',remainMoney:'999',currency:'CNY',apiType:'NORMAL'});
  assert.equal(p.points,'88.5');assert.equal(p.money,'999');assert.equal(p.coins,'99999');
  assert.deepEqual(p.entries.map(e=>e.kind),['points','money']);assert.equal(p.billingConfirmed,false);
});
test('missing points are unknown, not zero, and do not get replaced with RH coins',()=>{
  const p=account({remainCoins:'99999',remainMoney:null},'points');
  assert.equal(p.points,null);assert.equal(p.entries.length,0);assert.equal(walletState(p),'unknown');
  assert.equal(account({remainPoints:999}).points,null);
});
test('actual zero points remain visible and determine exhaustion only for selected points',()=>{
  const p=account({remainPoint:0,remainMoney:'1000',currency:'CNY',remainCoins:'500'},'points');
  assert.equal(p.points,'0');assert.equal(walletState(p),'empty');assert.equal(p.entries[1].applies,false);
});
test('automatic mode never guesses billing from NORMAL/SHARED or unrelated zeros',()=>{
  for(const apiType of ['NORMAL','SHARED','EXCLUSIVE','future']){
    const p=account({remainPoint:800,remainMoney:'0',remainCoins:'0',currency:'CNY',apiType});
    assert.equal(walletState(p),'unknown');assert.equal(p.billingConfirmed,false);
  }
});
test('new point threshold is independent from legacy coin threshold',()=>{
  const p=account({remainPoint:'88.500',remainCoins:'1'},'points');
  assert.equal(walletState(p,{lowPoints:50,lowCoins:100}),'normal');
  assert.equal(walletState(p,{lowPoints:90,lowCoins:0}),'low');
  assert.equal(walletConfig({lowCoins:150}).lowPoints,100);
});
test('enterprise money selection ignores both point/coin totals',()=>{
  const p=account({remainPoint:0,remainMoney:'50',remainCoins:'0',currency:'CNY'},'money');
  assert.equal(walletState(p),'normal');assert.equal(p.entries[1].applies,true);
  assert.equal(walletState(account({remainMoney:'0',remainPoint:900,remainCoins:'9999',currency:'CNY'},'money')),'empty');
});
test('removed legacy coin selection is unknown; unknown money currency is never usable',()=>{
  assert.equal(walletState(account({remainCoins:'500'},'coins')),'unknown');
  assert.equal(walletState(account({remainMoney:'100',currency:null},'money')),'unknown');
});
test('invalid numbers and absent fields do not become zeros',()=>{
  for(const remainPoint of [null,undefined,'',false,{},NaN,Infinity,'not a number'])assert.equal(parseRunningHubBalance({remainPoint}).points,null);
  assert.equal(parseRunningHubBalance({remainPoint:' 88.500 '}).points,'88.500');
  assert.equal(parseRunningHubBalance({remainPoint:0.0000001}).points,'1e-7');
});
test('wallet settings validate separate source and point threshold',()=>{
  assert.equal(walletConfig({runninghubBillingSource:'points'}).runninghubBillingSource,'points');
  assert.equal(walletConfig({runninghubBillingSource:'invalid'}).runninghubBillingSource,'auto');
  assert.equal(walletConfig({lowPoints:-10}).lowPoints,0);
});
test('real balance reader uses accountStatus and never starts generation',async()=>{
  const calls=[];
  const studio=createImageStudio({getConfig:()=>({provider:'runninghub',runninghub:{apiKey:'test-only-secret',baseUrl:'https://www.runninghub.cn'}}),fetchImpl:async(url,options)=>{
    calls.push({url,options});return {ok:true,status:200,text:async()=>JSON.stringify({code:0,data:{remainPoint:88.5,remainCoins:'0',remainMoney:'0',currency:'CNY'}})};
  },now:()=>1000});
  const p=await studio.balance({billingSource:'points'});assert.equal(p.points,'88.5');
  assert.equal(calls.length,1);assert(calls[0].url.endsWith('/uc/openapi/accountStatus'));
  assert.equal(JSON.parse(calls[0].options.body).apikey,'test-only-secret');
  await studio.balance({billingSource:'points'});assert.equal(calls.length,1);
  await studio.balance({billingSource:'money'});assert.equal(calls.length,2);
});
test('query failure retains stale point balance but cannot trigger zero/low',async()=>{
  let fail=false;
  const studio=createImageStudio({getConfig:()=>({provider:'runninghub',runninghub:{apiKey:'secret-for-test'}}),fetchImpl:async()=>{
    if(fail)throw Error('offline');return {ok:true,status:200,text:async()=>JSON.stringify({code:0,data:{remainPoint:88.5}})};
  },now:()=>1000});
  await studio.balance({billingSource:'points'});fail=true;
  const p=await studio.balance({billingSource:'points',force:true});assert.equal(p.points,'88.5');assert.equal(p.status,'error');assert.equal(p.stale,true);assert.equal(walletState({...p,entries:runningHubBalanceEntries(p)}),'unknown');
});
test('point-only response is valid and requests with no numeric fields are unknown/error',async()=>{
  const make=data=>createImageStudio({getConfig:()=>({provider:'runninghub',runninghub:{apiKey:'secret-for-test'}}),fetchImpl:async()=>({ok:true,status:200,text:async()=>JSON.stringify({code:0,data})})});
  assert.equal((await make({remainPoint:22.25}).balance()).status,'ok');
  assert.equal((await make({}).balance()).status,'error');
});
test('wallet cache and model hint preserve point roles, not RH coin-only view',async()=>{
  let value=account({remainPoint:'88.5',remainMoney:'0',currency:'CNY',remainCoins:'0'},'points');
  let now=1000;const notices={};
  const w=createWalletAwareness({now:()=>now,identity:()=>['test'],config:()=>({lowPoints:50}),sources:()=>[{id:'image',label:'生图账户',provider:'runninghub',read:async()=>value}],ledger:()=>notices,save(){}});
  await w.refresh();const snap=w.snapshot();assert.equal(snap.accounts[0].state,'normal');assert.equal(snap.accounts[0].entries[0].kind,'points');
  const hint=w.hint({isOwner:true,detail:true});assert(hint.includes('88.5 积分'));assert(hint.includes('新版平台积分'));assert(hint.includes('不相加'));assert(!hint.includes('（耗尽）'));
  assert.equal(w.hint({isOwner:false,detail:true}),'');
  now+=16*60000;assert.equal(w.snapshot().accounts[0].state,'unknown');
});
test('unknown billing never creates low-balance or exhaustion reactions',async()=>{
  const notices={};const w=createWalletAwareness({now:()=>1000,identity:()=>['test'],config:()=>({}),sources:()=>[{id:'image',label:'生图账户',provider:'runninghub',read:async()=>account({remainPoint:0,remainCoins:'0',remainMoney:'0',currency:'CNY'})}],ledger:()=>notices,save(){}});
  await w.refresh();assert.equal(w.hint({isOwner:true,detail:false}),'');assert.deepEqual(notices,{});
});
const html=readConsoleSource();
function uiContext(){
  const ctx={esc:s=>String(s),data:{settings:{wallet:{}}},featureData:{wallet:{accounts:[]}},document:{},Date};
  vm.createContext(ctx);
  const helpers=html.slice(html.indexOf('  function walletAmountText('),html.indexOf('  function walletMarkup('));vm.runInContext(helpers,ctx);
  const home=html.slice(html.indexOf('  function homeWalletRows('),html.indexOf('  function homeWalletCard('));vm.runInContext(home,ctx);
  return ctx;
}
test('home shows points and wallet and removes legacy coin amounts',()=>{
  const ctx=uiContext(),p=account({remainPoint:88.5,remainMoney:'0',remainCoins:'500',currency:'CNY'},'points');
  const rendered=ctx.homeWalletRows([{...p,state:'normal',label:'生图账户'}]);
  assert(rendered.includes('新版平台积分：88.5 积分'));assert(rendered.includes('API 钱包：0 CNY'));assert(!rendered.includes('RH币'));assert(!rendered.includes('RH 币'));assert(!rendered.includes('500'));
});
test('home explicitly reports missing points instead of showing 0',()=>{
  const ctx=uiContext();const text=ctx.walletAmountText(account({remainCoins:'0'},'points'));
  assert(text.includes('新版积分：接口未返回（不代表 0）'));assert(!text.includes('新版平台积分：0'));
});
test('balance settings expose independent point threshold and source choices',()=>{
  const ctx=uiContext();const fn=html.slice(html.indexOf('  function walletMarkup('),html.indexOf('  function bindCalendarWallet('));vm.runInContext(fn,ctx);
  const rendered=ctx.walletMarkup();assert(rendered.includes('id="wPoints"'));assert(rendered.includes('id="wRhBilling"'));assert(rendered.includes('余额跟随实际使用的连接'));assert(!rendered.includes('RH 币'));assert(!rendered.includes("['coins'"));
});
