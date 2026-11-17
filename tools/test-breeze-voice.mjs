import assert from 'node:assert';
import {breezeSpeech,breezeExtras,voiceExtras,safeVoiceConfig,voiceCacheKey,breezeChunks} from '../voice-studio.js';

const mp3=Buffer.concat([Buffer.from([0x49,0x44,0x33,0x04]),Buffer.alloc(2000,1)]);
function fakeFetch(check){return async (url,init)=>{check(url,init);return new Response(mp3,{status:200,headers:{'content-type':'audio/mpeg'}});};}

// official
let seen;
const r1=await breezeSpeech('你好呀',{engine:'breeze',breeze:{mode:'official',apiKey:'brz_test',voiceId:'voc_abc',language:'zh',instructions:'低声说'}},{},fakeFetch((url,init)=>{
  seen={url,init,body:JSON.parse(init.body)};
}));
assert.equal(seen.url,'https://api.breeze.blue/v1/text-to-speech/voc_abc?output_format=mp3');
assert.equal(seen.init.headers['xi-api-key'],'brz_test');
assert.deepEqual(seen.body.voice_settings,{guidance_scale:2});
assert.equal(seen.body.instructions,'低声说');
assert.equal(r1.format,'mp3');assert.ok(r1.bytes.length>1000);

// self-host
const r2=await breezeSpeech('测试自建',{engine:'breeze',breeze:{mode:'openai',baseUrl:'http://127.0.0.1:8091/v1/',voiceId:'S3'}},{},fakeFetch((url,init)=>{
  seen={url,init,body:JSON.parse(init.body)};
}));
assert.equal(seen.url,'http://127.0.0.1:8091/v1/audio/speech');
assert.equal(seen.init.headers.authorization,undefined);
assert.equal(seen.body.voice,'S3');
assert.equal(seen.body.model,'BreezeBlue/Breeze-TTS-2');
assert.equal(r2.format,'mp3');

// wav sniff
const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(2000,2)]);
const r3=await breezeSpeech('wav',{engine:'breeze',breeze:{mode:'openai'}},{},async()=>new Response(wav,{status:200,headers:{'content-type':'audio/wav'}}));
assert.equal(r3.format,'wav');

// missing key / voice
await assert.rejects(()=>breezeSpeech('x',{breeze:{mode:'official'}},{},fakeFetch(()=>{})),/Breeze API Key/);
await assert.rejects(()=>breezeSpeech('x',{breeze:{mode:'official',apiKey:'k'}},{},fakeFetch(()=>{})),/音色 ID/);

// http error surfaces json detail, key redacted
const errFetch=async()=>new Response(JSON.stringify({detail:'invalid voice voc_x'}),{status:404,headers:{'content-type':'application/json'}});
await assert.rejects(()=>breezeSpeech('x',{breeze:{mode:'official',apiKey:'brz_secret',voiceId:'voc_x'}},{},errFetch),(e)=>{
  assert.match(e.message,/HTTP 404/);assert.match(e.message,/invalid voice/);assert.ok(!e.message.includes('brz_secret'));return true;
});

// config normalization + masking
const extras=breezeExtras({breeze:{mode:'openai',baseUrl:'https://my.host/v1',voiceId:' S1 ',language:'EN',guidance:99,apiKey:'k'}});
assert.equal(extras.baseUrl,'https://my.host');
assert.equal(extras.voiceId,'S1');assert.equal(extras.language,'en');assert.equal(extras.guidance,10);
const masked=safeVoiceConfig({engine:'breeze',breeze:{mode:'official',apiKey:'brz_secret',voiceId:'voc_a'}});
assert.equal(masked.breeze.apiKey,'');assert.equal(masked.breeze.hasKey,true);assert.equal(masked.breeze.voiceId,'voc_a');
assert.match(voiceCacheKey('hi',{engine:'breeze',breeze:{apiKey:'a'}},{voice:'voc_a'}),/^[\da-f]{32}$/);
assert.notEqual(voiceCacheKey('hi',{engine:'breeze',breeze:{apiKey:'a'}},{voice:'voc_a'}),voiceCacheKey('hi',{engine:'breeze',breeze:{apiKey:'b'}},{voice:'voc_a'}));
assert.equal(voiceExtras({}).breeze.mode,'official');
assert.equal(voiceExtras({}).breeze.baseUrl,'https://api.breeze.blue');

// 长文本按句切分并顺序拼接
assert.deepEqual(breezeChunks('短句'),['短句']);
const long='她今天很好。'.repeat(200);
const chunks=breezeChunks(long);
assert.ok(chunks.length>1&&chunks.every(c=>c.length<=900));
assert.equal(chunks.join(''),long);
let calls=0;
const merged=await breezeSpeech(long,{breeze:{mode:'official',apiKey:'k',voiceId:'voc_a'}},{},async(url,init)=>{
  calls++;
  const body=JSON.parse(init.body);
  assert.ok(body.text.length<=900);
  assert.ok(long.includes(body.text.slice(0,4)));
  return new Response(mp3,{status:200,headers:{'content-type':'audio/mpeg'}});
});
assert.equal(calls,chunks.length);
assert.equal(merged.parts,calls);
assert.equal(merged.bytes.length,mp3.length*calls);
// 自建返回 WAV 时不允许拼长文本
await assert.rejects(()=>breezeSpeech(long,{breeze:{mode:'openai'}},{},async()=>new Response(Buffer.concat([Buffer.from('RIFF'),Buffer.alloc(2000,2)]),{status:200})),/WAV/);
console.log('breeze voice tests passed');
