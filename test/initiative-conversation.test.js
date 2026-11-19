import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initiativeConversation,initiativeConversationHint,recentOperationContext} from '../operation-context.js';
import {unansweredPrivateInitiative,proactiveDenial} from '../social-pacing.js';
import {createLocalInitiative} from '../local-initiative.js';

const at=Date.parse('2026-11-19T16:04:00+08:00');
const chat='private:12345',accountId='a',personaId='p';
const actor={initiative:true,accountId,chat,personaId,proactiveEpisode:'next'};
const last={...actor,id:'sent',proactiveEpisode:'old',status:'sent',at:at-90_000,sentAt:at-50_000};
test('only platform-confirmed messages, in this QQ conversation, create a wait for a new user message',()=>{
  assert.equal(unansweredPrivateInitiative(actor,[last],[],at-70_000),true,'reply before actual dispatch cannot answer a later message');
  assert.equal(unansweredPrivateInitiative(actor,[last],[],at-20_000),false);
  for(const change of [{status:'unknown'},{status:'queued'},{status:'cancelled'},{chat:'private:33333'},{accountId:'b'},{retracted:true},{commitmentId:'reminder'}]){
    assert.equal(unansweredPrivateInitiative(actor,[{...last,...change}],[],0),false);
  }
  for(const change of [{initiative:false},{manualInitiative:true},{commitmentId:'reminder'},{proactiveEpisode:'old'}]){
    assert.equal(unansweredPrivateInitiative({...actor,...change},[last],[],0),false);
  }
  const saved={dir:'out',delivery:'sent',automaticPrivate:true,proactiveEpisode:'old',chat,accountId,initiativeSentAt:last.sentAt,time:last.at};
  assert.equal(unansweredPrivateInitiative(actor,[],[saved],at-70_000),true);
  assert.equal(unansweredPrivateInitiative(actor,[],[{...saved,retracted:true}],0),false);
});

test('initiative context includes their latest real sentence, distinguishes silence, and excludes other conversations and unsent drafts',()=>{
  const row={chat,accountId,personaId};
  const history=[
    {...row,dir:'out',time:at-200_000,text:'你想看这篇文章吗？',delivery:'sent'},
    {...row,dir:'in',time:at-150_000,text:'旧的展示名',userText:'我先去看电影。'},
    {...row,dir:'out',time:at-100_000,text:'行，等你有空再聊。',delivery:'sent'},
    {...row,dir:'out',time:at-20_000,text:'未送达的草稿',delivery:'unknown'},
    {...row,chat:'private:other',dir:'in',time:at-9000,text:'别的联系人的话'},
  ];
  const ops=recentOperationContext(history,{key:chat,accountId,personaId,now:at});
  const context=initiativeConversation(ops);
  assert.match(context.replyState,/没有新的/);
  const hint=initiativeConversationHint(ops,true);
  assert.match(hint,/上一条主动私聊之后还没有收到/);
  assert.match(hint,/新想法可以自然开口/);
  assert.match(hint,/我先去看电影/);assert.doesNotMatch(hint,/旧的展示名|未送达的草稿|别的联系人/);
  history.push({...row,dir:'in',time:at-5000,userText:'电影看完了，来聊刚才那篇文章。'});
  assert.match(initiativeConversation(recentOperationContext(history,{key:chat,accountId,personaId,now:at})).replyState,/有新的/);
});

test('actual API send gate enforces spacing but allows a new topic after the configured interval without a reply',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const start=source.indexOf('  function proactiveCheck('),end=source.indexOf('\n  function privateInitiativeUnanswered(',start);
  assert.ok(start>=0&&end>start);
  let lastIncoming=at-70_000,now=last.sentAt+59*60_000;
  const deps={proactiveDenial,featureState:{proactiveContacts:[{...last,episode:last.proactiveEpisode,at:last.sentAt}]},proactiveIncoming:()=>lastIncoming,settings:{autonomy:{privateMinGapMinutes:60}},Date:{now:()=>now}};
  const check=Function(...Object.keys(deps),source.slice(start,end)+'\nreturn proactiveCheck;')(...Object.values(deps));
  assert.match(check({...actor}),/间隔/);
  now=last.sentAt+60*60_000;
  assert.equal(unansweredPrivateInitiative(actor,[last],[],lastIncoming),true);
  assert.equal(check({...actor}),'');
  assert.equal(check({...actor,commitmentId:'user-reminder'}),'');
  assert.equal(check({...actor,initiative:false}),'');
  lastIncoming=at-20_000;
  assert.equal(check({...actor}),'');
});

test('local pacing skips inference during the interval, then keeps reply status alongside a fresh draft',async()=>{
  let c={id:'p',key:chat,accountId,personaId,signature:'one',allowed:true,lastIncoming:at-90*60_000,
    day:'2026-11-19',clock:'16:04',history:[{role:'user',content:'刚才那篇文章我读完了。'}],contactHold:'主动私聊间隔还未到'};
  let probes=0,inferences=0,sent=0;
  const local=createLocalInitiative({context:()=>c,now:()=>at,
    probe:async()=>{probes++;return {status:'ready',contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}};},
    infer:async({messages})=>{inferences++;assert.match(JSON.stringify(messages),/刚才那篇文章/);assert.match(JSON.stringify(messages),/未收到对方的新消息/);c={...c,signature:'new-human'};return '{"speak":true,"text":"你最喜欢文章哪一段？","reason":"跟进阅读"}';},
    deliver:async()=>{sent++;return 'fixture';}});
  assert.equal((await local.tick()).status,'waiting');
  assert.equal(probes,0);assert.equal(inferences,0);
  c={...c,contactHold:'',replyState:'上一条主动私聊后未收到对方的新消息'};
  assert.equal((await local.tick()).status,'cancelled');
  assert.equal(inferences,1);assert.equal(sent,0);
});
