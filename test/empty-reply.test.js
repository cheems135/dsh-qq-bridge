import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleAssistantText,silentConversationReply,silentGroupReply} from '../group-conversation.js';
import {stripUnrequestedActions} from '../dialogue-only.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const recovery=source.slice(source.indexOf('  async function recoverEmptyDialogueReply('),source.indexOf('  async function refineDialogueReply('));
const start=source.indexOf("  ctx.on('session/event',"),end=source.indexOf('  /* ---------------- lifecycle ---------------- */',start);

function fixture({kind='private',text='',meta={},hadToolCalls=false,ask=async()=>JSON.stringify({text:'在呢，你想聊什么？'})}={}){
 const audit={id:'a',status:'queued',inputContent:'虚构的普通聊天资料，不含思考',mediaIntent:{},at:Date.now()},sent=[],issues=[],calls=[],turn={parts:text?[text]:[],visibleParts:text?[text]:[],reasoning:'PRIVATE_REASONING',meta:{kind:'user',auditId:'a',text:'在吗',inboundVersion:1,...meta},hadToolCalls};
 const chat={key:kind+':12345',kind,chatId:'12345',inboundVersion:1,turns:new Map([[1,turn]]),pendingTurns:[]},chats=new Map([['session',chat]]);
 let listener;
 const deps={chats,settings:{localChat:{enabled:false},activeAccountId:'a',realism:{}},state:{chats:{[chat.key]:{sessionId:'session',titleSynced:true}}},featureState:{generation:0},selfTest:null,stopped:false,accountPaused:false,cfg:{emptyReply:'NEVER_SEND_CONFIGURED_PLACEHOLDER'},API_CONTEXT_REVISION:'test',
  ctx:{on:(_event,fn)=>{listener=fn;}},apiModelScope:{run:(_scope,fn)=>fn()},invocationScope:()=>({}),visibleAssistantText,silentConversationReply,silentGroupReply,
  conversationScope:()=> 'same-persona-account',activePersona:()=>({id:'p'}),personaPromptText:()=> '虚构成年朋友，平常交谈',DIALOGUE_ONLY_RULE:'',CONTEXT_RULES:'',CORE_CONTEXT_RULES:'',operationContext:()=>[{role:'user',text:'刚休息下来'}],effectiveModel:()=>({provider:'test',model:'test'}),
  askModel:async(...args)=>{calls.push(args);return ask(...args);},auditById:()=>audit,auditAnswerCap:()=>6000,saveFeatures:()=>{},saveState:()=>{},log:()=>{},reportBridgeIssue:issue=>issues.push(issue),diagnosticFailure:e=>String(e?.message||e),
  extractExpressionTag:text=>({text}),stripUnrequestedActions,learningMemory:null,expressionLearning:null,learningMeta:()=>({}),restoreEffort:async()=>{},lifeExecution:null,commitmentLedger:null,
  refineDialogueReply:async(_chat,_meta,text)=>text,refineStickerReply:async(_chat,_audit,text)=>text,markReplyDelivery:()=>{},publishCompanionReaction:()=>{},shouldLookupReply:()=>false,
  sendText:(_chat,text)=>sent.push(text),messages:[],scheduleAfterthought:()=>{},scheduleSilence:()=>{},getLive2dGateway:()=>({end:()=>{}})};
 Function(...Object.keys(deps),recovery+'\n'+source.slice(start,end))(...Object.values(deps));
 return {audit,sent,issues,calls,chat,turn,chats,end:(reason={kind:'completed'})=>listener({id:'session'},{type:'turn/end',data:{turn:1,reason}})};
}

test('actual reasoning-only completion recovers text once, never exposing reasoning or the old placeholder',async()=>{
 const h=fixture();await h.end();
 assert.deepEqual(h.sent,['在呢，你想聊什么？']);assert.equal(h.calls.length,1);
 assert.equal(h.calls[0][2],1200);assert.equal(h.calls[0][5],true,'structured recovery disables DeepSeek thinking');
 assert.doesNotMatch(h.calls[0][1],/PRIVATE_REASONING/);assert.equal(h.audit.replyRecovery.status,'recovered');
 assert.equal(h.audit.answer,'在呢，你想聊什么？');assert.equal(h.issues.length,0);
});

test('ordinary text, explicit silence, group silence, already delivered and tool-only turns do not run recovery',async()=>{
 for(const options of [{text:'嗯，在这呢。'},{text:'[skip]'},{kind:'group'},{meta:{directTextSent:true}},{hadToolCalls:true}]){
  const h=fixture(options);await h.end();assert.equal(h.calls.length,0,JSON.stringify(options));
  assert.deepEqual(h.sent,options.text&&options.text!=='[skip]'?[options.text]:[]);
 }
});

test('media instructions and the existing singing request are preserved without retrying generation',async()=>{
 const media=fixture({text:'[图:窗边的小猫]'});await media.end();assert.equal(media.calls.length,0);assert.deepEqual(media.sent,['[图:窗边的小猫]']);
 const cover=fixture();cover.audit.mediaIntent.cover=true;await cover.end();assert.equal(cover.calls.length,0);assert.deepEqual(cover.sent,['[语音:唱歌]']);
});

test('failed, empty or action-bearing recovery is visible as an issue and never sent as a successful reply',async()=>{
 for(const ask of [async()=>{throw Error('provider failed');},async()=>'{"text":""}',async()=>'{"text":"[语音:重做任务]"}',async()=>'not-json']){
  const h=fixture({ask});await h.end();assert.equal(h.calls.length,1);assert.deepEqual(h.sent,[]);
  assert.equal(h.audit.status,'failed');assert.equal(h.audit.deliveryState,'withheld');assert.equal(h.audit.replyRecovery.status,'failed');assert.equal(h.issues.length,1);
 }
});

test('an explicit recovered skip remains silent and a newer incoming message cancels stale recovery',async()=>{
 const silent=fixture({ask:async()=>'{"text":"[skip]"}'});await silent.end();assert.deepEqual(silent.sent,[]);assert.equal(silent.audit.status,'silent');
 let finish;const h=fixture({ask:()=>new Promise(resolve=>{finish=resolve;})});const task=h.end();
 assert.equal(h.calls.length,1);h.chat.inboundVersion++;finish('{"text":"这条已过时"}');await task;assert.deepEqual(h.sent,[]);
});

test('an empty turn cannot retry recovery twice even if the host repeats turn end',async()=>{
 const h=fixture();await h.end();await h.end();assert.equal(h.calls.length,1);assert.equal(h.sent.length,1);
});

test('a response made entirely of unwanted stage directions is completed as dialogue, without leaking narration',async()=>{
 const h=fixture({text:'（手停在屏幕上，贴了一会儿）'});await h.end();
 assert.deepEqual(h.sent,['在呢，你想聊什么？']);assert.equal(h.calls.length,1);assert.equal(h.audit.replyRecovery.status,'recovered');
});
