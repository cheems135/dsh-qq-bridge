import test from 'node:test';
import assert from 'node:assert/strict';
import {createWalletAwareness,walletState,WALLET_EVENT_REVISION} from '../wallet-awareness.js';

function fixture(amount=20){
  let time=1000,identity='a',failed=false,saveFailed=false,calls=0;
  let value={status:'ok',entries:[{amount:String(amount),currency:'CNY',kind:'money'}]};
  const ledger={},config={lowMoney:5},options={now:()=>time,identity:()=>identity,config:()=>config,sources:()=>[{id:'chat',provider:'provider',label:'对话额度',read:async()=>{calls++;if(failed)throw Error('offline');return structuredClone(value);}}],ledger:()=>ledger,save:()=>!saveFailed};
  let wallet=createWalletAwareness(options);
  return {ledger,config,get wallet(){return wallet;},get calls(){return calls;},
    async refresh(next){if(next!==undefined)value.entries[0].amount=String(next);time++;return wallet.refresh({force:true});},
    entries(entries){value={status:'ok',entries};},status(status){value={...value,status};},fail(v){failed=v;},saveFail(v){saveFailed=v;},advance(ms){time+=ms;},identity(v){identity=v;},restart(){wallet=createWalletAwareness(options);},
    notice(scope='owner-persona'){return wallet.notice({isOwner:true,scope});},
    read(){return wallet.hint({isOwner:true,scope:'owner-persona',detail:false});}};
}
const events=notice=>notice.text?JSON.parse(notice.text.split('\n')[0].replace('【余额变化事件】','')):[];

test('strict threshold crossing and exhaustion notify once; ordinary spending does not',async()=>{
  const f=fixture();await f.refresh();assert.equal(f.read(),'');await f.refresh(15);assert.equal(f.read(),'');
  await f.refresh(5);assert.equal(walletState(f.wallet.snapshot().accounts[0],f.config),'normal');assert.equal(f.read(),'');
  await f.refresh(4.9);const low=f.notice();assert.equal(events(low)[0].type,'low');assert.equal(f.wallet.acknowledge(low.receipt),true);assert.equal(f.read(),'');
  await f.refresh(4);assert.equal(f.read(),'');await f.refresh(0);assert.equal(events(f.notice())[0].type,'empty');f.read();await f.refresh(0);assert.equal(f.read(),'');
  assert.equal(f.wallet.snapshot().eventRevision,WALLET_EVENT_REVISION);
});

test('any verified increase notifies, including increases that remain below the threshold',async()=>{
  const f=fixture(2);await f.refresh();assert.equal(events(f.notice())[0].type,'low');f.read();
  await f.refresh(3);const e=events(f.notice())[0];assert.equal(e.type,'increased');assert.equal(e.state,'low');assert.equal(e.increases[0].before,'2');assert.equal(e.increases[0].after,'3');assert(!Object.hasOwn(e,'recharged'));f.read();
  await f.refresh(30);assert.equal(events(f.notice())[0].type,'increased');f.read();await f.refresh(31);assert.equal(events(f.notice())[0].type,'increased');
});

test('robot reminders include exact amounts, units and configured thresholds without invented recharge claims',async()=>{
  const f=fixture(2.3456);await f.refresh();
  const low=f.notice(),entry=events(low)[0];
  assert.equal(entry.now,'2.3456 CNY');assert.equal(entry.thresholds[0].below,'5');
  assert.match(low.text,/具体数字和单位/);
  f.wallet.acknowledge(low.receipt);await f.refresh(3.4567);
  const increase=events(f.notice())[0];
  assert.equal(increase.was,'2.3456 CNY');assert.equal(increase.after,'3.4567 CNY');
  assert.deepEqual(increase.increases[0],{currency:'CNY',kind:'money',before:'2.3456',after:'3.4567'});
  f.config.lowPoints=100;f.config.lowCoins=150;
  f.entries([{amount:'99.5',currency:'积分',kind:'points'},{amount:'149',currency:'RH币',kind:'coins'}]);await f.refresh();
  assert.deepEqual(events(f.notice())[0].thresholds.map(e=>[e.amount,e.currency,e.below]),[['99.5','积分','100'],['149','RH币','150']]);
});

test('background reads detect increases before any chat and pending reminders survive a restart',async()=>{
  const f=fixture(20);await f.refresh();await f.refresh(25);await f.refresh(24);
  f.restart();await f.refresh();const n=f.notice(),e=events(n)[0];assert.equal(e.type,'increased');assert.equal(e.after,'25 CNY');assert.equal(e.now,'24 CNY');
  const calls=f.calls;assert.equal(f.wallet.acknowledge(n.receipt),true);assert.equal(f.read(),'');assert.equal(f.calls,calls);
  f.restart();await f.refresh();assert.equal(f.read(),'');
});

test('only the exact offered receipt is consumed when a later increase arrives',async()=>{
  const f=fixture();await f.refresh();await f.refresh(21);const first=f.notice();await f.refresh(22);assert.equal(f.wallet.acknowledge(first.receipt),true);
  const second=f.notice();assert.equal(events(second)[0].increases[0].after,'22');assert.notDeepEqual(second.receipt.ids,first.receipt.ids);f.wallet.acknowledge(second.receipt);assert.equal(f.read(),'');
});

test('units, reordered entries and reference-only balances cannot fabricate a recharge',async()=>{
  const f=fixture();const row=(amount,currency='CNY',applies=true)=>({amount:String(amount),currency,kind:'money',applies});
  f.entries([row(10),row(10,'EUR'),row(1,'points',false)]);await f.refresh();
  f.entries([row(10,'EUR'),row(10),row(999,'points',false)]);await f.refresh();assert.equal(f.read(),'');
  f.entries([row(9,'EUR'),row(11)]);await f.refresh();const n=f.notice();assert.deepEqual(events(n)[0].increases.map(e=>e.currency),['CNY']);f.wallet.acknowledge(n.receipt);
  f.entries([row(100,'USD')]);await f.refresh();assert.equal(f.read(),'');
  f.entries([row(10),row(20)]);await f.refresh();f.entries([row(20),row(10)]);await f.refresh();assert.equal(f.read(),'');
});

test('failed, unknown, stale and unconfirmed billing reads never become zero or generate an alert',async()=>{
  const f=fixture();f.status('unknown');await f.refresh();assert.equal(f.read(),'');assert.deepEqual(f.ledger,{});
  f.entries([{amount:'20',currency:'CNY',kind:'money'}]);await f.refresh();f.fail(true);await f.refresh();assert.equal(f.read(),'');assert.equal(f.wallet.snapshot().accounts[0].state,'unknown');
  f.fail(false);await f.refresh(21);f.advance(16*60000);assert.equal(f.read(),'');await f.refresh();assert.equal(events(f.notice())[0].type,'increased');
  const n=f.notice();f.wallet.acknowledge(n.receipt);f.config.enabled=false;await f.refresh(30);assert.equal(f.read(),'');assert.equal(f.wallet.notice({isOwner:false}).text,'');
});

test('reminders stay scoped to the wallet identity, owner and persona',async()=>{
  const f=fixture();await f.refresh();await f.refresh(21);const first=f.notice();assert.equal(f.wallet.notice({isOwner:false,scope:'owner-persona'}).text,'');
  f.wallet.acknowledge(first.receipt);assert.equal(f.notice().text,'');assert(events(f.notice('another-owner-persona')).length);
  f.identity('another-account');await f.refresh(100);assert.equal(f.notice().text,'');assert.equal(f.wallet.acknowledge(first.receipt),false);
});

test('notification switch and persistence failure do not consume or repeat spending notices',async()=>{
  const f=fixture(2);f.config.reactions=false;await f.refresh();assert.equal(f.read(),'');f.config.reactions=true;await f.refresh();const low=f.notice();assert.equal(events(low)[0].type,'low');
  f.saveFail(true);assert.equal(f.wallet.acknowledge(low.receipt),false);assert.deepEqual(f.notice().receipt.ids,low.receipt.ids);
  f.saveFail(false);assert.equal(f.wallet.acknowledge(low.receipt),true);assert.equal(f.read(),'');await f.refresh(1);assert.equal(f.read(),'');
  f.advance(25*3600000);await f.refresh(1);assert.equal(f.read(),'');
});
