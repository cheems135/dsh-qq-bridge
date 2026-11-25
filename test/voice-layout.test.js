import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {naturalBubbleParts,stickerMessageGroups} from '../chat-bubbles.js';
import {createMediaTaskLifecycle} from '../media-task-lifecycle.js';
import {requestsImage,requestsSinging,directMediaIntent,completeMediaReply,imageFirstReply,independentRequestedVoice} from '../media-intent.js';
import {cleanGeneratedReplyDividers} from '../local-reply.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');

test('a separate voice declaration binds its following speech line across blank lines and CRLF',()=>{
  for(const gap of ['\n','\n\n','\r\n\r\n']){
    assert.deepEqual(naturalBubbleParts('[语音:轻快]'+gap+'刚看到这个，想给你听听。'+gap+'[语音:小声]'+gap+'还有这一句。'),['[语音:轻快]刚看到这个，想给你听听。','[语音:小声]还有这一句。']);
  }
  assert.deepEqual(naturalBubbleParts('你听\n[语音]\n\n今天有一点风。\n后面是文字。'),['你听','[语音]今天有一点风。','后面是文字。']);
});

test('binding does not swallow the next image, another declaration, literal code, relay content or JSON',()=>{
  assert.deepEqual(naturalBubbleParts('[语音]\n[图:一只杯子]\n配话'),['[语音]','[图:一只杯子]','配话']);
  assert.deepEqual(naturalBubbleParts('[语音]\n[语音:轻快]你好'),['[语音]','[语音:轻快]你好']);
  for(const literal of ['```text\n[语音]\n\n保持原文\n```','[发送:private:12345|[语音]\n保持原文]','{"text":"[语音]\\n台词"}'])assert.equal(naturalBubbleParts(literal).join('\n'),literal);
});

test('missing spoken words never turn into a canned greeting or an invented line',()=>{
  for(const request of ['我想听语音','用语音说晚安','发个早安语音']){
    assert.equal(completeMediaReply('',directMediaIntent(request)),'');
    assert.equal(completeMediaReply('我现在不能发语音',directMediaIntent(request)),'我现在不能发语音');
  }
});

function host({isDesktop=true,kind='private'}={}){
  const featureState={generation:0,outbox:[],mediaTasks:[]},audit={id:'turn',accountId:'a',persona:'p',status:'completed',userWords:'我想听语音',mediaIntent:directMediaIntent('我想听语音')};
  const actor={key:kind+':12345',kind,chatId:'12345',auditId:audit.id,turnKind:'user'},spoken=[],sent=[],errors=[];
  const lifecycle=createMediaTaskLifecycle({state:()=>featureState,account:()=> 'a',persona:()=> 'p',source:()=> 'api',audit:()=>audit,record:()=>{},persist:()=>true});
  const deps={requestsSinging,calendarSafeText:x=>x,isDesktop,featureState,settings:{activeAccountId:'a',voice:{enabled:true,emotion:'auto'},imagegen:{}},groupStopped:()=>false,auditById:()=>audit,stripUnrequestedActions:x=>x,recipientDenial:()=>false,wrongOwnerAddress:()=>false,directMediaIntent,completeMediaReply,explicitlyRequestsImage:requestsImage,removeDuplicatePassages:x=>x,imageFirstReply,independentRequestedVoice,cfg:{plainText:false},companionSettings:()=>({}),naturalBubbleParts,cleanGeneratedReplyDividers,chats:new Map(),state:{chats:{}},stopped:false,accountPaused:false,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),setTimeout:fn=>queueMicrotask(fn),generationBlocked:()=>false,beginGeneration:()=>{},endGeneration:()=>{},beginMediaTask:(chat,kind)=>lifecycle.begin(chat,kind),recordMediaTask:lifecycle.record,saveFeatures:()=>true,finishMediaTask:lifecycle.finish,completeMediaShare:()=>{},mediaFailureNotice:()=>errors.push('notice'),featureProfile:()=>({}),conversationScope:()=> 'scope',synthesizeVoice:async(text,_key,options)=>{spoken.push({text,emotion:options.emotionHint});return 'voice-'+spoken.length+'.mp3';},saveSettings:()=>{},sendSegments:(chat,segments)=>{sent.push({chat,segments});return 'delivery-'+sent.length;},burstSegments:text=>[{type:'text',data:{text}}],stickerMessageGroups,replyDeliveryFailure:(_chat,error)=>errors.push(error),log:()=>{}};
  const start=source.indexOf('  function sendTextNow('),end=source.indexOf('  /* ---------------- NapCat',start);
  const send=Function(...Object.keys(deps),'return ('+source.slice(start,end).trim()+');')(...Object.values(deps));
  return {send,actor,spoken,sent,errors,featureState};
}

for(const isDesktop of [true,false])for(const kind of ['private','group'])test(`actual ${isDesktop?'PC':'phone'} ${kind} renderer generates distinct speech parts and never resubmits them on replay`,async()=>{
  const h=host({isDesktop,kind}),answer='[语音:轻快]\n\n刚看到这个，想给你听听。\n[语音:小声]\n\n还有这一句。';
  await h.send(h.actor,answer);
  assert.deepEqual(h.errors,[]);assert.deepEqual(h.spoken,[{text:'刚看到这个，想给你听听。',emotion:'轻快'},{text:'还有这一句。',emotion:'小声'}]);
  assert.deepEqual(h.sent.map(x=>x.segments[0].type),['record','record']);
  assert.deepEqual(h.featureState.mediaTasks.map(x=>[x.part,x.status]),[['voice:0','queued'],['voice:1','queued']]);
  await h.send(h.actor,answer);assert.equal(h.spoken.length,2);assert.equal(h.sent.length,2);
});

test('a legacy media task with an uncertain result still blocks a new differently labelled part',()=>{
  const h=host();h.featureState.mediaTasks.push({id:'legacy',accountId:'a',personaId:'p',chat:h.actor.key,auditId:'turn',kind:'voice',status:'unknown'});
  const lifecycle=createMediaTaskLifecycle({state:()=>h.featureState,account:()=> 'a',persona:()=> 'p',source:()=> 'api',audit:()=>null,record:()=>{},persist:()=>true});
  assert.equal(lifecycle.begin({...h.actor,mediaPart:'voice:1'},'voice').duplicate,true);
});
