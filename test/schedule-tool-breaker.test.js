import test from 'node:test';import assert from 'node:assert/strict';
import {createScheduleToolBreaker,scheduledToolName} from '../schedule-tool-breaker.js';
const slot={accountId:'a',personaId:'p',date:'2026-11-07',start:'10:00',end:'11:00'};
function fixture(){let data=null;return {make:()=>createScheduleToolBreaker({storage:{read:()=>structuredClone(data),write:v=>data=structuredClone(v)}})};}
test('four cumulative failures pause the same tool despite successful calls and changed actions or parameters',async()=>{
 const b=fixture().make();let calls=0;
 for(let i=0;i<4;i++){
  await assert.rejects(b.run(slot,'bridge_browser',{action:i?'click':'snapshot',i},()=>{calls++;throw Error('unavailable');}),/unavailable/);
  if(i<3)assert.equal(await b.run(slot,'bridge_browser',{},()=>({ok:true})).then(v=>v.ok),true);
 }
 await assert.rejects(b.run(slot,'bridge_browser',{action:'navigate',url:'other'},()=>calls++),e=>e.code==='SCHEDULE_TOOL_PAUSED');assert.equal(calls,4);assert.equal(b.snapshot(slot)[0].failures,4);
 assert.equal(await b.run(slot,'bridge_search',{},()=> 'still works'),'still works');
});
test('next scheduled slot resets on demand, restart does not reset the current one, labels do not affect the boundary',async()=>{
 const f=fixture();let b=f.make();for(let i=0;i<4;i++)await b.run({...slot,activity:'video'},'browse',{},()=>({ok:false,error:'bad'}));
 b=f.make();let calls=0;await assert.rejects(b.run({...slot,activity:'renamed',end:'11:30'},'browse',{},()=>calls++),/当前日程/);assert.equal(calls,0);
 assert.equal(await b.run({...slot,start:'11:00',end:'12:00'},'browse',{},()=>++calls),1);
 assert.equal(await b.run({...slot,personaId:'other'},'browse',{},()=>++calls),2);
 assert.equal(await b.run({...slot,accountId:'other'},'browse',{},()=>++calls),3);
});
test('concurrent failures never dispatch a fifth actual attempt and cancellation is not failure',async()=>{
 const b=fixture().make();let calls=0;
 const results=await Promise.allSettled(Array.from({length:8},()=>b.run(slot,'tool',{},async()=>{calls++;await new Promise(r=>setTimeout(r,1));throw Error('bad');})));
 assert.equal(calls,4);assert.equal(results.filter(r=>r.reason.code==='SCHEDULE_TOOL_PAUSED').length,4);
 for(let i=0;i<5;i++)await assert.rejects(b.run(slot,'cancelled',{},()=>{throw Object.assign(Error('cancelled'),{name:'AbortError'});}));
 assert.equal(b.snapshot(slot).some(r=>r.tool==='cancelled'),false);
});
test('logical tool routing cannot evade counts and nested same-target hooks count once',async()=>{
 const b=fixture().make();assert.equal(scheduledToolName('bridge_tools',{action:'call',name:'bridge_native',arguments:{action:'call',name:'browser'}}),'browser');
 for(let i=0;i<4;i++)await assert.rejects(b.run(slot,'bridge_native',{action:'call',name:'browser'},()=>b.run(slot,'browser',{},()=>{throw Error('bad');})));
 assert.equal(b.snapshot(slot)[0].failures,4);await assert.rejects(b.run(slot,'browser',{},()=>1),/当前日程/);
});
test('returned error envelopes count, pending results and unplanned conversations do not become permanent pauses',async()=>{
 const b=fixture().make();for(const v of [{isError:true},{value:{ok:false}},{status:'failed'},{ok:false}])await b.run(slot,'tool',{},()=>v);
 await assert.rejects(b.run(slot,'tool',{},()=>1),/当前日程/);
 for(let i=0;i<6;i++)await b.run(null,'tool',{},()=>({ok:false}));
 for(let i=0;i<6;i++)await b.run(slot,'waiting',{},()=>({ok:true,status:'pending'}));
 assert.equal(b.snapshot(slot).length,1);
});
