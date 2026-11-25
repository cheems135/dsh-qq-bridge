import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {foldAuxiliaryUsage,usageBreakdown,billingDay} from '../usage-accounting.js';
import {modelPurpose} from '../model-invocation-audit.js';
import {createLifeExecution} from '../life-execution.js';
import {invocationSpend} from '../index.js';

test('spend without a current daily ledger retains recorded auxiliary costs and uses the Shanghai billing date', () => {
 const now = Date.parse('2026-11-23T00:15:00+08:00');
 const rows = [
  {id:'chat', at:now, kind:'chat', tool:'chat.reply', backend:'api', usage:{outputTokens:100}},
  {id:'aux', at:now, kind:'chat', tool:'model.complete', backend:'api', usage:{outputTokens:50}},
  {id:'previous', at:now-1800000, kind:'chat', tool:'chat.reply', backend:'api', usage:{outputTokens:999}},
 ];
 const summary = invocationSpend(rows, {day:'2026-11-22',total:5}, now);
 assert.equal(summary.day,'2026-11-23');
 assert.equal(summary.chat,0.0004);
 assert.equal(summary.tool,0.0002);
 assert.equal(summary.total,summary.chat+summary.tool);
 assert.deepEqual(summary.requests.map(entry=>entry.id),['chat','aux']);
 const metered = invocationSpend(rows,{day:summary.day,total:0.5,auxiliaryTotal:0.1},now);
 assert.equal(metered.turnTotal,0.4);
 assert.equal(metered.auxiliaryTotal,0.1);
});

test('auxiliary fees persist once, reconcile corrections, and exclude local or unfinished requests',()=>{
 const at=Date.parse('2026-11-14T22:00:00+08:00'),row={id:'a',at,backend:'api',tool:'model.complete',status:'returned',usage:{value:.02}},price=u=>u.value;
 let usage={day:billingDay(at),total:.1,turns:2,last:.05};usage=foldAuxiliaryUsage(usage,row,price,at);
 assert(Math.abs(usage.total-.12)<1e-9);assert.equal(usage.turns,2);assert(Math.abs(usageBreakdown(usage).turnTotal-.1)<1e-9);
 const restored=JSON.parse(JSON.stringify(usage));assert.equal(foldAuxiliaryUsage(restored,row,price,at),restored);
 usage=foldAuxiliaryUsage(restored,{...row,usage:{value:.03}},price,at);assert(Math.abs(usage.total-.13)<1e-9);assert.equal(usage.auxiliaryCalls,1);
 for(const change of [{backend:'local'},{status:'started'},{tool:'chat.reply'},{at:at-86400000}])assert.equal(foldAuxiliaryUsage(usage,{...row,...change},price,at),usage);
 const next=foldAuxiliaryUsage(usage,{...row,id:'tomorrow',at:at+86400000},price,at+86400000);assert.equal(next.total,.02);assert.equal(next.auxiliaryCalls,1);assert(!usageBreakdown(next).auxiliaryEntries);
});
test('memory and operational reviews are classified by their actual task before generic context words',()=>{
 assert.equal(modelPurpose('日程事实核对\n【个人记忆整理】情绪只依据来源'),'整理或检索记忆');
 assert.equal(modelPurpose('【操作前情境核对】情绪mood'),'核对操作意图与表达');
});
function fixture(){let saved,calls=0,clock=Date.parse('2026-11-14T10:10:00+08:00');const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-14',start:'10:00',end:'11:00',activity:'阅读并记录两条事实',taskKind:'browse'};
 const options={storage:{read:()=>saved,write:v=>saved=structuredClone(v)},config:()=>({execute:true,sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,now:()=>clock,dispatch:async()=>{calls++;return 's';}};
 return {meta,options,advance:ms=>clock+=ms,get calls(){return calls;},engine:createLifeExecution(options)};
}
test('a safe unfinished checkpoint resumes after normal turn completion and restart without a user prompt',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;
 f.engine.checkpoint(id,f.meta,{summary:'已读一段',next:'读取第二段并核对',safeToResume:true});f.engine.ended(id,f.meta,'completed');
 assert.equal(f.engine.snapshot(f.meta).jobs[0].status,'paused');await f.engine.close();
 const reloaded=createLifeExecution(f.options);await reloaded.tick();assert.equal(f.calls,2);assert.equal(reloaded.snapshot(f.meta).jobs[0].id,id);assert.equal(reloaded.snapshot(f.meta).jobs[0].actuallyCompleted,false);await reloaded.close();
});
test('confirmed operations get one closeout; no repeated send and no automatic claim of completion',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;
 const step=f.engine.beginStep(id,f.meta,{key:'sent',effect:'send',target:'private:1'}).step;
 f.engine.settleStep(id,f.meta,step.id,{status:'confirmed',evidence:{verified:true}});f.engine.ended(id,f.meta,'completed');
 assert.equal(f.engine.snapshot(f.meta).jobs[0].continuation.closeoutOnly,true);
 await f.engine.tick();assert.equal(f.calls,2);f.engine.ended(id,f.meta,'completed');
 for(let i=0;i<5;i++)await f.engine.tick();assert.equal(f.calls,2);assert.equal(f.engine.snapshot(f.meta).jobs[0].status,'incomplete');await f.engine.close();
});
test('unchanged checkpoints stop empty continuation, unknown side effects never resume',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;f.engine.checkpoint(id,f.meta,{next:'继续阅读',safeToResume:true});
 for(let i=0;i<5;i++){f.engine.ended(id,f.meta,'completed');f.advance(300000);await f.engine.tick();}
 assert.equal(f.calls,4);assert.equal(f.engine.snapshot(f.meta).jobs[0].status,'incomplete');await f.engine.close();
 const g=fixture();await g.engine.tick();const other=g.engine.snapshot(g.meta).jobs[0].id;g.engine.checkpoint(other,g.meta,{next:'核对结果',safeToResume:true});g.engine.beginStep(other,g.meta,{key:'send',effect:'send'});g.engine.ended(other,g.meta,'completed');await g.engine.tick();assert.equal(g.calls,1);await g.engine.close();
});
test('host image preflight rejects missing material before environment, intent, or prompt model calls',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('async function prepareStudioPrompt('),b=source.indexOf('function runningHubNodeValues',a);let paid=0;
 const scope={settings:{imagegen:{enabled:true,provider:'runninghub'}},workflowForPicture:()=>({selected:'w',savedReference:{file:'ref'}}),resolveImageWorkflow:async()=>{throw Error('missing required input');},preparePhotoEnvironment:()=>{paid++;},studioContext:()=>{},reviewOperation:()=>{paid++;}};
 vm.createContext(scope);vm.runInContext(source.slice(a,b),scope);await assert.rejects(scope.prepareStudioPrompt('ordinary test'),/missing required input/);assert.equal(paid,0);
});
test('late QQ readback after the model turn ends schedules closeout instead of leaving a phantom running task',async()=>{
 const f=fixture();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;
 const step=f.engine.beginStep(id,f.meta,{key:'send',effect:'send'}).step;
 f.engine.settleStep(id,f.meta,step.id,{status:'unknown',evidence:{deliveryIds:['d']}});
 f.engine.ended(id,f.meta,'completed');assert.equal(f.engine.snapshot(f.meta).jobs[0].status,'needs_reconcile');
 f.engine.deliveryReceipt('d',{status:'sent',messageId:'123',verification:{state:'observed'}});
 const j=f.engine.snapshot(f.meta).jobs[0];assert.equal(j.status,'paused');assert.equal(j.continuation.closeoutOnly,true);
 await f.engine.tick();assert.equal(f.calls,2);assert.equal(f.engine.snapshot(f.meta).jobs[0].steps.length,1);await f.engine.close();
});
