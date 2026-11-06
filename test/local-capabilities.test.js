import {listenLocalServer} from './local-server-listen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCapabilityDetector} from '../local-capabilities.js';
import {defaultLocalConfig} from '../local-config.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){const dir=mkdtempSync(join(tmpdir(),'local-capabilities-')),config=defaultLocalConfig({});let probes=0,service={reachable:true,voice:true},answer=({kind,nonce})=>kind==='vision'?'红色':JSON.stringify({action:'capability_ping',arguments:{nonce}});const make=()=>createCapabilityDetector({root,workDir:dir,getConfig:()=>config,services:async()=>service,probe:async request=>{probes++;return answer(request);}});return {dir,config,make,setService:v=>service=v,setAnswer:v=>answer=v,probes:()=>probes,close:()=>rmSync(dir,{recursive:true,force:true})};}
test('capabilities require a real protocol response and persist against the model fingerprint',async()=>{
 const h=fixture();try{const detector=h.make();assert.equal((await detector.snapshot()).features.tools.supported,null);const value=await detector.detect();assert.equal(value.features.text.supported,true);assert.equal(value.features.json.supported,true);assert.equal(value.features.tools.supported,true);assert.equal(value.features.vision.supported,null);assert.equal(h.probes(),1);await h.make().detect();assert.equal(h.probes(),1);h.config.modelId='different-model';await h.make().detect();assert.equal(h.probes(),2);}finally{h.close();}
});
test('incorrect random nonce and prose are not accepted as working tool support',async()=>{
 const h=fixture();try{h.setAnswer(()=>'{"action":"capability_ping","arguments":{"nonce":"invented"}}');let value=await h.make().detect();assert.equal(value.features.json.supported,true);assert.equal(value.features.tools.supported,false);h.setAnswer(()=> '当然支持工具啦');value=await h.make().detect({force:true});assert.equal(value.features.text.supported,true);assert.equal(value.features.json.supported,false);assert.equal(value.features.tools.supported,false);}finally{h.close();}
});
test('arbitrary local compatible-server models do not require one of the ComfyUI presets',async()=>{
 const h=fixture();try{h.config.backend='openai';h.config.chatWorkflow='not-a-comfy-preset';h.config.modelId='my-custom-vision-model';const value=await h.make().detect();assert.equal(value.model,'my-custom-vision-model');assert.equal(value.features.tools.supported,true);}finally{h.close();}
});
test('busy or offline services never submit a capability inference or unload a manual job',async()=>{
 const h=fixture();try{h.setService({reachable:true,busy:true});assert.equal((await h.make().detect({force:true,vision:true})).busy,true);h.setService({reachable:false});assert.equal((await h.make().detect()).status,'unavailable');assert.equal(h.probes(),0);}finally{h.close();}
});
test('concurrent checks coalesce; vision uses a controlled image rather than a model name',async()=>{
 const h=fixture();try{const detector=h.make();await Promise.all([detector.detect(),detector.detect()]);assert.equal(h.probes(),1);let value=await detector.detect({vision:true});assert.equal(value.features.vision.supported,true);assert.equal(h.probes(),2);h.setAnswer(({kind,nonce})=>kind==='vision'?'蓝色':JSON.stringify({action:'capability_ping',arguments:{nonce}}));value=await detector.detect({force:true,vision:true});assert.equal(value.features.vision.supported,false);assert.equal(value.features.native.supported,false);const png=probeColorPng();assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');}finally{h.close();}
});
test('capability failures can be retried and tools never execute during native-call probing',async()=>{
 const h=fixture();try{h.setAnswer(()=>{throw Error('temporary disconnect');});assert.equal((await h.make().detect()).status,'unavailable');h.setAnswer(({nonce})=>({tool_calls:[{function:{name:'capability_ping',arguments:JSON.stringify({nonce})}}]}));const result=await h.make().detect();assert.equal(result.status,'ready');assert.equal(result.features.tools.supported,true);assert.equal(h.probes(),2);}finally{h.close();}
});
test('registered media graphs and service readiness are separate from language-model abilities',async()=>{
 const h=fixture();try{writeFileSync(join(h.dir,'image.json'),JSON.stringify({1:{class_type:'Prompt',inputs:{text:''}},2:{class_type:'SaveImage',inputs:{}}}));h.config.workflowLibrary=[{id:'image',kind:'image',file:join(h.dir,'image.json'),inputs:{prompt:{node:'1',field:'text'}},output:{node:'2'}}];let value=await h.make().snapshot();assert.equal(value.features.image.supported,true);assert.equal(value.features.image.evidence,'workflow');assert.equal(value.features.video.supported,false);h.setService({reachable:true,voice:false});value=await h.make().snapshot();assert.equal(value.features.speech.supported,false);}finally{h.close();}
});
test('gateway capability endpoint falls back to JSON protocol when native schemas are unsupported',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'gateway-capabilities-'));let calls=0,actualTools=0;
 const service=createLocalModelServer({configFile:join(dir,'config.json'),env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'gateway.log')},runtime:{status:async()=>({reachable:true}),release:async()=>{throw Error('must not unload');}},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[],busy:false}),tools:{ping:{execute:async()=>actualTools++}},logger:()=>{},model:async options=>{calls++;if(options.tools?.length)throw Error('400 tools not supported');const request=JSON.parse(options.messages.at(-1).content);return JSON.stringify(request);}});
 try{const base=await listenLocalServer(service);
 const initial=await(await fetch(base+'/v1/local/capabilities')).json();assert.equal(initial.status,'pending');
 const checked=await(await fetch(base+'/v1/local/capabilities/probe',{method:'POST',body:'{}'})).json();assert.equal(checked.features.tools.supported,true);assert.equal(calls,2);assert.equal(actualTools,0);
 await fetch(base+'/v1/local/capabilities/probe',{method:'POST',body:'{}'});assert.equal(calls,2);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
