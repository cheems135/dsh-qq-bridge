import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initiativeEvent,eventInitiativeCadence,blockedTaskInitiativeEvent} from '../initiative-events.js';
import {createLocalInitiative} from '../local-initiative.js';
import {proactiveDenial,reserveProactive} from '../social-pacing.js';
const minute=60000,now=Date.parse('2026-11-15T06:00:00Z');
test('event identity ignores observation clock; plans are never execution evidence',()=>{
 const scene={date:'2026-11-15',start:720,activity:'画画',actual:false};
 assert.equal(initiativeEvent({scene,now}),null);
 assert.equal(initiativeEvent({scene:{...scene,now:'14:01'},now:now+minute}),null);
 assert.equal(initiativeEvent({scene:{...scene,start:800},now}),null);
 const e={ok:true,substantive:true,tool:'draw',file:'picture.png',coverage:'完成了一张水彩画',at:now};
 const progress=initiativeEvent({scene,jobs:[{id:'j',scene,evidence:[e]}],now});
 assert.equal(progress.kind,'progress');
 assert.equal(progress.id,initiativeEvent({scene,jobs:[{id:'j',scene,evidence:[{...e,at:now+minute}]}],now:now+minute}).id);
 assert.equal(progress.id,initiativeEvent({scene:{...scene,start:800,activity:'散步'},jobs:[{id:'j',scene,evidence:[e]}],now}).id);
 assert.equal(initiativeEvent({scene,jobs:[{id:'j',evidence:[{...e,substantive:false}]}],now}),null);
});
test('a real ended task failure gives one stable decision cue, not an automatic help message',()=>{
 const job={id:'job-1',status:'failed',endedAt:now-minute,reason:'四次尝试后仍无法调用搜索工具',scene:{date:'2026-11-15',start:720,activity:'找一篇文章'},evidence:[{ok:true,substantive:true,tool:'search',coverage:'确认了文章标题',at:now-2*minute}]};
 const first=initiativeEvent({jobs:[job],now});
 assert.equal(first.kind,'task-blocker');
 assert.equal(first.summary.status,'failed');
 assert.match(first.summary.reason,/无法调用搜索工具/);
 assert.deepEqual(first.summary.confirmedProgress,[{tool:'search',coverage:'确认了文章标题'}]);
 assert.equal(first.id,initiativeEvent({jobs:[{...job,reason:'四次尝试后仍无法调用搜索工具，已记录'}],now:now+minute}).id);
 assert.equal(blockedTaskInitiativeEvent([job],now+25*3600000),null);
});
test('temporary waits, ordinary pauses and plans never ask for help; unresolved side effects can trigger safe review once',()=>{
 const base={id:'job-2',scene:{activity:'发布作品'},reason:'操作结果未知',lastTurnEnded:{at:now-minute},steps:[{id:'send-1',status:'unknown',effect:'send',idempotent:false}]};
 for(const status of ['planned','queued','running','paused','waiting_user','unsupported'])assert.equal(blockedTaskInitiativeEvent([{...base,status}],now),null);
 assert.equal(blockedTaskInitiativeEvent([{...base,status:'failed',endedAt:0}],now),null);
 const pending={...base,status:'needs_reconcile',waitingService:{taskId:'t',state:'waiting'}};
 assert.equal(blockedTaskInitiativeEvent([pending],now),null);
 const event=blockedTaskInitiativeEvent([{...base,status:'needs_reconcile'}],now);
 assert.equal(event.kind,'task-blocker');
 assert.match(event.summary.note,/不要重复执行结果未知的操作/);
 assert.equal(event.id,blockedTaskInitiativeEvent([{...base,status:'needs_reconcile',lastTurnEnded:{at:now}}],now).id);
});
test('new events bypass idle wait once, and a quiet decision does not cause paid polling every tick',()=>{
 const base=now-minute,event={id:'one',kind:'mood'},first=eventInitiativeCadence(null,base,now,{event,commit:true});
 assert.equal(first.ok,true);assert.equal(first.event.id,'one');
 assert.equal(eventInitiativeCadence(first.record,base,now+minute,{event}).ok,false);
 const second=eventInitiativeCadence(first.record,base,now+minute,{event:{id:'two',kind:'progress'},commit:true});
 assert.equal(second.ok,true);
 assert.equal(eventInitiativeCadence(second.record,base,now+2*minute,{event}).ok,false);
 assert.equal(eventInitiativeCadence(first.record,base,now+15*minute,{event}).ok,true);
 const overdue=eventInitiativeCadence(null,now-180*minute,now,{commit:true});
 assert.equal(eventInitiativeCadence(overdue.record,now-180*minute,now+minute).ok,false);
});
test('scene changes stay background until cadence; only confirmed observations may trigger immediately',()=>{
 const base=now-minute,first={id:'scene-one',kind:'scene'},switched={id:'scene-two',kind:'scene'};
 assert.equal(initiativeEvent({scene:{date:'2026-11-15',start:720,activity:'画画'},now}),null);
 assert.equal(initiativeEvent({scene:{date:'2026-11-15',start:721,activity:'散步'},now}),null);
 assert.equal(eventInitiativeCadence(null,base,now,{event:first}).ok,false);
 const due=eventInitiativeCadence(null,base,base+15*minute,{event:first,commit:true});
 assert.equal(due.ok,true);assert.equal(due.event,null);assert.deepEqual(due.record.seenEventIds,[]);
 assert.equal(eventInitiativeCadence(due.record,base,base+16*minute,{event:switched}).ok,false);
 assert.equal(eventInitiativeCadence(due.record,base,base+16*minute,{event:{id:'unverified'}}).ok,false);
 for(const kind of ['mood','task-blocker','progress','social-followup','message']){
  const actual=eventInitiativeCadence(due.record,base,base+16*minute,{event:{id:kind,kind}});
  assert.equal(actual.ok,true,kind);assert.equal(actual.event.kind,kind);
 }
});
test('local fresh events may send while owner has not replied; repeated event is not reconsidered',async()=>{
 let clock=now,calls=0;const state={};const rows=[],sent=[];
 const c={allowed:true,unrestricted:true,id:'owner',signature:'same',accountId:'a',personaId:'p',key:'private:1',day:'2026-11-15',lastIncoming:now-3600000,event:{id:'drawing',kind:'progress'},history:[],recent:[]};
 state.lastSent=now-minute;
 const engine=createLocalInitiative({context:()=>c,now:()=>clock,load:()=>state,save:(_,v)=>Object.assign(state,v),probe:async()=>({contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}}),infer:async()=>{calls++;return JSON.stringify({speak:true,text:c.event.id==='drawing'?'画好了，这个水彩背景比上次舒服':'刚发现一段很有趣的吉他演奏'});},deliver:({text,deliveryKey})=>{
  const job={initiative:true,accountId:c.accountId,personaId:c.personaId,chat:c.key,proactiveEpisode:deliveryKey,segments:[{type:'text',data:{text}}]};assert.equal(proactiveDenial(job,rows,c.lastIncoming,clock),'');reserveProactive(job,rows,c.lastIncoming,clock);sent.push(text);return deliveryKey;
 }});
 assert.equal((await engine.tick()).status,'queued');assert.equal(calls,1);
 clock+=minute;assert.equal((await engine.tick()).status,'waiting');assert.equal(calls,1);
 c.event={id:'music',kind:'progress'};assert.equal((await engine.tick()).status,'queued');assert.equal(sent.length,2);
});
test('busy local resources do not consume the event; a declined thought consumes it without sending',async()=>{
 let busy=true,calls=0,state={};const c={allowed:true,unrestricted:true,id:'owner',signature:'same',day:'today',lastIncoming:now-minute,event:{id:'one',kind:'progress'}};
 const engine=createLocalInitiative({context:()=>c,now:()=>now,load:()=>state,save:(_,v)=>state=v,probe:async()=>({busy,contextWindow:4096,features:{text:{supported:true},json:{supported:true}}}),infer:async()=>{calls++;return '{"speak":false}';},deliver:()=>assert.fail('must stay quiet')});
 assert.equal((await engine.tick()).status,'waiting');assert.equal(calls,0);
 busy=false;assert.equal((await engine.tick()).status,'quiet');assert.equal(calls,1);
 assert.equal((await engine.tick()).status,'waiting');assert.equal(calls,1);
});
test('actual API cadence reads account/persona scoped input and consumes only the selected recipient event',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  function initiativeCadenceGate('),source.indexOf('  async function runAutonomyTick('));
 const featureState={},settings={activeAccountId:'a'},messages=[{chat:'private:1',dir:'in',accountId:'other',personaId:'p',time:now},{chat:'private:1',dir:'in',accountId:'a',personaId:'old',time:now}];let saves=0;
 const deps={effectiveUsers:()=>['1'],privateInitiativeAllowed:()=>true,settings,featureState,messages,activePersona:()=>({id:'p'}),pausedConversation:()=>false,lifeExecution:null,calendarMeta:()=>({}),initiativeEventFor:()=>({id:'event',kind:'progress'}),eventInitiativeCadence,saveFeatures:()=>{saves++;},Date:{now:()=>now}};
 const gate=Function(...Object.keys(deps),code+';return initiativeCadenceGate;')(...Object.values(deps));
 assert.equal(gate(false,'private:1').ok,false);assert.equal(saves,0);
 messages.push({chat:'private:1',dir:'in',accountId:'a',personaId:'p',time:now-minute});
 assert.equal(gate().event.id,'event');assert.equal(gate(true,'private:1').ok,true);assert.equal(saves,1);
 assert.equal(gate().ok,false);
 assert.equal(gate(true,'private:2').ok,false);assert.equal(saves,1);
});

 test('open initiative does not regain a hidden minimum gap or 1000-message cap',async()=>{
 const {initiativeAllowed}=await import('../initiative-state.js');
 const config={enabled:true,unrestricted:true,wakeStart:0,wakeEnd:24,minGapMinutes:0,maxPerDay:{chats:9999}};
 assert.equal(initiativeAllowed(config,{counts:{chats:5000},lastActionAt:now},{now}),true);
 assert.equal(initiativeAllowed(config,{counts:{}},{now,quiet:true}),false);
 });
test('actual final QQ send gate accepts both API and local episodes without owner reply, while retaining scope and whitelist checks',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  function outgoingJobDenial('),source.indexOf('  function outboundWait('));
 const rows=[],settings={activeAccountId:'a',localChat:{enabled:true}};let allowed=true,personaId='p';
 const deps={proactiveCheck:job=>proactiveDenial(job,rows,now-minute,now),settings,nonpaymentOpen:()=>true,autonomyConfig:()=>({enabled:true,initiate:true}),inDnd:()=>false,initiativeWindow:()=>true,recipientDenial:()=>'',privateInitiativeAllowed:()=>true,wrongOwnerAddress:()=>false,groupAddressConflict:()=>false,groupStopped:()=>false,auditById:()=>null,featureState:{outbox:[]},recordsAllowed:()=>allowed,activePersona:()=>({id:personaId})};
 const denial=Function(...Object.keys(deps),code+';return outgoingJobDenial;')(...Object.values(deps));
 const first={initiative:true,accountId:'a',personaId:'p',chat:'private:1',chatId:'1',kind:'private',proactiveEpisode:'first',segments:[{type:'text',data:{text:'刚把画布整理好了'}}]};reserveProactive(first,rows,now-minute,now-100);
 for(const [episode,deliveryKey] of [['api','api:initiative:test'],['local','local:initiative:test']]){
  const job={...first,proactiveEpisode:episode,deliveryKey,segments:[{type:'text',data:{text:'看到一个新的摄影技巧'}}]};
  assert.equal(denial(job),'');reserveProactive(job,rows,now-minute,now);assert.equal(denial(job),'');
  allowed=false;assert.match(denial(job),/白名单/);allowed=true;
  personaId='new-persona';assert.match(denial(job),/人设已改变/);personaId='p';
  rows.splice(1);
 }
 assert.match(denial({...first,proactiveEpisode:'duplicate'}),/相同内容/);
});

test('fresh event recipient wins over an unrelated idle topic with a longer history',async()=>{
 const {selectInitiative,initiativePolicy}=await import('../api-initiative.js');
 const fresh={action:'chat',target:'1',event:true},idle={action:'explore',target:'2'};
 assert.equal(selectInitiative([idle,fresh],{actions:{chat:{lastAt:now-1}}},initiativePolicy({},true),{now}),fresh);
});
