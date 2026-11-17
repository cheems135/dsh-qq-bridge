import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {transcribeCompanionAudio} from '../companion-input-audio.js';
const audio={data:Buffer.from('1a45dfa300000000','hex').toString('base64'),mediaType:'audio/webm'};
test('microphone STT in local mode never uploads audio even when API credentials exist',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'companion-mic-'));let api=0,local=0;
 try{
  const text=await transcribeCompanionAudio(audio,{localOnly:true,media:{asrApiKey:'fixture'},cacheDir:directory,context:{localVoice:true,generation:1},analysis:{status:()=>({transcription:true}),analyze:async(args,c)=>{local++;assert.equal(c.localVoice,true);assert.equal(args.voiceInput,true);return {transcription:{segments:[{text:'你看到刚才那个了吗'}]}};}},fetchImpl:async()=>{api++;throw Error('must not upload');}});
  assert.equal(text,'你看到刚才那个了吗');assert.equal(local,1);assert.equal(api,0);assert.deepEqual(readdirSync(join(directory,'companion-microphone')),[]);
  await assert.rejects(transcribeCompanionAudio(audio,{localOnly:true,media:{asrApiKey:'fixture'},analysis:{status:()=>({transcription:false})},fetchImpl:async()=>{api++;}}),/没有上传云端/);assert.equal(api,0);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test('API STT uses explicit saved ASR settings and keeps recognized text separate from sending',async()=>{
 const text=await transcribeCompanionAudio(audio,{media:{asrApiKey:'fixture',asrBaseUrl:'https://example.com/v1',asrModel:'chosen-asr'},fetchImpl:async(url,options)=>{assert.equal(url.href,'https://example.com/v1/audio/transcriptions');assert.equal(options.body.get('model'),'chosen-asr');assert.equal(options.headers.authorization,'Bearer fixture');return Response.json({text:'可以修改的转写'});}});
 assert.equal(text,'可以修改的转写');
 await assert.rejects(transcribeCompanionAudio({data:'bad',mediaType:'audio/webm'}),/录音/);
});
