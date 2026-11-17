import test from 'node:test';import assert from 'node:assert/strict';
import {createLifeExecution} from '../life-execution.js';import {createLifeMemory,groundedEvents} from '../life-memory.js';import {createMemoryHub} from '../memory-hub.js';import {taskCompletion} from '../schedule-evidence.js';
import {blockedTaskInitiativeEvent} from '../initiative-events.js';
const missing=()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});};
test('turning off actual tasks pauses running schedule only and rejects manual schedule resume',async()=>{
 let enabled=true,stops=[],calls=0;const meta={accountId:'a',personaId:'p'},role={meta},scene={date:'2026-11-07',start:'10:00',end:'11:00',activity:'读文章',taskKind:'browse'};
 const engine=createLifeExecution({storage:{read:missing,write:()=>{}},config:()=>({execute:enabled}),roles:()=>[role],allowed:()=>true,sceneFor:()=>scene,activityFor:()=>scene,dispatch:async()=>{calls++;return 's';},stop:async(_m,o)=>stops.push(o),now:()=>Date.parse('2026-11-07T10:10:00+08:00')});
 await engine.tick();assert.equal(calls,1);enabled=false;await engine.enforceExecution();const job=engine.snapshot(meta).jobs[0];assert.equal(job.status,'paused');assert.equal(job.actuallyCompleted,false);assert.equal(stops[0].scheduledOnly,true);await engine.tick();assert.equal(calls,1);assert.throws(()=>engine.resume(job.id,meta),/关闭/);await engine.close();
});
test('completion evidence cannot be inferred from schedule or a textual completed claim',()=>{
 assert.equal(taskCompletion({status:'completed',evidence:[]}).actuallyCompleted,false);assert.equal(taskCompletion({status:'completed',evidence:[{ok:true,substantive:true}]}).actuallyCompleted,true);
 const src={id:'s1',text:'计划：看完教程',role:'simulated',executionStatus:'not_executed',actuallyCompleted:false,taskDescription:'计划：看完教程'};
 const events=groundedEvents([{text:'我已经读完教程',quote:'看完教程',sourceIds:['s1']}],[src]);assert.equal(events[0].actuallyCompleted,false);assert.equal(events[0].text,'【计划未执行】计划：看完教程');
});
test('slow online heartbeat and disconnected device are never classified as sleep',()=>{
 const files=new Map();let time=Date.parse('2026-11-07T10:00:00+08:00'),online=true;const meta={kind:'life',accountId:'a',personaId:'p',key:''},role={meta};
 const engine=createLifeMemory({storage:{list:()=>[...files.keys()],read:n=>files.has(n)?structuredClone(files.get(n)):missing(),write:(n,v)=>files.set(n,structuredClone(v))},now:()=>time,online:()=>online,timeZone:'Asia/Shanghai',config:()=>({life:{enabled:true},memory:{enabled:true,schedule:'daily'}}),allowed:()=>true,roles:()=>[role],signature:()=>'',ask:async()=>''});
 engine.presence(role);time+=5*60000;engine.presence(role);assert.equal(Object.keys(engine.snapshot(meta).plans).length,0);online=false;engine.presence(role,{active:false});assert.equal(engine.plannedScene(meta).taskKind,'rest');time+=3*60000;online=true;engine.presence(role,{active:true});const slots=Object.values(engine.snapshot(meta).plans['2026-11-07']).flatMap(p=>p.slots);assert.ok(slots.length);assert.ok(slots.every(s=>s.taskKind==='rest'&&s.actual===false));
});
test('local memory maintenance processes only the supplied one-item batch and uses short source ids; retrieval works when expansion is deferred',async()=>{
 const files=new Map(),meta={accountId:'a',key:'private:11111',personaId:'p',personaVersion:'v'},sent=[];let deferred=false;
 const hub=createMemoryHub({storage:{list:()=>[...files.keys()],read:n=>files.has(n)?structuredClone(files.get(n)):missing(),write:(n,v)=>files.set(n,structuredClone(v))},allowed:()=>true,signature:()=>'',analysisBatchSize:()=>1,ask:async(_s,input)=>{if(deferred)throw Object.assign(Error('QQ优先'),{code:'LOCAL_ANALYSIS_DEFERRED'});const v=JSON.parse(input);sent.push(v.sources);return JSON.stringify({reflection:{text:'记得继续聊养花。',sourceIds:['s1']}});}});
 for(let i=0;i<3;i++)hub.record(meta,{dir:'in',text:'我喜欢养绿萝，明天讨论养花'+i,speakerId:'11111',messageId:String(i),time:Date.now()+i});
 const r=await hub.maintain(meta,{force:true});assert.equal(r.processed,1);assert.equal(r.pending,2);assert.equal(sent[0].length,1);assert.equal(sent[0][0].id,'s1');deferred=true;const wait=await hub.maintain(meta,{force:true});assert.equal(wait.deferred,true);assert.equal(wait.processed,0);assert.equal(hub.snapshot(meta).maintenance.state,'deferred');const hits=await hub.recall(meta,'还记得我喜欢养绿萝吗',{expand:true});assert.ok(hits.ids.length);hub.close();
});


test('paused schedules without a safe continuation do not restart every minute',async()=>{
 let calls=0;const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-08',start:'10:00',end:'11:00',activity:'读文章',taskKind:'browse'};
 const engine=createLifeExecution({storage:{read:missing,write:()=>{}},config:()=>({maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,dispatch:async()=>{calls++;return 's';}});
 await engine.tick();const id=engine.snapshot(meta).jobs[0].id;
 engine.ended(id,meta,'failed',Error('服务不可达'));
 for(let i=0;i<6;i++)await engine.tick();
 assert.equal(calls,1);assert.equal(engine.snapshot(meta).jobs[0].lastError,'服务不可达');
 engine.resume(id,meta);await engine.tick();assert.equal(calls,2);await engine.close();
});

test('a failed schedule dispatch records its end so the next idle check can consider help',async()=>{
 const at=Date.parse('2026-11-17T10:10:00+08:00'),meta={accountId:'a',personaId:'p'};
 const scene={date:'2026-11-17',start:'10:00',end:'11:00',activity:'查找资料',taskKind:'browse'};
 const engine=createLifeExecution({storage:{read:missing,write:()=>{}},config:()=>({execute:true}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,dispatch:async()=>{throw Error('浏览器无法打开网页');},now:()=>at});
 await engine.tick();const job=engine.snapshot(meta).jobs[0];
 assert.equal(job.status,'failed');assert.equal(job.endedAt,at);
 const event=blockedTaskInitiativeEvent([job],at+1000);
 assert.equal(event?.kind,'task-blocker');assert.match(event.summary.reason,/浏览器无法打开网页/);
 await engine.close();
});

test('missing autonomous actions stop after four failures, survive reload, and permit the next slot',async()=>{
 let stored,calls=0;const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-08',start:'10:00',end:'11:00',activity:'读文章',taskKind:'browse'};
 const options={storage:{read:()=>stored||missing(),write:v=>stored=structuredClone(v)},config:()=>({maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,dispatch:async()=>{calls++;return 's';}};
 let engine=createLifeExecution(options);
 for(let i=0;i<4;i++){await engine.tick();const job=engine.snapshot(meta).jobs[0];engine.ended(job.id,meta,'failed',Object.assign(Error('没有实际调用'),{code:'LOCAL_ACTION_MISSING'}));}
 assert.equal(calls,4);assert.equal(engine.snapshot(meta).jobs[0].status,'failed');assert.equal(engine.snapshot(meta).jobs[0].actuallyCompleted,false);
 await engine.close();engine=createLifeExecution(options);for(let i=0;i<6;i++)await engine.tick();assert.equal(calls,4);
 scene.start='11:00';scene.end='12:00';await engine.tick();assert.equal(calls,5);await engine.close();
});

test('unknown side effects never auto resume even with a safe checkpoint or missing-action error',async()=>{
 let calls=0;const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-08',start:'10:00',end:'11:00',activity:'读文章',taskKind:'browse'};
 const engine=createLifeExecution({storage:{read:missing,write:()=>{}},config:()=>({maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,dispatch:async()=>{calls++;return 's';}});
 await engine.tick();const id=engine.snapshot(meta).jobs[0].id;engine.checkpoint(id,meta,{safeToResume:true});engine.beginStep(id,meta,{key:'send',effect:'send'});
 engine.ended(id,meta,'failed',Object.assign(Error('没有实际调用'),{code:'LOCAL_ACTION_MISSING'}));await engine.tick();
 const job=engine.snapshot(meta).jobs[0];assert.equal(calls,1);assert.equal(job.status,'needs_reconcile');assert.equal(job.resumeOnIdle,false);await engine.close();
});
