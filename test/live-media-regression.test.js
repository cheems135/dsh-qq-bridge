import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requestsImage,directMediaIntent,completeMediaReply,imageFirstReply,independentRequestedVoice} from '../media-intent.js';
import {naturalBubbleParts,stickerMessageGroups} from '../chat-bubbles.js';
import {createImageStudio} from '../image-studio.js';

const request='请用当前选中的图片工作流实际生成一张照片：木桌上的蓝色杯子，不需要人物。另外请发一条语音，说‘早上好，今天也慢慢来’，即使图片失败也请发送这条语音。';
test('explicit workflow execution is direct media, while configuration discussions remain inert',()=>{
 for(const line of [request,'请用这个 API 生成一张照片','用工作流直接生成一张蓝色杯子的图片'])assert.equal(requestsImage(line),true,line);
 for(const line of ['怎么用这个工作流生成图片','帮我修复生成图片工作流','请设置生成图片的 API','为什么这个工作流不能直接生成图片','不要用工作流直接生成图片'])assert.equal(requestsImage(line),false,line);
 assert.deepEqual(directMediaIntent(request).kinds,['image','voice']);
});
test('verbatim inline speech is recovered without reading an emotion or a later caption',()=>{
 const out=completeMediaReply('[图:杯子]\n[语音:早上好，今天也慢慢来]\n\n杯子拍好了',directMediaIntent(request));
 assert.match(out,/\[语音\]早上好，今天也慢慢来\s*\|\|\|/);
 assert.equal(independentRequestedVoice('[语音]早上好，今天也慢慢来',request),true);
 assert.equal(independentRequestedVoice('[语音]图已经发给你了',request),false);
 assert.equal(independentRequestedVoice('[语音]早上好，今天也慢慢来\n杯子拍好了',request),false);
 assert.equal(completeMediaReply('[语音:温柔]你好',directMediaIntent('发一条温柔的语音')), '[语音:温柔]你好');
 assert.equal(completeMediaReply('[语音:温柔]',directMediaIntent('发一条温柔的语音')), '[语音:温柔]');
 assert.match(completeMediaReply('[语音:早上好，今天也慢慢来]',null,request),/^\[语音\]早上好/);
});

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
for(const isDesktop of [true,false])for(const kind of ['private','group'])for(const alreadyShared of [false,true])test(`actual ${isDesktop?'PC':'phone'} ${kind} keeps independent speech; native image already shared=${alreadyShared}`,async()=>{
 const start=source.indexOf('  function sendTextNow('),end=source.indexOf('  /* ---------------- NapCat',start);
 const tasks=[],sent=[],errors=[],notices=[],spoken=[];
 const audit={id:'test',status:'completed',userWords:request},actor={key:kind+':12345',kind,chatId:'12345',auditId:audit.id,turnKind:'user'};
 const featureState={generation:0,outbox:alreadyShared?[{id:'shared',accountId:'',auditId:audit.id,chat:actor.key,status:'sent',deliveryKey:'artifact:fixture:part:0',segments:[{type:'image',data:{file:'original.png'}}]}]:[]};
 const deps={calendarSafeText:v=>v,isDesktop,featureState,settings:{voice:{enabled:true,emotion:'auto'},imagegen:{}},groupStopped:()=>false,auditById:()=>audit,stripUnrequestedActions:v=>v,recipientDenial:()=>false,wrongOwnerAddress:()=>false,directMediaIntent,completeMediaReply,explicitlyRequestsImage:requestsImage,removeDuplicatePassages:v=>v,imageFirstReply,independentRequestedVoice,cfg:{plainText:false},replyCharLimit:()=>2000,companionSettings:()=>({}),splitBursts:(v,_n,opts)=>naturalBubbleParts(v,opts),chats:new Map(),state:{chats:{}},stopped:false,accountPaused:false,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),setTimeout:fn=>queueMicrotask(fn),generationBlocked:()=>false,beginGeneration:()=>{},endGeneration:()=>{},beginMediaTask:(_chat,kind)=>{const task={id:'t'+tasks.length,kind,status:'pending',auditId:audit.id};tasks.push(task);return {task};},recordMediaTask:()=>{},saveFeatures:()=>{},finishMediaTask:(task,status,details)=>Object.assign(task,{status,...details}),photoFor:async()=>{throw Error('fixed prompt conflict');},completeMediaShare:()=>{},rememberImageFailure:()=>{},imageFailureReply:()=>notices.push('image'),featureProfile:()=>({}),conversationScope:()=>'',synthesizeVoice:async text=>{spoken.push(text);return 'fixture.mp3';},saveSettings:()=>{},sendSegments:(chat,segments)=>{sent.push({chat,segments});return 'delivery';},burstSegments:text=>[{type:'text',data:{text}}],stickerMessageGroups,replyDeliveryFailure:(_c,e)=>errors.push(e),log:()=>{}};
 const run=Function(...Object.keys(deps),'return ('+source.slice(start,end).trim()+');')(...Object.values(deps));
 run(actor,alreadyShared?'[语音:早上好，今天也慢慢来]':'[图:蓝色杯子]\n[语音:早上好，今天也慢慢来]\n\n杯子拍好了');await actor.sendChain;
 assert.deepEqual(errors,[]);assert.deepEqual(notices,alreadyShared?[]:['image']);assert.deepEqual(spoken,['早上好，今天也慢慢来']);
 assert.equal(tasks.length,alreadyShared?1:2);if(!alreadyShared)assert.equal(tasks[0].status,'failed');assert.equal(tasks.at(-1).status,'queued');
 assert.equal(sent.length,1);assert.equal(sent[0].segments[0].type,'record');assert.equal(sent[0].chat.afterImageId,'');
});

test('a locked workflow conflict is explained after one review, without paid futile redrafting',async()=>{
 let calls=0;
 const studio=createImageStudio({getConfig:()=>({promptLanguage:'en'}),visualPlan:()=>({humanRequest:'静物照片，无人物',prompt:'blue cup on a table',lifeContext:{location:'room'}}),ask:async(system,input)=>{
  calls++;const data=JSON.parse(input);
  if(system.startsWith('【图像细节核对】')){assert.deepEqual(data.requirements.lockedWorkflowPrompts,['1girl, character_token']);assert.match(data.finalPrompt,/character_token/);return JSON.stringify({ok:false,missing:['固定人物词与无人要求冲突'],fixedPromptConflicts:['1girl']});}
  assert.deepEqual(data.lockedWorkflowPrompts,['1girl, character_token']);return JSON.stringify({prompt:'A blue cup rests on a wooden table beside a lemon. Soft window light falls across the ceramic surface and the grain of the wood.'});
 }});
 await assert.rejects(studio.prepare('静物照片',{workflow:{name:'固定人物',triggerWords:'1girl, character_token'}}),e=>e.code==='IMAGE_FIXED_PROMPT_CONFLICT'&&/固定提示词/.test(e.message)&&/尚未提交/.test(e.message));
 assert.equal(calls,2);
});
