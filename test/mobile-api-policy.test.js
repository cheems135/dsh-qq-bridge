import test from 'node:test';
import assert from 'node:assert/strict';
import {apiOnlySettings,apiOnlyConnections} from '../mobile-api-policy.js';
import {createServiceConnections,detectConnection} from '../service-connections.js';

test('mobile migration keeps conversation, schedule, mood and memory configuration while blocking inference',()=>{
 const source={localChat:{enabled:true,apiComplement:true,initiativeEnabled:true},comfyui:{enabled:true,localVoiceDir:'private-device-path'},voice:{engine:'localai',enabled:true},agency:{enabled:true,desktop:true,workspace:'desktop',phone:true,browser:true},memory:{enabled:true,keepTurns:40},life:{enabled:true,execute:true},emotion:{enabled:true},personae:[{id:'example'}],autonomy:{enabled:true},model:{provider:'custom',model:'any-id'}};
 const before=structuredClone(source),mobile=apiOnlySettings(source);
 for(const key of ['memory','life','emotion','personae','autonomy','model'])assert.deepEqual(mobile[key],source[key]);
 assert.equal(mobile.localChat.enabled,false);assert.equal(mobile.localChat.apiComplement,false);assert.equal(mobile.localChat.initiativeEnabled,false);assert.equal(mobile.comfyui.enabled,false);assert.equal(mobile.voice.engine,'none');assert.equal(mobile.agency.workspace,'internal');assert.equal(mobile.agency.desktop,false);assert.equal(mobile.agency.phone,true);assert.deepEqual(source,before);
 assert.strictEqual(apiOnlySettings(source,false),source);
});
test('mobile connection loading cannot activate old synced local routes or unsupported profiles',()=>{
 const state={profiles:[{id:'c',type:'comfyui'},{id:'a',type:'openai'}],routes:{enabled:true,chat:'local',image:'profile:c',speech:'profile:a'},legacyLocalEnabled:true,legacyApiComplement:true};
 const clean=apiOnlyConnections(state);assert.deepEqual(clean.routes,{enabled:true,chat:'host',image:'legacy',speech:'profile:a'});assert.equal(clean.legacyLocalEnabled,false);assert.equal(clean.legacyApiComplement,false);assert.equal(state.routes.chat,'local');
 assert.strictEqual(apiOnlyConnections(state,false),state);
});
test('mobile API routing accepts arbitrary chat/image/speech API models and rejects local writes',()=>{
 let data=null;const connections=createServiceConnections({apiOnly:true,storage:{read:()=>data,write:v=>data=structuredClone(v)}});
 for(const type of ['comfyui','voicelab'])assert.throws(()=>connections.save({type,baseUrl:'http://localhost:8188'}),/手机版仅支持 API/);
 const a=connections.save({type:'openai',baseUrl:'https://example.test/v1',chatModel:'arbitrary-chat',imageModel:'arbitrary-image',speechModel:'arbitrary-voice',voice:'custom-voice',apiKey:'synthetic-key'});
 connections.use(a.id,'chat');connections.use(a.id,'image');connections.use(a.id,'speech');
 assert.deepEqual(connections.snapshot().routes,{enabled:true,chat:'profile:'+a.id,image:'profile:'+a.id,speech:'profile:'+a.id});assert.equal(connections.snapshot().apiOnly,true);assert.equal(connections.snapshot().profiles[0].apiKey,undefined);
 assert.throws(()=>connections.saveRoutes({enabled:true,chat:'host',image:'local'}),/手机版仅支持 API/);
 connections.saveRoutes({enabled:false,chat:'host',image:'legacy',speech:'legacy'});assert.equal(connections.raw().legacyLocalEnabled,false);
});
test('mobile detection reads only API metadata, never starts a model or probes local generation services',async()=>{
 const requests=[];const fetchImpl=async(url,options)=>{requests.push([url,options.method]);return new Response(JSON.stringify({data:[{id:'custom-model'}]}),{status:200});};
 const result=await detectConnection({baseUrl:'https://example.test',type:'auto'},{apiOnly:true,fetchImpl});assert.equal(result.type,'openai');assert.deepEqual(result.models,['custom-model']);assert.deepEqual(requests,[['https://example.test/models','GET']]);
 await assert.rejects(detectConnection({baseUrl:'http://localhost:8188',type:'comfyui'},{apiOnly:true,fetchImpl}),/手机版仅支持 API/);assert.equal(requests.length,1);
});
