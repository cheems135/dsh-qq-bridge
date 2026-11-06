import {applyNonpaymentPolicy,nonpaymentOpen} from '../nonpayment-policy.js';
import {applyLocalPortraitPlan,resolveLocalPhotoSubject} from '../local-portrait-plan.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import {personaStateId,sharedPersonaOutfit,personaStateHint,alignOutfitReply} from '../local-persona-state.js';
import {calendarNow} from '../life-memory.js';
import {localDailyDiaryInput} from '../daily-journal.js';
import {createLocalInitiative} from '../local-initiative.js';
import {speakerIdentity} from '../contact-policy.js';
import {groupTurnHint} from '../group-conversation.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {validateLocalAttachment} from '../local-config.js';
import {cleanLocalReply} from '../local-reply.js';
import {prepareLocalReply} from '../local-repetition.js';
import {naturalBubbleParts} from '../chat-bubbles.js';
import {localImageRequest} from '../media-intent.js';
import {removeStreamedPrefix} from '../local-fast-chat.js';
import {unresolvedLocalReceipts} from '../bridge-issues.js';
import {createInvocationJournal} from '../invocation-journal.js';
import {createLocalGroupWindow} from '../local-group-window.js';
import {localIssueReply} from '../local-issue-reply.js';
import {personaWaitStyle,cleanWaitNotice,fallbackWaitNotice} from '../local-wait-notice.js';
import {localSharedContext,localAnalysisInput} from '../local-chat-context.js';
import {moodState,moodDelivery,shouldJudgeMood,applyMood,consumeMoodHint} from '../companion-mood.js';
import {conversationStep,conversationHint} from '../conversation-care.js';
import {memeKnowledgeHint} from '../meme-knowledge.js';
import {localMediaPlanningCandidate} from '../local-media-planner.js';
import {resolveLocalMediaTask} from '../local-media-task.js';
import {localRequirements,chooseLocalRoute,waitForLocalRoute} from '../local-routing.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const localSource=source.slice(source.indexOf('  function localTurnScope(chat)'),source.indexOf('\n  async function handlePayloadCore('));
const inboundSource=source.slice(source.indexOf('  function handlePayload(payload,'),source.indexOf('\n  async function drainInbox('));
assert.ok(localSource.length>1000&&inboundSource.length>1000);

function setup(){
  const queued=[],logged=[],calls=[],issues=[];
  const sandbox={nonpaymentOpen,createLocalInitiative,localDailyDiaryInput,serviceMediaScope:new AsyncLocalStorage(),localQqTools:()=>({}),personaStateId,sharedPersonaOutfit,personaStateHint,alignOutfitReply,calendarNow,isLoopbackUrl:()=>true,resolveLocalPhotoSubject,applyLocalPortraitPlan,localMediaPlanningCandidate,pauseLocalGroupWindow:()=>()=>{},resolveLocalMediaTask,unresolvedLocalReceipts,invocationScope:(chat,auditId)=>({accountId:sandbox.settings.activeAccountId,personaId:sandbox.persona.id,chat,auditId}),reportBridgeIssue:(event,scope)=>issues.push({...event,...scope}),localRequirements,chooseLocalRoute,waitForLocalRoute,localImageRequest,removeStreamedPrefix,localIssueReply,fallbackWaitNotice,personaWaitStyle,cleanWaitNotice,Buffer,AbortController,AbortSignal,Date,console,randomUUID,pathToFileURL,cleanLocalReply,prepareLocalReply,localSharedContext,localAnalysisInput,moodDelivery,shouldJudgeMood,applyMood,
    splitBursts:(value,limit,options)=>naturalBubbleParts(value,options),replyCharLimit:()=>2000,
    settings:{activeAccountId:'a',presetPrompts:{p:'角色设定'},basePersona:'完整系统提示词',memory:{enabled:false},localChat:{enabled:true,baseUrl:'http://127.0.0.1:8777'},owners:['12345'],reliability:{}},
    persona:{id:'p'},version:'v1',featureState:{floors:{},inbox:[],outbox:[],audits:[]},memories:{},messages:[],memoryHub:null,localTurns:new Map(),stopped:false,accountPaused:false,
    state:{chats:{}},ctx:{sessionController:{cancel:()=>{}}},
    soul:{mood:moodState()},soulFor:()=>sandbox.soul,
    enrichConversation:()=>{},prepareCalendarContext:async()=>{},
    segmentsOf:parts=>Array.isArray(parts)?parts:[],transcribeRecord:async()=>'',
    auditForTurn:()=>{const audit={id:randomUUID(),accountId:'a',persona:'p'};sandbox.featureState.audits||=[];sandbox.featureState.audits.push(audit);return audit;},auditAnswerCap:()=>20000,
    extractExpressionTag:text=>({text,emotion:''}),publishCompanionReaction:()=>{},reflectOnTurn:async()=>{},
    learningMemory:null,memeStudy:null,expressionLearning:null,learningMeta:key=>({key,accountId:sandbox.settings.activeAccountId,personaId:sandbox.persona.id}),
    activePersona:()=>sandbox.persona,photoPromptPlan:text=>({prompt:text,humanRequest:text}),personaContextIdentity:()=>sandbox.version,effectiveModel:()=> 'api-model',
    textHash:v=>createHash('sha256').update(v).digest('hex'),
    log:()=>{},readPresetPrompt:()=>'',logMessage:row=>{logged.push(row);sandbox.messages.push(row);},
    queueOutgoing:(chat,segments)=>{queued.push({chat,segments});return 'queued';},validateLocalAttachment,localReplyDelay:()=>0,localErrorDetail:error=>error.message,
    sleepingPayload:()=>false,incomingAllowed:()=>true,saveState:()=>{},saveFeatures:()=>{},
    extractIncoming:segments=>({text:segments.filter(s=>s.type==='text').map(s=>s.data.text).join('')}),
    fetch:async(url,options)=>{calls.push({url,options,body:JSON.parse(options.body)});return Response.json({text:'最后答复',attachments:[],receipts:[]});},
    handlePayloadCore:()=>{throw Error('unexpected cloud path');},
  };
  sandbox.requestLocalJson=async(url,options)=>{if(url.endsWith('/v1/local/priority'))return {ok:true,status:200,body:{ok:true}};const response=await sandbox.fetch(url,{...options,body:JSON.stringify(options.body)});return {ok:response.ok,status:response.status,body:await response.json()};};
  sandbox.invocationJournal=createInvocationJournal({getRows:()=>sandbox.featureState.invocations||[],setRows:rows=>sandbox.featureState.invocations=rows});
  vm.createContext(sandbox);
  const invocationSource=source.slice(source.indexOf('  function recordInvocation(event,scope)'),source.indexOf('\n  function invocationScope('));
  vm.runInContext(localSource+'\n'+inboundSource+'\n'+invocationSource+'\nthis.review={handleLocalChatTurn,abortLocalTurn,handlePayload,askConversationAnalysis,routeLocalTurn,runLocalInitiativeTick,localInitiativeContext,prioritizeLocalQq};',sandbox);
  sandbox.getLocalCapabilities=async()=>({status:'ready',contextWindow:4096,maxOutputTokens:512,features:Object.fromEntries(['text','json','tools','vision','asr','speech','image','video'].map(key=>[key,{supported:true}]))});
  return {sandbox,queued,logged,calls,issues,...sandbox.review,chat:{key:'private:12345',kind:'private',isOwner:true,chatId:'12345',userId:'12345',incomingImages:[]}};
}

test('actual bridge function preserves account/persona/chat scope and current input appears once',async()=>{
  const h=setup(),time=Date.now()-1000;
  h.sandbox.messages.push(
    {chat:h.chat.key,accountId:'a',personaId:'p',time,dir:'in',text:'有效历史'},
    {chat:h.chat.key,accountId:'b',personaId:'p',time,dir:'in',text:'其他账号'},
    {chat:h.chat.key,accountId:'a',personaId:'q',time,dir:'in',text:'其他人设'},
    {chat:'private:67890',accountId:'a',personaId:'p',time,dir:'in',text:'其他联系人'});
  await h.handleLocalChatTurn(h.chat,'本条请求',false,{message_id:1});
  const rows=h.calls[0].body.messages;
  assert.equal(rows.filter(r=>r.content==='本条请求').length,1);
  assert.ok(rows.some(r=>r.content==='有效历史'));
  assert.ok(!rows.some(r=>/其他账号|其他人设|其他联系人/.test(r.content)));
  assert.equal(h.logged.filter(r=>r.text==='本条请求').length,1);
  assert.equal(h.queued.length,1);
  assert.ok(h.queued[0].chat.deliveryKey);
});

test('actual private and group bridge turns share only current outfit and preserve the same color',async()=>{
 const h=setup(),time=Date.now()-1000;
 Object.assign(h.sandbox,{speakerIdentity,groupTurnHint,groupTranscriptLines:()=>''});
 h.sandbox.messages.push({chat:h.chat.key,accountId:'a',personaId:'p',time,dir:'in',text:'你衣服什么颜色？'},{chat:h.chat.key,accountId:'a',personaId:'p',time:time+1,dir:'out',delivery:'sent',text:'白色呀。'});
 h.sandbox.fetch=async(url,options)=>{h.calls.push({url,options,body:JSON.parse(options.body)});return Response.json({text:'蓝色的衣服呀。',attachments:[],receipts:[]});};
 const group={...h.chat,key:'group:67890',kind:'group',isOwner:false,chatId:'67890'};
 await h.handleLocalChatTurn(group,'你衣服什么颜色？',false,{message_id:710,user_id:'55555',sender:{nickname:'群友'}});
 assert.match(h.queued.at(-1).segments[0].data.text,/白色/);assert.doesNotMatch(h.queued.at(-1).segments[0].data.text,/蓝色/);
 const ctx=h.calls.at(-1).body;assert.equal(ctx.turnContext.personaState.outfit,'白色的衣服');assert.equal(ctx.turnContext.groupSpeaker.id,'55555');assert.equal(ctx.messages.filter(m=>m.role==='user').length,1);
 assert.doesNotMatch(JSON.stringify(ctx.messages),/最近私聊|私聊原文/);
});

test('actual local initiative adapter uses background inference and the same reliable QQ outbox without a host API session',async()=>{
 const h=setup(),s=h.sandbox;
 Object.assign(s,{autonomyConfig:()=>({enabled:true,initiate:true}),effectiveUsers:()=>['12345'],privateInitiativeAllowed:()=>true,calendarRole:()=>({meta:{}}),socket:{ready:true},recordsAllowed:()=>true,pausedConversation:()=>false,featureProfile:()=>({}),inDnd:()=>false,initiativeWindow:()=>true,lifeExecution:null,lifeMemory:null,personaPromptText:()=> '角色风格'});
 s.messages.push({chat:h.chat.key,accountId:'a',personaId:'p',time:Date.now()-2*3600000,dir:'in',text:'最近在学摄影。'});
 s.requestLocalJson=async(url,options={})=>{
  h.calls.push({url,body:options.body});
  if(url.endsWith('/capabilities'))return {ok:true,body:{status:'ready',contextWindow:4096,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}}};
  assert.match(url,/127\.0\.0\.1:8777\/v1\/chat\/completions$/);assert.equal(options.body.analysis,true);
  return {ok:true,body:{choices:[{message:{content:'{"speak":true,"text":"刚想到，你那张逆光照片可以试试保留轮廓光。"}'}}]}};
 };
 const result=await h.runLocalInitiativeTick();assert.equal(result.status,'queued');assert.equal(h.queued.length,1);assert.equal(h.queued[0].chat.turnKind,'proactive');assert.match(h.queued[0].chat.deliveryKey,/^local:initiative:/);assert.equal(h.logged.length,0,'no invented inbound user row');
 assert.equal(s.featureState.invocations.at(-1).result.decision,'queued');assert.equal(s.featureState.invocations.at(-1).backend,'local');
 s.settings.permissionsMode='configured';s.settings.localChat.initiativeEnabled=false;const count=h.calls.length;assert.equal((await h.runLocalInitiativeTick()).status,'waiting');assert.equal(h.calls.length,count);
});

test('an incoming QQ priority reservation cancels a queued local initiative but preserves a normal reply',()=>{
 const h=setup(),s=h.sandbox;
 s.featureState.outbox.push({deliveryKey:'local:initiative:example',status:'queued'},{deliveryKey:'local:normal',status:'queued'});h.prioritizeLocalQq();
 assert.equal(s.featureState.outbox[0].status,'cancelled');assert.equal(s.featureState.outbox[1].status,'queued');
});

test('actual QQ turns apply a later wardrobe schedule to both prompt state and corrected output',async()=>{
 const h=setup(),s=h.sandbox,day=calendarNow(Date.now(),'Asia/Shanghai').day;
 let scene={date:day,phase:'morning',start:'09:00',outfit:'白色衬衫'};
 s.lifeMemory={lifeScene:()=>scene};s.calendarRole=()=>({meta:{}});s.speakerIdentity=()=> '当前群友';s.groupTurnHint=()=>'';s.groupTranscriptLines=()=>'';
 s.fetch=async(url,options)=>{h.calls.push({url,body:JSON.parse(options.body)});return Response.json({text:'我的衣服是粉色的，旁边是蓝色窗帘。',attachments:[],receipts:[]});};
 await h.handleLocalChatTurn(h.chat,'你衣服什么颜色？',false,{message_id:751});assert.match(h.queued.at(-1).segments[0].data.text,/白色/);
 scene={...scene,phase:'afternoon',start:'14:00',outfit:'黑色卫衣'};
 await h.handleLocalChatTurn({...h.chat,key:'group:67890',kind:'group',isOwner:false,chatId:'67890'},'你衣服什么颜色？',false,{message_id:752,user_id:'55555'});
 assert.equal(h.calls.at(-1).body.turnContext.personaState.outfit,'黑色卫衣');assert.equal(h.queued.at(-1).segments[0].data.text,'我的衣服是黑色的，旁边是蓝色窗帘。');
});

test('actual QQ routing resolves a media followup before capability admission and keeps its image plan',async()=>{
 const h=setup(),now=Date.now()-1000;h.sandbox.messages.push({chat:h.chat.key,accountId:'a',personaId:'p',time:now,dir:'in',text:'生成一张窗边绿植的图片'});
 let requirements;h.sandbox.waitForLocalRoute=async options=>{requirements=options.requirements;return {snapshot:await options.getSnapshot(),decision:{target:'local',reason:'本地'}};};
 await h.routeLocalTurn(h.chat,'再发一遍嘛',false,{message_id:406});assert.equal(requirements.image,true);assert.match(h.calls[0].body.turnContext.imagePlan.prompt,/窗边绿植/);assert.equal(h.calls[0].body.messages.at(-1).content,'再发一遍嘛');
 const isolated=setup();isolated.sandbox.messages.push({chat:isolated.chat.key,accountId:'other',personaId:'p',time:now,dir:'in',text:'生成一张图片'});await isolated.handleLocalChatTurn(isolated.chat,'再发一遍嘛',false,{message_id:407});assert.equal(isolated.calls[0].body.turnContext.imagePlan,null);
});

test('allowed group messages use the local gateway, retain speaker identity and never bind owner tools',async()=>{
 const h=setup();h.sandbox.speakerIdentity=()=> '当前说话者：测试成员';h.sandbox.groupTurnHint=()=>'';h.sandbox.groupTranscriptLines=()=> '测试群聊背景';h.sandbox.agencyTools={localTools:()=>{throw Error('group cannot bind owner device tools');}};
 const chat={...h.chat,key:'group:test',kind:'group',isOwner:false};
 await h.routeLocalTurn(chat,'你好',false,{message_id:500,user_id:'test-member'});
 assert.equal(h.calls.length,1);assert.equal(h.queued.length,1);assert.ok(h.calls[0].body.messages.some(m=>m.content.includes('当前说话者：测试成员')));assert.equal(h.logged[0].chat,'group:test');
});

test('actual local group routing pauses the activation clock across capability checks and generation, then resumes once',async()=>{
 const h=setup(),s=h.sandbox;let time=0,respond,started;const ready=new Promise(r=>started=r),window=createLocalGroupWindow({now:()=>time});window.activate('scope');
 s.pauseLocalGroupWindow=()=>window.pause('scope');s.speakerIdentity=()=> '群友';s.groupTurnHint=()=>'';s.groupTranscriptLines=()=>'';
 s.fetch=async()=>{started();return new Promise(r=>respond=r);};
 const pending=h.routeLocalTurn({...h.chat,key:'group:test',chatId:'test',kind:'group',isOwner:false},'你好',false,{message_id:409,user_id:'member'});await ready;
 time=300000;assert.equal(window.snapshot('scope').remainingMs,120000);assert.equal(window.snapshot('scope').paused,true);respond(Response.json({text:'你好呀。',attachments:[],receipts:[]}));await pending;
 assert.equal(window.snapshot('scope').paused,false);assert.equal(window.snapshot('scope').remainingMs,120000);time+=119999;assert.equal(window.active('scope'),true);time++;assert.equal(window.active('scope'),false);
});
test('unavailable local tools and media return an explanation without submitting an API turn',async()=>{
 const h=setup();const capabilities=await h.sandbox.getLocalCapabilities();capabilities.features.image={supported:false,reason:'尚未登记图片工作流'};h.sandbox.getLocalCapabilities=async()=>capabilities;
 assert.equal(await h.routeLocalTurn(h.chat,'生成一张图片',false,{message_id:501}),true);assert.equal(h.calls.length,0);assert.equal(h.queued.length,0);assert.match(h.issues[0].message,/尚未登记图片工作流/);
 assert.equal(await h.routeLocalTurn({...h.chat,isOwner:false},'搜索一下B站',false,{message_id:502}),true);assert.equal(h.calls.length,0);
 h.sandbox.settings.localChat.enabled=false;assert.equal(await h.routeLocalTurn(h.chat,'你好',false,{}),false);assert.equal(h.calls.length,0);
});
test('stop during capability detection suppresses the pending conversation',async()=>{
 const h=setup();let resume;const capabilities=await h.sandbox.getLocalCapabilities();h.sandbox.getLocalCapabilities=()=>new Promise(resolve=>resume=resolve);
 const pending=h.routeLocalTurn(h.chat,'你好',false,{message_id:503});await Promise.resolve();h.sandbox.cancelLocalCommandWork(h.chat.key,null,false);resume(capabilities);assert.equal(await pending,true);assert.equal(h.calls.length,0);assert.equal(h.queued.length,0);
});
test('foreground complement hands unsupported requests to the existing API route only when enabled',async()=>{
 const h=setup(),capabilities=await h.sandbox.getLocalCapabilities();capabilities.features.native={supported:false,reason:'本地未接入终端'};h.sandbox.getLocalCapabilities=async()=>capabilities;h.sandbox.settings.localChat.apiComplement=true;const payload={message_id:504};assert.equal(await h.routeLocalTurn(h.chat,'用终端执行命令',false,payload),false);assert.equal(payload._bridgeApiComplement,true);assert.equal(h.calls.length,0);assert.equal(h.queued.length,0);
});

test('foreground busy admission waits with one scoped notice and then dispatches once locally',async()=>{
 const h=setup(),s=h.sandbox;let checks=0,time=0;
 const capabilities=await s.getLocalCapabilities();s.settings.localChat.apiComplement=true;
 s.getLocalCapabilities=async()=>{checks++;assert.equal(h.calls.length,0);return {...capabilities,busy:checks<=10};};
 s.waitForLocalRoute=options=>waitForLocalRoute({...options,now:()=>time,sleep:async ms=>time+=ms});
 await h.routeLocalTurn(h.chat,'今天有什么想聊的',false,{message_id:505});
 assert.equal(checks,11);assert.equal(h.calls.length,1);assert.equal(h.queued.length,2);assert.match(h.queued[0].chat.deliveryKey,/local:queue:/);assert.match(h.queued[0].segments[0].data.text,/任务/);assert.equal(s.localTurns.size,0);assert.equal(s.featureState.localWaitNotices.length,1);
});

test('in-flight cancellation suppresses final output even when backend resolves late',async()=>{
  const h=setup();let resolve;
  h.sandbox.fetch=async()=>new Promise(r=>{resolve=r;});
  const pending=h.handleLocalChatTurn(h.chat,'慢任务',false,{message_id:2});
  await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.abortLocalTurn(h.chat.key),true);
  resolve(Response.json({text:'过期结果'}));
  await pending;
  assert.equal(h.queued.length,0);
});

test('switching account before completion suppresses old output',async()=>{
  const h=setup();let resolve;
  h.sandbox.fetch=async()=>new Promise(r=>{resolve=r;});
  const pending=h.handleLocalChatTurn(h.chat,'慢任务',false,{message_id:3});
  await Promise.resolve();
  await new Promise(resolve=>setImmediate(resolve));
  h.sandbox.settings.activeAccountId='b';
  resolve(Response.json({text:'旧账号结果'}));
  await pending;
  assert.equal(h.queued.length,0);
});

test('/new clears the local context floor and replaying the same command does nothing',async()=>{
  const h=setup();
  const command={post_type:'message',message_type:'private',self_id:99999,user_id:12345,message_id:11,message:[{type:'text',data:{text:'/new'}}]};
  h.handlePayload(command);
  assert.ok(h.sandbox.featureState.floors[h.chat.key]>0,'local history must have a reset cutoff');
  const count=h.queued.length,logged=h.logged.length;
  h.handlePayload(command);
  assert.equal(h.queued.length,count,'replayed reset must not send a second acknowledgement');
  assert.equal(h.logged.length,logged,'replayed reset must not add duplicate history');
});

test('/stop cancels queued messages that arrived before the command',async()=>{
  const h=setup();
  h.sandbox.featureState.inbox.push({id:'old',key:h.chat.key,at:Date.now()-1000,status:'queued'});
  h.handlePayload({post_type:'message',message_type:'private',self_id:99999,user_id:12345,message_id:12,message:[{type:'text',data:{text:'/stop'}}]});
  assert.notEqual(h.sandbox.featureState.inbox[0].status,'queued');
});

test('voice/video and text use separate reliable delivery parts with proper file URIs',async()=>{
  const directory=mkdtempSync(new URL('./bridge-media-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
  try{
    const speech=join(directory,'voice.wav'),video=join(directory,'video.mp4');
    writeFileSync(speech,'RIFF0000WAVEfmt ');writeFileSync(video,'0000ftypisom');
    const h=setup();
    h.sandbox.fetch=async()=>Response.json({text:'已生成',attachments:[{kind:'speech',file:speech},{kind:'video',file:video}]});
    await h.handleLocalChatTurn(h.chat,'说一句，再生成视频',false,{message_id:40});
    assert.equal(h.queued.length,3);
    assert.deepEqual(h.queued.map(x=>x.segments[0].type),['record','video','text']);
    assert.equal(new Set(h.queued.map(x=>x.chat.deliveryKey)).size,3);
    assert.ok(h.queued.slice(0,2).every(x=>x.segments[0].data.file.startsWith('file:///')));
    assert.equal(h.sandbox.localTurns.size,0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('terminal voice queues audio once and keeps its transcript out of the QQ payload',async()=>{
  const directory=mkdtempSync(new URL('./bridge-voice-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
  try{
    const speech=join(directory,'voice.wav');writeFileSync(speech,'RIFF0000WAVEfmt ');
    const h=setup();h.sandbox.fetch=async()=>Response.json({text:'',spokenText:'连接成功。',attachments:[{kind:'speech',file:speech}]});
    await h.handleLocalChatTurn(h.chat,'语音测试',false,{message_id:41});
    assert.equal(h.queued.length,1);assert.equal(h.queued[0].segments[0].type,'record');assert.equal(h.queued[0].chat.localTranscript,'连接成功。');assert.equal(h.queued[0].segments.some(s=>s.type==='text'),false);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('local runtime and media errors stay in the bridge panel with no technical QQ reply',async()=>{
 const h=setup();h.sandbox.fetch=async()=>Response.json({error:{message:'VoiceLab synthesis interrupted'}},{status:500});
 await h.handleLocalChatTurn(h.chat,'语音说句话',false,{message_id:401});assert.equal(h.queued.length,0);assert.equal(h.issues.length,1);assert.match(h.issues[0].message,/VoiceLab synthesis interrupted/);
 const media=setup();media.sandbox.fetch=async()=>Response.json({text:'这是模型生成的技术报错',attachments:[],receipts:[{invocationId:'failed-speech',tool:'speech',ok:false,error:'VoiceLab incomplete'}]});
 await media.handleLocalChatTurn(media.chat,'语音说句话',false,{message_id:402});assert.equal(media.queued.length,0);assert.equal(media.issues.length,1);assert.match(media.issues[0].message,/VoiceLab incomplete/);
});

test('a partial media failure preserves the successful attachment and reports only to the panel',async()=>{
 const directory=mkdtempSync(new URL('./bridge-partial-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
 try{const image=join(directory,'image.png');writeFileSync(image,Buffer.from('89504e470d0a1a0a','hex'));const h=setup();h.sandbox.fetch=async()=>Response.json({text:'语音合成失败',attachments:[{kind:'image',file:image}],receipts:[{tool:'image',ok:true},{tool:'speech',ok:false,error:'incomplete voice',invocationId:'speech-1'}]});await h.handleLocalChatTurn(h.chat,'画图并用语音介绍',false,{message_id:403});assert.equal(h.queued.length,1);assert.equal(h.queued[0].segments[0].type,'image');assert.equal(h.issues.length,1);assert.equal(h.issues[0].id,'local:speech-1');}finally{rmSync(directory,{recursive:true,force:true});}
});

test('owner local turn binds existing host tools to its exact account and persona turn',async()=>{
  const h=setup();let bound;
  h.sandbox.settings.agency={enabled:true};h.sandbox.featureState.revisions={};
  h.sandbox.workspaceLeases={resolve:()=>null};
  h.sandbox.agencyTools={localTools:context=>{bound=context;return {bridge_tools:{execute:async()=>({ok:true})}};}};
  h.sandbox.runWithHostTools=async input=>{
    assert.ok(input.tools.bridge_tools);assert.equal(input.messages.at(-1).content,'读一下网页');
    assert.equal(bound.accountId,'a');assert.equal(bound.personaId,'p');assert.equal(bound.key,h.chat.key);
    assert.equal(bound.localTurn,true);assert.equal(bound.meta.userWords,'读一下网页');
    assert.equal(h.sandbox.localTurns.get(h.chat.key).localContext,bound);
    return {ok:true,status:200,body:{text:'读到了实际内容。',attachments:[]}};
  };
  await h.handleLocalChatTurn(h.chat,'读一下网页',false,{message_id:42});
  assert.equal(h.queued.length,1);assert.equal(h.queued[0].segments[0].data.text,'读到了实际内容。');assert.equal(h.sandbox.localTurns.size,0);
});

test('local dialogue cleans wrappers and sends each intentional line in order with distinct delivery keys',async()=>{
  const h=setup();h.sandbox.fetch=async()=>Response.json({text:'*她轻轻笑了笑*\n“今天很好呀。”\n“你呢？😊”'});
  await h.handleLocalChatTurn(h.chat,'今天怎么样？',false,{message_id:81});
  assert.deepEqual(h.queued.map(x=>x.segments[0].data.text),['今天很好呀。','你呢？😊']);
  assert.equal(new Set(h.queued.map(x=>x.chat.deliveryKey)).size,2);
  assert.ok(h.queued[0].chat.deliveryKey.endsWith(':part:0'));
  assert.ok(h.queued[1].chat.deliveryKey.endsWith(':part:1'));
});

test('local code and lists retain their layout inside a single QQ message',async()=>{
  const h=setup(),text='```js\nconst hello = "world";\nconsole.log(hello);\n```';
  h.sandbox.fetch=async()=>Response.json({text});
  await h.handleLocalChatTurn(h.chat,'给我代码',false,{message_id:82});
  assert.equal(h.queued.length,1);assert.equal(h.queued[0].segments[0].data.text,text);
});

test('local image input resolves full OneBot image data and keeps the question with actual image bytes',async()=>{
  const h=setup();let resolved;
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
  h.chat.incomingImageData=[{file:'qq-image-id',url:'https://qq.invalid/image',file_id:'123'}];
  h.sandbox.readImageBytes=async data=>{resolved=data;return png;};
  await h.handleLocalChatTurn(h.chat,'这是什么颜色？',true,{message_id:83});
  assert.equal(resolved.file_id,'123');
  const parts=h.calls[0].body.messages.at(-1).content;
  assert.equal(parts[0].text,'这是什么颜色？');assert.match(parts[1].image_url.url,/^data:image\/png;base64,/);
});

test('failed QQ image resolution is disclosed to the local model instead of silently dropping the image',async()=>{
  const h=setup();h.chat.incomingImages=['bad-id'];h.sandbox.readImageBytes=async()=>{throw Error('download failed');};
  await h.handleLocalChatTurn(h.chat,'看图片',true,{message_id:84});
  assert.match(JSON.stringify(h.calls[0].body.messages.at(-1).content),/不可猜测/);
});

test('automatic local context resets preserve records and resume from the current turn on the next request',async()=>{
 const h=setup(),receivedAt=Date.now()-100;
 h.sandbox.messages.push({chat:h.chat.key,accountId:'a',personaId:'p',time:receivedAt-10000,dir:'in',text:'应退出上下文的旧消息'});
 h.sandbox.fetch=async()=>Response.json({text:'现在可以继续了。',context:{reset:true}});
 await h.handleLocalChatTurn(h.chat,'当前保留问题',false,{message_id:91,_bridgeReceivedAt:receivedAt});
 assert.equal(Object.keys(h.sandbox.featureState.localContextFloors).length,1);assert.ok(h.sandbox.messages.some(row=>row.text==='应退出上下文的旧消息'));
 h.sandbox.fetch=async(url,options)=>{h.calls.push({body:JSON.parse(options.body)});return Response.json({text:'下一个回答。'});};
 await h.handleLocalChatTurn(h.chat,'下一个问题',false,{message_id:92});
 const rows=h.calls.at(-1).body.messages;assert.ok(!rows.some(row=>row.content==='应退出上下文的旧消息'));assert.ok(rows.some(row=>row.content==='当前保留问题'));
});

test('real shared API enrichment, recall and mood feedback run through the local bridge with one gateway request',async()=>{
 const h=setup(),s=h.sandbox,usage=[],outcomes=[],observed=[];let recalls=0,cloudCalls=0;
 h.chat.isOwner=true;Object.assign(s.settings,{memory:{enabled:true,maxChars:500},companion:{enabled:true},websites:{learning:true},mood:{enabled:true},realism:{enabled:false}});
 Object.assign(s,{conversationStep,conversationHint,consumeMoodHint,memeKnowledgeHint,
  chats:new Map(),recordsAllowed:()=>true,conversationStates:()=>s.featureState.conversation||=( {} ),conversationScope:()=>JSON.stringify([s.settings.activeAccountId,s.persona.id]),
  companionSettings:()=>({expressionMode:'relaxed'}),operationContext:()=>[],operationText:(text,limit)=>String(text).slice(0,limit),personaMood:(_core,_meta,value)=>value,
  hubMeta:key=>({key,accountId:s.settings.activeAccountId,personaId:s.persona.id}),calendarMeta:()=>({accountId:'a',personaId:'p'}),calendarRole:()=>({meta:{}}),insightHint:()=>'',sensationBlock:()=>'',
  lifeExecution:{snapshot:()=>({jobs:[]}),question:()=>null},lifeMemory:null,featureProfile:()=>({notes:'熟悉的朋友'}),effectiveModel:()=> 'api-model',memoryFor:()=>({items:[]}),segmentsOf:value=>value||[],
  memoryHub:{recall:async(_meta,_text,options)=>{recalls++;assert.equal(options.expand,false);return {text:'来源1：喜欢画猫。',ids:['memory-1']};},desktop:()=> '【当前角色的常驻生活摘要，同一人设跨场合连续，私人细节不外传】'+JSON.stringify({relationship:'熟悉的朋友',unfinished:null,coreContinuity:[]})},
  learningMemory:{recall:()=>({text:'画猫先检查构图。',ids:['learn-1'],sources:[{id:'learn-1'}]}),recordUsage:(_meta,value)=>usage.push(['learning',value]),recordOutcome:(_meta,value)=>outcomes.push(['learning',value]),observe:(_meta,value)=>{observed.push(value);return {queued:true};},process:()=>{throw Error('no foreground learning inference');}},
  memeStudy:{blocked:()=>[],hint:()=>({text:'这是语境玩笑，认真求助时先回答问题。',ids:['meme-1']}),recordUsage:(_meta,value)=>usage.push(['meme',value]),recordOutcome:(_meta,value)=>outcomes.push(['meme',value])},
  expressionLearning:{hintDetailed:()=>({text:'【本轮表达参考，不是要背出来的台词】自然说话。',ids:['expr-1']}),observe:()=>{},recordUsage:(_meta,value)=>usage.push(['expression',value]),recordOutcome:(_meta,value)=>outcomes.push(['expression',value])},
  auditById:id=>s.featureState.audits?.find(a=>a.id===id),updateCoreMood:()=>{},reactToAnalysis:()=>{},normalizeMoodIntensity:()=>.5,getLive2dGateway:()=>({publishMood:async()=>{},react:()=>{}}),askModel:async()=>{cloudCalls++;throw Error('must not call cloud');},
 });
 s.soul.mood=moodState({dims:{calm:3}});
 const enrich=source.slice(source.indexOf('  function enrichConversation('),source.indexOf('\n  let installedMediaRuntime='));
 const calendar=source.slice(source.indexOf('  async function prepareCalendarContext('),source.indexOf('\n  function calendarSnapshot('));
 const audit=source.slice(source.indexOf('  function auditForTurn('),source.indexOf('\n  function auditAnswerCap('));
 const reflect=source.slice(source.indexOf('  async function reflectOnTurn('),source.indexOf('\n  // Optional self-chosen expression marker'));
 vm.runInContext(enrich+'\n'+calendar+'\n'+audit+'\n'+reflect,s);
 s.fetch=async(url,options)=>{h.calls.push({body:JSON.parse(options.body)});return Response.json({text:'先看猫在画面的位置和留白，画累了就歇一会儿。',attachments:[],mood:{confidence:85,evidenceQuote:'谢谢你',reason:'对方表达感谢',moodDelta:2,dims:{happy:3}}});};
 await h.handleLocalChatTurn(h.chat,'谢谢你，去码头整点薯条这个梗是什么？',false,{user_id:'12345',message_id:101,message:[]});
 assert.equal(recalls,1);assert.equal(cloudCalls,0);assert.equal(h.calls.length,1);const body=h.calls[0].body;
 for(const kind of ['memory','meme','learning','expression','mood','life'])assert.equal(body.turnContext.features[kind],1,kind);
 assert.match(JSON.stringify(body.messages),/喜欢画猫/);assert.equal(body.messages.filter(row=>row.content==='谢谢你，去码头整点薯条这个梗是什么？').length,1);
 assert.equal(h.queued.length,1);const receipt=s.featureState.audits[0];assert.equal(h.queued[0].chat.auditId,receipt.id);assert.equal(receipt.local,true);assert.equal(receipt.status,'completed');assert.equal(usage.length,3);assert.equal(outcomes.length,3);assert.equal(observed.length,1);assert.equal(s.soul.lastAnalysis.moodAccepted,true);assert.ok(s.soul.mood.dims.happy>=3);assert.equal(s.state.turns[h.chat.key],1);
});

test('account switches during shared recall cannot submit context or queue old feedback',async()=>{
 const h=setup();let resume,ready;const started=new Promise(resolve=>ready=resolve);
 h.sandbox.prepareCalendarContext=async()=>{ready();await new Promise(resolve=>resume=resolve);};
 const pending=h.handleLocalChatTurn(h.chat,'还记得画猫吗',false,{message_id:102});await started;h.sandbox.settings.activeAccountId='b';resume();await pending;
 assert.equal(h.calls.length,0);assert.equal(h.queued.length,0);assert.equal(h.sandbox.featureState.audits?.length||0,0);
});

test('background learning routes to the selected local model, defers when chatting and never falls back to cloud',async()=>{
 const h=setup(),s=h.sandbox,meta={key:h.chat.key,accountId:'a',personaId:'p'};let cloud=0;
 s.askModel=async(system,input,tokens,route,timeout,structured)=>{if(!s.settings.localChat.enabled){cloud++;return 'api';}const response=await s.requestLocalJson('http://127.0.0.1:8777/v1/chat/completions',{method:'POST',body:{analysis:true,max_tokens:tokens,messages:[{role:'system',content:system},{role:'user',content:input}]}});if(!response.ok)throw Object.assign(Error(response.body.error.message),{code:'LOCAL_ANALYSIS_DEFERRED'});return response.body.choices[0].message.content;};s.recordsAllowed=()=>true;
 s.fetch=async(url,options)=>{h.calls.push({url,body:JSON.parse(options.body)});return Response.json({choices:[{message:{content:'{"items":[]}'}}]});};
 assert.equal(await h.askConversationAnalysis('分析规则','资料',1800,meta),' {"items":[]}'.trim());assert.equal(h.calls[0].body.analysis,true);assert.equal(h.calls[0].body.max_tokens,384);assert.equal(cloud,0);
 s.localTurns.set(h.chat.key,{});await assert.rejects(()=>h.askConversationAnalysis('规则','资料',1800,meta),/聊天优先/);assert.equal(h.calls.length,1);s.localTurns.clear();
 assert.equal(await h.askConversationAnalysis('规则','资料',500,{accountId:'a',personaId:'p'}),' {"items":[]}'.trim());assert.equal(cloud,0);
 s.fetch=async()=>Response.json({error:{message:'稍后重试'}},{status:503});await assert.rejects(()=>h.askConversationAnalysis('规则','资料',1800,meta),/稍后重试/);assert.equal(cloud,0);
 s.settings.localChat.enabled=false;assert.equal(await h.askConversationAnalysis('规则','资料',1800,meta),'api');assert.equal(cloud,1);
});

test('QQ voice transcription enters the same local memory and mood input once, while unread audio is disclosed',async()=>{
 const h=setup();let options;
 h.sandbox.transcribeRecord=async(_data,input)=>{options=input;return '谢谢你，我刚画完一只猫。';};
 await h.handleLocalChatTurn(h.chat,'[语音]',false,{message_id:111,message:[{type:'record',data:{file:'qq-record-id'}}]});
 assert.equal(options.localOnly,true);assert.ok(options.signal);assert.equal(h.calls[0].body.messages.at(-1).content,'谢谢你，我刚画完一只猫。');assert.equal(h.logged[0].userText,'谢谢你，我刚画完一只猫。');assert.equal(h.calls[0].body.turnContext.judgeMood,true);
 const failed=setup();await failed.handleLocalChatTurn(failed.chat,'[语音]',false,{message_id:112,message:[{type:'record',data:{file:'unread'}}]});assert.match(failed.calls[0].body.messages.at(-1).content,/未能在本机转写/);assert.equal(failed.logged[0].userText,'');
});

test('actual QQ handler queues streamed text before the gateway finishes and never queues that prefix twice',async()=>{
 const h=setup();let done,ready;const first=new Promise(resolve=>ready=resolve);
 h.sandbox.requestLocalJson=async(_url,options)=>{assert.equal(options.body.stream,true);options.onEvent({event:'text',index:0,text:'今天已经很辛苦了，先歇一会儿。'});ready();await new Promise(resolve=>done=resolve);return {ok:true,status:200,body:{text:'今天已经很辛苦了，先歇一会儿。\n坐下来聊聊吧。',attachments:[],receipts:[]}};};
 const pending=h.handleLocalChatTurn(h.chat,'今天好累',false,{message_id:201});await first;assert.equal(h.queued.length,1);assert.match(h.queued[0].chat.deliveryKey,/:stream:0$/);done();await pending;assert.equal(h.queued.length,2);assert.equal(h.queued[1].segments[0].data.text,'坐下来聊聊吧。');
});

test('wait notice is independent of answer auditing and is sent once, while cancelled stream events stay silent',async()=>{
 const h=setup();h.sandbox.requestLocalJson=async(_url,options)=>{if(_url.endsWith('/priority'))return {ok:true};for(let i=0;i<2;i++)options.onEvent({event:'notice',text:'哼，先等本大人一小会儿。'});return {ok:true,status:200,body:{text:'好了，来聊聊。',attachments:[]}};};
 await h.handleLocalChatTurn(h.chat,'说句话',false,{message_id:202});assert.equal(h.queued.length,2);assert.equal(h.queued[0].chat.auditId,undefined);assert.match(h.queued[0].chat.deliveryKey,/:wait$/);
 const cancelled=setup();cancelled.sandbox.requestLocalJson=async(_url,options)=>{if(_url.endsWith('/priority'))return {ok:true};cancelled.sandbox.settings.activeAccountId='b';options.onEvent({event:'text',index:0,text:'旧账号的内容不能发送。'});options.onEvent({event:'notice',text:'等我一下。'});return {ok:true,body:{text:'旧结果'}};};await cancelled.handleLocalChatTurn(cancelled.chat,'你好',false,{message_id:203});assert.equal(cancelled.queued.length,0);
});

test('current persona reference is included only for an own portrait and remains separate from chat image input',async()=>{
 const h=setup(),directory=mkdtempSync(join(process.env.TEMP||process.cwd(),'persona-ref-')),file='a'.repeat(64)+'.png',bytes=Buffer.from('valid image bytes');
 Object.assign(h.sandbox,{join,readFileSync,personaImageDir:directory,personaImageInfo:()=>({file,personaId:'p'}),sniffImage:()=> 'image/png',photoPromptPlan:text=>({ownPortrait:/自拍/.test(text)})});writeFileSync(join(directory,file),bytes);
 try{await h.handleLocalChatTurn(h.chat,'生成一张你的自拍',false,{message_id:204});assert.ok(h.calls[0].body.turnContext.personaImage.dataUrl.startsWith('data:image/png;base64,'));assert.equal(typeof h.calls[0].body.messages.at(-1).content,'string');
  const next=setup();Object.assign(next.sandbox,{join,readFileSync,personaImageDir:directory,personaImageInfo:()=>({file,personaId:'p'}),sniffImage:()=> 'image/png',photoPromptPlan:()=>({ownPortrait:false})});await next.handleLocalChatTurn(next.chat,'生成一张海边风景图',false,{message_id:205});assert.equal(next.calls[0].body.turnContext.personaImage,null);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('actual QQ photo followups retain the last human subject and current persona bytes, while unclear subjects are marked for clarification',async()=>{
 const dir=mkdtempSync(join(process.env.TEMP||process.cwd(),'followup-persona-')),file='c'.repeat(64)+'.png',bytes=Buffer.from('test reference bytes');writeFileSync(join(dir,file),bytes);
 try{for(const mode of ['portrait','scene','unknown','other-account']){
  const h=setup(),time=Date.now()-10000;
  Object.assign(h.sandbox,{join,readFileSync,personaImageDir:dir,personaImageInfo:()=>({file,personaId:'p'}),sniffImage:()=> 'image/png',photoPromptPlan:text=>({prompt:text,ownPortrait:false,camera:'scene'})});
  if(mode!=='unknown')h.sandbox.messages.push({chat:h.chat.key,accountId:mode==='other-account'?'b':'a',personaId:'p',time,dir:'in',text:mode==='scene'?'生成一张窗边绿植的图片':'发一张你在窗边看书的自拍'});
  await h.handleLocalChatTurn(h.chat,'拍一张给我看看',false,{message_id:880});const turn=h.calls.at(-1).body.turnContext;
  if(mode==='portrait'){assert.equal(turn.imagePlan.ownPortrait,true);assert.ok(turn.personaImage.dataUrl.endsWith(bytes.toString('base64')));assert.match(turn.imagePlan.humanRequest,/窗边看书/);assert.equal(turn.imagePlan.subjectResolution.source,'recent-human-photo');}
  else if(mode==='scene'){assert.equal(turn.personaImage,null);assert.equal(turn.imagePlan.subjectResolution.ambiguous,false);assert.match(turn.imagePlan.humanRequest,/绿植/);}
  else{assert.equal(turn.personaImage,null);assert.equal(turn.imagePlan.subjectResolution.ambiguous,true);assert.equal(turn.personaReferenceDiagnostics.reason,'subject_needs_clarification');}
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('actual QQ route attaches saved identity bytes for ordinary portrait synonyms using the same scene and camera plan',async()=>{
 const directory=mkdtempSync(join(process.env.TEMP||process.cwd(),'ordinary-persona-')),file='b'.repeat(64)+'.png',bytes=Buffer.from('test reference bytes');writeFileSync(join(directory,file),bytes);
 try{
  for(const [request,camera,framing] of [['我想看看你的相片，穿绿色外套','front','upper'],['发一张你的近照，前置自拍','front','upper'],['发一张你的相片，对镜自拍','mirror','upper'],['发一张你的相片，朋友他拍全身','external','full']]){
   const h=setup();Object.assign(h.sandbox,{join,readFileSync,personaImageDir:directory,personaImageInfo:()=>({file,personaId:'p'}),sniffImage:()=> 'image/png',photoPromptPlan:()=>({ownPortrait:false,camera:'scene',prompt:'图书馆窗边，绿色外套',lifeContext:{location:'图书馆窗边'}})});
   await h.routeLocalTurn(h.chat,request,false,{message_id:request});assert.equal(h.calls.length,1);const ctx=h.calls[0].body.turnContext;assert.ok(ctx.personaImage.dataUrl.endsWith(bytes.toString('base64')),request);assert.equal(ctx.imagePlan.camera,camera,request);assert.equal(ctx.imagePlan.framing,framing,request);assert.equal(ctx.imagePlan.ownPortrait,true);assert.equal(ctx.personaReferenceDiagnostics.prepared,true);assert.equal(ctx.personaReferenceDiagnostics.reason,'reference_prepared');assert.equal(ctx.imagePlan.lifeContext.location,'图书馆窗边');
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});



