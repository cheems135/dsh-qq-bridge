import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForLocalRoute,chooseLocalRoute,createModelRouter} from '../local-routing.js';
import {localRepeatRisk} from '../local-repetition.js';
import {createDialogueStream} from '../local-fast-chat.js';
import {createWaitNotice,fallbackWaitNotice} from '../local-wait-notice.js';
import {compactLocalProtocol} from '../local-context.js';
import {strictActionProtocol} from '../local-agent.js';
import {createLocalAgent} from '../local-agent.js';
const ready={status:'ready',features:{text:{supported:true}}};

test('foreground resource contention waits, then selects local once without an API dispatch',async()=>{
 let count=0,waits=0,time=0;
 const result=await waitForLocalRoute({getSnapshot:async()=>({...ready,busy:++count<3}),requirements:{text:true},options:{apiComplement:true},onWaiting:()=>waits++,now:()=>time,sleep:async ms=>time+=ms});
 assert.equal(result.decision.target,'local');assert.equal(waits,2);assert.equal(count,3);
 assert.equal(chooseLocalRoute({...ready,busy:true},{text:true},{apiComplement:true}).target,'wait');
 let cloud=0;const router=createModelRouter({getSnapshot:async()=>({...ready,busy:true}),local:()=>assert.fail('background should defer'),api:()=>cloud++});
 await assert.rejects(router.complete({apiComplement:true,requirements:{text:true}}),e=>e.code==='LOCAL_ANALYSIS_DEFERRED');assert.equal(cloud,0);
});

test('stop, account changes and bounded queue time cannot dispatch a waiting turn',async()=>{
 let current=true,reads=0;
 await assert.rejects(waitForLocalRoute({getSnapshot:async()=>{reads++;return {...ready,busy:true};},isCurrent:()=>current,sleep:async()=>current=false}),{name:'AbortError'});assert.equal(reads,1);
 const controller=new AbortController();
 await assert.rejects(waitForLocalRoute({getSnapshot:async()=>{controller.abort();return ready;},signal:controller.signal}),{name:'AbortError'});
 let time=0;await assert.rejects(waitForLocalRoute({getSnapshot:async()=>({...ready,busy:true}),now:()=>time,sleep:async ms=>time+=ms,timeoutMs:2000}),e=>e.code==='LOCAL_QUEUE_TIMEOUT');
});

test('short persona catchphrases and recycled persona openings are checked before final or streamed delivery',()=>{
 const messages=[{role:'user',content:'刚回家'},{role:'assistant',content:'哼，杂鱼～'},{role:'user',content:'买了本书'},{role:'assistant',content:'哼，杂鱼～'},{role:'user',content:'今天学会画猫了'}];
 assert.equal(localRepeatRisk('哼，杂鱼～',{messages,request:messages.at(-1).content}).kind,'short-catchphrase');
 assert.equal(localRepeatRisk('哼，杂鱼～发来看看你画的猫。',{messages,request:messages.at(-1).content}).kind,'persona-opening');
 assert.equal(localRepeatRisk('哼，杂鱼～',{messages,request:'再说一遍哼杂鱼'}),null);
 assert.equal(localRepeatRisk('好',{messages,request:'嗯'}),null);
 const streamed=[];const stream=createDialogueStream({request:messages.at(-1).content,messages,emit:t=>streamed.push(t)});stream.feed('哼，杂鱼～发来看看你画的猫。');assert.equal(streamed.length,0);
});

test('notice model wording is reused only for its own turn; repeated fallbacks rotate then stay quiet',()=>{
 const sent=[],recent=[];let fire;
 for(let i=0;i<4;i++){
  const n=createWaitNotice({style:'playful',recent:[...recent],remember:t=>recent.push(t),emit:e=>sent.push(e),setTimer:fn=>(fire=fn,1)});
  n.set('哼，这张图还得等一小会儿，先别急着跑。');n.start('image');fire();n.start('image');
 }
 assert.equal(new Set(sent.map(r=>r.text)).size,sent.length);
 assert.equal(sent[0].source,'model');assert.ok(sent.slice(1).every(r=>r.source==='fallback'));
 assert.equal(fallbackWaitNotice('image','playful',sent.map(r=>r.text)),'');
 const protocol=compactLocalProtocol(strictActionProtocol({image:{execute:()=>{}}})+'\n需要waitText\n最近的等待提示（本轮不要复用）：["先等我一下。"]');assert.match(protocol,/先等我一下/);
});

test('native media wait metadata cannot reject the valid prompt or become an executor argument',async()=>{
 let wait='',args,calls=0;
 const agent=createLocalAgent({model:async()=>{calls++;return {tool_calls:[{function:{name:'image',arguments:JSON.stringify({prompt:'窗边吃饭的人物自拍',waitText:'这张饭桌照还得准备一下。'})}}]};},onWaitText:t=>wait=t,terminalMedia:['image'],tools:{image:{execute:async value=>{args=value;return {kind:'image',file:'actual.png'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'生成一张自拍'}]});assert.equal(calls,1);assert.equal(wait,'这张饭桌照还得准备一下。');assert.deepEqual(args,{prompt:'窗边吃饭的人物自拍'});assert.equal(result.attachments.length,1);
});

test('a cleared resource queue cannot mislabel model generation as waiting for someone else',()=>{
 let callback,cancelled=0;const emitted=[];
 const n=createWaitNotice({emit:e=>emitted.push(e),setTimer:fn=>(callback=fn,1),clearTimer:()=>cancelled++});
 n.start('queue');n.stop('queue');assert.equal(cancelled,1);
 n.set('这张照片还在准备，等我一下。');n.start('image');n.stop('queue');assert.equal(cancelled,1);callback();assert.equal(emitted[0].kind,'image');assert.equal(emitted[0].source,'model');
});
