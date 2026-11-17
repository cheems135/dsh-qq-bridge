import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {defaultPromptPreferences,normalizePromptPreferences,voicePromptInstructions,createPromptPreferenceStore} from '../prompt-preferences.js';
import {connectionMedia} from '../service-adapters.js';import {requestLocalSpeech} from '../local-voice.js';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';import {listenLocalServer} from './local-server-listen.js';
test('old three-category settings gain voice defaults; voice text is separate and not duplicated',()=>{
 const old=defaultPromptPreferences();delete old.voice;assert.equal(normalizePromptPreferences(old).voice.pace,'context');const values=normalizePromptPreferences(old);values.voice.customText='语气亲近，停顿自然。';values.voice.pace='relaxed';
 const direction=voicePromptInstructions('保持音色',values);assert.match(direction,/语气亲近/);assert.match(direction,/从容/);assert.equal(voicePromptInstructions(direction,values),direction);assert.equal(voicePromptInstructions('保持音色'),'保持音色');
});
const wav=()=>{const b=Buffer.alloc(1100);b.write('RIFF');b.writeUInt32LE(1092,4);b.write('WAVE',8);b.write('fmt ',12);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(24000,24);b.writeUInt32LE(48000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(1056,40);return b;};
test('generic speech API receives instructions separately from spoken words',async()=>{
 let payload;await connectionMedia({type:'openai',baseUrl:'https://example.com/v1',apiKey:'',speechModel:'test-voice',voice:'test',audioFormat:'wav'},'speech',{text:'你好。',instructions:'轻声自然。'},async(_u,o)=>{payload=JSON.parse(o.body);return new Response(wav(),{headers:{'content-type':'audio/wav'}});});assert.equal(payload.input,'你好。');assert.equal(payload.instructions,'轻声自然。');
});
test('local OpenAI TTS receives the same Chinese direction without contaminating text',async()=>{
 let payload;await requestLocalSpeech({type:'openai',baseUrl:'http://127.0.0.1:8888',path:'/v1/audio/speech',model:'test',apiKey:''},{text:'你好。',voice:'test',instruction:'亲近自然。',fetchImpl:async(_u,o)=>{payload=JSON.parse(o.body);return new Response(wav(),{headers:{'content-type':'audio/wav'}});}});assert.equal(payload.input,'你好。');assert.equal(payload.instructions,'亲近自然。');
});
test('local speech tool forwards saved voice preferences to actual TTS request generation',async()=>{
 const root=fileURLToPath(new URL('../.voice-preference-tests/',import.meta.url));mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'turn-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:true,voiceService:{type:'openai',baseUrl:'http://127.0.0.1:8888/v1',device:'cpu',model:'test'},mediaDir:dir}));
 const values=defaultPromptPreferences();values.voice.customText='语气亲近，停顿自然。';let payload;
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},logger:()=>{},model:async()=>JSON.stringify({action:'speech',arguments:{text:'你好。',final:true}}),fetchImpl:async(url,o={})=>{if(o.method==='POST'&&String(url).includes('audio/speech')){payload=JSON.parse(o.body);return new Response(wav(),{headers:{'content-type':'audio/wav'}});}return Response.json({data:[],queue_running:[],queue_pending:[]});}});
 const base=await listenLocalServer(service);try{const r=await fetch(base+'/v1/local/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'用语音说你好'}],turnContext:{promptPreferences:values}})});assert.equal(r.status,200,await r.text());assert.equal(payload.input,'你好。');assert.match(payload.instructions,/语气亲近，停顿自然/);assert.match(payload.instructions,/保留所选声音的音色身份和口音/);}finally{service.server.closeAllConnections();await service.close();}
});
