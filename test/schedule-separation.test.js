import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCommitments} from '../commitments.js';
import {createLifeExecution} from '../life-execution.js';
import {scheduledChatHeld,scheduledChatReceipt} from '../schedule-continuity.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const target='private:12345';

function dispatch(deps,name,last){
  const start=source.indexOf('      '+name+':async(args,context)=>{');
  const end=source.indexOf(last,start);
  assert.ok(start>=0&&end>start);
  return new Function(...Object.keys(deps),'return ({'+source.slice(start,end)+'})['+JSON.stringify(name)+'];')(...Object.values(deps));
}

test('actual QQ tool holds a scheduled text, sticker and derived commitment without composing or queuing',async()=>{
  const deps={scheduledChatHeld,scheduledChatReceipt,shareTask:()=>({}),targets:()=>[target],resolveShareRecipient:()=>target,
    readdirSync:()=>assert.fail('scheduled sticker was opened'),
    socialReplyForChat:()=>assert.fail('scheduled dialogue was composed'),
    sendSegments:()=>assert.fail('scheduled dialogue was queued')};
  const say=dispatch(deps,'lifeChat','\n      inspectScreen:');
  for(const fields of [{text:'我刚读完，想给你看'},{sticker:'test'}]){
    for(const meta of [{kind:'proactive',lifeJobId:'reading'},{kind:'proactive',sourceLifeJobId:'reading',commitmentId:'self-reminder'}]){
      const result=await say({action:'send',target,...fields},{key:target,meta});
      assert.equal(result.status,'withheld');
      assert.equal(result.queued,false);
      assert.equal(result.submitted,false);
    }
  }
});

test('actual artifact sharing keeps a self-started schedule link or file in its panel',async()=>{
  const deps={scheduledChatHeld,scheduledChatReceipt,targets:()=>[target],resolveShareRecipient:()=>target,
    shareEvidence:()=>assert.fail('went past the quiet schedule check'),sendSegments:()=>assert.fail('scheduled media escaped')};
  const start=source.indexOf('      lifeShare:async(args,context)=>{');
  const end=source.indexOf('\n      },\n    };',start);
  assert.ok(start>=0&&end>start);
  const share=new Function(...Object.keys(deps),'return ({'+source.slice(start,end+8)+'}).lifeShare;')(...Object.values(deps));
  for(const data of [{url:'https://example.org/article'},{file:'saved.png'}]){
    const result=await share({action:'send',target,...data},{key:target,meta:{kind:'proactive',lifeJobId:'job'}});
    assert.equal(result.status,'withheld');
  }
});

test('the persistent QQ queue rejects schedule-origin messages sent through other tools',()=>{
  const start=source.indexOf('  function queueOutgoing(');
  const end=source.indexOf('\n  function ',start+1);
  assert.ok(start>=0&&end>start);
  const send=new Function('scheduledChatHeld',source.slice(start,end)+';return queueOutgoing;')(scheduledChatHeld);
  const content=[{type:'record',data:{file:'fixture.wav'}}];
  assert.equal(send({lifeJobId:'calendar',turnKind:'proactive'},content),null);
  assert.equal(send({sourceLifeJobId:'calendar',turnKind:'proactive'},content),null);
  assert.equal(send({turns:new Map([['one',{meta:{kind:'proactive',lifeJobId:'a'}}]])},content),null);
  assert.equal(scheduledChatHeld({kind:'user',lifeJobId:'calendar'}),false);
  assert.equal(scheduledChatHeld({kind:'proactive',commitmentId:'requested'}),false);
});

test('a task can save a panel-only decision without notifying the chat',async()=>{
  let persisted,notified=0;
  const now=Date.parse('2026-11-19T14:30:00+08:00');
  const meta={accountId:'a',personaId:'p',ownerId:'12345'};
  const scene={date:'2026-11-19',start:'14:00',end:'15:30',activity:'后台读网页',taskKind:'browse'};
  const engine=createLifeExecution({storage:{read:()=>persisted,write:value=>{persisted=structuredClone(value);}},roles:()=>[{meta,ownerKey:target}],
    sceneFor:()=>scene,config:()=>({enabled:true,execute:true}),allowed:()=>true,dispatch:async()=> 'session',
    notify:()=>{notified++;},questionChannel:'panel',now:()=>now});
  try{
    await engine.tick();
    const job=engine.snapshot(meta).jobs.at(-1);
    assert.ok(job);
    const answer=await engine.request(job.id,meta,{kind:'device_borrow',details:{device:'desktop',ownerId:'12345'},question:'想试一下桌面，可以吗？'});
    assert.equal(answer.waiting,true);
    assert.equal(engine.snapshot(meta).waiting[0].question.panelOnly,true);
    assert.equal(notified,0);
    assert.equal(engine.answer(answer.id,meta,'不同意').status,'cancelled');
  }finally{await engine.close();}
});

test('a follow-up created inside an autonomous activity keeps its source, while a user-set reminder is allowed',()=>{
  const now=Date.parse('2026-11-19T14:30:00+08:00');
  let store={};
  const ledger=createCommitments({read:()=>store,write:v=>store=structuredClone(v),now:()=>now,dispatch:async()=>true});
  const plan={action:'plan',goal:'稍后提醒',doneWhen:'记录结果',next:'继续试验',trigger:{kind:'now'}};
  const scope={accountId:'a',personaId:'p',key:target,ownerId:'12345',chat:{isOwner:true,userId:'12345'}};
  try{
    const a=ledger.command(plan,{...scope,meta:{kind:'proactive',lifeJobId:'daily'}});
    const b=ledger.command({...plan,goal:'提醒本人关电脑'},{...scope,meta:{kind:'user',userWords:'一会儿提醒我关电脑'}});
    assert.equal(a.job.sourceLifeJobId,'daily');
    assert.equal(b.job.sourceLifeJobId,undefined);
    assert.equal(scheduledChatHeld({kind:'proactive',sourceLifeJobId:a.job.sourceLifeJobId}),true);
    assert.equal(scheduledChatHeld({kind:'proactive',sourceLifeJobId:b.job.sourceLifeJobId}),false);
  }finally{ledger.close();}
});


test('a new scheduled activity reaches completion with evidence and leaves its result in the panel',async()=>{
  const now=Date.parse('2026-11-19T14:30:00+08:00');
  const meta={accountId:'a',personaId:'p',ownerId:'12345'};
  let persisted,started=0,attempted=0;
  const say=dispatch({scheduledChatHeld,scheduledChatReceipt,shareTask:()=>({}),targets:()=>[target],resolveShareRecipient:()=>target,
    sendSegments:()=>{attempted++;return 'would-have-sent';}},'lifeChat','\n      inspectScreen:');
  const scene={date:'2026-11-19',start:'14:00',end:'15:00',activity:'读取文章正文',taskKind:'browse'};
  const engine=createLifeExecution({storage:{read:()=>persisted,write:v=>{persisted=structuredClone(v);}},roles:()=>[{meta,ownerKey:target}],
    sceneFor:()=>scene,config:()=>({enabled:true,execute:true}),allowed:()=>true,dispatch:async()=>{started++;return 'session';},now:()=>now});
  try{
    await engine.tick();
    const job=engine.snapshot(meta).jobs.at(-1);
    assert.equal(job.status,'running');
    assert.equal(engine.record(job.id,meta,{tool:'bridge_read',ok:true,substantive:true,coverage:'已取得正文的测试回执'}),true);
    const share=await say({action:'send',target,text:'这篇文章读完了'}, {key:target,meta:{kind:'proactive',lifeJobId:job.id}});
    assert.equal(share.status,'withheld');
    assert.equal(engine.finish(job.id,meta,{status:'completed',note:'正文已核对'}).status,'completed');
    await engine.tick();
    assert.equal(started,1);
    assert.equal(attempted,0);
    assert.equal(engine.snapshot(meta).jobs.at(-1).status,'completed');
  }finally{await engine.close();}
});

test('an overlapping planner rewrite keeps the completed activity, while a changed goal still starts',async()=>{
  let now=Date.parse('2026-11-19T15:05:21+08:00'),stored,started=0;
  const meta={accountId:'a',personaId:'p',ownerId:'12345'};
  let scene={date:'2026-11-19',start:'14:40',end:'15:40',activity:'写一段读书记录',goal:'记下读完文章的感受',taskKind:'write'};
  const engine=createLifeExecution({storage:{read:()=>stored,write:v=>{stored=structuredClone(v);}},roles:()=>[{meta,ownerKey:target}],
    sceneFor:()=>scene,config:()=>({enabled:true,execute:true,maxTasksPerDay:0}),allowed:()=>true,dispatch:async()=>{started++;return 'session-'+started;},now:()=>now});
  try{
    await engine.tick();
    const first=engine.snapshot(meta).jobs.at(-1);
    assert.equal(first.status,'running');
    engine.record(first.id,meta,{tool:'bridge_write',ok:true,substantive:true,coverage:'读书记录已写完'});
    assert.equal(engine.finish(first.id,meta,{status:'completed',note:'正文已经写完'}).status,'completed');
    now+=60_000;
    scene={...scene,start:'15:05',end:'15:41',activity:'整理阅读随笔'};
    await engine.tick();
    assert.equal(started,1);
    assert.equal(engine.snapshot(meta).jobs.length,1);
    assert.equal(engine.snapshot(meta).jobs[0].id,first.id);
    scene={...scene,goal:'写下明天的购物计划'};
    await engine.tick();
    assert.equal(started,2);
    assert.equal(engine.snapshot(meta).jobs.length,2);
  }finally{await engine.close();}
});

test('autonomous tasks rest for thirty minutes after completion even with no daily cap',async()=>{
 let now=Date.parse('2026-11-19T15:02:00+08:00'),stored,started=0;
 const meta={accountId:'a',personaId:'p',ownerId:'12345'};
 let scene={date:'2026-11-19',start:'14:45',end:'15:15',activity:'读书',goal:'读完一篇文章',taskKind:'browse'};
 const engine=createLifeExecution({storage:{read:()=>stored,write:v=>{stored=structuredClone(v);}},roles:()=>[{meta,ownerKey:target}],
   sceneFor:()=>scene,config:()=>({enabled:true,execute:true,maxTasksPerDay:0,minGapMinutes:30}),allowed:()=>true,dispatch:async()=>{started++;return 'session-'+started;},now:()=>now});
 try{
   await engine.tick();
   const first=engine.snapshot(meta).jobs.at(-1);
   assert.equal(started,1);
   now=Date.parse('2026-11-19T15:13:00+08:00');
   engine.record(first.id,meta,{tool:'bridge_read',ok:true,substantive:true,coverage:'正文已读'});
   assert.equal(engine.finish(first.id,meta,{status:'completed',note:'正文已读完'}).status,'completed');
   scene={...scene,start:'15:15',end:'16:00',activity:'读资料',goal:'了解下一个专题'};
   now=Date.parse('2026-11-19T15:42:59+08:00');
   await engine.tick();
   assert.equal(started,1);
   assert.match(engine.snapshot(meta).jobs.find(job=>job.scene.goal===scene.goal)?.reason,/30 分钟/);
   now+=1000;
   await engine.tick();
   assert.equal(started,2);
 }finally{await engine.close();}
});
