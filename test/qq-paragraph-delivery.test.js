import {naturalBubbleParts,stickerMessageGroups} from '../chat-bubbles.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
import {cleanOutgoingText,qqParagraphGroups,deliveryFingerprint,existingDelivery} from '../qq-reliability.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  function '+name+'\\(','m'));for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return fn(...Object.values(deps));}throw Error('Function not found');}
function fixture({saveOk=true,deny=()=>'',audit=null}={}){const featureState={outbox:[],proactiveContacts:[]};let saves=0,flushes=0;const deps={qqParagraphGroups,cleanOutgoingText,deliveryFingerprint,existingDelivery,featureState,settings:{activeAccountId:'a'},stripUnrequestedActions:v=>v,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),deliveryScopeCurrent:()=>true,personaContextIdentity:()=> 'v',calendarSafeText:v=>v,groupStopped:()=>false,auditById:()=>audit,noteDeliveryIssue:()=>{},recipientDenial:deny,recordsAllowed:()=>true,wrongOwnerAddress:()=>false,privateInitiativeAllowed:()=>true,randomUUID,stopped:false,accountPaused:false,proactiveCheck:()=>'',reserveProactive:()=>{},proactiveIncoming:()=>0,log:()=>{},saveFeatures:()=>{saves++;return saveOk;},logDelivery:()=>{},flushOutbox:()=>{flushes++;}};
 const queue=extract('queueOutgoing',deps);return {queue,featureState,deps,get saves(){return saves;},get flushes(){return flushes;}};}
const chat={key:'private:12345',kind:'private',chatId:'12345',turnKind:'user',deliveryKey:'local:turn-1'};
test('actual queue turns both real and literal returns into independent persisted QQ jobs',()=>{
 for(const text of ['第一段，\n第二段,\r\n第三段。','第一段，\\n第二段,\\r\\n第三段。']){
 const h=fixture(),id=h.queue(chat,[{type:'text',data:{text}}]),jobs=h.featureState.outbox;assert.equal(jobs.length,3);assert.equal(jobs[0].id,id);assert.deepEqual(jobs.map(j=>j.segments[0].data.text),['第一段','第二段','第三段']);assert.equal(new Set(jobs.map(j=>j.deliveryKey)).size,3);assert.deepEqual(jobs[0].paragraphIds,jobs.map(j=>j.id));assert.equal(h.saves,1);assert.equal(h.flushes,1);
 h.queue(chat,[{type:'text',data:{text}}]);assert.equal(jobs.length,3,'same delivery cannot duplicate children');
 }
});
test('same proactive episode and recipient scope are preserved across paragraphs',()=>{const h=fixture();h.queue({...chat,turnKind:'proactive',contactEpisode:'episode-a'},[{type:'at',data:{qq:'123'}},{type:'text',data:{text:'第一段，\n第二段，'}}]);const jobs=h.featureState.outbox;assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.proactiveEpisode==='episode-a'&&j.accountId==='a'&&j.personaId==='p'));assert.equal(jobs[0].segments[0].type,'at');assert.equal(jobs[1].segments[0].type,'text');});
test('code, JSON and mixed media are never split into separate fabricated messages',()=>{for(const text of ['```js\nconsole.log(1.2);\n```','{\n"text":"hello"\n}','1. first\n2. second'])assert.equal(qqParagraphGroups([{type:'text',data:{text}}]).length,1);assert.equal(qqParagraphGroups([{type:'image',data:{file:'a'}},{type:'text',data:{text:'第一段\n第二段'}}]).length,1);});
test('whole-message recipient denial or storage failure cannot send partial paragraphs',()=>{const denied=fixture({deny:()=> 'outside whitelist'});assert.equal(denied.queue(chat,[{type:'text',data:{text:'一\n二'}}]),null);assert.equal(denied.featureState.outbox.length,0);const failed=fixture({saveOk:false});assert.equal(failed.queue(chat,[{type:'text',data:{text:'第一段\n第二段'}}]),null);assert.equal(failed.flushes,0);assert.ok(failed.featureState.outbox.every(j=>j.status==='failed'));});
test('comma at a paragraph ending is removed after style cleanup, preserving decimal punctuation and inline code',()=>{assert.equal(cleanOutgoingText('第一段，\r\n第二段,',{chatStyle:true}),'第一段\n第二段');assert.equal(cleanOutgoingText('版本1.2，\n`x = 1.2;`',{chatStyle:true}),'版本1.2\n`x = 1.2;`');});

for(const isDesktop of [true,false])for(const text of ['第一段，\n第二段。\n[表情包:开心]','第一段，\n第二段。[表情包:开心]','第一段，\\n第二段。[表情包:开心]','[表情包:开心]\n第一段，\n第二段。'])test(`actual ${isDesktop?'PC':'phone'} sendTextNow queues standalone sticker and separate paragraphs: ${JSON.stringify(text)}`,async()=>{
 const audit={id:'audit',accountId:'a',persona:'p',status:'completed',userWords:'聊聊天',answer:text,outboxIds:[]};
 const h=fixture({audit}),errors=[];
 const parse=extract('burstSegments',{settings:{stickerDisabled:[]},FACE_IDS:{},resolveSticker:()=>'/fixture/happy.png',randomSticker:()=>'/fixture/happy.png',stickersInGroup:()=>[],log:()=>{}});
 const deps={...h.deps,isDesktop,stripUnrequestedActions:v=>v,completeMediaReply:v=>v,directMediaIntent:()=>null,explicitlyRequestsImage:()=>false,removeDuplicatePassages:v=>v,imageFirstReply:v=>v,cfg:{plainText:false},replyCharLimit:()=>2000,companionSettings:()=>({maxBubbles:1,automaticBreaks:false}),splitBursts:(v,_limit,options)=>naturalBubbleParts(v,options),burstSegments:parse,stickerMessageGroups,sendSegments:(actor,segments)=>h.queue(actor,segments),setTimeout:fn=>queueMicrotask(fn),replyDeliveryFailure:(_chat,error)=>errors.push(error)};
 const send=extract('sendTextNow',deps),actor={...chat,auditId:audit.id,mediaIntentHandled:true};send(actor,text);await actor.sendChain;
 assert.deepEqual(errors,[]);const jobs=h.featureState.outbox,images=jobs.filter(j=>j.segments.some(s=>s.type==='image'));
 assert.equal(jobs.length,3);assert.equal(images.length,1);assert.deepEqual(images[0].segments,[{type:'image',data:{file:'/fixture/happy.png'}}]);
 assert.deepEqual(jobs.filter(j=>j!==images[0]).map(j=>j.segments[0].data.text),['第一段','第二段']);
 assert.equal(jobs[0].segments[0].type,text.startsWith('[表情包')?'image':'text');
});

test('sticker marker no longer suppresses explicit newlines before parsing',()=>{
 assert.deepEqual(naturalBubbleParts('第一段\n第二段[表情包:开心]',{maxBubbles:1,automaticBreaks:false}),['第一段','第二段[表情包:开心]']);
 assert.deepEqual(naturalBubbleParts('[发送:12345|第一段\n第二段]'),['[发送:12345|第一段\n第二段]']);
});
