import test from 'node:test';
import {cleanGeneratedReplyDividers} from '../local-reply.js';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestsSinging,requestsDifferentCover,selectMediaIntent,mediaIntentHint,completeMediaReply,directMediaIntent,imageFirstReply,independentRequestedVoice} from '../media-intent.js';
import {isRunningHubCover,runningHubAudioNodes} from '../runninghub-audio.js';
import {naturalBubbleParts,stickerMessageGroups} from '../chat-bubbles.js';
import {stripUnrequestedActions} from '../dialogue-only.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const workflow={id:'2058763737900867585',allowLocal:true,songAudio:'api/song.wav',referenceAudio:'api/sample.wav',nodeInfoList:[
  {nodeId:'5',fieldName:'audio',fieldValue:'{{song_audio}}'},{nodeId:'4',fieldName:'audio',fieldValue:'{{reference_audio}}'},
]};
const request='用 RunningHub API 帮我翻唱一下这段';
const key='private:12345';

function scopedSource(start,end,deps,expression){
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a);
  return Function(...Object.keys(deps),source.slice(a,b)+'\nreturn '+expression)(...Object.values(deps));
}
function intentFor(settings){
  return scopedSource('  function singingWorkflowFor(','  function voiceRuntimeReadiness(',{
    settings,requestsSinging,requestsDifferentCover,selectMediaIntent,isRunningHubCover,featureProfile:()=>({}),
    askModel:()=>{throw Error('an explicit song should not require a classifier');},
  },'previewMediaForm');
}
test('explicit Singing requests include ordinary Chinese and a named API without treating discussion as consent',()=>{
  for(const text of [request,'你再唱一段吧','哼两句','我想听一首你唱的歌','翻唱一下这段','你唱段歌给我听','带伴奏唱一段'])assert.equal(requestsSinging(text),true,text);
  for(const text of ['这个 API 支持唱歌吗','怎么用 RunningHub 的接口翻唱','她说“请给我唱一段”','我给你唱首歌','放首歌听听','别唱了','哼，真烦','刚才唱的是什么歌'])assert.equal(requestsSinging(text),false,text);
});

test('the API preflight uses preset cover assets, keeps lyric workflows distinct, and prevents charging for the wrong song',async()=>{
  const settings={voice:{enabled:true,runninghub:{sing:workflow}},imagegen:{enabled:true,runninghub:{apiKey:'fixture'}}};
  const intent=await intentFor(settings)(request,key);
  assert.deepEqual(intent.kinds,['voice']);
  assert.equal(intent.cover,true);
  assert.match(mediaIntentHint(intent),/保存的原曲片段和参考音色/);
  assert.deepEqual(runningHubAudioNodes(workflow,'sing'),[
    {nodeId:'5',fieldName:'audio',fieldValue:'api/song.wav'},{nodeId:'4',fieldName:'audio',fieldValue:'api/sample.wav'},
  ]);
  const named=await intentFor(settings)('唱一首《另一首歌》给我听',key);
  assert.deepEqual(named.kinds,[]);
  assert.equal(named.coverNeedsAudio,true);
  assert.match(mediaIntentHint(named),/换成那首歌的片段/);
  settings.voice.runninghub.sing={...workflow,nodeInfoList:[{nodeId:'5',fieldName:'lyrics',fieldValue:'{{text}}'}]};
  const lyrics=await intentFor(settings)(request,key);
  assert.equal(lyrics.cover,undefined);
  assert.equal(completeMediaReply('好呀。',lyrics),'好呀。');
  assert.match(mediaIntentHint(lyrics),/实际要唱的歌词/);
  settings.localChat={enabled:true};
  settings.voice.runninghub.sing={...workflow,allowLocal:false};
  assert.deepEqual((await intentFor(settings)(request,key)).kinds,[]);
});

test('the real QQ reply dispatcher starts one configured cover on plain text and another chat reply does not wait',async()=>{
  const audit={id:'cover',status:'completed',userWords:request,mediaUserWords:request,mediaIntent:{request,kinds:['voice'],cover:true}};
  const live={key,kind:'private',sendChain:Promise.resolve()};
  const actor={key,kind:'private',chatId:'12345',auditId:audit.id,turnKind:'user'};
  const sent=[],errors=[],jobs=[];
  let release,started;
  const pending=new Promise(resolve=>{release=resolve;});
  const active=new Promise(resolve=>{started=resolve;});
  const deps={settings:{voice:{enabled:true,emotion:'auto'}},featureState:{generation:0,outbox:[]},state:{chats:{[key]:{sessionId:'s'}}},chats:new Map([['s',live]]),
    groupStopped:()=>false,recipientDenial:()=>false,wrongOwnerAddress:()=>false,auditById:id=>id===audit.id?audit:null,
    stripUnrequestedActions,completeMediaReply,directMediaIntent,requestsSinging,explicitlyRequestsImage:()=>false,removeDuplicatePassages:value=>value,imageFirstReply,independentRequestedVoice,
    naturalBubbleParts,cleanGeneratedReplyDividers,companionSettings:()=>({}), cfg:{plainText:false},
    stopped:false,accountPaused:false,lifeExecution:null,isDesktop:true,activePersona:()=>({id:'p'}),calendarMeta:()=>({}),setTimeout:fn=>queueMicrotask(fn),
    beginMediaTask:()=>({task:{id:'task',status:'pending',auditId:audit.id}}),recordMediaTask:()=>{},finishMediaTask:(task,status,extra)=>Object.assign(task,extra,{status}),
    completeMediaShare:()=>{},saveSettings:()=>{},saveFeatures:()=>{},generationBlocked:()=>false,beginGeneration:()=>{},endGeneration:()=>{},featureProfile:()=>({}),conversationScope:()=>key,
    synthesizeVoice:async(text,_chat,options)=>{jobs.push({text,performance:options.performance,request:options.songRequest});started();return pending;},
    burstSegments:text=>[{type:'text',data:{text}}],stickerMessageGroups,sendSegments:(_actor,segments)=>{sent.push(segments[0]);return 'delivery';},
    replyDeliveryFailure:(_chat,error)=>errors.push(error),log:()=>{},
  };
  const send=scopedSource('  function sendTextNow(','  /* ---------------- NapCat',deps,'sendTextNow');
  const first=send(actor,'那我来一段。');
  await Promise.race([active,first.then(()=>{throw Error('no song was requested');})]);
  await send({...actor,auditId:undefined},'我也看见你的下一句了。');
  assert.deepEqual(sent.map(segment=>segment.type),['text','text']);
  await send(actor,'[语音:唱歌]多余的模型标签');
  release('cover.wav');
  await first;
  assert.deepEqual(errors,[]);
  assert.deepEqual(jobs,[{text:'',performance:'sing',request}]);
  assert.deepEqual(sent.at(-1),{type:'record',data:{file:'cover.wav'}});
});
