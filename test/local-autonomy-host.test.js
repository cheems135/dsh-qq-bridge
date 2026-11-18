import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recentOperationContext} from '../operation-context.js';
import {currentLifeChatTurns} from '../life-conversation-context.js';

// Exercise the installed host entry itself, with external actions replaced.
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const body=source.slice(source.indexOf('  async function startLocalAutonomousTurn('),source.indexOf('  function localCurrentPersonaState('));
function setup({fail=false}={}){
 let release,captured;const gate=new Promise(r=>release=r),ended=[];
 const settings={localChat:{enabled:true},life:{execute:true},agency:{enabled:true,autonomous:true},owners:['12345']},localTurns=new Map(),chats=new Map(),socket={ready:true};
 const lifeExecution={asleep:()=>false,ended:(...v)=>ended.push(v)};
 const deps={conversationExecutionHint:()=>'',sleepAwarenessHint:()=> '【实际睡眠与离线】被动离线，已恢复连接',currentPersonaMood:()=>({}),consumeMoodHint:()=>({text:''}),apiAssistTools:()=>({}),settings,localTurns,chats,socket,lifeExecution,stopped:false,accountPaused:false,localForegroundAt:0,featureState:{revisions:{}},autonomyConfig:()=>({enabled:true}),recordsAllowed:()=>true,privateInitiativeAllowed:()=>true,pausedConversation:()=>false,inDnd:()=>false,initiativeWindow:()=>true,calendarMeta:()=>({accountId:'a',personaId:'p'}),activePersona:()=>({id:'p'}),localTurnScope:c=>({accountId:'a',personaId:'p',personaVersion:'v',key:c.key}),localScopeCurrent:()=>true,getLocalCapabilities:async()=>({busy:false,features:{tools:{supported:true}}}),qzoneEnabled:()=>false,randomUUID:()=>String(Math.random()),localTurnSignals:s=>({signal:s,close:()=>{}}),workspaceLeases:{resolve:()=>({})},agencyTools:{localTools:()=>({})},localQqTools:()=>({}),messages:[],operationContext:key=>recentOperationContext(deps.messages,{key,accountId:'a',personaId:'p',floor:Date.now()-20000}),currentLifeChatTurns,recipientIdentity:()=> '当前收件人是测试号主',personaPromptText:()=> '角色',CONTEXT_RULES:'context',CORE_CONTEXT_RULES:'core',LIFE_EXECUTION_RULES:'life',QZONE_DAILY_CUE:'qzone',briefLifeJob:j=>j,withClock:t=>t,currentScheduleScope:()=>({}),promptPreferences:{snapshot:()=>({values:{}})},serviceMediaScope:{run:(_s,fn)=>fn()},recordInvocation:()=>{},reportBridgeIssue:()=>{},executeLocalAutonomy:async args=>{captured=args;await gate;await args.finish(fail?'failed':'completed');if(fail)throw Error('测试工具失败');},runWithHostTools:()=>{throw Error('unexpected live tool call');},runScheduledTool:(_k,_n,_a,execute)=>execute(),prepareLocalReply:t=>t,splitBursts:t=>[t],queueOutgoing:()=> 'outbox',validateLocalAttachment:a=>a,pathToFileURL:f=>({href:f})};
 const start=new Function(...Object.keys(deps),body+';return startLocalAutonomousTurn;')(...Object.values(deps));
 const chat={key:'private:12345',kind:'private',userId:'12345',chatId:'12345',isOwner:true};
 return {messages:deps.messages,start,chat,settings,localTurns,chats,lifeExecution,ended,release,get captured(){return captured;}};
}
test('real host starts a local proactive job without a cloud session or fake incoming message',async()=>{
 const h=setup();assert.equal(await h.start(h.chat,'自己的活动','life',{lifeJob:{id:'job'}}),true);
 const active=h.localTurns.get(h.chat.key);assert.equal(active.autonomous,true);assert.equal(active.localContext.meta.kind,'proactive');assert.equal(active.localContext.meta.userWords,'');assert.equal(active.localContext.meta.lifeJobId,'job');assert.equal(h.captured.context.turnContext.autonomyId,active.deliveryKey);assert.match(h.captured.context.cue,/被动离线，已恢复连接/);
 h.release();await active.promise;assert.equal(h.localTurns.size,0);assert.equal(h.chats.size,0);assert.equal(h.ended[0][2],'completed');
});
test('actual-task switch and sleep gate prevent the real host entry from starting',async()=>{
 for(const kind of ['off','sleep','api']){const h=setup();if(kind==='off')h.settings.life.execute=false;if(kind==='sleep')h.lifeExecution.asleep=()=>true;if(kind==='api')h.settings.localChat.enabled=false;assert.equal(await h.start(h.chat,'活动','life'),false);assert.equal(h.localTurns.size,0);assert.equal(h.captured,undefined);h.release();}
});
test('cancelled local host context cannot execute a later tool step',async()=>{
 const h=setup();await h.start(h.chat,'活动','idle-activity');const active=h.localTurns.get(h.chat.key);active.controller.abort();assert.throws(()=>h.captured.assertCurrent(),/已暂停/);h.release();await active.promise;
});

test('a failed autonomous task is finalized once rather than counted twice by the host',async()=>{
 const h=setup({fail:true});await h.start(h.chat,'活动','life',{lifeJob:{id:'job'}});const task=h.localTurns.get(h.chat.key);h.release();await task.promise;assert.equal(h.ended.length,1);assert.equal(h.ended[0][2],'failed');
});

test('scheduled local history uses current recipient scope, clear boundary and complete recent words',async()=>{
 const h=setup(),now=Date.now();h.messages.push({chat:h.chat.key,accountId:'a',personaId:'p',time:now-30000,dir:'in',text:'已经清除的旧话题'},{chat:h.chat.key,accountId:'a',personaId:'p',time:now-2,dir:'in',text:'这句的前半部分'.repeat(35)+'当前关键要求：不要再概括文章'},{chat:h.chat.key,accountId:'a',personaId:'p',time:now-1,dir:'out',text:'尚未送达的草稿',delivery:'queued'},{chat:'private:99999',accountId:'a',personaId:'p',time:now,dir:'in',text:'其他人的私聊'});
 await h.start(h.chat,'继续任务','life',{lifeJob:{id:'job'}});assert.equal(h.captured.context.history.length,1);assert.match(h.captured.context.history[0].content,/当前关键要求/);assert.equal(h.captured.context.recipient,'当前收件人是测试号主');const active=h.localTurns.get(h.chat.key);h.release();await active.promise;
});
