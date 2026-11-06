import {listenLocalServer} from './local-server-listen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {localVoices,selectLocalVoice,validateLocalWav} from '../local-voice.js';
import {createBridgeIssues,unresolvedLocalReceipts} from '../bridge-issues.js';
import {createLocalAgent} from '../local-agent.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';

const wav=Buffer.concat([Buffer.from('RIFF0000WAVE'),Buffer.alloc(36)]);
test('local voices use actual presets, reject foreign voice names and reject interrupted audio',async()=>{
 const voices=await localVoices({url:'http://voice',fetchImpl:async()=>Response.json({items:[{id:'v1',name:'一号',has_audio:true},{id:'broken',has_audio:false}]})});
 assert.deepEqual(voices,[{id:'v1',name:'一号'}]);assert.equal(selectLocalVoice(voices,{requested:'default'}),'v1');assert.equal(selectLocalVoice(voices,{configured:'一号'}),'v1');
 assert.throws(()=>selectLocalVoice(voices,{requested:'Microsoft Huihui Desktop'}),/音色不存在/);assert.throws(()=>selectLocalVoice([...voices,{id:'v2',name:'二号'}]),/多个音色/);assert.throws(()=>selectLocalVoice([]),/没有可用/);
 assert.equal(validateLocalWav(wav,new Headers()),wav);for(const header of ['x-cancelled','x-timed-out','x-complete'])assert.throws(()=>validateLocalWav(wav,new Headers({[header]:header==='x-complete'?'0':'1'})),/未完成/);assert.throws(()=>validateLocalWav(Buffer.from('{"error":"oops"}')),/有效 WAV/);
});
test('bridge issues deduplicate, redact, isolate accounts and retain successful tool receipts',()=>{
 let rows=[];const issues=createBridgeIssues({getRows:()=>rows,setRows:r=>rows=r});
 issues.record({id:'a',message:'failed Bearer secret-token'},{accountId:'owner'});issues.record({id:'a',message:'duplicate'},{accountId:'owner'});issues.record({id:'a',message:'other'},{accountId:'other'});
 assert.equal(rows.length,2);assert.doesNotMatch(rows[0].message,/secret-token/);assert.equal(issues.list({accountId:'owner'}).length,1);issues.acknowledge(['a'],{accountId:'owner'});assert.equal(rows[0].acknowledged,true);assert.equal(rows[1].acknowledged,false);
 const receipts=[{tool:'image',ok:true},{tool:'image',ok:false,duplicate:true},{tool:'speech',ok:false,error:'audio failed'}];assert.deepEqual(unresolvedLocalReceipts(receipts),[receipts[2]]);
 assert.deepEqual(unresolvedLocalReceipts([{tool:'speech',ok:false},{tool:'speech',ok:true}]),[]);
});
test('explicit speech repairs a model promise into one real tool call and does not retry a failed synthesis',async()=>{
 let calls=0,models=0;const agent=createLocalAgent({requiredSpeech:true,model:async()=>++models===1?'好，我说给你听。':JSON.stringify({action:'speech',arguments:{text:'我在这儿。',final:true}}),tools:{speech:{execute:async()=>{calls++;return {file:'D:/voice.wav',kind:'speech'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'用语音说一句'}]});assert.equal(models,2);assert.equal(calls,1);assert.equal(result.attachments.length,1);assert.equal(result.text,'');
 let failedCalls=0,round=0;const failed=createLocalAgent({requiredSpeech:true,model:async()=>++round===1?JSON.stringify({action:'speech',arguments:{text:'你好'}}):'暂时没说出来。',tools:{speech:{execute:async()=>{failedCalls++;throw Error('offline');}}}});
 const failure=await failed.run({messages:[{role:'user',content:'发语音'}]});assert.equal(failedCalls,1);assert.equal(unresolvedLocalReceipts(failure.receipts).length,1);
});
async function fixture(run){const dir=mkdtempSync(join(tmpdir(),'voice-notices-'));let service;try{await run(dir,s=>service=s);}finally{if(service){service.server.closeAllConnections();await service.close();}rmSync(dir,{recursive:true,force:true});}}
const listen=listenLocalServer;
test('image wait line is emitted before prompt preparation and image execution; missing metadata uses the same model',async()=>{
 for(const supplied of [true,false])await fixture(async(dir,set)=>{
  const order=[];const graph=join(dir,'graph.json'),config=join(dir,'config.json');writeFileSync(graph,'{}');writeFileSync(config,JSON.stringify({voiceEnabled:false,mediaDir:dir,workflowLibrary:[{id:'pic',kind:'image',name:'图',file:graph,inputs:{prompt:{node:'1',field:'text'}}}]}));
  const service=createLocalModelServer({configFile:config,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async()=>{order.push('image');const file=join(dir,'image.png');writeFileSync(file,probeColorPng());return {media:[{kind:'image',file}]};}},fetchImpl:async()=>Response.json({loaded:false,busy:false,queue_running:[],queue_pending:[]}),model:async options=>{if(options.purpose==='notice'){order.push('notice-model');assert.deepEqual(options.tools,[]);return '我先给那只猫找个晒太阳的角落，等我一下。';}return JSON.stringify({action:'image',arguments:{prompt:'晒太阳的猫'},...(supplied?{waitText:'给小猫挑个暖和的角落，等我画出来。'}:{})});}});set(service);const base=await listen(service);
  const response=await fetch(base+'/v1/local/turn',{method:'POST',headers:{accept:'application/x-ndjson'},body:JSON.stringify({stream:true,messages:[{role:'user',content:'生成一张晒太阳的猫图'}]})});
  const lines=(await response.text()).trim().split('\n').map(line=>JSON.parse(line));const notice=lines.find(line=>line.type==='notice');assert.ok(notice,JSON.stringify(lines));assert.equal(notice.source,'model');assert.equal(lines.filter(line=>line.type==='notice').length,1);
  const submittedIndex=lines.findIndex(line=>line.type==='invocation'&&line.record.status==='returned');assert.ok(lines.indexOf(notice)<submittedIndex);assert.deepEqual(order,supplied?['image']:['notice-model','image']);
 });
});
test('speech HTTP route preserves manual VoiceLab work and records failure without sending partial WAV',async()=>{
 for(const mode of ['busy','partial','success','foreign'])await fixture(async(dir,set)=>{
  const config=join(dir,'config.json');writeFileSync(config,JSON.stringify({voiceEnabled:true,mediaDir:dir}));let submissions=0,unloads=0;
  const service=createLocalModelServer({configFile:config,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>{unloads++;return {freed:true};}},fetchImpl:async(url,options={})=>{
   if(url.endsWith('/api/presets'))return Response.json({items:[{id:'v1',name:'一号',has_audio:true}]});
   if(url.endsWith('/api/status'))return Response.json({busy:mode==='busy',loaded:false});
   if(url.endsWith('/api/tts')){submissions++;assert.equal(options.body.get('preset_id'),'v1');return new Response(wav,{headers:{'content-type':'audio/wav',...(mode==='partial'?{'x-complete':'0'}:{})}});}
   return Response.json({ok:true,queue_running:[],queue_pending:[]});
  }});set(service);const base=await listen(service);const response=await fetch(base+'/v1/audio/speech',{method:'POST',body:JSON.stringify({input:'我在。',voice:mode==='foreign'?'Microsoft Huihui Desktop':'default',recordScope:{accountId:'a',chat:'private:test'}})});
  if(mode==='success'){assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,wav.length);}else{assert.equal(response.status,500);const issues=await(await fetch(base+'/v1/local/issues')).json();assert.equal(issues.issues.length,1);assert.equal(issues.issues[0].accountId,'a');}
  if(mode==='busy'||mode==='foreign'){assert.equal(submissions,0);assert.equal(unloads,0);}else assert.equal(submissions,1);
 });
});
