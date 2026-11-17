import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeHearing,hearingContext,requestAudioTranscription,createLiveHearing} from '../hearing-evidence.js';
import {transcribeCompanionAudio} from '../companion-input-audio.js';
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('real recognizer labels survive separately from words; ordinary ASR does not invent emotions',()=>{
 const h=normalizeHearing({text:'<|zh|><|HAPPY|><|Laughter|><|withitn|>终于成功了'});
 assert.equal(h.text,'终于成功了');assert.deepEqual(h.labels.map(l=>l.label),['开心','笑声']);assert(h.labels.every(l=>l.status==='candidate'));
 assert.match(hearingContext(h),/可能错误/);assert.equal(normalizeHearing({text:'真开心'}).labels.length,0);
 assert.equal(normalizeHearing({text:'<|unknown|>你好',apiKey:'secret'}).text,'你好');assert.doesNotMatch(JSON.stringify(h),/secret/);
 const conflict=normalizeHearing({transcription:{segments:[{text:'听见了吗',start:0,end:1}]},acoustic:{kind:'silence'}});assert(conflict.conflict);assert.match(conflict.coverage,/冲突/);
});
test('microphone detailed mode preserves vocal events and normal mode keeps editable text',async()=>{
 const audio={data:Buffer.from('1a45dfa300000000','hex').toString('base64'),mediaType:'audio/webm'},options={media:{asrApiKey:'test',asrBaseUrl:'https://example.test/v1',asrModel:'custom'},fetchImpl:async()=>Response.json({text:'<|SAD|><|Cry|>还没想好'})};
 assert.equal(await transcribeCompanionAudio(audio,options),'还没想好');
 const detail=await transcribeCompanionAudio(audio,{...options,detailed:true});assert.equal(detail.text,'还没想好');assert.equal(detail.labels.length,2);
});
test('all ASR requests honor saved model and endpoint without leaking credentials or duplicating the path',async()=>{
 let calls=0;const media={asrApiKey:'fixture-private-key',asrBaseUrl:'https://voice.example/custom/audio/transcriptions/',asrModel:'chosen-model'};
 const h=await requestAudioTranscription(Buffer.from('audio'),media,{fetchImpl:async(url,request)=>{calls++;assert.equal(url.href,'https://voice.example/custom/audio/transcriptions');assert.equal(request.body.get('model'),'chosen-model');assert.equal(request.headers.authorization,'Bearer fixture-private-key');return Response.json({text:'你好',emotion:'angry'});}});
 assert.equal(calls,1);assert.equal(h.labels[0].label,'生气');assert.doesNotMatch(JSON.stringify(h),/fixture-private-key/);
 await assert.rejects(requestAudioTranscription(Buffer.from('audio'),{...media,asrBaseUrl:'https://user:pass@example.com/v1'}),/HTTPS/);
 await assert.rejects(requestAudioTranscription(Buffer.from('audio'),{...media,asrApiKey:''}),/配置/);
});
test('live ASR never blocks vision, queues old chunks, or charges twice for the same chunk',async()=>{
 let now=100000,calls=0,resolve;
 const hearing=createLiveHearing({now:()=>now,recognize:async()=>{calls++;return new Promise(r=>resolve=r);}}),context={visualSessionId:'one'};
 try{
  assert.equal(hearing.observe({at:now,data:'a'},context),null);await settle();assert.equal(calls,1);
  now+=1000;hearing.observe({at:now,data:'b'},context);assert.equal(calls,1);
  resolve({text:'当前片段',labels:[]});await settle();assert.equal(hearing.observe(null,context).text,'当前片段');
  now+=8000;hearing.observe({at:now,data:'c'},context);await settle();assert.equal(calls,2);resolve({text:'新的片段'});await settle();
  hearing.observe({at:now,data:'c'},context);await settle();assert.equal(calls,2);
 }finally{hearing.close();}
});
test('expired ASR or revoked sessions never submit old sounds into a new frame',async()=>{
 let now=100000,current=true,resolve;const hearing=createLiveHearing({now:()=>now,valid:()=>current,recognize:()=>new Promise(r=>resolve=r)}),context={visualSessionId:'old'};
 try{hearing.observe({at:now},context);await settle();now+=13000;resolve({text:'过时声音'});await settle();assert.equal(hearing.observe(null,context),null);
  hearing.observe({at:now},context);await settle();current=false;hearing.release('old');resolve({text:'旧账号声音'});await settle();assert.equal(hearing.observe(null,context),null);
 }finally{hearing.close();}
});
