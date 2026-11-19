import {readConsoleSource} from './console-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createLifeMemory} from '../life-memory.js';
import {createLifeExecution} from '../life-execution.js';
import {taskProgressSignature,scheduleJobDetails} from '../schedule-continuity.js';
import {taskCompletion} from '../schedule-evidence.js';
import {createMemoryHub} from '../memory-hub.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function storage(){const files=new Map();return {list:()=>[...files.keys()],read:k=>{if(!files.has(k))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(k));},write:(k,v)=>files.set(k,structuredClone(v)),remove:k=>files.delete(k)};}
function execution(extra={}){let saved,calls=0,clock=Date.parse('2026-11-15T10:10:00+08:00');const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-15',start:'10:00',end:'11:00',activity:'阅读文章',taskKind:'browse',goal:'读完实际正文'};
 const options={storage:{read:()=>saved,write:v=>saved=structuredClone(v)},config:()=>({sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,now:()=>clock,dispatch:async()=>{calls++;return 's';},...extra},engine=createLifeExecution(options);
 return {engine,options,meta,advance:ms=>clock+=ms,get now(){return clock;},get calls(){return calls;}};
}
test('actual conversation supersedes current activity without claiming the original plan completed, survives restart and preserves clothing',()=>{
 let clock=Date.parse('2026-11-15T10:10:00+08:00'),busy=false;const meta={kind:'life',accountId:'a',personaId:'p',key:''},role={meta,name:'测试角色',prompt:'自然聊天'};
 const options={storage:storage(),config:()=>({life:{enabled:true},memory:{enabled:false}}),allowed:()=>true,roles:()=>[role],signature:()=>'',online:()=>true,conversationActive:()=>busy,now:()=>clock,ask:()=>{throw Error('must not invoke model');}};
 let life=createLifeMemory(options);life.chooseActivity(role,{mode:'start',activity:'阅读文章',taskKind:'browse',outfit:'蓝裙与白色发夹',minutes:30},{self:true});
 assert(life.noteConversation(meta,{key:'private:12345',text:'刚才那篇文章的结尾是什么意思',messageId:'in-1'}));assert.equal(life.noteConversation(meta,{key:'private:12345',text:'重复',messageId:'in-1'}),false);
 let scene=life.lifeScene(meta);assert.equal(scene.conversation,true);assert.match(scene.goal,/文章的结尾/);assert.equal(scene.outfit,'蓝裙与白色发夹');assert.equal(life.snapshot(meta).activity.state,'running');assert.equal(life.today(meta).slots[0].activity,'阅读文章');
 assert.equal(life.noteConversation(meta,{key:'private:12345',dir:'out',delivery:'queued',text:'未发出'}),false);assert.equal(life.snapshot(meta).conversations[0].status,'received');
 life.noteConversation(meta,{key:'private:12345',dir:'out',delivery:'sent',text:'可以一起看最后一段',messageId:'out-1'});life=createLifeMemory(options);assert.equal(life.lifeScene(meta).conversation,true);assert.equal(life.snapshot(meta).conversations[0].lastReply,'可以一起看最后一段');
 clock+=180000;busy=true;assert.equal(life.lifeScene(meta).conversation,true);busy=false;assert.equal(life.lifeScene(meta).activity,'阅读文章');assert.equal(life.snapshot(meta).activity.state,'running');
 assert.equal(life.noteConversation(meta,{key:'invalid',text:'no'}),false);life.close();
});
test('active chat prevents background paid dispatch while real user tools remain independent',async()=>{
 let busy=true;const f=execution({conversationBusy:()=>busy});for(let n=0;n<20;n++){await f.engine.tick();f.advance(60000);}assert.equal(f.calls,0);busy=false;await f.engine.tick();assert.equal(f.calls,1);await f.engine.close();
});
test('talking inside the scheduled group does not close its participation window',async()=>{
 const events=[],scene={date:'2026-11-15',start:'10:00',end:'11:00',activity:'去群里聊聊',taskKind:'group',groupIds:['67890']};
 const f=execution({sceneFor:()=>scene,activityFor:()=>({actual:true,conversation:true,activity:'正在群聊中交流',taskKind:'conversation',key:'group:67890'}),groups:async(_m,input)=>{events.push(input);return {ok:true};}});await f.engine.tick();await f.engine.tick();assert(events.some(e=>e.open));assert(!events.some(e=>e.open===false));assert.equal(f.calls,0);await f.engine.close();
});
test('silent round without real progress stops periodic model retries but explicit resume still works',async()=>{
 const f=execution();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;f.engine.checkpoint(id,f.meta,{summary:'还没拿到内容',next:'稍后再看',safeToResume:true});f.engine.ended(id,f.meta,'completed',undefined,{body:'[skip]'});
 assert.equal(f.engine.snapshot(f.meta).jobs[0].resumeOnIdle,false);for(let n=0;n<15;n++){f.advance(60000);await f.engine.tick();}assert.equal(f.calls,1);assert.equal(f.engine.snapshot(f.meta).jobs[0].actuallyCompleted,false);
 f.engine.resume(id,f.meta);await f.engine.tick();assert.equal(f.calls,2);await f.engine.close();
});
test('one activity split at noon or shifted by a minute keeps its task and send receipt',async()=>{
 let clock=Date.parse('2026-11-17T11:57:00+08:00'),calls=0,stored;
 const meta={accountId:'a',personaId:'p'},scene={date:'2026-11-17',phase:'morning',start:'11:56',end:'12:00',activity:'读文章',taskKind:'browse',goal:'读完一篇具体文章'};
 const engine=createLifeExecution({storage:{read:()=>stored,write:v=>stored=structuredClone(v)},config:()=>({execute:true,sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>scene,now:()=>clock,dispatch:async()=>{calls++;return 'session';}});
 await engine.tick();const id=engine.snapshot(meta).jobs[0].id;
 const step=engine.beginStep(id,meta,{effect:'send',target:'private:1',details:{tool:'bridge_life_qq'}}).step;
 engine.settleStep(id,meta,step.id,{status:'confirmed',evidence:{verified:true}});
 engine.ended(id,meta,'completed',undefined,{body:'[skip]'});
 clock=Date.parse('2026-11-17T12:00:00+08:00');Object.assign(scene,{phase:'afternoon',start:'12:00',end:'12:10'});await engine.tick();
 clock=Date.parse('2026-11-17T12:01:00+08:00');Object.assign(scene,{start:'12:01',end:'12:11'});await engine.tick();
 let jobs=engine.snapshot(meta).jobs;assert.equal(jobs.length,1);assert.equal(jobs[0].id,id);assert.equal(jobs[0].scene.end,'12:11');assert.equal(jobs[0].steps.length,1);assert.equal(calls,2); // One closeout turn for the existing receipt is allowed.
 engine.ended(id,meta,'completed',undefined,{body:'[skip]'});
 clock=Date.parse('2026-11-17T12:12:00+08:00');Object.assign(scene,{start:'12:12',end:'12:30',goal:'读一篇新文章',activity:'阅读'});await engine.tick();
 jobs=engine.snapshot(meta).jobs;assert.equal(jobs.length,2);assert.equal(calls,3);await engine.close();
});
test('duplicate successful observations cannot manufacture progress; delays survive reload and unknown sends remain blocked',async()=>{
 const f=execution();await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id;
 const read=key=>{const s=f.engine.beginStep(id,f.meta,{key,effect:'read',target:'same page',details:{tool:'bridge_read'}}).step;f.engine.settleStep(id,f.meta,s.id,{status:'confirmed'});};
 read('1');f.engine.checkpoint(id,f.meta,{next:'继续阅读',safeToResume:true});f.engine.ended(id,f.meta,'completed');await f.engine.tick();assert.equal(f.calls,2);read('2');f.engine.ended(id,f.meta,'completed');
 const due=f.engine.snapshot(f.meta).jobs[0].nextDispatchAt;assert(due>f.now);for(let n=0;n<20;n++)await f.engine.tick();assert.equal(f.calls,2);await f.engine.close();
 const reloaded=createLifeExecution(f.options);await reloaded.tick();assert.equal(f.calls,2);f.advance(60000);await reloaded.tick();assert.equal(f.calls,3);await reloaded.close();
 const a={steps:[{id:'random1',status:'confirmed',fingerprint:'stable'}],evidence:[]},b={steps:[...a.steps,{id:'random2',status:'confirmed',fingerprint:'stable'}],evidence:[]};assert.equal(taskProgressSignature(a),taskProgressSignature(b));
 const g=execution();await g.engine.tick();const gid=g.engine.snapshot(g.meta).jobs[0].id;g.engine.beginStep(gid,g.meta,{effect:'send'});g.engine.ended(gid,g.meta,'completed',undefined,{body:'[skip]'});assert.equal(g.engine.snapshot(g.meta).jobs[0].status,'needs_reconcile');await g.engine.close();
});
test('skip after actual new tool progress can continue a saved task and completed tasks retain step details',async()=>{
 const events=[],f=execution({onProgress:j=>events.push(j.id)});await f.engine.tick();const id=f.engine.snapshot(f.meta).jobs[0].id,step=f.engine.beginStep(id,f.meta,{key:'read',effect:'read',target:'article',details:{tool:'bridge_read'}}).step;
 f.engine.settleStep(id,f.meta,step.id,{status:'confirmed',evidence:{verified:true}});f.engine.record(id,f.meta,{ok:true,substantive:true,tool:'bridge_read',coverage:'实际正文已读取'});f.engine.checkpoint(id,f.meta,{summary:'已读正文',next:'核对结尾',safeToResume:true});f.engine.ended(id,f.meta,'completed',undefined,{body:'[skip]'});assert.equal(f.engine.snapshot(f.meta).jobs[0].resumeOnIdle,true);await f.engine.tick();assert.equal(f.calls,2);
 f.engine.finish(id,f.meta,{note:'文章内容已核对'});const j=f.engine.snapshot(f.meta).jobs[0];assert.equal(j.details.actuallyCompleted,true);assert.equal(j.details.steps[0].tool,'bridge_read');assert.equal(j.details.steps[0].status,'confirmed');assert(events.length>=2);await f.engine.close();
});
test('checkpoint and real results are immediately retrievable by owner chat without a nightly archive or an analysis API',async()=>{
 const hub=createMemoryHub({storage:storage(),allowed:()=>true,now:()=>10000}),meta={accountId:'a',personaId:'p'},owner={...meta,key:'private:12345',personaVersion:'v'};
 const start=source.indexOf('  function rememberLifeProgress('),end=source.indexOf('  async function prepareCalendarContext(',start);assert(start>=0&&end>start);
 const deps={memoryHub:hub,settings:{memory:{enabled:true}},lifeOwnerRoles:()=>[{meta,ownerKey:owner.key}],taskCompletion,scheduleJobDetails,taskProgressSignature,hubMeta:()=>owner,textHash:v=>v};
 const remember=Function(...Object.keys(deps),source.slice(start,end)+';return rememberLifeProgress;')(...Object.values(deps));
 const j={id:'j',meta,status:'paused',scene:{activity:'阅读雨天文章'},checkpoint:{summary:'读到雨天咖啡馆结尾',next:'确认作者的结论',at:10000},evidence:[{ok:true,substantive:true,tool:'bridge_read',coverage:'实际正文谈到雨天咖啡馆'}]};remember(j);remember(j);
 const result=await hub.recall(owner,'雨天 咖啡馆 结尾',{expand:false});assert.match(result.text,/雨天/);assert(!result.records.some(r=>r.actual));await hub.close();
});
test('detailed schedule UI renders unknown versus verified steps and received versus sent chat distinctly',()=>{
 const html=readConsoleSource(),start=html.indexOf('  function lifeExecutionDetails('),end=html.indexOf('  function homeWalletRows(',start);assert(end>start);
 const render=Function('esc','LIFE_JOB_LABELS','INVOCATION_TOOL_LABELS',html.slice(start,end)+';return lifeExecutionDetails;')(v=>String(v??''),{needs_reconcile:'待核对'},{bridge_read:'读网页'});
 const at=Date.parse('2026-11-15T10:00:00+08:00'),view=render({v:{today:{day:'2026-11-15',conversations:[{key:'private:12345',startedAt:at,lastAt:at,topic:'文章结尾',status:'received'}]}},life:{jobs:[{status:'needs_reconcile',scene:{activity:'阅读'},details:{steps:[{at,tool:'bridge_read',status:'unknown',target:'正文'}]}}]}});assert.match(view,/消息已收到，未确认回复送达/);assert.match(view,/结果待核对/);assert.match(view,/文章结尾/);assert(!view.includes('undefined'));
});

test('foreground borrowing waits on the original job across reload and resolves ordinary owner speech',async()=>{
 for(const [device,reply,expected] of [['desktop','你用吧','paused'],['phone','我在用','cancelled']]){
  let asked=0;const f=execution({notify:async()=>{asked++;}});await f.engine.tick();
  const id=f.engine.snapshot(f.meta).jobs[0].id,params={kind:'device_borrow',question:'想玩一局，可以借我一会儿吗？',details:{device,ownerId:'12345'}};
  const receipt=await f.engine.request(id,f.meta,params);f.engine.reload();await f.engine.request(id,f.meta,params);
  assert.equal(asked,1);assert.equal(f.engine.job(id,f.meta).status,'waiting_user');
  assert.equal(f.engine.answer(receipt.id,f.meta,'午饭吃什么').unrelated,true);
  assert.equal(f.engine.answer(receipt.id,f.meta,reply).status,expected);await f.engine.close();
 }
});
