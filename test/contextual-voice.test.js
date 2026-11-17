import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import path from 'node:path';
import * as voice from '../voice-studio.js';
import {composeDirection} from '../voice-performance.js';
import {voicePromptInstructions,promptPreferenceRule} from '../prompt-preferences.js';
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8').replaceAll('\r\n','\n');
const bytes=Buffer.alloc(1200);bytes.write('ID3');
const direction='带着委屈哭着说，句间有抽噎，仍努力把话说完整';
const config={engine:'breeze',emotion:'auto',breeze:{mode:'official',apiKey:'fixture',voiceId:'voc_same',guidance:2}};
test('ordinary speech uses contextual direction without invented events, automatic tags or voice distortion cues',async()=>{
 for(const emotion of ['crying','afraid','angry','laugh','excited']){
  const planned=voice.resolveVoiceDelivery(config,{text:'嗯，你终于回来了呀…'},{delivery:{emotion,instructions:direction}});
  let payload;await voice.breezeSpeech('嗯，你终于回来了呀…',config,planned,async(_url,req)=>{payload=JSON.parse(req.body);return new Response(bytes);});
  assert.equal(payload.text,'嗯，你终于回来了呀…');assert.equal(payload.voice_settings.guidance_scale,2);
  assert.match(payload.instructions,/保留所选声音的音色身份和口音/);assert.match(payload.instructions,/句间有抽噎/);
  assert.doesNotMatch(payload.instructions,/基频|嗓音粗糙|被打|想让他心软|但不喊/);
 }
});
test('short instructions are idempotent and retain identity protection even after clipping',()=>{
 for(const mood of ['crying','afraid','angry','excited','laugh']){
  const base=composeDirection({mood});assert.doesNotMatch(base,/被人弄哭|他心软|被吓到|失约/);
  assert.equal(composeDirection({mood,userDirection:base}),base);
  const long=composeDirection({mood,userDirection:direction+'，'+('当前要求，'.repeat(70)),extra:'不添加其他人的声音'});
  assert(long.length<=160);assert(long.startsWith(direction));assert.match(long,/保留所选声音的音色身份和口音/);
 }
 const english=composeDirection({mood:'angry',language:'en',userDirection:'Speak angrily but keep the same voice.'});assert.doesNotMatch(english,/[\u4e00-\u9fff]/);assert.equal(composeDirection({mood:'angry',language:'en',userDirection:english}),english);
});
test('private and group use the real host speech function with the same voice and direction policy',async()=>{
 const start=source.indexOf('  async function synthesizeVoice('),end=source.indexOf('  function registerVoiceStudio(',start),stored=new Map(),requests=[];
 const ctx={operationText:x=>x,promptPreferenceRule:()=>"写作规则：140到240字",serviceRoutingEpoch:0,featureState:{generation:0},randomUUID:()=>"test",recordInvocation:()=>{},invocationScope:()=>({}),inspectVoiceFile:()=>({durationCheck:"unavailable"}),...voice,Buffer,AbortSignal,Error,JSON,Date,settings:{voice:config,localChat:{enabled:false}},serviceSource:()=>'',serviceConnections:null,isDesktop:true,mkdirSync:()=>{},voiceDir:'cache',join:path.join,existsSync:f=>stored.has(f),statSync:f=>({size:stored.get(f).length}),writeFileSync:(f,b)=>stored.set(f,b),featureProfile:()=>({}),promptPreferences:{snapshot:()=>({values:{voice:{customText:'通常使用140—240个汉字，按照模板编写发声说明。末尾只写一次音色。'}}})},voicePromptInstructions,saveSettings:()=>{},log:()=>{},panelOperationKey:()=>'',singingLibrary:null,reviewOperation:async()=>({delivery:{emotion:'crying',instructions:direction}}),
  breezeSpeech:async(line,c,options)=>voice.breezeSpeech(line,c,options,async(url,request)=>{requests.push({url,payload:JSON.parse(request.body)});return new Response(bytes);})};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nthis.run=synthesizeVoice;',ctx);
 await ctx.run('你终于回来了','private:test');await ctx.run('原来你也在这里','group:test');
 assert.equal(requests.length,2);for(const r of requests){assert.match(r.url,/voc_same/);assert.doesNotMatch(r.payload.text,/\[/);assert.match(r.payload.instructions,/保留所选声音/);assert.equal(r.payload.voice_settings.guidance_scale,2);assert.doesNotMatch(r.payload.instructions,/140|模板|末尾只写/);}
 ctx.reviewOperation=async()=>{ctx.serviceRoutingEpoch++;return {delivery:{emotion:'crying',instructions:direction}};};
 await assert.rejects(ctx.run('切换模式后的旧语音','private:test'),/来源或账号已改变/);assert.equal(requests.length,2,'mode change must stop before paid TTS');
});
test('generic API speech receives contextual guidance for both private and group without a duplicate review',async()=>{
 const start=source.indexOf('  async function connectedSpeech('),end=source.indexOf('  async function prepareConnectionVisual(',start),calls=[],reviews=[];
 const ctx={...voice,Buffer,Error,JSON,settings:{voice:{emotion:'auto'}},promptPreferences:{snapshot:()=>({values:{voice:{customText:'通常使用140—240个汉字，按照模板编写发声说明。末尾只写一次音色。'}}})},promptPreferenceRule,voicePromptInstructions,resolveVoiceDelivery:voice.resolveVoiceDelivery,operationText:x=>x,panelOperationKey:()=>'',reviewOperation:async(_kind,_line,key)=>{reviews.push(key);return {delivery:{emotion:'crying',instructions:direction}};},serviceConnections:{profile:()=>({name:'Generic',voice:'chosen-voice',speechModel:'test'})},randomUUID:()=>String(calls.length),invocationScope:()=>({}),featureState:{generation:1},recordInvocation:()=>{},apiModeController:new AbortController(),connectionMedia:async(profile,_kind,input)=>{calls.push({profile,input});return {bytes,extension:'mp3'};},mkdirSync:()=>{},voiceDir:'cache',join:path.join,writeFileSync:()=>{},log:()=>{}};
 vm.createContext(ctx);vm.runInContext(source.slice(start,end)+'\nthis.run=connectedSpeech;',ctx);
 await ctx.run('你好','private:test',{},'profile:test');await ctx.run('大家好','group:test',{},'profile:test');await ctx.run('再见','private:test',{operationReview:{delivery:{emotion:'natural',instructions:'按平常的语气告别'}}},'profile:test');
 assert.deepEqual(reviews,['private:test','group:test']);assert.equal(calls.length,3);for(const c of calls){assert.match(c.input.instructions,/保留所选声音/);assert.equal(c.profile.voice,'chosen-voice');assert.doesNotMatch(c.input.instructions,/140|模板|末尾只写/);assert.doesNotMatch(c.input.text,/\[/);}
});
test('MiniMax combined emotion produces real audio instead of returning an instruction object',async()=>{
 let payload;const result=await voice.miniMaxSpeech('你好',{engine:'minimax',minimax:{apiKey:'fixture',voiceId:'same'}},{emotion:'crying+afraid',emotionHint:'哭腔+害怕'},async(_url,req)=>{payload=JSON.parse(req.body);return Response.json({base_resp:{status_code:0},data:{audio:bytes.toString('hex')}});});
 assert(Buffer.isBuffer(result.bytes));assert.equal(payload.voice_setting.voice_id,'same');assert.equal(payload.voice_setting.emotion,'sad');assert.equal(payload.text,'你好');
});
