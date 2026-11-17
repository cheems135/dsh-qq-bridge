import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {outgoingMediaEvidence,recentSentMediaContext} from '../outgoing-media-evidence.js';

const imageFile = 'D:\\images\\portrait.png';
const imageSegment = {type:'image',data:{file:pathToFileURL(imageFile).href}};

test('only QQ-accepted media puts its requested content into dialogue history', () => {
  const task = {id:'image-task',deliveryId:'delivery-1',file:imageFile,request:'穿蓝色外套在雨后的街边自拍',prompt:'雨后街边，蓝色外套，前置自拍'};
  const job = {id:'delivery-1',mediaTaskId:'image-task',status:'queued',segments:[imageSegment]};
  const queued = outgoingMediaEvidence(job,{mediaTask:task});
  assert.equal(queued.text,'[图片]');
  assert.deepEqual(queued.media,[]);

  job.status='sent';job.messageId='qq-123';
  const accepted = outgoingMediaEvidence(job,{mediaTask:task});
  assert.match(accepted.text,/画面要求：穿蓝色外套在雨后的街边自拍/);
  assert.match(accepted.text,/生成提示词：雨后街边/);
  assert.match(accepted.text,/成品画面未视觉复核/);
  assert.match(accepted.text,/QQ已接收，尚未读回/);
  assert.equal(accepted.media[0].file,imageSegment.data.file);
  assert.equal(accepted.media[0].visualVerified,false);
  assert.equal(accepted.media[0].qqObserved,false);

  job.verification={state:'observed'};
  const observed = outgoingMediaEvidence(job,{mediaTask:task});
  assert.match(observed.text,/QQ记录已读回/);
  assert.equal(observed.media[0].qqObserved,true);
});

test('a media task from another file cannot describe the sent attachment', () => {
  const job={id:'delivery-2',mediaTaskId:'image-task',status:'sent',messageId:'qq-456',segments:[imageSegment]};
  const mismatch=outgoingMediaEvidence(job,{mediaTask:{id:'image-task',file:'D:\\images\\other.png',request:'一只黑猫',visualInspection:{description:'黑猫坐在窗前',ok:true,missing:[]}}});
  assert.doesNotMatch(mismatch.text,/黑猫/);
  assert.match(mismatch.text,/成品画面未视觉复核/);
  assert.equal(mismatch.media[0].visualVerified,false);
});

test('structured visual inspection is attributed to the sent image as a fallible observation', () => {
  const job={id:'delivery-visual',mediaTaskId:'visual-task',status:'sent',messageId:'qq-789',segments:[imageSegment]};
  const task={id:'visual-task',file:imageFile,request:'角色穿蓝色外套在雨后自拍',visualInspection:{file:imageFile,description:'画面里角色站在雨后街边，外套偏灰',ok:false,missing:['外套不是蓝色']}};
  const result=outgoingMediaEvidence(job,{mediaTask:task});
  assert.match(result.text,/视觉模型对成品的观察（可能有误）：画面里角色站在雨后街边/);
  assert.match(result.text,/与要求的差异：外套不是蓝色/);
  assert.doesNotMatch(result.text,/成品画面未视觉复核/);
  assert.equal(result.media[0].visualVerified,true);
  assert.equal(result.media[0].visualMatch,false);
  assert.deepEqual(result.media[0].visualMissing,['外套不是蓝色']);

  const invalid=outgoingMediaEvidence(job,{mediaTask:{...task,visualInspection:{description:'没有结构化判断',ok:true}}});
  assert.equal(invalid.media[0].visualVerified,false);
  assert.match(invalid.text,/成品画面未视觉复核/);
  const wrongFile=outgoingMediaEvidence(job,{mediaTask:{...task,visualInspection:{...task.visualInspection,file:'D:\\images\\other.png'}}});
  assert.equal(wrongFile.media[0].visualVerified,false);
});

test('video and speech retain their generation request and actual TTS input separately', () => {
  const videoFile='D:\\videos\\clip.mp4';
  const video={id:'video-1',deliveryId:'delivery-v',file:videoFile,args:{prompt:'夜晚在窗边挥手',actionPrompt:'先抬手，随后挥两下'},prepared:{prompt:'夜晚窗边角色，暖光，镜头中景'}};
  const videoJob={id:'delivery-v',deliveryKey:'video:video-1',status:'sent',messageId:'qq-video',segments:[{type:'video',data:{file:pathToFileURL(videoFile).href}}]};
  const output=outgoingMediaEvidence(videoJob,{videoJob:video});
  assert.match(output.text,/生成请求：夜晚在窗边挥手/);
  assert.match(output.text,/动作：先抬手/);
  assert.equal(output.media[0].prompt,'夜晚窗边角色，暖光，镜头中景');

  const speech=outgoingMediaEvidence({id:'delivery-s',status:'sent',messageId:'qq-speech',localTranscript:'我在这儿，刚看到你的消息',segments:[{type:'record',data:{file:'D:\\audio\\voice.wav'}}]});
  assert.match(speech.text,/送入合成器的台词：我在这儿/);
  assert.match(speech.text,/音频未转写核对/);
  assert.doesNotMatch(speech.text,/成品画面/);
});

test('persistent API sessions receive only accepted same-chat media in a bounded follow-up', () => {
  const now=Date.parse('2026-11-16T12:00:00Z');
  const media=[{type:'image',file:'portrait.png'}];
  const rows=[
    {dir:'out',chat:'private:owner',accountId:'a',personaId:'p',delivery:'queued',time:now-1000,text:'排队中的图',media},
    {dir:'out',chat:'private:other',accountId:'a',personaId:'p',delivery:'sent',time:now-1000,text:'别人的图',media},
    {dir:'out',chat:'private:owner',accountId:'a',personaId:'p',delivery:'sent',time:now-11*60_000,text:'旧图，发出时只知道请求内容',media},
    {dir:'out',chat:'private:owner',accountId:'a',personaId:'p',delivery:'sent',time:now-1000,text:'刚发的图，实际画面未复核',media},
  ];
  const scope={chat:'private:owner',accountId:'a',personaId:'p',now};
  const spontaneous=recentSentMediaContext(rows,scope);
  assert.match(spontaneous,/刚发的图/);
  assert.doesNotMatch(spontaneous,/排队中的图|别人的图|旧图/);
  const asked=recentSentMediaContext(rows,{...scope,userWords:'你上次发的照片是什么内容'});
  assert.match(asked,/旧图/);
  assert.match(asked,/刚发的图/);
});

test('the next turn sees the observed image before a long generation prompt', () => {
  const now=Date.now();
  const row={dir:'out',chat:'private:owner',accountId:'a',personaId:'p',delivery:'sent',time:now-1000,
    text:'[图片；画面要求：在海边自拍；生成提示词：'+ '长'.repeat(1600) + '；视觉模型观察：海边自拍]',
    media:[{type:'image',request:'在海边自拍',prompt:'长'.repeat(1600),visualVerified:true,
      visualDescription:'角色站在海边，举手自拍，头发被风吹起',visualMissing:[],qqObserved:true}]};
  const context=recentSentMediaContext([row],{chat:'private:owner',accountId:'a',personaId:'p',now});
  assert.match(context,/角色站在海边，举手自拍/);
  assert.match(context,/QQ记录已读回/);
  assert.ok(context.length<800);
});
