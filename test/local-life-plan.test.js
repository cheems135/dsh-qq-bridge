import test from 'node:test';import assert from 'node:assert/strict';
import {localLifePlanRequest} from '../local-life-plan.js';import {estimateTokens} from '../local-context.js';import {createLifeMemory} from '../life-memory.js';
test('local planning keeps current conversation interests and progress, and does not invent native capability when compacting',()=>{
 const raw={window:{start:'13:00',end:'24:00'},recentConversation:[{at:1,topic:'想试做解谜小游戏',lastReply:'只完成了菜单，关卡还没有做',status:'active'}],recentEmotion:{tone:'有点低落',events:[{at:1,status:'仍有影响',direction:'低落'}]},character:{persona:'喜欢实验'},availableCapabilities:{details:'状态'.repeat(3000)}};
 const result=localLifePlanRequest('【模拟人生时段规划】',JSON.stringify(raw),1200,{contextWindow:4096,maxOutputTokens:1200}),data=JSON.parse(result.input);
 assert.equal(data.recentConversation[0].topic,raw.recentConversation[0].topic);assert.equal(data.recentConversation[0].lastReply,raw.recentConversation[0].lastReply);
 assert.equal(data.recentEmotion.events[0].direction,'低落');
 assert.notEqual(data.availableCapabilities.nativeDigitalTasks,true);assert.match(result.system,/不是活动边界/);
});
test('local planning fits real 4096/1200 limits without overriding other model requests',()=>{
 const input=JSON.stringify({window:{start:'13:00',end:'24:00'},character:{persona:'人设'.repeat(4000)},recentSimulatedPlans:[{slots:Array.from({length:40},()=>({activity:'很长的日程'.repeat(100)}))}],previousSleep:[],availableCapabilities:{browser:{details:'状态'.repeat(3000)}}});
 const r=localLifePlanRequest('【模拟人生时段规划】'+'.'.repeat(10000),input,2400,{contextWindow:4096,maxOutputTokens:1200});assert.ok(estimateTokens(r.system)+estimateTokens(r.input)<=4096-r.tokens-320);assert.equal(r.tokens,1200);assert.deepEqual(JSON.parse(r.input).window,{start:'13:00',end:'24:00'});
 assert.deepEqual(localLifePlanRequest('memory','input',2400,{}),{system:'memory',input:'input',tokens:2400});
});
test('foreground deferral keeps the plan pending without counting failure and observes retry delay',async()=>{
 let now=Date.parse('2026-11-08T13:00:00+08:00'),calls=0;const files=new Map(),role={name:'测试',prompt:'爱阅读',meta:{kind:'life',accountId:'test',personaId:'test',key:''}};
 const life=createLifeMemory({storage:{list:()=>[...files.keys()],read:n=>{if(!files.has(n))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(n));},write:(n,v)=>files.set(n,structuredClone(v))},now:()=>now,config:()=>({life:{enabled:true},memory:{enabled:true,schedule:'daily'}}),allowed:()=>true,roles:()=>[role],signature:()=>'',ask:async()=>{calls++;throw Object.assign(Error('busy'),{code:'LOCAL_ANALYSIS_DEFERRED'});}});
 try{await life.ensureLife(role);const status=life.snapshot(role.meta).status;assert.equal(status.state,'pending');assert.equal(status.attempt,0);await life.ensureLife(role);assert.equal(calls,1);now+=16000;await life.ensureLife(role);assert.equal(calls,2);assert.equal(life.snapshot(role.meta).status.attempt,0);}finally{life.close();}
});
