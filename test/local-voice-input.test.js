import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,existsSync,mkdirSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  const sleepVoiceTranscriptions='),source.indexOf('  /** 链接：'));

test('local QQ voice input uses CPU audio analysis even when an API key is configured, and never uploads audio',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-voice-input-')),record=join(directory,'received.wav');writeFileSync(record,'RIFF0000WAVEfmt ');let uploads=0,analyses=0;
 const sandbox={Buffer,AbortSignal,FormData,Blob,readFileSync,writeFileSync,existsSync,mkdirSync,unlinkSync,randomUUID,join,cacheRoot:directory,settings:{media:{asrApiKey:'FAKE_TEST_KEY'}},featureState:{generation:1},log:()=>{},request:async()=>({file:record}),audioAnalysis:{status:()=>({available:true}),analyze:async(args,context)=>{analyses++;assert.equal(context.localVoice,true);assert.equal(args.transcribe,true);assert.ok(context.signal);return {transcription:{segments:[{text:'我刚画完一只猫。'}]}};}},fetch:async()=>{uploads++;return Response.json({text:'兼容API转写'});}};
 sandbox.isDesktop=true;
 vm.createContext(sandbox);vm.runInContext(block+'\nthis.transcribe=transcribeRecord;',sandbox);
 try{assert.equal(await sandbox.transcribe({file:'qq-record-id'},{localOnly:true,signal:AbortSignal.timeout(3000)}),'我刚画完一只猫。');assert.equal(analyses,1);assert.equal(uploads,0);
  sandbox.audioAnalysis.status=()=>({available:false});assert.equal(await sandbox.transcribe({file:'qq-record-id'},{localOnly:true}),'');assert.equal(uploads,0);
  assert.equal(await sandbox.transcribe({file:'qq-record-id'}),'兼容API转写');assert.equal(uploads,1);
  sandbox.isDesktop=false;sandbox.audioAnalysis.status=()=>({available:true});assert.equal(await sandbox.transcribe({file:'qq-record-id'}),'兼容API转写');assert.equal(uploads,2);assert.equal(analyses,1);
  sandbox.settings.media.asrApiKey='';assert.equal(await sandbox.transcribe({file:'qq-record-id'}),'');assert.equal(analyses,1);assert.equal(uploads,2);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
