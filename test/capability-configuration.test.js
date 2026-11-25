import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recognizeServiceRequest,renderServiceSources} from '../ui/execution-overview.js';
import {serviceSourceOverview} from '../service-source-overview.js';
import {createLocalAudioWorkflows,inspectLocalAudioWorkflow,localAudioUrl} from '../local-audio-workflows.js';

test('five configured capability cards are navigable; historical snapshots stay read-only',()=>{
 const value=serviceSourceOverview({settings:{voice:{enabled:true,runninghub:{sing:{id:'12345'}}},imagegen:{runninghub:{apiKey:'private'}}}});
 assert.deepEqual(value.items.map(x=>x.kind),['chat','image','speech','video','sing']);
 const html=renderServiceSources(value,{configure:true});
 for(const page of ['model','imagegen','voice','videogen','apisong'])assert.ok(html.includes('data-go="'+page+'"'));
 assert.equal(html.includes('private'),false);
 assert.equal(renderServiceSources(value).includes('data-go='),false);
});
test('request recognition extracts supported protocol fields without retaining bearer keys or evaluating commands',()=>{
 const curl=`curl --request POST 'https://example.com/custom/v1/audio/speech' --header 'Authorization: Bearer PRIVATE' --data-raw '{"model":"voice-model","voice":"whale","input":"你好"}'`;
 const r=recognizeServiceRequest(curl,'speech');
 assert.equal(r.model,'voice-model');assert.equal(r.voice,'whale');assert.equal(r.url,'https://example.com/custom/v1/audio/speech');assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
 assert.throws(()=>recognizeServiceRequest(curl+'; echo injected','speech'),/命令拼接/);
 assert.equal(recognizeServiceRequest('{"prompt":{"1":{"class_type":"SaveImage","inputs":{}}}}','image').type,'comfyui');
 assert.equal(recognizeServiceRequest('curl https://example.com/v1/responses --data-raw \'{"model":"reasoner"}\'','chat').type,'responses');
});
const graph={
 '1':{class_type:'TextInput',inputs:{text:'旧台词'}},
 '2':{class_type:'LoadAudio',_meta:{title:'参考音色'},inputs:{audio:'voice.wav'}},
 '3':{class_type:'AudioSynthesis',inputs:{text:['1',0],reference:['2',0]}},
 '4':{class_type:'SaveAudio',inputs:{audio:['3',0]}},
 '5':{class_type:'SaveAudio',inputs:{audio:['2',0]}},
};
test('audio inspection preserves ambiguous outputs and rejects missing nodes',()=>{
 const result=inspectLocalAudioWorkflow(graph,'speech');assert.equal(result.output,null);assert.equal(result.outputs.length,2);
 assert.deepEqual(result.inputs.text,{node:'1',field:'text'});assert.deepEqual(result.inputs.reference_audio,{node:'2',field:'audio'});
 assert.throws(()=>inspectLocalAudioWorkflow({'4':{class_type:'SaveAudio',inputs:{audio:['missing',0]}}},'sing'),/引用不存在/);
 assert.throws(()=>localAudioUrl('https://example.com:8188'),/本机回环/);
 assert.throws(()=>localAudioUrl('http://user:pass@127.0.0.1:8188'),/本机回环/);
});
test('a damaged optional local audio configuration does not crash the QQ bridge or overwrite the file',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cap-audio-damaged-'));
 try{const file=join(root,'config.json');writeFileSync(file,'{damaged');const engine=createLocalAudioWorkflows({directory:root});assert.match(engine.snapshot().error,/保留原文件/);assert.equal(engine.isLocal('sing'),false);await assert.rejects(engine.action({action:'select',kind:'sing',mode:'api'}),/配置损坏/);assert.equal(readFileSync(file,'utf8'),'{damaged');}
 finally{rmSync(root,{recursive:true,force:true});}
});
test('local audio import, save, reload and execution bind actual text and audio, and select only the chosen final output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'cap-audio-'));let submitted=null,downloads=[],posts=0;
 const wav=Buffer.alloc(128);wav.write('RIFF');wav.write('WAVE',8);
 const fetchImpl=async(url,init={})=>{
   if(url.endsWith('/upload/image')){posts++;return Response.json({name:'uploaded-voice.wav',subfolder:''});}
   if(url.endsWith('/object_info'))return Response.json({});
   if(url.endsWith('/prompt')){posts++;submitted=JSON.parse(init.body).prompt;return Response.json({prompt_id:'actual-local-test'});}
   if(url.includes('/history/'))return Response.json({'actual-local-test':{outputs:{'4':{audio:[{filename:'final.wav',type:'output'}]},'5':{audio:[{filename:'wrong.wav',type:'output'}]}}}});
   if(url.includes('/view?')){downloads.push(url);return new Response(wav,{headers:{'content-type':'audio/wav'}});}
   throw Error('Unexpected '+url);
 };
 try{
   const engine=createLocalAudioWorkflows({directory:root,mediaDir:join(root,'media'),fetchImpl});
   const result=await engine.action({action:'inspect',kind:'speech',workflow:graph});assert.equal(posts,0);
   await assert.rejects(engine.action({action:'import',kind:'speech',token:result.token,output:result.outputs[1],inputs:result.inputs}),/输出路径/);
   const imported=await engine.action({action:'import',kind:'speech',token:result.token,name:'我的音色',output:result.outputs[0],inputs:result.inputs});
   assert.equal(posts,0);
   await engine.action({action:'upload',kind:'speech',role:'reference_audio',name:'voice.wav',data:wav.toString('base64')});
   await engine.action({action:'select',kind:'speech',mode:'local',workflowId:imported.entry.id});
   const reloaded=createLocalAudioWorkflows({directory:root,mediaDir:join(root,'media'),fetchImpl});assert.equal(reloaded.isLocal('speech'),true);assert.equal(reloaded.isLocal('sing'),false);
   const file=await reloaded.render('speech',{text:'这次真实传入的台词'});
   assert.deepEqual(readFileSync(file),wav);assert.equal(submitted['1'].inputs.text,'这次真实传入的台词');assert.equal(submitted['2'].inputs.audio,'uploaded-voice.wav');
   assert.equal(downloads.length,1);assert.ok(downloads[0].includes('final.wav'));assert.equal(posts,2);
   assert.equal(graph['1'].inputs.text,'旧台词');
 }finally{rmSync(root,{recursive:true,force:true});}
});
