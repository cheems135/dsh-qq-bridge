import test from 'node:test';
import assert from 'node:assert/strict';
import {localRequiredDataTools} from '../local-search-task.js';
import {createLocalAgent} from '../local-agent.js';
import {reconcileLocalAudioEvidence,reconcileLocalToolAudio} from '../local-audio-evidence.js';
const definitions={bridge_tools:{kind:'data',repeatable:true,parameters:{type:'object',properties:{action:{type:'string'},name:{type:'string'},arguments:{type:'object'}},required:['action']}}};
const call=name=>JSON.stringify({action:'bridge_tools',arguments:{action:'call',name,arguments:name==='bridge_search'?{query:'MDN Array.map'}:{url:'https://developer.mozilla.org/'}}});
test('read requirement follows explicit current instructions, not quoted, canceled, links-only or unrelated requests',()=>{
 for(const text of ['帮我搜索MDN，再打开官方文档','search for MDN and read the documentation'])assert.deepEqual(localRequiredDataTools(text),['bridge_search','bridge_read']);
 for(const text of ['搜索MDN，不要打开网页','搜索MDN，只要链接','帮我搜索MDN'])assert.deepEqual(localRequiredDataTools(text),['bridge_search']);
 for(const text of ['不要搜索再打开网页','例如搜索MDN再打开网页','“搜索MDN再打开网页”是什么意思'])assert.deepEqual(localRequiredDataTools(text),[]);
});
test('search result advances protocol to reading; early final is repaired without redoing search',async()=>{
 const executed=[],protocols=[];let round=0;
 const agent=createLocalAgent({maxToolRounds:8,requiredDataTools:['bridge_search','bridge_read'],tools:{bridge_tools:{...definitions.bridge_tools,execute:async args=>{executed.push(args.name);return {ok:true,url:'https://developer.mozilla.org/',text:'official documentation'};}}},model:async options=>{
 protocols.push(options.protocol);return [call('bridge_search'),'搜索到了，map返回数组。',call('bridge_read'),'已读取官方说明：map返回新数组。'][round++];
 }});
 const result=await agent.run({messages:[{role:'user',content:'搜索MDN再打开官方文档'}]});
 assert.deepEqual(executed,['bridge_search','bridge_read']);assert.match(protocols[1],/"name":"bridge_read"/);assert.doesNotMatch(protocols[1],/"name":"bridge_search"/);assert.match(result.text,/已读取/);
});
test('failed prerequisite stops dependent requirement without inventing or opening a URL',async()=>{
 let round=0,executions=0;const agent=createLocalAgent({requiredDataTools:['bridge_search','bridge_read'],tools:{bridge_tools:{...definitions.bridge_tools,execute:async()=>{executions++;throw Error('搜索网站不可用');}}},model:async()=>round++===0?call('bridge_search'):'搜索失败，没有读取网页。'});
 const result=await agent.run({messages:[{role:'user',content:'搜索后读文档'}]});assert.equal(executions,1);assert.equal(result.receipts.length,1);assert.equal(result.receipts[0].ok,false);
});
test('schema-only activity cannot satisfy the required page read',async()=>{
 let round=0;const agent=createLocalAgent({maxToolRounds:5,requiredDataTools:['bridge_search','bridge_read'],tools:{bridge_tools:{...definitions.bridge_tools,execute:async()=>({ok:true})}},model:async()=>[call('bridge_search'),JSON.stringify({action:'bridge_tools',arguments:{action:'schema',name:'bridge_read'}}),'已经阅读。','已经阅读。'][round++]});
 await assert.rejects(agent.run({messages:[{role:'user',content:'搜索后读文档'}]}),/没有实际网页读取调用记录/);
});
const audio=()=>({ok:true,duration:2.64,start:0,end:2.64,acoustic:{kind:'纯音/提示音（非语音、非音乐）',confidence:'medium',reasons:['单音集中度0.308']},transcription:{status:'candidate',segments:[{start:0,end:2.76,text:'本地功能 检查完成',noSpeech:.26}]},coverage:'仅本机测量'});
test('real speech-shaped fixture reconciles ASR conflict while retaining raw acoustic evidence',()=>{
 const raw=audio(),before=structuredClone(raw),result=reconcileLocalAudioEvidence(raw);assert.match(result.acoustic.kind,/可能含可辨识人声/);assert.deepEqual(result.localClassification.rawAcoustic,raw.acoustic);assert.deepEqual(raw,before);assert.deepEqual(reconcileLocalAudioEvidence(result),result);assert.match(result.coverage,/不能据此区分/);
});
test('silence, invalid segments, hallucination-like phrases and high no-speech probability are not promoted to speech',()=>{
 for(const patch of [{text:'谢谢观看'},{text:'hi'},{noSpeech:.8},{noSpeech:null},{start:-1},{end:10},{end:0}]){
  const raw=audio();Object.assign(raw.transcription.segments[0],patch);const r=reconcileLocalAudioEvidence(raw);assert.equal(r.localClassification.verifiedSpeechSegments,0);
 }
 const raw=audio();raw.acoustic.kind='静音/近乎无声';const r=reconcileLocalAudioEvidence(raw);assert.match(r.acoustic.kind,/待确认/);assert.equal(r.acoustic.confidence,'low');
});
test('music evidence never becomes a claim of spoken conversation or lack of music',()=>{
 const raw=audio();raw.acoustic.kind='实际音乐信号测量，未执行人声分离或乐器识别';const r=reconcileLocalAudioEvidence(raw);assert.match(r.acoustic.kind,/可能含/);assert.match(r.localClassification.note,/歌唱/);
 raw.transcription={status:'no-verified-speech',segments:[]};assert.deepEqual(reconcileLocalAudioEvidence(raw),raw);
});
test('local routing reconciles audio executions only, preserving schemas, failed results and unrelated tools',()=>{
 const raw=audio();assert.ok(reconcileLocalToolAudio('bridge_tools',{action:'call',name:'bridge_audio'},raw).localClassification);
 for(const [name,args] of [['bridge_tools',{action:'schema',name:'bridge_audio'}],['bridge_tools',{action:'call',name:'bridge_read'}],['speech',{}]])assert.equal(reconcileLocalToolAudio(name,args,raw),raw);
 const failed={...raw,ok:false};assert.equal(reconcileLocalToolAudio('bridge_audio',{},failed),failed);
});

import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';
import {runWithHostTools} from '../local-tool-broker.js';
import {listenLocalServer} from './local-server-listen.js';
test('actual local gateway reconciles audio before the model, receipts and invocation journal see the result',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-audio-evidence-')),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir}));
 let models=0,executions=0;const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async options=>{
  if(++models===1)return JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_audio',arguments:{file:'existing-fixture.wav',transcribe:true}}});
  assert.ok(options.messages.some(row=>String(row.content).includes('可能含可辨识人声')));return '这段有可辨识的人声候选。';
 }});
 const baseUrl=await listenLocalServer(service);
 try{
  const response=await runWithHostTools({baseUrl,messages:[{role:'user',content:'分析这段音频的类型'}],tools:{bridge_tools:{...definitions.bridge_tools,execute:async()=>{executions++;return audio();}}}});
  assert.equal(executions,1);assert.equal(response.body.qqDelivered,false);
  const receipt=response.body.receipts.find(r=>r.data?.localClassification);assert.equal(receipt.data.localClassification.verifiedSpeechSegments,1);assert.match(receipt.data.localClassification.rawAcoustic.kind,/提示音/);
  const invocation=response.body.invocations.find(r=>r.tool==='bridge_audio'&&r.status==='returned');assert.ok(JSON.stringify(invocation).includes('可能含可辨识人声'));
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

