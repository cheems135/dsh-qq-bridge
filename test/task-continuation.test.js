import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent} from '../local-agent.js';
import {executeLocalAutonomy} from '../local-autonomy.js';
import {createLifeExecution} from '../life-execution.js';
import {serviceTaskEvidence,latestTaskWait} from '../task-progress.js';
import {createExecutionRuntime} from '../execution-runtime.js';

function fixture(){let saved,calls=0,time=Date.parse('2026-11-14T10:10:00+08:00');const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-14',start:'10:00',end:'11:00',taskKind:'browse',activity:'阅读资料'};
 const options={storage:{read:()=>saved,write:v=>saved=structuredClone(v)},config:()=>({execute:true,sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,dispatch:async()=>{calls++;return 's';},now:()=>time};
 const engine=createLifeExecution(options);return {engine,options,meta,get calls(){return calls;},get now(){return time;},advance:ms=>time+=ms};
}
test('actual local agent budget yields unexecuted tools; schedule persists and continues without counting a tool failure',async()=>{
 let modelCalls=0,executions=0;
 const agent=createLocalAgent({maxToolCalls:1,maxToolRounds:4,model:async()=>({tool_calls:[{id:'call'+(++modelCalls),function:{name:'bridge_step',arguments:JSON.stringify({step:modelCalls})}}]}),tools:{bridge_step:{kind:'data',parameters:{type:'object',properties:{step:{type:'number'}},required:['step']},execute:async()=>{executions++;return {ok:true,text:'实际第一步结果'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'读取两步资料'}]});assert.equal(executions,1);assert.equal(result.continuation.reason,'tool-budget');assert.equal(result.receipts.filter(r=>r.limited).length,1);
 const f=fixture();await f.engine.tick();const job=f.engine.snapshot(f.meta).jobs[0];let deliveries=0;
 await executeLocalAutonomy({context:{id:'turn',lifeJob:job},assertCurrent:()=>{},guardTool:(_n,_a,run)=>run(),run:async()=>({ok:true,body:result}),deliver:()=>deliveries++,finish:(reason,error)=>f.engine.ended(job.id,f.meta,reason,error)});
 assert.equal(deliveries,0);assert.equal(f.engine.snapshot(f.meta).jobs[0].missingActionFailures,undefined);
 await f.engine.close();const reloaded=createLifeExecution(f.options);await reloaded.tick();assert.equal(f.calls,2);assert.equal(reloaded.snapshot(f.meta).jobs[0].id,job.id);assert.equal(reloaded.snapshot(f.meta).jobs[0].actuallyCompleted,false);await reloaded.close();
});
test('only real task IDs and service statuses count as waiting; poll completion can come from a different tool',()=>{
 assert.equal(serviceTaskEvidence({status:'running',text:'还在处理'},'watch'),null);
 const a=serviceTaskEvidence({taskId:'t',status:'RUNNING'},'generate',1000),b=serviceTaskEvidence({data:{taskId:'t',status:'SUCCESS'}},'query',2000);
 assert.equal(latestTaskWait({steps:[{evidence:{serviceTask:a}}]},1500).taskId,'t');
 assert.equal(latestTaskWait({steps:[{evidence:{serviceTask:a}},{evidence:{serviceTask:b}}]},2500),null);
});
test('pending service waits across more than three continuations without stalls; completion is not inferred',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;
 const step=f.engine.beginStep(id,f.meta,{key:'poll',effect:'read',idempotent:true}).step;
 f.engine.settleStep(id,f.meta,step.id,{status:'confirmed',evidence:{serviceTask:serviceTaskEvidence({taskId:'t',status:'processing'},'query',f.now)}});
 for(let i=0;i<6;i++){f.engine.ended(id,f.meta,'completed');assert.equal(f.engine.snapshot(f.meta).jobs[0].continuation?.stalls||0,0);f.advance(60000);await f.engine.tick();}
 assert.equal(f.calls,7);assert.throws(()=>f.engine.finish(id,f.meta,{status:'completed'}),/仍在排队/);await f.engine.close();
});
test('expired service observations require reconciliation, not failure or another paid submission',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id,step=f.engine.beginStep(id,f.meta,{effect:'read',idempotent:true}).step;
 f.engine.settleStep(id,f.meta,step.id,{status:'confirmed',evidence:{serviceTask:serviceTaskEvidence({taskId:'t',status:'queued'},'query',f.now)}});f.engine.ended(id,f.meta,'completed');
 f.advance(16*60000);await f.engine.tick();assert.equal(f.calls,1);const j=f.engine.snapshot(f.meta).jobs[0];assert.equal(j.status,'needs_reconcile');assert.equal(j.actuallyCompleted,false);await f.engine.close();
});
test('real failures alongside a budget receipt remain failures, never a safe automatic handoff',async()=>{
 let reason;await assert.rejects(executeLocalAutonomy({context:{id:'x',lifeJob:{id:'job'}},assertCurrent:()=>{},run:async()=>({ok:true,body:{continuation:{reason:'tool-budget'},receipts:[{tool:'read',ok:false,error:'offline'},{tool:'other',ok:false,limited:true}]}}),finish:r=>reason=r}),/offline/);assert.equal(reason,'failed');
});
test('host execution runtime persists the service task ID and status from the actual tool receipt',()=>{
 const rows=[],life={beginStep:()=>({step:{id:'s'}}),settleStep:(_id,_meta,_step,value)=>rows.push(value)};
 const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>life});
 const context={accountId:'a',personaId:'p',key:'private:1',meta:{lifeJobId:'j'}},exec={name:'bridge_watch',arguments:{action:'status'}};
 runtime.begin(exec,context);runtime.finish(exec,context,{taskId:'actual-task',status:'running'});
 assert.equal(rows[0].evidence.serviceTask.taskId,'actual-task');assert.equal(rows[0].evidence.serviceTask.state,'waiting');
});
test('ordinary local chat completes a three-step task across one-call phases without repeating executed steps',async()=>{
 const executed=[],checkpoints=[],sequence=['a','b','b','c','c',null];
 const agent=createLocalAgent({continueAcrossBudgets:true,onCheckpoint:c=>checkpoints.push(c),maxToolCalls:1,maxToolRounds:3,model:async()=>{const step=sequence.shift();return step?{tool_calls:[{function:{name:'bridge_step',arguments:{step}}}]}:'全部步骤已核对';},tools:{bridge_step:{kind:'data',parameters:{type:'object',properties:{step:{type:'string'}},required:['step']},execute:async({step})=>{executed.push(step);return {ok:true,text:'真实完成'+step};}}}});
 const result=await agent.run({messages:[{role:'user',content:'依次执行a、b、c'}]});
 assert.deepEqual(executed,['a','b','c']);assert.equal(checkpoints.length,2);assert(!result.continuation);assert.equal(result.text,'全部步骤已核对');assert(checkpoints[0].completed.some(r=>r.text.includes('a')));
});
test('new QQ interruption at a phase checkpoint cancels before another operation',async()=>{
 const controller=new AbortController();let calls=0,models=0;
 const agent=createLocalAgent({continueAcrossBudgets:true,maxToolCalls:1,onCheckpoint:()=>controller.abort(),model:async()=>({tool_calls:[{function:{name:'bridge_step',arguments:{step:++models}}}]}),tools:{bridge_step:{kind:'data',parameters:{type:'object',properties:{step:{type:'number'}}},execute:async()=>{calls++;return {ok:true,text:'实际结果'};}}}});
 await assert.rejects(agent.run({messages:[{role:'user',content:'执行多步'}],signal:controller.signal}),e=>e.name==='AbortError');assert.equal(calls,1);
});

