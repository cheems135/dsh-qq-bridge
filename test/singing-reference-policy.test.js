import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {selectReferenceSinging,singingUsedTitles,sameMusicReference,singingTitleKey} from '../singing-policy.js';
import {singingSegment,parseSingingRequest} from '../singing-plan.js';
import {qqParagraphGroups} from '../qq-reliability.js';
import {randomUUID} from 'node:crypto';
const source={title:'做个神仙',artist:'锦颜子',audio:'api/correct.mp3',songId:'3384328281',url:'https://music.163.com/song?id=3384328281',duration:206.016979,verified:true};
const reference={id:'provided',at:100,input:{id:'3384328281',url:source.url,title:source.title,author:source.artist}};
const cover={id:'stock',title:source.title,artist:source.artist,identityVerified:true,quality:'accepted',sourceSong:source,file:'saved.wav',at:1};
const old={...cover,id:'old',title:'烂奇迹',sourceSong:{...source,title:'烂奇迹',songId:'3458269805',audio:'api/old.mp3'}};
const host=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=host.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=host.indexOf('}',start);end>=0;end=host.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+host.slice(start,end+1)+')');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return fn(...Object.values(deps));}throw Error(name);}

test('a provided song is identified before lookup and never falls back to a default or model-selected old title',()=>{
 const result=selectReferenceSinging({request:'好呀',title:'烂奇迹',reference,versions:[old],sources:[source,old.sourceSong]});
 assert.equal(result.action,'generate');assert.equal(result.title,'做个神仙');assert.equal(result.audio,'api/correct.mp3');
});
test('with a reference, existing verified stock is reused even if previously sent, unreviewed or the workflow changed',()=>{
 for(const quality of ['accepted','unreviewed']){const result=selectReferenceSinging({request:'重新唱这个',reference,versions:[{...cover,quality}],sources:[source],usedTitles:['做个神仙']});assert.equal(result.action,'reuse');assert.equal(result.version.id,'stock');}
});
test('a rejected or deleted rendition cannot satisfy the archive lookup',()=>{
 for(const changes of [{quality:'rejected'},{deleted:true},{disabled:true},{identityVerified:false}])assert.equal(selectReferenceSinging({reference,versions:[{...cover,...changes}],sources:[source]}).action,'generate');
});
test('without a reference, only unsent stock is selected and all-exhausted stock stays empty without generation',()=>{
 assert.equal(selectReferenceSinging({request:'想听你唱',versions:[cover,old],usedTitles:['做个神仙']}).version.id,'old');
 assert.equal(selectReferenceSinging({request:'想听你唱',versions:[cover,old],usedTitles:['做个神仙','烂奇迹'],sources:[source]}).action,'empty');
 assert.equal(selectReferenceSinging({request:'唱首新歌',versions:[],sources:[source]}).action,'empty');
});
test('a named request without audio never gets substituted with another stock song or a generated default',()=>{
 assert.equal(selectReferenceSinging({request:'唱《另一首》',versions:[cover],sources:[source]}).action,'empty');
});
test('reference identity is scoped to the actual platform song and unresolved audio cannot select an old prepared song',()=>{
 assert.equal(sameMusicReference(source,reference.input),true);assert.equal(sameMusicReference(old.sourceSong,reference.input),false);
 const result=selectReferenceSinging({request:'唱这个',reference:{id:'new',input:{url:'https://example.org/new.mp3'}},sources:[source,old.sourceSong],versions:[old]});assert.equal(result.action,'need-source');assert.equal(result.title,undefined);
});
test('clip and full song remain separate when checking archives',()=>{
 const clip={start:0,end:30};assert.equal(selectReferenceSinging({reference,sources:[source],versions:[cover],segment:clip}).action,'need-source');
 assert.equal(selectReferenceSinging({reference,sources:[{...source,segment:clip,duration:30}],versions:[cover],segment:clip}).action,'generate');
});
test('an in-progress reference task is awaited rather than charged again',()=>{
 const result=selectReferenceSinging({reference,sources:[source],pending:[{id:'running',singing:{title:source.title,referenceId:reference.id}}]});
 assert.equal(result.action,'waiting');assert.equal(result.taskId,'running');
});
test('delivery history persists song titles and reserves queued/unknown recordings; a failed-before-send version is eligible again',()=>{
 const jobs=[{id:'q',status:'queued',singing:{title:'做个神仙'},segments:[{type:'record'}]},{id:'u',status:'unknown',singing:{title:'烂奇迹'},segments:[{type:'record'}]},{id:'f',status:'failed',singing:{title:'未发送'},segments:[{type:'record'}]}];
 assert.deepEqual(singingUsedTitles({history:{晴天:{}},jobs}).sort(),['做个神仙','晴天','烂奇迹'].sort());
});
test('real host selection uses only the provided reference and ignores stale configured music',()=>{
 const plan=extract('singingPlanFor',{settings:{activeAccountId:'a',voice:{runninghub:{sing:{songTitle:'烂奇迹'}}}},activePersona:()=>({id:'p'}),localAudioWorkflows:null,localSingingSources:null,singingSources:{list:()=>[source,old.sourceSong]},singingReferenceFor:()=>reference,musicContextByChat:new Map(),conversationScope:()=> 'scope',sameMusicReference,coverLibraryFor:()=>({list:()=>[old]}),singingUsageFor:()=>[],singingInventoryFor:()=>[old],featureState:{mediaTasks:[]},singingSegment,selectReferenceSinging});
 assert.equal(plan('好呀','private:12345').title,'做个神仙');
});
test('real resolution with no reference never acquires audio, including a forged source URL from the model',async()=>{
 const resolve=extract('resolveSingingPlanFor',{singingSegment,singingPlanFor:()=>({action:'empty',stockOnly:true}),localAudioWorkflows:null,localSingingSources:null,singingSources:{prepare:()=>{throw Error('must not upload');}}});
 assert.equal((await resolve('想听你唱','private:12345',{input:{url:'https://example.org/forged.mp3'}})).action,'empty');
});
test('both actual local and API render entrances reuse stock before any generator is touched',async()=>{
 for(const local of [false,true]){
  let observed;const render=extract('renderVoiceFile',{serviceSource:()=>local?'local':'legacy',resolveSingingPlanFor:async()=>({action:'reuse',version:cover,title:cover.title,reference}),localAudioWorkflows:{isLocal:()=>{throw Error('no local generation');}}});
  assert.equal(await render('','private:12345',{performance:'sing',onSingingPlan:p=>observed=p}),'saved.wav');assert.equal(observed.versionId,'stock');
 }
});
test('actual generator entry cannot charge when reference is absent and inventory is exhausted',async()=>{
 const render=extract('renderVoiceFile',{serviceSource:()=> 'legacy',resolveSingingPlanFor:async()=>({action:'empty',reason:'没有未重复库存'})});
 await assert.rejects(render('','private:12345',{performance:'sing'}),error=>error.code==='SINGING_REFERENCE_REQUIRED'&&error.nonRetryable===true);
});

test('reference recovery across restart uses the original same-persona music card and consumes it only on a delivery receipt',()=>{
 const scope='scope',messages=[{chat:'private:1',dir:'in',personaId:'p',accountId:'a',messageId:'music',time:100,text:'[分享卡片] 做个神仙'}];
 messages.push({chat:'private:1',dir:'in',personaId:'p',accountId:'a',text:'无 ID 的旧记录'});
 const featureState={inbox:[{key:'private:1',accountId:'a'},{key:'private:1',accountId:'a',at:100,payload:{message_id:'music',message:{cards:[{title:'做个神仙',id:'3384328281'}]}}}]};
 const referenceFor=extract('singingReferenceFor',{conversationScope:()=>scope,musicContextByChat:new Map(),featureState,textHash:v=>v,messages,activePersona:()=>({id:'p'}),settings:{activeAccountId:'a'},extractIncoming:x=>typeof x==='string'?{}:x,selectMusicInput:x=>x.cards?.[0]?reference.input:null,singingHistoryScope:()=> 'history',parseSingingRequest});
 const found=referenceFor('private:1');assert.equal(found.input.id,source.songId);
 const record=extract('rememberSingingDelivery',{featureState,textHash:()=> 'history',singingTitleKey,saveFeatures:()=>true});
 record({id:'delivery',status:'failed',personaId:'p',chat:'private:1',singing:{title:source.title,referenceAt:100}});assert(referenceFor('private:1'));
 record({id:'delivery',status:'sent',personaId:'p',chat:'private:1',singing:{title:source.title,referenceAt:100}});assert.equal(referenceFor('private:1'),null);
 assert(referenceFor('private:1',{referenceId:found.id}));
 assert.equal(referenceFor('private:other'),null);messages[0].personaId='another';assert.equal(referenceFor('private:1',{referenceId:found.id}),null);
});

test('the actual QQ queue refuses wrong-reference and repeated stock audio before dispatch, but allows ordinary speech',()=>{
 let current={title:source.title,versionId:cover.id,stockOnly:true},used=['做个神仙'],sent=0;
 const featureState={outbox:[],proactiveContacts:[]},audit={id:'turn',accountId:'a',status:'completed',outboxIds:[],singingReference:reference};
 const deps={featureState,settings:{activeAccountId:'a'},scheduledChatHeld:()=>false,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),deliveryScopeCurrent:()=>true,personaContextIdentity:()=> 'p',coverLibraryFor:()=>({isRejectedFile:()=>false}),auditById:()=>audit,deliveryCommitmentId:()=>'',calendarSafeText:v=>v,stripUnrequestedActions:v=>v,cleanOutgoingText:v=>v,groupStopped:()=>false,recipientDenial:()=>'',recordsAllowed:()=>true,wrongOwnerAddress:()=>false,qqParagraphGroups,randomUUID,singingDeliveryFor:()=>current,singingUsageFor:()=>used,singingTitleKey,singingPlanFor:()=>({title:source.title}),singingReferenceFor:()=>reference,privateInitiativeAllowed:()=>true,deliveryFingerprint:JSON.stringify,stopped:false,accountPaused:false,existingDelivery:()=>null,saveFeatures:()=>true,logDelivery:()=>{},flushOutbox:()=>{sent++;},log:()=>{}};
 const queue=extract('queueOutgoing',deps),chat={key:'private:1',kind:'private',chatId:'1',auditId:'turn',turnKind:'user',mediaCaptionHandled:true};
 assert.equal(queue(chat,[{type:'record',data:{file:'saved.wav'}}]),null);assert.equal(sent,0);assert.match(audit.error,/重复/);
 current={title:'烂奇迹',referenceId:reference.id};assert.equal(queue(chat,[{type:'record',data:{file:'wrong.wav'}}]),null);assert.equal(sent,0);assert.match(audit.error,/不一致/);
 current={title:source.title,referenceId:reference.id};assert(queue(chat,[{type:'record',data:{file:'correct.wav'}}]));assert.equal(sent,1);
 current=null;assert(queue(chat,[{type:'record',data:{file:'speech.wav'}}]));assert.equal(sent,2);
});
