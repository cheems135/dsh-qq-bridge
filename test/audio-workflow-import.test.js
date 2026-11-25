import test from 'node:test';
import assert from 'node:assert/strict';
import {importRunningHubAudio} from '../runninghub-audio-import.js';
import {runningHubAudioNodes,singingWorkflowKey,singingAudioTiming,normalizeRunningHubAudio,renderRunningHubAudio} from '../runninghub-audio.js';
import {singingSegment,selectSingingPlan} from '../singing-plan.js';
import {createServiceConnections} from '../service-connections.js';
import {readFileSync} from 'node:fs';
import {normalizeRequestExample,inferAudioExampleBindings} from '../ui/execution-overview.js';

const id='2055815336380911617',nodes=[
 {nodeId:'23',fieldName:'audio',fieldValue:'demo-voice.mp3'},
 {nodeId:'45',fieldName:'audio',fieldValue:'demo-song.mp3'},
 {nodeId:'57',fieldName:'start_time',fieldValue:'0:00'},
 {nodeId:'57',fieldName:'end_time',fieldValue:'1:00'},
 {nodeId:'58',fieldName:'end_time',fieldValue:'0:05'},
 {nodeId:'40',fieldName:'control',fieldValue:'score'}];
const body={nodeInfoList:nodes,instanceType:'default'};

test('full songs and cropped sources both replace example crop times with measured uploaded duration',()=>{
 const config=importRunningHubAudio(''+JSON.stringify({...body,webappId:id}),'sing',{referenceAudio:'voice.wav'}).config;
 for(const [duration,end] of [[163.017959,'2:43'],[30,'0:30'],[19.4,'0:19']]){
  const source={title:'晴天',artist:'歌手',audio:'api/source.wav',verified:true,duration};
  const plan=selectSingingPlan({request:'唱《晴天》',config:{...config,songAudio:'api/source.wav',songTitle:'晴天',songIdentityAudio:'api/source.wav'},sources:[source]});
  assert.equal(plan.sourceSong.duration,duration);
  const mapped=runningHubAudioNodes(config,'sing',{song_audio:source.audio,...singingAudioTiming(plan.sourceSong)});
  assert.equal(mapped.find(n=>n.nodeId==='57'&&n.fieldName==='end_time').fieldValue,end);
  assert.equal(mapped.find(n=>n.nodeId==='58'&&n.fieldName==='end_time').fieldValue,'0:05');
 }
});
const curl='curl --request POST https://www.runninghub.cn/openapi/v2/run/ai-app/'+id+' --header "Authorization: Bearer private-fixture-key" --data-raw '+JSON.stringify(JSON.stringify(body));
test('the actual escaped example imports labelled song and voice without confusing reference crop with song duration',()=>{
 const raw=readFileSync(new URL('./fixtures/runninghub-sing-2102953894560231426.txt',import.meta.url),'utf8');
 const result=importRunningHubAudio(raw,'sing',{referenceAudio:'my-voice.wav',songAudio:'my-verified-song.wav'});
 assert.equal(result.config.id,'2102953894560231426');assert.equal(result.warnings.length,0);
 const nodes=runningHubAudioNodes(result.config,'sing',{song_audio:'clip30.wav',song_end:'0:30'});
 assert.equal(nodes.find(n=>n.nodeId==='1').fieldValue,'clip30.wav');assert.equal(nodes.find(n=>n.nodeId==='2').fieldValue,'my-voice.wav');
 assert.equal(nodes.find(n=>n.nodeId==='5').fieldValue,'0');assert.equal(nodes.find(n=>n.nodeId==='6').fieldValue,'30');
 assert.equal(nodes.find(n=>n.nodeId==='10').fieldValue,'true');assert.equal(nodes.find(n=>n.nodeId==='37').fieldValue,'false');
 assert.equal(result.fields.find(n=>n.nodeId==='6').label,'音色参考结束时间（第几秒）');
 assert.throws(()=>importRunningHubAudio(raw+'; echo injected','sing'),/一条/);
 assert.equal(normalizeRequestExample(raw).includes('&#x20;'),false);
});
test('role inference refuses ambiguous audio inputs and leaves unrelated controls alone',()=>{
 assert.deepEqual(inferAudioExampleBindings([{fieldName:'audio',description:'上传音乐'},{fieldName:'audio',description:'另一首音乐'},{fieldName:'audio',description:'上传音色'},{fieldName:'value',description:'音色人声分离'}],'sing'),{2:'{{reference_audio}}'});
});

test('the full pasted cURL replaces the old app, maps the inspected graph and keeps credentials and demo files out of audio roles',()=>{
 const result=importRunningHubAudio(curl,'sing',{id:'2058763737900867585',referenceAudio:'api/my-voice.wav',songAudio:'api/current-original.wav'});
 assert.equal(result.config.id,id);assert.equal(result.config.outputNodeId,'46');assert.equal(result.config.outputIndex,1);
 assert.equal(JSON.stringify(result).includes('private-fixture-key'),false);
 const resolved=runningHubAudioNodes(result.config,'sing',{song_audio:'api/clip-30.wav',song_start:'0:00',song_end:'0:30'});
 assert.equal(resolved.find(n=>n.nodeId==='23').fieldValue,'api/my-voice.wav');
 assert.equal(resolved.find(n=>n.nodeId==='45').fieldValue,'api/clip-30.wav');
 assert.equal(resolved.find(n=>n.nodeId==='57'&&n.fieldName==='end_time').fieldValue,'0:30');
 assert.equal(resolved.find(n=>n.nodeId==='58').fieldValue,'0:05');
 assert.equal(resolved.find(n=>n.nodeId==='40').fieldValue,'score');
});
test('object and node-array imports work, while an unknown two-audio workflow requires actual role selection',()=>{
 assert.equal(importRunningHubAudio(JSON.stringify({...body,webappId:id}),'sing').config.id,id);
 assert.equal(importRunningHubAudio(JSON.stringify(nodes),'sing',{id}).config.nodeInfoList[0].fieldValue,'{{reference_audio}}');
 const generic=importRunningHubAudio(JSON.stringify(nodes),'sing',{id:'1234567890123456'});
 assert.equal(generic.warnings.length,1);assert.equal(generic.config.nodeInfoList[0].fieldValue,'demo-voice.mp3');
 assert.throws(()=>importRunningHubAudio(curl+'; echo unsafe','sing'),/一条/);
 assert.throws(()=>importRunningHubAudio('{not json','sing'),/完整 JSON/);
});
test('first thirty seconds stay distinct; generator settings do not invalidate accepted stock unless a new rendition is requested',()=>{
 assert.deepEqual(singingSegment('重新来一小段30秒的'),{start:0,end:30});
 assert.deepEqual(singingSegment('只尝试前30秒'),{start:0,end:30});
 assert.deepEqual(singingSegment('唱《晴天》，从30到60秒'),{start:30,end:60});
 const config={id,mode:'app',referenceAudio:'voice.wav',songTitle:'晴天',songAudio:'song.wav',songIdentityAudio:'song.wav'},workflowKey=singingWorkflowKey(config);
 const sourceSong={title:'晴天',audio:'song.wav',verified:true};
 const row={title:'晴天',quality:'accepted',identityVerified:true,sourceSong,workflowKey};
 assert.equal(selectSingingPlan({request:'唱《晴天》',config,versions:[row],workflowKey}).action,'reuse');
 assert.equal(selectSingingPlan({request:'唱《晴天》，只试前30秒',config,versions:[row],workflowKey}).action,'need-source');
 for(const changed of [{...config,id:'2058763737900867585'},{...config,referenceAudio:'new-voice.wav'}]){
  assert.equal(selectSingingPlan({request:'唱《晴天》',config:changed,versions:[row],workflowKey:singingWorkflowKey(changed)}).action,'reuse');
  assert.equal(selectSingingPlan({request:'重新唱《晴天》',config:changed,versions:[row],workflowKey:singingWorkflowKey(changed)}).action,'generate');
 }
 const presets=[{...config,name:'这个版本'}],normalized=normalizeRunningHubAudio({sing:{...config,presets}}).sing;
 assert.equal(normalized.presets[0].id,id);assert.equal(singingWorkflowKey(normalized),workflowKey);
});
test('the mixed final audio is selected by actual output node even when result order changes',async()=>{
 const config=importRunningHubAudio(curl,'sing',{referenceAudio:'voice.wav',songAudio:'song.wav'}).config;
 let calls=0,downloaded='';const wav=Buffer.alloc(300);wav.write('RIFF');wav.write('WAVE',8);
 const result=await renderRunningHubAudio({config,kind:'sing',inputs:{},apiConfig:{apiKey:'fixture'},poll:async()=>{},request:async()=>++calls===1?{taskId:'12345'}:{status:'SUCCESS',results:[{nodeId:'46',url:'https://example.org/mixed.wav'},{nodeId:'39',url:'https://example.org/dry.wav'}]},fetchImpl:async url=>{downloaded=url.pathname;return new Response(wav);}});
 assert.equal(downloaded,'/mixed.wav');assert.equal(result.outputNodeId,'46');assert.equal(result.outputSelection,'node');assert.equal(calls,2);
});
test('legacy source choices migrate independently and selecting local chat never changes image or speech sources',()=>{
 let state={profiles:[],routes:{enabled:false},legacyLocalEnabled:true};
 const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:v=>state=structuredClone(v)},getLegacySpeech:()=> 'runninghub'});
 assert.deepEqual(c.raw().routes,{enabled:true,chat:'local',image:'local',speech:'runninghub',video:'local'});
 c.saveRoutes({chat:'host'});assert.equal(c.route('image'),'local');assert.equal(c.route('speech'),'runninghub');
 assert.equal(c.setMode,undefined);assert.equal(c.raw().legacyLocalEnabled,undefined);
});
