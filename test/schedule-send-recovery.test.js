import {scheduledChatReceipt} from '../schedule-continuity.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createExecutionRuntime} from '../execution-runtime.js';
import {createLifeExecution} from '../life-execution.js';
test('known unqueued send is not_applied, ambiguous and queued sends remain unknown',()=>{
 for(const [value,expected] of [[scheduledChatReceipt(),'not_applied'],[{ok:false,queued:false,submitted:false,deliveryIds:[]},'not_applied'],[{ok:false},'unknown'],[{ok:true,queued:true,deliveryId:'d'},'unknown']]){
  const events=[],settled=[],life={beginStep:()=>({step:{id:'s'}}),settleStep:(_id,_meta,_step,r)=>settled.push(r)};
  const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>life,journal:e=>events.push(e)});
  const c={accountId:'a',personaId:'p',key:'private:12345',meta:{lifeJobId:'job'}},exec={name:'bridge_life_qq',arguments:{action:'send',target:'private:12345',text:'test'}};
  runtime.begin(exec,c);runtime.finish(exec,c,value);assert.equal(events.at(-1).status,expected);assert.equal(settled[0].status,expected);
 }
});
test('unknown action blocks minute-shifted plans within the slot, next slot can start',async()=>{
 let clock=Date.parse('2026-11-14T21:40:00+08:00'),calls=0;
 const meta={accountId:'a',personaId:'p'},old={id:'old',meta,scene:{date:'2026-11-14',start:'21:30',end:'22:00',activity:'看星空'},status:'failed',at:clock-60000,steps:[{id:'send',effect:'send',status:'unknown',idempotent:false}]};
 let plan={date:'2026-11-14',start:'21:40',end:'22:00',activity:'分享星空',taskKind:'social'};
 const e=createLifeExecution({storage:{read:()=>({jobs:[old],wake:{},sleep:{}}),write:()=>{}},config:()=>({execute:true,sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>plan,dispatch:async()=>{calls++;return 's';},now:()=>clock});
 for(let i=0;i<10;i++){clock+=60000;plan={...plan,start:'21:'+String(40+i).padStart(2,'0')};await e.tick();}assert.equal(calls,0);
 clock=Date.parse('2026-11-14T22:01:00+08:00');plan={...plan,start:'22:00',end:'22:30',activity:'看新文章'};await e.tick();assert.equal(calls,1);await e.close();
});
