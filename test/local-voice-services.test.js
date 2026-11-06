import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeVoiceService,requestLocalSpeech,serviceVoices,releaseVoiceService,voiceEndpoint} from '../local-voice.js';
import {normalizeLocalConfig,publicLocalConfig} from '../local-config.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVE',8);

test('local speech configuration preserves old installation, edits arbitrary service paths, and protects saved keys',()=>{
 const legacy=normalizeLocalConfig({});assert.equal(legacy.voiceService.type,'voicelab');
 const s=normalizeLocalConfig({voiceService:{type:'openai',baseUrl:'http://192.168.1.8:8008/v1',model:'any-tts',apiKey:'secret-test',directory:'D:/anywhere/voice'}});
 assert.equal(publicLocalConfig(s).voiceService.apiKey,'');assert.equal(publicLocalConfig(s).voiceService.hasApiKey,true);
 assert.equal(normalizeLocalConfig({voiceService:{apiKey:''}},s).voiceService.apiKey,'secret-test');
 assert.equal(normalizeLocalConfig({voiceService:{baseUrl:'http://127.0.0.1:7777'}},s).voiceService.apiKey,'');
 assert.equal(normalizeLocalConfig({voiceService:{clearApiKey:true}},s).voiceService.apiKey,'');
 assert.throws(()=>normalizeVoiceService({type:'json',bodyTemplate:'{}'}),/text/);
 for(const url of ['https://example.com','file:///abc','http://127.0.0.1:8777'])assert.throws(()=>normalizeVoiceService({baseUrl:url}));
 assert.throws(()=>voiceEndpoint('http://localhost:8000','http://127.0.0.1:8001/audio'));
});

test('OpenAI compatible local speech sends the chosen model and voice to the chosen endpoint with no VoiceLab dependency',async()=>{
 const s=normalizeVoiceService({type:'openai',baseUrl:'http://localhost:8009/v1',model:'custom-model',apiKey:'fake'});let calls=0;
 const bytes=await requestLocalSpeech(s,{text:'你好“测试”\n第二行',voice:'speaker-any',instruction:'温柔',fetchImpl:async(url,o)=>{calls++;assert.equal(url,'http://localhost:8009/v1/audio/speech');assert.equal(o.redirect,'error');assert.equal(o.headers.authorization,'Bearer fake');assert.deepEqual(JSON.parse(o.body),{model:'custom-model',input:'你好“测试”\n第二行',voice:'speaker-any',response_format:'wav',instructions:'温柔'});return new Response(wav);}});
 assert.deepEqual(bytes,wav);assert.equal(calls,1);assert.deepEqual(await serviceVoices(s),[]);
});

test('custom local JSON speech maps nested fields safely and validates base64/audio URL results',async()=>{
 for(const mode of ['audio','base64','url']){
  const s=normalizeVoiceService({type:'json',baseUrl:'http://127.0.0.1:9009',ttsPath:'/speak',responseMode:mode,responseField:'data.sound',bodyTemplate:JSON.stringify({content:{text:'{{text}}'},speaker:'{{voice}}',speed:1.2,stream:false})});let submissions=0,downloads=0;
  const bytes=await requestLocalSpeech(s,{text:'"text"\n换行',voice:'id',fetchImpl:async(url,o)=>{
   if(o.method==='POST'){submissions++;assert.deepEqual(JSON.parse(o.body),{content:{text:'"text"\n换行'},speaker:'id',speed:1.2,stream:false});return mode==='audio'?new Response(wav):Response.json({data:{sound:mode==='base64'?wav.toString('base64'):'/outputs/speech.wav'}});}
   downloads++;assert.equal(url,'http://127.0.0.1:9009/outputs/speech.wav');return new Response(wav);
  }});assert.deepEqual(bytes,wav);assert.equal(submissions,1);assert.equal(downloads,mode==='url'?1:0);
 }
 const s=normalizeVoiceService({type:'json',responseMode:'url'});let n=0;
 await assert.rejects(requestLocalSpeech(s,{text:'hi',fetchImpl:async()=>{n++;return Response.json({audio:'https://example.com/leak'});}}),/同站点/);assert.equal(n,1);
 await assert.rejects(requestLocalSpeech(normalizeVoiceService({type:'openai',model:'x'}),{text:'hi',fetchImpl:async()=>Response.json({error:'not audio'})}),/WAV/);
});

test('custom GPU speech release preserves busy work, CPU skips unload, unmanaged GPU cannot claim released',async()=>{
 let calls=0;const fetchImpl=async(url,o)=>{calls++;return Response.json({busy:true,loaded:true});};
 assert.equal(await releaseVoiceService(normalizeVoiceService({type:'json',device:'cpu'}),{fetchImpl}),true);assert.equal(calls,0);
 assert.equal(await releaseVoiceService(normalizeVoiceService({type:'json'}),{fetchImpl}),false);assert.equal(calls,0);
 assert.equal(await releaseVoiceService(normalizeVoiceService({type:'json',statusPath:'/state',unloadPath:'/unload'}),{fetchImpl}),false);assert.equal(calls,1);
});

test('actual speech HTTP route picks changed local providers without restarting, returns audio once and never calls a chat API',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-speech-services-'));let service;
 try{
  const file=join(dir,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:true,mediaDir:dir,voicePreset:'speaker',voiceService:{type:'openai',baseUrl:'http://127.0.0.1:8888/v1',model:'a',device:'cpu'}}));let submitted=[];
  service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>{throw Error('CPU speech must not unload chat');}},fetchImpl:async(url,o={})=>{if(o.method==='POST'){submitted.push(url);assert.ok(url.endsWith('/audio/speech')||url.endsWith('/custom'));return new Response(wav);}return Response.json({data:[]});}});
  const base=await listenLocalServer(service);
  let r=await fetch(base+'/v1/audio/speech',{method:'POST',body:JSON.stringify({input:'你好'})});assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),wav);
  r=await fetch(base+'/config',{method:'POST',body:JSON.stringify({voiceService:{type:'json',baseUrl:'http://127.0.0.1:9999',ttsPath:'/custom',device:'cpu'}})});assert.equal(r.status,200);
  r=await fetch(base+'/v1/audio/speech',{method:'POST',body:JSON.stringify({input:'再试一次'})});assert.equal(r.status,200);
  assert.deepEqual(submitted,['http://127.0.0.1:8888/v1/audio/speech','http://127.0.0.1:9999/custom']);
  const saved=JSON.parse(readFileSync(file));assert.equal(saved.voiceService.baseUrl,'http://127.0.0.1:9999');
 }finally{if(service)await service.close();rmSync(dir,{recursive:true,force:true});}
});
