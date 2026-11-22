import test from 'node:test';import assert from 'node:assert/strict';
import {moodState,shouldJudgeMood,applyMood,consumeMoodHint,moodContinuity,moodDelivery,moodPlanningContext} from '../companion-mood.js';
import {initiativeEvent,moodInitiativeEvent,moodFollowupReady,eventInitiativeCadence} from '../initiative-events.js';
import {createLifeMemory} from '../life-memory.js';
import {decideInitiative,parseInitiativeDecision} from '../api-initiative.js';
const now=1794650000000,words='你真没用，我不想理你了';
const negative={confidence:90,evidenceQuote:words,reason:'受到明确贬低而难过',moodDelta:-3,dims:{sad:3}};
test('different grounded reactions persist and reach voice direction without a fixed action',()=>{
 for(const [dim,emotion] of Object.entries({angry:'angry',curious:'curiosity',excited:'excited',disappointed:'sad',relieved:'relieved',proud:'smug',bored:'boredom'})){
  const quote='我们刚才提到的事情';
  const result=applyMood({}, {confidence:90,evidenceQuote:quote,reason:'结合当下语境的状态变化',dims:{[dim]:4}},quote,{now});
  assert.equal(result.accepted,true,dim);assert.equal(moodDelivery(result.state,{now}).emotion,emotion);
  assert.equal(result.state.dims[dim],4);assert(!('action' in result.state));
 }
});
test('salient event requests assessment immediately, disabled and empty do not',()=>{
 for(const turns of [1,2,3])assert(shouldJudgeMood({turns},words));
 assert(!shouldJudgeMood({turns:1},'今天的天气还好'));assert(!shouldJudgeMood({turns:3},''));assert(!shouldJudgeMood({turns:1},words,{enabled:false}));
 for(const words of ['对呀','嗯','啊？','我没听清'])assert.equal(shouldJudgeMood({turns:3},words),false,words);
 assert.equal(shouldJudgeMood({turns:3},'对呀，今天真的很开心！'),true);
});
test('cause survives consumption and fading; public projection excludes private cause',()=>{
 const hurt=applyMood(moodState({},now),negative,words,{now}).state;
 const first=consumeMoodHint(hurt,{now:now+1000}),second=consumeMoodHint(first.state,{now:now+45*60000});
 assert.match(second.text,/明确贬低/);
 assert.match(moodContinuity(second.state,{now:now+24*3600000}),/是否解决需结合后续交流/);
 const publicText=moodContinuity(second.state,{now:now+45*60000,publicContext:true});assert(!publicText.includes(words));assert(!publicText.includes('明确贬低'));
 assert.equal(moodContinuity(second.state,{now:now+8*86400000}),'');
});
test('a grounded mood change becomes one delayed initiative cue without exposing the private quote',()=>{
 const at=Date.parse('2026-11-16T09:30:00+08:00');
 const hurt=applyMood({},negative,words,{now:at}).state;
 const cue=moodInitiativeEvent(hurt,{now:at+60000});
 assert.equal(cue.kind,'mood');assert.equal(cue.at,at);
 assert(!JSON.stringify(cue).includes(words));assert(!JSON.stringify(cue).includes(negative.reason));
 assert.equal(moodFollowupReady(cue,{now:at+19*60000,lastIncoming:at}),false);
 assert.equal(moodFollowupReady(cue,{now:at+20*60000,lastIncoming:at}),true);
 const accepted=eventInitiativeCadence(null,at,at+20*60000,{event:cue,commit:true});
 assert.equal(eventInitiativeCadence(accepted.record,at,at+21*60000,{event:cue}).ok,false);
 assert.equal(moodInitiativeEvent(hurt,{now:at+25*3600000}),null);
 assert.equal(moodInitiativeEvent(hurt,{now:at+60000,enabled:false}),null);
 const scene={date:'2026-11-16',start:'09:00',activity:'读书',actual:false};
 assert.equal(initiativeEvent({scene,mood:hurt,now:at+60000}).kind,'mood');
 assert.equal(initiativeEvent({scene,mood:hurt,jobs:[{id:'job',evidence:[{ok:true,substantive:true,tool:'read',at:at+2*60000}]}],now:at+3*60000}).kind,'progress');
});

test('casual turns keep the tone and leave the old episode available for a real follow-up',()=>{
 const hurt=applyMood({},negative,words,{now}).state;
 const opts={now:now+1000};
 const casual=consumeMoodHint(hurt,{...opts,turnWords:'我选红茶，你呢？'});
 assert.match(casual.text,/当前情绪底色/);
 assert.doesNotMatch(casual.text,/明确贬低|不想理你/);
 assert.match(consumeMoodHint(casual.state,{...opts,turnWords:'你还在生气吗？'}).text,/明确贬低/);
 assert.match(consumeMoodHint(casual.state,{...opts,turnWords:'我刚才把话说重了'}).text,/明确贬低/);
 for(const turnWords of ['室友和朋友和好了','她说“对不起”','你觉得他还在生气吗？'])
   assert.doesNotMatch(consumeMoodHint(hurt,{...opts,turnWords}).text,/明确贬低|不想理你/);
 assert.doesNotMatch(consumeMoodHint(hurt,{...opts,turnWords:'你还在生气吗？',publicContext:true}).text,/明确贬低|不想理你/);
});
test('schedule mood projection is compact and never includes the private cause',()=>{
 const hurt=applyMood({},negative,words,{now}).state;
 const projection=moodPlanningContext(hurt,{now:now+3600000});
 assert.equal(projection.events.length,1);
 assert.equal(projection.events[0].direction,'低落');
 assert(!JSON.stringify(projection).includes(words));assert(!JSON.stringify(projection).includes(negative.reason));
 assert.equal(moodPlanningContext(hurt,{now:now+3600000,config:{enabled:false}}),null);
});
test('a real schedule planning request receives recent emotion without an extra model call',async()=>{
 const at=Date.parse('2026-11-16T13:00:00+08:00'),files=new Map(),meta={kind:'life',key:'',accountId:'a',personaId:'p'},role={meta,name:'测试',prompt:'喜欢阅读'};
 let calls=0,seen;
 const life=createLifeMemory({storage:{list:()=>[...files.keys()],read:name=>{if(!files.has(name))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(name));},write:(name,value)=>files.set(name,structuredClone(value))},now:()=>at,config:()=>({life:{enabled:true},memory:{enabled:true,schedule:'daily'}}),allowed:()=>true,roles:()=>[role],signature:()=>'',emotionContext:()=>({tone:'有点低落',events:[{at:at-3600000,status:'仍有影响',direction:'低落'}]}),capabilities:()=>({groups:[]}),ask:async(_system,input)=>{calls++;seen=JSON.parse(input);return JSON.stringify({slots:[{start:seen.window.start,end:seen.window.end,activity:'读资料',taskKind:'browse'}]});}});
 try{assert.equal(await life.ensureLife(role),true);assert.equal(calls,1);assert.equal(seen.recentEmotion.events[0].direction,'低落');assert.equal(life.snapshot(meta).plans['2026-11-16'].afternoon.slots[0].activity,'读资料');}finally{life.close();}
});
test('validated related reconciliation settles event without mutating old state',()=>{
 const hurt=applyMood(moodState({},now),negative,words,{now}).state,id=hurt.event.id,apology='对不起，刚才话说重了';
 const healed=applyMood(hurt,{confidence:90,evidenceQuote:apology,reason:'为此前贬低道歉，关系缓和',moodDelta:0,dims:{sad:-3,calm:2},eventRelation:'resolve',relatedEventId:id},apology,{now:now+60000});
 assert(healed.accepted);assert.equal(healed.state.timeline.find(e=>e.id===id).status,'settled');assert.equal(hurt.event.status,'active');
 const falseLink=applyMood(hurt,{...negative,eventRelation:'resolve',relatedEventId:'other'},words,{now:now+60000});assert.equal(falseLink.state.timeline[0].status,'active');
});
test('correction remains nonnegative, missing evidence cannot invent conflict',()=>{
 const correction='这个答案不对';const r=applyMood({}, {...negative,evidenceQuote:correction},correction,{now});assert.equal(r.state.dims.sad,0);
 assert.equal(applyMood({},negative,'今天好',{now}).accepted,false);
});
test('decision repairs once and rejects undeclared action',async()=>{
 const calls=[];const r=await decideInitiative({system:'聊天风格',input:'选择',actions:['explore'],ask:async(s,u)=>{calls.push({s,u});return calls.length===1?'想去看看资料':'{"action":"explore","text":"读资料","reason":"有兴趣"}';}});
 assert.equal(r.decision.action,'explore');assert.equal(calls.length,2);
 assert.throws(()=>parseInitiativeDecision('{"action":"payment","text":"付款"}',['explore']));
 await assert.rejects(decideInitiative({system:'',input:'',actions:['chat'],ask:async()=> '坏格式'}));
});
test('configuration change during inference prevents repair or action',async()=>{
 let current=true,calls=0;const r=await decideInitiative({system:'',input:'',actions:['chat'],isCurrent:()=>current,ask:async()=>{calls++;current=false;return 'invalid';}});assert(r.cancelled);assert.equal(calls,1);
});
test('runtime connects private causes, public projections, and bounded decision repair',async()=>{
 const {readFile}=await import('node:fs/promises');const s=await readFile(new URL('../index.js',import.meta.url),'utf8');
 assert.match(s,/decideInitiative\(\{/);assert.match(s,/recentMoodEvents:/);assert.match(s,/publicContext:kind==='qzone-interest'/);
});
