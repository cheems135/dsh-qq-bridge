import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initiativeConversation,initiativeConversationHint,recentOperationContext} from '../operation-context.js';
import {routineFollowupDenial} from '../conversation-timing.js';
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

test('proactive decisions retain the last unreturned question across bubbles without enlarging the transcript',()=>{
  const row={chat,accountId,personaId};
  const words=['周末再听。','你想听现场版吗','我更喜欢贝斯进来的那一下。','前奏也特别短。','副歌第一拍就进了。','突然想起还有张现场碟。','歌词最后一句是“你愿意吗？”'];
  const rows=words.map((text,i)=>({...row,dir:i?'out':'in',text,time:at-(words.length-i)*1000,delivery:'sent'}));
  rows.push({...row,dir:'out',text:'另一件事呢？',time:at-100,delivery:'queued'});
  const snapshot=()=>initiativeConversation(recentOperationContext(rows,{key:chat,accountId,personaId,now:at}),false,at);
  const waiting=snapshot();
  assert.equal(waiting.turns.length,4);
  assert.deepEqual(waiting.turns.map(turn=>turn[1]),[words[0],words[1],words[5],words[6]]);
  assert.match(waiting.replyState,/提问后对方还没发言/);
  rows.push({...row,dir:'in',text:'现场版周末再听吧。',time:at});
  assert.doesNotMatch(snapshot().replyState,/提问后对方还没发言/);
});

test('actual API send gate enforces spacing but allows a new topic after the configured interval without a reply',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const start=source.indexOf('  function proactiveCheck('),end=source.indexOf('\n  function privateInitiativeUnanswered(',start);
  assert.ok(start>=0&&end>start);
  let lastIncoming=at-70_000,now=last.sentAt+59*60_000;
  let userTurn={role:'user',at:lastIncoming,text:'等一下我修'};
  const deps={proactiveDenial,routineFollowupDenial,operationContext:()=>[userTurn],featureState:{proactiveContacts:[{...last,episode:last.proactiveEpisode,at:last.sentAt}]},proactiveIncoming:()=>lastIncoming,settings:{autonomy:{privateMinGapMinutes:60}},Date:{now:()=>now}};
  const check=Function(...Object.keys(deps),source.slice(start,end)+'\nreturn proactiveCheck;')(...Object.values(deps));
  assert.match(check({...actor}),/间隔/);
  now=last.sentAt+60*60_000;
  assert.equal(unansweredPrivateInitiative(actor,[last],[],lastIncoming),true);
  assert.equal(check({...actor}),'');
  const draft=words=>({...actor,segments:[{type:'text',data:{text:words}}]});
  const repairCheck=draft('修好了没嘛？');
  assert.match(check(repairCheck),/未要求追问/);
  assert.equal(check(draft('刚发现一首吉他编曲，副歌突然安静下来很有意思。')),'');
  assert.equal(check({...repairCheck,manualInitiative:true}),'');
  assert.equal(check({...repairCheck,commitmentId:'agreed'}),'');
  assert.equal(check({...actor,commitmentId:'user-reminder'}),'');
  assert.equal(check({...actor,initiative:false}),'');
  lastIncoming=at-20_000;
  userTurn={role:'user',at:lastIncoming,text:'我修好了，想聊点别的。'};
  assert.equal(check({...actor}),'');
  assert.equal(check(repairCheck),'');
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

test('local initiative leaves a stale check-in quiet without a failed-send record',async()=>{
  const latest={role:'user',at:at-8*3600000,text:'等一下我修'};
  const c={id:'p',key:chat,accountId,personaId,signature:'old',allowed:true,lastIncoming:latest.at,lastUser:latest,
    day:'2026-11-19',clock:'16:04',history:[{role:'user',content:'等一下我修'}]};
  const audited=[];
  const local=createLocalInitiative({context:()=>c,now:()=>at,
    probe:async()=>({status:'ready',contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}}),
    infer:async()=>'{"speak":true,"text":"修好了没嘛？"}',
    deliver:async()=>assert.fail('the draft must not enter the queue'),
    record:row=>audited.push(row)});
  assert.equal((await local.tick()).status,'quiet');
  assert.equal(audited.at(-1).result.decision,'quiet');
});
