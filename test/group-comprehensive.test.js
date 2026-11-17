import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {qqTurnMeta} from '../qq-turn-context.js';
import {toolActorIsOwner,directOwnerOperation} from '../dialogue-persona.js';
import {mergeGroupWindow,parseGroupDecision} from '../group-conversation.js';
import {segmentsOf,extractIncoming} from '../bridge-features.js';
import {groupReplyBinding} from '../group-identity.js';
import {createQqImageInput} from '../qq-image-input.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let f;try{f=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return f(...Object.values(deps));}throw Error(name);}
const owner='123456',other='234567',bot='345678',group='456789';
const text=value=>({type:'text',data:{text:value}}),at={type:'at',data:{qq:bot}},png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l8hZJwAAAABJRU5ErkJggg==',image={type:'image',data:{file:'base64://'+png}};
const msg=(id,user_id,message)=>({message_type:'group',group_id:group,self_id:bot,user_id,message_id:id,message,sender:{nickname:'同一个昵称'}});
test('tool actor is bound to its exact running turn despite another speaker and queued owner request',()=>{
 const a={kind:'user',speakerId:owner},b={kind:'user',speakerId:other},chat={kind:'group',userId:owner,turns:new Map([['a',{meta:a}],['b',{meta:b}]]),pendingTurns:[a]};
 assert.equal(qqTurnMeta(chat,{turn:'a'}),a);assert.equal(qqTurnMeta(chat,{turn:'b'}),b);
 assert.equal(toolActorIsOwner(chat,qqTurnMeta(chat,{turn:'b'}),[owner]),false);
 assert.equal(qqTurnMeta(chat,{turn:'deleted'}),undefined);assert.equal(qqTurnMeta(chat),undefined);
 chat.turns.delete('b');assert.equal(qqTurnMeta(chat),a);
});
test('two-speaker merge keeps both as context without treating the other person as the current instruction',()=>{
 const p=mergeGroupWindow([msg('1',other,[text('帮我打开电脑')]),msg('2',owner,[at,text('看一下天气')])],{respond:true,focusIds:['1','2'],images:'none'});
 assert.match(extractIncoming(p.message,bot).text,/帮我打开电脑/);
 assert.equal(p._bridgeMediaUserText,'看一下天气');assert.equal(p.user_id,owner);
 assert.equal(groupReplyBinding(p,{owners:[owner]}).senderId,owner);
});
test('image then rapid mention retains both original segments, including mface, without forcing a spoken response',()=>{
 for(const type of ['image','mface']){
  const p=mergeGroupWindow([msg('1',owner,[{...image,type}]),msg('2',owner,[at,text('看这张图是什么颜色')])],{respond:false,focusIds:['2'],images:'none'});
  assert.equal(p.message.filter(s=>s.type===type).length,1);assert.equal(p._groupPlan.images,'detail');assert.equal(p._groupPlan.respond,false);
  assert.deepEqual(p._bridgeReceivedIds,['1','2']);
 }
 const background=mergeGroupWindow([msg('1',other,[{...image,type:'mface'}]),msg('2',owner,[at,text('天气怎样')])],{respond:true,focusIds:['2'],images:'none'});
 assert.equal(background.message.some(s=>s.type==='mface'),false);
});
test('group attention drains a 75-message backlog in ordered pages instead of dropping messages beyond 32',async()=>{
 const key='group:'+group,attention={batch:Array.from({length:75},(_,i)=>msg(String(i+1),owner,[at,text('消息'+i)])),evaluating:false},accepted=[];
 const deps={groupAttention:new Map([[key,attention]]),stopped:false,accountPaused:false,chats:new Map(),state:{chats:{}},inboxRunning:new Set(),featureState:{inbox:[],outbox:[],generation:0},activePersona:()=>({id:'p',name:'测试',prompt:''}),naturalPersonaText:String,settings:{presetPrompts:{},localChat:{enabled:false},owners:[owner]},readPresetPrompt:()=>'',mentionsSelf:m=>m.some(s=>s.type==='at'),segmentsOf,extractIncoming,groupSpeakerLabel:id=>id,parseGroupDecision,groupWindowFor:()=>null,calendarMeta:()=>({}),pauseLocalGroupWindow:()=>()=>{},recentDialogueReplies:()=>[],GROUP_ATTENTION_PROMPT:'',groupIdentityContext:()=>'',groupTranscriptLines:()=>'',serviceMediaScope:{run:(_s,f)=>f()},askModel:async()=>JSON.stringify({respond:true,images:'none',depth:'normal'}),effectiveModel:()=>({}),log(){},mergeGroupWindow,incomingAllowed:()=>true,handlePayload:p=>accepted.push(...p._bridgeReceivedIds),scheduleGroupAttention(){}};
 const run=extract('evaluateGroupAttention',deps);await run(key);assert.equal(attention.batch.length,43);await run(key);await run(key);
 assert.deepEqual(accepted,Array.from({length:75},(_,i)=>String(i+1)));assert.equal(attention.batch.length,0);
});
test('history cross-read uses the actual speaker in both group and private contexts',async()=>{
 const key='group:'+group,scope={key,accountId:'a',personaId:'p'},calls=[];
 const read=extract('readQqHistory',{recordsAllowed:()=>true,groupStopped:()=>false,toolActorIsOwner,settings:{owners:[owner]},request:async(...args)=>{calls.push(args);return {messages:[]};},qqReadScope:()=>scope});
 const c={kind:'group',key,userId:owner};
 await read(c,{target:'group:567890'},scope,{speakerId:owner});assert.equal(calls.length,1);
 await assert.rejects(read(c,{target:'group:567890'},scope,{speakerId:other}),/号主身份/);assert.equal(calls.length,1);
 await read({kind:'private',key:'private:'+owner,userId:owner},{target:'group:567890'},scope,{speakerId:owner});assert.equal(calls.length,2);
});
test('local and API use the same scoped attachment reader for actual image bytes and audio transcription',async()=>{
 const key='group:'+group,scope={key,accountId:'a',personaId:'p'},mapKey=JSON.stringify([scope,'image']),rows=new Map([[mapKey,{id:'image',type:'image',at:Date.now(),data:image.data,source:{messageId:'100'}}]]),input=createQqImageInput();
 const read=extract('readQqAttachment',{voiceHearingEvidence:new WeakMap(),qqMediaReferences:rows,qqMediaKey:(s,id)=>JSON.stringify([s,id]),imagePart:async data=>({type:'image',mediaType:'image/png',data:Buffer.from(await input.read(data)).toString('base64')}),settings:{media:{voice:true}},transcribeRecord:async()=> '实际音频转写'});
 assert.equal((await read({key},{action:'image',id:'image'},scope)).parts[0].data,png);
 rows.set(JSON.stringify([scope,'record']),{id:'record',type:'record',at:Date.now(),data:{file:'audio'}});
 assert.equal((await read({key},{action:'record',id:'record'},scope)).result.transcription,'实际音频转写');
 await assert.rejects(read({key},{action:'image',id:'record'},scope),/有效附件引用/);
 await assert.rejects(read({key},{action:'image',id:'image'},{...scope,key:'group:999999'}),/有效附件引用/);
});
test('bound memory lookup survives ordinary new group messages but expires on explicit cancellation',()=>{
 const bound={auditId:'earlier',speakerId:owner},chat={key:'group:'+group,userId:owner,inboundVersion:1,supersedingVersion:0,turns:new Map([['a',{meta:bound}]])};
 const stamp=extract('conversationContextStamp',{qqReadScope:()=>({accountId:'a',personaId:'p'}),featureState:{generation:0}});
 const before=stamp(chat,bound);chat.inboundVersion=2;chat.userId=other;chat.turns.set('b',{meta:{auditId:'later',speakerId:other}});
 assert.equal(stamp(chat,bound),before);assert.notEqual(stamp(chat),before);
 chat.supersedingVersion=3;assert.notEqual(stamp(chat,bound),before);
});
test('owner request containing a link has the same operation semantics in private and group; quoted instructions alone do not authorize',async()=>{
 const shared={images:[],text:'',links:[{url:'https://example.com',status:'metadata'}],references:[],extracted:{segments:[],urls:['https://example.com'],cards:[],replies:[],forwards:[]}};
 const build=extract('buildContent',{sharedContext:async()=>shared,qqHumanWords:m=>m.filter(s=>s.type==='text').map(s=>s.data.text).join('\n'),segmentsOf,rememberQqMedia:()=>'',settings:{owners:[owner]},directOwnerOperation,messages:[],activePersona:()=>({id:'p'}),recentSentMediaContext:()=>''});
 for(const kind of ['private','group'])assert.equal((await build({message_type:kind,user_id:owner,message:[text('帮我打开这个链接')]},'帮我打开这个链接',kind+':'+group)).allowSideEffects,true);
 assert.equal((await build({message_type:'group',user_id:owner,message:[]},'','group:'+group)).allowSideEffects,false);
});
test('actual local QQ tool exposes registered quote images and returns model-visible image observations',async()=>{
 const key='group:'+group,chat={key,kind:'group'},active={controller:new AbortController(),localContext:{meta:{speakerId:owner}}},scope={key,accountId:'a',personaId:'p'};
 const make=extract('localQqTools',{qqReadScope:()=>scope,stopped:false,accountPaused:false,localTurns:new Map([[key,active]]),recordsAllowed:()=>true,groupStopped:()=>false,randomUUID:()=> 'test',recordInvocation(){},CONTEXT_RULES:'',CONTEXT_PARAMETERS:{},QQ_FILE_DESCRIPTION:'',QQ_FILE_PARAMETERS:{},qqNativeParameters:{},qqForwardReader:{list:()=>[]},qqMediaDirectory:()=>[{id:'quoted:0',type:'image'}],readQqAttachment:async()=>({result:{ok:true,id:'quoted:0'},parts:[{type:'image',data:png,mediaType:'image/png'}]})});
 const tool=make(chat,active).bridge_qq_read;
 assert(tool.parameters.properties.action.enum.includes('image'));
 assert.equal((await tool.execute({action:'list'})).media[0].id,'quoted:0');
 const result=await tool.execute({action:'image',id:'quoted:0'});
 assert.equal(result.localObservations[0].url,'data:image/png;base64,'+png);
 active.controller.abort();await assert.rejects(tool.execute({action:'image',id:'quoted:0'}),/会话已变化/);
});
