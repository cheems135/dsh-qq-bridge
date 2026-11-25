import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,statSync,readdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publicProfileHistory,QQ_SIGNATURE_GUIDANCE} from '../profile-expression.js';
import {createQqNativeCapabilities} from '../qq-native-capabilities.js';
import {audioDeliveryKind,prepareRecordFile} from '../audio-delivery.js';

test('public signature context keeps public history and excludes private replies and help requests',()=>{
  const rows=[{action:'chat',text:'私聊内容'},{action:'signature',text:'旧签名'},{action:'explore',text:'私人活动计划'},{action:'qzone',text:'公开动态'}];
  assert.deepEqual(publicProfileHistory(rows),[{action:'signature',text:'旧签名'},{action:'qzone',text:'公开动态'}]);
  const native=createQqNativeCapabilities({request:async()=>{throw Error('discovery must not publish')}});
  const catalog=native.catalog({accountId:'a',personaId:'p',key:'private:12345',kind:'private',userId:'12345'});
  for(const name of ['set_self_longnick','set_qq_profile'])assert.equal(catalog.find(r=>r.action===name).signatureGuidance,QQ_SIGNATURE_GUIDANCE);
});

test('new and saved audio defaults to QQ record; explicit file delivery keeps the original',()=>{
  for(const file of ['new.wav','saved-cover.mp3','song.FLAC','voice.m4a']){
    assert.equal(audioDeliveryKind(file),'record');
    assert.equal(audioDeliveryKind(file,{delivery:'voice'}),'record');
    assert.equal(audioDeliveryKind(file,{delivery:'file'}),'file');
  }
  assert.equal(audioDeliveryKind('notes.txt'),'file');
});

test('oversized audio uses a separate cached transport copy without trimming or overwriting the source',async()=>{
  const root=mkdtempSync(join(tmpdir(),'qq-record-')),file=join(root,'original.wav'),original=Buffer.alloc(4096,3);writeFileSync(file,original);let calls=0;
  const opts={outputDir:join(root,'transport'),ffmpegPath:'ffmpeg',maxBytes:1024,run:async(_cmd,args)=>{calls++;assert.equal(args.includes('-t'),false);assert.equal(args.includes('-ss'),false);assert.equal(args[args.indexOf('-i')+1],file);const bytes=Buffer.alloc(256);bytes.write('ID3');writeFileSync(args.at(-1),bytes);}};
  try{const result=await prepareRecordFile(file,opts);assert.notEqual(result,file);assert(statSync(result).size<1024);assert.deepEqual(readFileSync(file),original);assert.equal(await prepareRecordFile(file,opts),result);assert.equal(calls,1);assert(!readdirSync(opts.outputDir).some(f=>f.includes('partial')));
    const short=join(root,'short.mp3');writeFileSync(short,Buffer.from('ID3short'));assert.equal(await prepareRecordFile(short,opts),short);assert.equal(calls,1);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('failed conversion cleans its temporary result and cannot turn into a file upload',async()=>{
  const root=mkdtempSync(join(tmpdir(),'qq-record-failed-')),file=join(root,'original.wav');writeFileSync(file,Buffer.alloc(4096,4));
  try{await assert.rejects(prepareRecordFile(file,{outputDir:join(root,'out'),ffmpegPath:'ffmpeg',maxBytes:1024,run:async(_cmd,args)=>{writeFileSync(args.at(-1),'invalid');throw Error('encoder failed');}}),error=>error.code==='VOICE_TRANSPORT_PREPARE_FAILED'&&error.submitted===false);assert.deepEqual(readdirSync(join(root,'out')),[]);assert.equal(statSync(file).size,4096);}finally{rmSync(root,{recursive:true,force:true});}
});
