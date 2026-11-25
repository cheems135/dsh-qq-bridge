import {createResidenceFeedback} from '../residence-feedback.js';
const quietResidence=createResidenceFeedback({readJson:()=>null});
import {initiativeConversationHint} from '../operation-context.js';
import {interestHint} from '../website-reading.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {selectMediaIntent,mediaIntentHint} from '../media-intent.js';
import {initiativeGrounding,conversationExecutionGrounding} from '../initiative-grounding.js';
import {createBridgeIssues} from '../bridge-issues.js';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

test('diagnostic questions use only redacted issues owned by this account, private chat and persona',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const helperStart=source.indexOf('  function recentEventsHint(');
 const helperEnd=source.indexOf("  {const web=ctx.get('webServer');",helperStart);
 const question=source.indexOf('    const diagnosticQuestion=',source.indexOf('  function enrichConversation('));
 const end=source.indexOf('    const groupReceipts=',question);
 assert.ok(helperStart>=0&&helperEnd>helperStart&&question>=0&&end>question);
 const base={accountId:'a',personaId:'p',chat:'private:1'},settings={owners:['1','2']};
 let current={...base},rows=[];
 const issues=createBridgeIssues({getRows:()=>rows,setRows:r=>rows=r});
 const run=Function('settings','bridgeIssues','recordsAllowed','invocationScope','featureState',
   source.slice(helperStart,helperEnd)+'\nreturn {reportBridgeIssue,read(chat,text,payload={}){const content=[];'+source.slice(question,end)+'return content.map(p=>p.text).join("");}};'
 )(settings,issues,()=>true,chat=>({...current,chat}),{recentEvents:[{at:Date.now(),text:'legacy-global'}]});
 const chat={kind:'private',key:base.chat,isOwner:true};
 const ask=(where=chat)=>run.read(where,'插件怎么报错了');
 assert.equal(ask(),'');
 for(const [label,scope] of [['wrong-chat',{chat:'private:2'}],['wrong-persona',{personaId:'q'}],['wrong-account',{accountId:'b'}],['panel-only',{chat:''}]]){
   run.reportBridgeIssue({id:label,message:label},{...base,...scope});
 }
 run.reportBridgeIssue({id:'matching',message:'图片任务失败 Bearer abc123'},{...base});
 rows.push({id:'legacy',at:Date.now(),accountId:'a',chat:'private:1',message:'missing-persona'});
 run.reportBridgeIssue({id:'obsolete',at:Date.now()-7*3600000,message:'stale-error'},{...base});
 const hint=ask();
 assert.match(hint,/图片任务失败/);
 assert.doesNotMatch(hint,/abc123|legacy-global|wrong-|panel-only|missing-persona|stale-error/);
 assert.equal(run.read(chat,'早上好'), '');
 assert.equal(ask({...chat,kind:'group',key:'group:1'}),'');
 assert.equal(ask({...chat,isOwner:false}),'');
 assert.match(ask({...chat,key:'private:2'}),/wrong-chat/);
 assert.doesNotMatch(ask({...chat,key:'private:2'}),/图片任务失败/);
 current={...base,personaId:'q'};
 assert.match(ask(),/wrong-persona/);
 assert.doesNotMatch(ask(),/图片任务失败/);
 assert.ok(issues.list({accountId:'a'}).some(r=>r.message==='missing-persona'));
});

test('actual API proactive reply receives protected execution facts after planning',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');let received;
 const chat={key:'private:1',kind:'private',isOwner:true,sessionId:'session',lifeOnly:true,turns:new Map()};
 const sandbox={residenceParts:(chat,options)=>quietResidence.parts({accountId:"a",personaId:"p",key:chat.key},options),chat,isDesktop:true,conversationExecutionGrounding,randomUUID:()=> 'id',stopped:false,accountPaused:false,
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
 const text=received.content.map(p=>p.text||'').join('\n');assert.doesNotMatch(text,/音乐分享与语音合成是不同操作/);assert.match(text,/没调用不是失败/);assert.match(text,/想和对方分享音乐/);assert.match(text,/当前运行在电脑/);assert.match(text,/由你自己推进/);
});
test('media planning cannot replace user words with an invented reply',()=>{
 const intent=selectMediaIntent('你准备听啥呢',{form:'voice',confidence:.85,reason:'声音适合表达',request:'我就听你安排，你想听什么呀'});
 assert.equal(intent.request,'你准备听啥呢');assert.deepEqual(intent.kinds,['voice']);const hint=mediaIntentHint(intent);assert.match(hint,/建议，不是对方明确要求/);assert.doesNotMatch(hint,/我就听你安排/);
 const explicit=selectMediaIntent('发语音跟我说晚安');assert.match(mediaIntentHint(explicit),/明确邀请/);
});

test('reply facts retain scoped outcomes and never treat absence or an old failure as an outage',()=>{
 const now=Date.now(),scope={accountId:'a',personaId:'p',key:'private:1'};
 const row=(change={})=>({accountId:'a',personaId:'p',chat:'private:1',at:now-1000,tool:'bridge_audio',status:'returned',result:{value:{title:'真实曲目',url:'https://example.org/song',partial:true,coverage:'实际听取前十秒'}},...change});
 const hint=conversationExecutionGrounding({scope,now,musicEvidence:true,rows:[row(),row({accountId:'other',result:{title:'other-account'}}),row({personaId:'other',result:{title:'other-persona'}}),row({chat:'group:2',result:{title:'other-chat'}}),row({at:now-31*60000,result:{title:'too-old'}}),row({at:now+1000,result:{title:'future'}}),row({tool:'voice.synthesis',status:'failed',error:'本次合成失败'}),row({tool:'bridge_life_share',result:{value:{ok:true,queued:true,deliveryId:'delivery-1'}}})]});
 assert.match(hint,/真实曲目/);assert.match(hint,/"partial":true/);assert.match(hint,/本次合成失败/);assert.match(hint,/"queued":true/);
 assert.doesNotMatch(hint,/other-account|other-persona|other-chat|too-old|future/);
 assert.match(hint,/没调用不是失败/);assert.match(hint,/音乐分享与语音合成是不同操作/);
 const empty=conversationExecutionGrounding({scope,now});assert.doesNotMatch(empty,/近期同一对话工具事实|实际执行依据|卡住了/);
});

test('a plain writing or correction turn gets concise conversational grounding; a structured media request retains action guidance',()=>{
 const base={operating:{platform:'电脑',chat:'private',deviceTools:true}};
 const plain=conversationExecutionGrounding(base);
 assert.match(plain,/实际回执/);assert.match(plain,/对方的纠正/);assert.match(plain,/付款须本人确认/);
 assert.doesNotMatch(plain,/歌曲|游戏|工具目录|近期同一对话工具事实|实际执行依据|\[\]/);
 const image=conversationExecutionGrounding({...base,mediaKinds:['image']});
 assert.match(image,/由你自己推进/);assert.doesNotMatch(image,/歌曲|游戏/);
 const music=conversationExecutionGrounding({...base,musicEvidence:true});
 assert.match(music,/bridge_audio/);assert.match(music,/bridge_life_share/);
 const scope={accountId:'a',personaId:'p',key:'group:1'};
 const sharedImage=conversationExecutionGrounding({...base,scope,rows:[{...scope,chat:scope.key,at:Date.now(),tool:'bridge_life_share',status:'returned',result:{file:'image.png'}}]});
 assert.match(sharedImage,/image.png/);assert.doesNotMatch(sharedImage,/音乐分享与语音合成/);
});
test('autonomous facts preserve failure and partial results without converting wishes or summaries to receipts',()=>{
 const now=Date.now(),hint=initiativeGrounding([{updatedAt:now,status:'failed',actuallyCompleted:false,scene:{activity:'听音乐'},checkpoint:{summary:'已经听完了'},evidence:[{at:now,tool:'bridge_audio',ok:false,substantive:true,coverage:'音乐好听'},{at:now,tool:'bridge_browser',ok:true,substantive:true,partial:true,coverage:'专辑页面标题'}]}],now);
 assert.match(hint,/"completed":false/);assert.match(hint,/"partial":true/);assert.doesNotMatch(hint,/已经听完了|音乐好听/);assert.match(hint,/页面文字不证明听过音频/);
});

test('mobile group awareness distinguishes disabled device control from other usable tools',()=>{
 const text=conversationExecutionGrounding({operating:{platform:'手机',chat:'group',deviceTools:false,modelTools:false}});
 assert.match(text,/当前运行在手机，这里是群聊/);assert.match(text,/设备工具总开关已关/);assert.match(text,/本轮本地模型未通过工具调用能力检测/);
});

test('a receipt remains available after a topic change without reviving its instructions',()=>{
 const scope={accountId:'a',personaId:'p',key:'private:1'},now=123456789;
 const row={...scope,chat:scope.key,tool:'bridge_audio',status:'returned',at:now-1000,result:{title:'前一个话题的曲目'}};
 const common={scope,now,operating:{platform:'电脑',chat:'private'},rows:[row]};
 const ordinary=conversationExecutionGrounding(common);
 assert.match(ordinary,/前一个话题的曲目/);
 assert.doesNotMatch(ordinary,/由你自己推进|音乐分享与语音合成/);
 assert.match(conversationExecutionGrounding({...common,musicEvidence:true}),/音乐分享与语音合成/);
 const idle=conversationExecutionGrounding({...common,proactive:true,rows:[]});
 assert.doesNotMatch(idle,/音乐分享与语音合成|游戏或作品/);
});
