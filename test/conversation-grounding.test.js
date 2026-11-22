import {initiativeConversationHint} from '../operation-context.js';
import {interestHint} from '../website-reading.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {selectMediaIntent,mediaIntentHint} from '../media-intent.js';
import {initiativeGrounding,conversationExecutionGrounding} from '../initiative-grounding.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('actual API proactive reply receives protected execution facts after planning',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');let received;
 const chat={key:'private:1',kind:'private',isOwner:true,sessionId:'session',lifeOnly:true,turns:new Map()};
 const sandbox={chat,isDesktop:true,conversationExecutionGrounding,randomUUID:()=> 'id',stopped:false,accountPaused:false,
  autonomousStandby:()=>false,proactiveCheck:()=>'',recordsAllowed:()=>true,autonomyAllowed:()=>true,privateInitiativeAllowed:()=>true,pausedConversation:()=>false,
  featureProfile:()=>({}),keepSessionAlive:async()=>true,autonomyState:()=>({counts:{chats:0}}),saveState:()=>{},pinApprovalPolicy:async()=>{},installAgentContext:()=>true,
  settings:{activeAccountId:'a',localChat:{enabled:false},owners:['1'],realism:{enabled:true},mood:{}},featureState:{invocations:[],generation:0},activePersona:()=>({id:'p'}),lifeExecution:null,
  consumeMoodHint:()=>({text:''}),currentPersonaMood:()=>({}),operationContext:()=>[],recipientIdentity:()=> '本人',sleepAwarenessHint:()=>'',recentEventsHint:()=>'',websiteReader:null,
  interestHint,privateReadingInterest:key=>{assert.equal(key,chat.key);return {detail:'贝斯在鼓前面进了半拍'};},
  privateInitiativeUnanswered:()=>false,initiativeConversationHint,operationContextHint:()=>'',mediaShareHint:()=>'',withClock:v=>v,sharingExpression:()=> '自然说话',recentDialogueReplies:()=>[],sessionDigests:new Map(),
  promptBudget:{pack(content,{protectedParts}){const facts=content.find(p=>p.text?.startsWith('【经历与执行状态】'));assert.ok(facts);assert.ok(protectedParts.has(facts));}},
  ctx:{get:()=>({get:()=>({followup:async value=>{received=value;}})})},log:()=>{},
 };
 vm.createContext(sandbox);vm.runInContext(source.slice(source.indexOf('  function conversationExecutionHint('),source.indexOf('  /** He went quiet mid-conversation:')),sandbox);
 assert.equal(await sandbox.nudge(chat,'想和对方分享音乐','autonomy'),true);
 assert.ok(received.content.some(part=>part.text?.includes('贝斯在鼓前面进了半拍')));
 const text=received.content.map(p=>p.text||'').join('\n');assert.match(text,/音乐分享与语音合成是不同操作/);assert.match(text,/没调用不是失败/);assert.match(text,/想和对方分享音乐/);assert.match(text,/当前运行在电脑/);assert.match(text,/由你自己推进/);
});
test('media planning cannot replace user words with an invented reply',()=>{
 const intent=selectMediaIntent('你准备听啥呢',{form:'voice',confidence:.85,reason:'声音适合表达',request:'我就听你安排，你想听什么呀'});
 assert.equal(intent.request,'你准备听啥呢');assert.deepEqual(intent.kinds,['voice']);const hint=mediaIntentHint(intent);assert.match(hint,/建议，不是对方明确要求/);assert.doesNotMatch(hint,/我就听你安排/);
 const explicit=selectMediaIntent('发语音跟我说晚安');assert.match(mediaIntentHint(explicit),/明确邀请/);
});

test('reply facts retain scoped outcomes and never treat absence or an old failure as an outage',()=>{
 const now=Date.now(),scope={accountId:'a',personaId:'p',key:'private:1'};
 const row=(change={})=>({accountId:'a',personaId:'p',chat:'private:1',at:now-1000,tool:'bridge_audio',status:'returned',result:{value:{title:'真实曲目',url:'https://example.org/song',partial:true,coverage:'实际听取前十秒'}},...change});
 const hint=conversationExecutionGrounding({scope,now,rows:[row(),row({accountId:'other',result:{title:'other-account'}}),row({personaId:'other',result:{title:'other-persona'}}),row({chat:'group:2',result:{title:'other-chat'}}),row({at:now-31*60000,result:{title:'too-old'}}),row({at:now+1000,result:{title:'future'}}),row({tool:'voice.synthesis',status:'failed',error:'本次合成失败'}),row({tool:'bridge_life_share',result:{value:{ok:true,queued:true,deliveryId:'delivery-1'}}})]});
 assert.match(hint,/真实曲目/);assert.match(hint,/"partial":true/);assert.match(hint,/本次合成失败/);assert.match(hint,/"queued":true/);
 assert.doesNotMatch(hint,/other-account|other-persona|other-chat|too-old|future/);
 assert.match(hint,/没调用不是失败/);assert.match(hint,/音乐分享与语音合成是不同操作/);
 const empty=conversationExecutionGrounding({scope,now});assert.match(empty,/工具事实[^\n]*\[\]/);assert.doesNotMatch(empty,/卡住了/);
});
test('autonomous facts preserve failure and partial results without converting wishes or summaries to receipts',()=>{
 const now=Date.now(),hint=initiativeGrounding([{updatedAt:now,status:'failed',actuallyCompleted:false,scene:{activity:'听音乐'},checkpoint:{summary:'已经听完了'},evidence:[{at:now,tool:'bridge_audio',ok:false,substantive:true,coverage:'音乐好听'},{at:now,tool:'bridge_browser',ok:true,substantive:true,partial:true,coverage:'专辑页面标题'}]}],now);
 assert.match(hint,/"completed":false/);assert.match(hint,/"partial":true/);assert.doesNotMatch(hint,/已经听完了|音乐好听/);assert.match(hint,/页面文字不证明听过音频/);
});

test('mobile group awareness distinguishes disabled device control from other usable tools',()=>{
 const text=conversationExecutionGrounding({operating:{platform:'手机',chat:'group',deviceTools:false,modelTools:false}});
 assert.match(text,/当前运行在手机，这里是群聊/);assert.match(text,/设备工具总开关已关/);assert.match(text,/本轮本地模型未通过工具调用能力检测/);
});
