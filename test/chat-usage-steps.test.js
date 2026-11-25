import test from 'node:test';
import assert from 'node:assert/strict';
import {accountChatUsage,billingDay,invocationCost,invocationSpend,usageBreakdown} from '../usage-accounting.js';
import {invocationViewRows} from '../model-invocation-audit.js';
import {executionOverview} from '../execution-overview.js';

const at=Date.parse('2026-11-23T08:59:59+08:00');
const tokens={inputTokens:1000,cacheReadTokens:300,outputTokens:90};
const receipt=(step,time,seq=step)=>({type:'assistant/message',seq,time,data:{turn:5,step,usage:tokens}});
const newAudit=()=>({id:'audit',accountId:'a',persona:'p',chat:'private:1',status:'completed',at});
const equalMoney=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-12,actual+' versus '+expected);

test('a provider receipt is priced from tokens and damaged historical totals still render',()=>{
  const mocked={...receipt(0,at)};
  mocked.data={...mocked.data,usage:{...tokens,billingDays:{unexpected:{cost:500,calls:1}}}};
  const {daily}=accountChatUsage(null,newAudit(),'s',mocked,at);
  equalMoney(daily.last,invocationCost(tokens,at));
  const damaged={...tokens,billingDays:{[billingDay(at)]:null}};
  equalMoney(invocationCost(damaged,at),daily.last);
  equalMoney(invocationSpend([{id:'r',kind:'chat',tool:'chat.reply',backend:'api',at,usage:damaged}],{},at).chat,daily.last);
});

test('two host steps across a change of tariff remain one priced QQ task after restart and replay',()=>{
  const audit=newAudit(),one=receipt(0,at,7),two=receipt(1,at+2000,8);
  const legacyDaily={day:billingDay(at),turns:10,total:0.04,last:0.01,auxiliaryTotal:0.01};
  let {daily}=accountChatUsage(legacyDaily,audit,'s',one,at);
  const restored=JSON.parse(JSON.stringify(audit));
  daily=accountChatUsage(JSON.parse(JSON.stringify(daily)),restored,'s',two,at+2000).daily;
  for(const event of [one,two,{...two,seq:99}]){
    const replay=accountChatUsage(daily,restored,'s',event,at+2000);
    assert.equal(replay.daily,daily);
    assert.equal(replay.auditChanged,false);
  }
  const expected=invocationCost(tokens,at)+invocationCost(tokens,at+2000);
  equalMoney(daily.total,0.04+expected);
  assert.equal(daily.turns,12);
  assert.equal(restored.usage.outputTokens,180);
  assert.equal(restored.usage.cacheReadTokens,600);
  assert.equal(usageBreakdown(daily).chatEntries,undefined);
  const records=invocationViewRows([],[restored],{accountId:'a'});
  assert.equal(records.length,1);
  equalMoney(invocationCost(records[0].usage,at),expected);
  const [task]=executionOverview({audits:[restored],records,accountId:'a',cost:invocationCost});
  assert.equal(task.cost.priced,1);
  equalMoney(task.cost.estimated,expected);
  const spend=invocationSpend(records,daily,at);
  assert.equal(spend.requests.length,1);
  assert.equal(spend.requests[0].calls,2);
  equalMoney(spend.requests[0].cost,expected);
});

test('each receipt belongs to its Shanghai day even when the chat opened yesterday',()=>{
  const a=Date.parse('2026-11-23T23:59:59+08:00'),b=a+2000;
  const audit={...newAudit(),at:a};
  const one=receipt(0,a),two=receipt(1,b);
  const yesterday=accountChatUsage(null,audit,'s',one,a).daily;
  const today=accountChatUsage(yesterday,audit,'s',two,b).daily;
  assert.equal(accountChatUsage(today,audit,'s',one,b).daily,today);
  const rows=invocationViewRows([],[audit],{accountId:'a'});
  for(const time of [a,b]){
    const spend=invocationSpend(rows,{},time);
    assert.equal(spend.chatCalls,1);
    equalMoney(spend.chat,invocationCost(tokens,time));
  }
  equalMoney(today.total,invocationCost(tokens,b));
  equalMoney(invocationCost(audit.usage,a),yesterday.total+today.total);
});

test('legacy receipts stay readable and identical token counts in distinct events are billable',()=>{
  const legacy={...newAudit(),usage:{...tokens}};
  equalMoney(invocationCost(legacy.usage,at),invocationCost(tokens,at));
  const changed=accountChatUsage(null,legacy,'s',receipt(1,at+2000),at);
  assert.equal(changed.auditChanged,true);
  assert.equal(legacy.usage.billingDays[billingDay(at)].calls,2);
  const predecessor={...receipt(undefined,at,24)};
  let {daily}=accountChatUsage(null,null,'s',predecessor,at);
  assert.equal(accountChatUsage(daily,null,'s',predecessor,at).daily,daily);
  daily=accountChatUsage(daily,null,'s',{...predecessor,seq:25},at).daily;
  daily=accountChatUsage(daily,null,'other-session',predecessor,at).daily;
  assert.equal(daily.turns,3);
});
