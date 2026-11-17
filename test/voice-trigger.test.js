import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import os from 'node:os';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
const sourceRoot=process.env.QQ_VOICE_SOURCE||fileURLToPath(new URL('../',import.meta.url));
const voice=await import(pathToFileURL(path.join(sourceRoot,'voice-studio.js')));
const {voiceExtras,voiceScene,sceneNames,resolveVoiceDelivery,breezeDelivery,breezeSpeech,voiceCacheKey}=voice;
const source=fs.readFileSync(path.join(sourceRoot,'index.js'),'utf8').replace(/\r\n/g,'\n');
function host(config){
 const begin=source.indexOf('  async function synthesizeVoice('),end=source.indexOf('  function registerVoiceStudio(',begin);assert.ok(begin>0&&end>begin);
 const stored=new Map(),calls=[];const settings={voice:{engine:'breeze',emotion:'auto',breeze:{mode:'official',apiKey:'mock',voiceId:'voc_test'},...config},localChat:{enabled:false}};
 const context={operationText:x=>x,promptPreferenceRule:()=>"写作规则：140到240字",serviceRoutingEpoch:0,featureState:{generation:0},randomUUID:()=>"test",recordInvocation:()=>{},invocationScope:()=>({}),inspectVoiceFile:()=>({durationCheck:"unavailable"}),...voice,Buffer,AbortSignal,Error,JSON,Date,settings,serviceSource:()=>'',serviceConnections:null,isDesktop:true,mkdirSync:()=>{},voiceDir:'test-cache',join:path.join,existsSync:f=>stored.has(f),statSync:f=>({size:stored.get(f).length}),writeFileSync:(f,b)=>stored.set(f,b),breezeSpeech:async(line,c,opts)=>{calls.push({line,options:opts,delivery:breezeDelivery(line,c,opts)});return {format:'mp3',bytes:Buffer.alloc(1200)};},featureProfile:()=>({}),promptPreferences:{snapshot:()=>({values:{}})},voicePromptInstructions:x=>x,saveSettings:()=>{},log:()=>{},panelOperationKey:()=>'',reviewOperation:async()=>({delivery:{emotion:'natural',instructions:'自然说话'}}),singingLibrary:null};
 vm.createContext(context);vm.runInContext(source.slice(begin,end)+'\nthis.synthesizeVoice=synthesizeVoice;',context);return {synthesize:context.synthesizeVoice,calls,stored};
}
test('all saved scene selections survive settings normalization and review',()=>{
 for(const scene of sceneNames()){
  assert.equal(voiceExtras({emotion:scene}).emotion,scene,scene);
  const out=resolveVoiceDelivery({emotion:scene},{text:'今天我想早点休息。'},{delivery:{emotion:'natural'}});
  assert.equal(out.emotion,scene,scene);assert.equal(breezeDelivery('今天我想早点休息。',{},out).scene,scene);
 }
 assert.equal(voiceExtras({emotion:'crying+afraid'}).emotion,'crying+afraid');
 assert.equal(voiceExtras({emotion:'invalid-scene'}).emotion,'auto');
});
test('actual host preserves marked scene, no cached ordinary recording replaces it',async()=>{
 const h=host();const line='今天我想早点休息。';
 await h.synthesize(line,'private:test',{emotionHint:'刚睡醒'});
 await h.synthesize(line,'private:test',{emotionHint:'电话里'});
 await h.synthesize(line,'private:test',{emotionHint:'刚睡醒'});
 assert.equal(h.calls.length,2);assert.deepEqual(h.calls.map(c=>c.delivery.scene),['刚睡醒','电话里']);
 assert.equal(h.calls[0].line,line);assert.equal(h.calls[1].line,line);
});
test('automatic review may choose existing scene; manual mood keeps precedence',()=>{
 const review={delivery:{emotion:'刚睡醒'}};
 assert.equal(resolveVoiceDelivery({emotion:'auto'},{text:'早上好。'},review).emotion,'刚睡醒');
 assert.equal(resolveVoiceDelivery({emotion:'serious'},{text:'早上好。'},review).emotion,'serious');
});
test('API payload inserts each existing scene tag once per chunk, without changing words',async()=>{
 const payloads=[],mp3=Buffer.alloc(1200);mp3.write('ID3');const line='今天我想早点休息。明天再继续吧。';
 await breezeSpeech(line,{breeze:{mode:'official',apiKey:'mock',voiceId:'voc_test'}},{emotion:'刚睡醒'},async(_url,o)=>{payloads.push(JSON.parse(o.body));return new Response(mp3);});
 const tags=voiceScene('刚睡醒').tags;
 assert.equal(payloads.length,1);for(const tag of tags)assert.equal(payloads[0].text.split(tag).length-1,1,tag);
 assert.equal(payloads[0].text.replace(/\[[^\]]+\]/g,''),line);
});
test('multiple chunks retain all scene triggers instead of consuming tag list on first chunk',async()=>{
 const payloads=[],mp3=Buffer.alloc(1200);mp3.write('ID3');const line='今天想早点休息。'.repeat(80);
 await breezeSpeech(line,{breeze:{mode:'official',apiKey:'mock',voiceId:'voc_test'}},{emotion:'刚睡醒'},async(_url,o)=>{payloads.push(JSON.parse(o.body));return new Response(mp3);});
 assert.ok(payloads.length>1);for(const p of payloads)for(const tag of voiceScene('刚睡醒').tags)assert.equal(p.text.split(tag).length-1,1,tag);
 assert.equal(payloads.map(p=>p.text.replace(/\[[^\]]+\]/g,'')).join(''),line);
});
test('desktop acoustic effect executes with configured runtime and cleans temporary files', {skip:process.platform!=='win32'||!process.env.QQ_REAL_SCENE_FX},async()=>{
 const runtime=JSON.parse(fs.readFileSync(new URL('../tools/media-runtime-desktop.json',import.meta.url)));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-scene-test-'));try{
  const rate=24000,samples=rate*2,b=Buffer.alloc(44+samples*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++){const t=i/rate,phase=2*Math.PI*180*t;b.writeInt16LE(Math.round(7000*Math.sin(phase)+3500*Math.sin(2*phase)+1800*Math.sin(3*phase)),44+i*2);}
  const input=path.join(dir,'tone.wav'),output=path.join(dir,'tone.mp3');fs.writeFileSync(input,b);execFileSync(runtime.ffmpegPath,['-v','error','-y','-i',input,output],{windowsHide:true});const audio=fs.readFileSync(output);
  const before=new Set(fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('dsh-scene-')));
  const out=await breezeSpeech('今天我想早点休息。',{breeze:{mode:'official',apiKey:'mock',voiceId:'voc_test'}},{emotion:'鼻塞感冒'},async()=>new Response(audio));
  assert.equal(out.sceneFx,true);assert.ok(out.bytes.length>1000);assert.notDeepEqual(out.bytes,audio);
  const after=fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('dsh-scene-')&&!before.has(n));assert.deepEqual(after,[]);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
