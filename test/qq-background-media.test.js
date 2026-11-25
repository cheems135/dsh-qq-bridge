import test from 'node:test';
import {cleanGeneratedReplyDividers} from '../local-reply.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {naturalBubbleParts} from '../chat-bubbles.js';
import {completeMediaReply,imageFirstReply} from '../media-intent.js';

for(const isDesktop of [true,false]) test((isDesktop?'desktop':'mobile')+' replies while an image is generated or reviewed and keeps the caption linked',async()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const start=source.indexOf('  function sendTextNow(chat, text) {');
  const end=source.indexOf('  /* ---------------- NapCat',start);
  assert.ok(start>=0&&end>start);
  let startImage,finishImage,startInspection,finishInspection;
  const pictureStarted=new Promise(resolve=>{startImage=resolve;});
  const pendingPicture=new Promise(resolve=>{finishImage=resolve;});
  const inspectionStarted=new Promise(resolve=>{startInspection=resolve;});
  const pendingInspection=new Promise(resolve=>{finishInspection=resolve;});
  const audit={status:'completed',userWords:'先告诉我到哪了，然后发图'};
  const output=[],errors=[];
  const chat={key:'group:1',kind:'group',chatId:'1',turnKind:'user',auditId:'audit',mediaIntentHandled:true};
  const live={...chat,sendChain:Promise.resolve()};
  const deps={
    groupStopped:()=>false,markReplyDelivery:()=>{},auditById:()=>audit,stripUnrequestedActions:x=>x,
    recipientDenial:()=>false,wrongOwnerAddress:()=>false,featureState:{generation:0,outbox:[]},settings:{activeAccountId:'a',imagegen:{}},
    completeMediaReply,explicitlyRequestsImage:()=>false,removeDuplicatePassages:x=>x,imageFirstReply,cfg:{plainText:false},
    naturalBubbleParts,cleanGeneratedReplyDividers,companionSettings:()=>({}),
    chats:new Map([['session',live]]),state:{chats:{'group:1':{sessionId:'session'}}},isDesktop,stopped:false,accountPaused:false,
    lifeExecution:null,independentRequestedVoice:()=>false,generationBlocked:()=>false,generationCooldowns:new Map(),
    beginMediaShare:()=>({}),beginMediaTask:()=>({task:{id:'picture-task'}}),recordMediaTask:()=>{},saveFeatures:()=>{},
    beginGeneration:()=>{},endGeneration:()=>{},photoFor:async()=>{startImage();return pendingPicture;},mediaShareCurrent:()=>true,
    reviewImageForQQ:async()=>{startInspection();return pendingInspection;},saveSettings:()=>{},finishMediaTask:()=>{},completeMediaShare:()=>{},setTimeout:fn=>queueMicrotask(fn),
    burstSegments:x=>[{type:'text',data:{text:x}}],stickerMessageGroups:segments=>[segments],
    sendSegments:(actor,segments)=>{
      output.push({after:actor.afterImageId,segments});
      return segments[0].type==='image'?'image-delivery':'text-delivery';
    },
    replyDeliveryFailure:(_actor,error)=>errors.push(error),log:()=>{}
  };
  const persistStart=source.indexOf('  function persistTextBubbles(');
  const persistEnd=source.indexOf('  function outgoingJobDenial(',persistStart);
  const persistDeps={...deps,randomUUID:()=>String(output.length),
    queueOutgoing:(actor,segments)=>{
      const id=String(output.length);
      output.push({segments});
      deps.featureState.outbox.push({id,bubbleBatchId:actor.bubbleBatchId});
      return id;
    },
    saveFeatures:()=>true,logDelivery:()=>{},flushOutbox:()=>{}
  };
  deps.persistTextBubbles=Function(...Object.keys(persistDeps),source.slice(persistStart,persistEnd)+';return persistTextBubbles;')(...Object.values(persistDeps));
  const compile=new Function(...Object.keys(deps),'return ('+source.slice(start,end).trim()+');');
  const send=compile(...Object.values(deps));
  const caption='这是生成好的图。\n- 窗台边是一杯茶';
  const media=send(live,'[即时回复]我已经收到啦。\n[图:窗台]\n'+caption);
  await Promise.race([pictureStarted,new Promise((_,reject)=>setTimeout(()=>reject(Error('image task not started')),1000))]);
  await send({...chat},'这是一条新消息的回复。');
  assert.deepEqual(output.map(x=>x.segments[0].data.text),['我已经收到啦。','这是一条新消息的回复。']);
  finishImage('test.png');
  await inspectionStarted;
  await send({...chat},'自检期间也能回消息。');
  assert.equal(output.length,3);
  finishInspection({status:'passed'});
  await media;
  assert.deepEqual(errors,[]);
  assert.equal(output[3].segments[0].type,'image');
  assert.equal(output[4].after,'image-delivery');
  assert.equal(output[4].segments[0].data.text,caption);
});
