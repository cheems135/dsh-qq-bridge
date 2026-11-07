import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createComfyRuntime,prepareLocalChatImages} from '../comfyui-runtime.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
import {inspectWorkflow} from '../workflow-inspector.js';
import {defaultLocalConfig,normalizeLocalConfig,chatWorkflowSpec} from '../local-config.js';

const graph=()=>({'1':{class_type:'MyArbitraryChatNode',inputs:{question:'测试',system_prompt:'中文',server_url:'http://127.0.0.1:12345',use_image:false,image:['3',0],max_tokens:4000,temperature:0.6,seed:0}},'2':{class_type:'ShowText|pysssss',inputs:{text:['1',0]}},'3':{class_type:'LoadImage',inputs:{image:'missing-sample.png'}}});
const mappings={text:{node:'1',field:'question'},system:{node:'1',field:'system_prompt'},image:{node:'3',field:'image'},imageEnabled:{node:'1',field:'use_image'},maxTokens:{node:'1',field:'max_tokens'}};

test('external local workflow switches text/image/text without sample image dependencies or stale photos',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./external-chat-',import.meta.url)));
 const photo=join(dir,'current.png');writeFileSync(photo,Buffer.from('89504e470d0a1a0a','hex'));
 const submitted=[];let uploads=0;
 const original=graph();
 const spec={api:original,inputs:mappings,output:{kind:'text',node:'2',field:'text'}};
 const runtime=createComfyRuntime({root:dir,getConfig:()=>({enabled:true,baseUrl:'http://127.0.0.1:8188',mediaDir:dir,keepWarm:true,workflows:{chat:spec}}),fetchImpl:async(url,o={})=>{
  if(url.endsWith('/upload/image')){uploads++;assert.ok(o.body.get('image'));return Response.json({name:'current.png',subfolder:'qq'});}
  if(url.endsWith('/prompt')){submitted.push(JSON.parse(o.body).prompt);return Response.json({prompt_id:'test'});}
  if(url.includes('/history/'))return Response.json({test:{outputs:{'2':{text:['模拟回执']}}}});
  throw Error('Unexpected request '+url);
 }});
 try{
  for(const imageFiles of [[],[photo],[]]){
   const result=await runtime.run('chat',{text:'看一下',system:'保留人设',history:[{role:'user',content:'记得蓝色衣服'}],imageFiles,maxTokens:512});
   assert.equal(result.text,'模拟回执');
  }
  assert.equal(uploads,1);assert.equal(submitted.length,3);
  for(const index of [0,2]){assert.equal(submitted[index]['1'].inputs.use_image,false);assert.equal(submitted[index]['1'].inputs.image,undefined);assert.equal(submitted[index]['3'],undefined);}
  assert.equal(submitted[1]['1'].inputs.use_image,true);assert.equal(submitted[1]['3'].inputs.image,'qq/current.png');
  assert.match(submitted[1]['1'].inputs.question,/蓝色衣服/);assert.equal(submitted[1]['1'].inputs.system_prompt,'保留人设');assert.equal(submitted[1]['1'].inputs.max_tokens,512);
  assert.equal(original['1'].inputs.use_image,false);assert.equal(original['3'].inputs.image,'missing-sample.png');
  await assert.rejects(runtime.run('chat',{text:'看两张',imageFiles:[photo,photo]}),/只支持单张图片/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('external local vision fails before submission when its image mapping points at another branch',()=>{
 const workflow=graph();workflow.other={class_type:'LoadImage',inputs:{image:'wrong.png'}};
 assert.throws(()=>prepareLocalChatImages(workflow,{inputs:{image:{node:'other',field:'image'},imageEnabled:{node:'1',field:'use_image'}}},{imageFiles:['current.png']}),/不在同一条连接路径/);
});

test('fresh configuration has no selected model and a workflow remains untouched without an image switch mapping',()=>{
 const defaults=defaultLocalConfig({});assert.equal(defaults.chatWorkflow,'');assert.equal(defaults.modelId,'');
 const config=normalizeLocalConfig({},defaults);assert.equal(config.chatWorkflow,'');assert.equal(chatWorkflowSpec(config).file,'');
 const workflow=graph(),before=structuredClone(workflow);
 prepareLocalChatImages(workflow,{inputs:{image:mappings.image}},{imageFiles:['photo.png']});
 assert.deepEqual(workflow,before);
 const analysis=inspectWorkflow(workflow,{},{preferredKind:'chat'});
 assert.deepEqual(analysis.inputs.imageEnabled,{node:'1',field:'use_image'});
 assert.equal(analysis.api['1'].inputs.server_url,'http://127.0.0.1:12345');
});

test('gateway without a selected workflow stays available and never silently selects a model',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./no-chat-model-',import.meta.url))),configFile=join(dir,'config.json');
 writeFileSync(configFile,JSON.stringify({voiceEnabled:false}));let calls=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),run:async()=>{calls++;throw Error('Must not run');}},fetchImpl:async()=>{throw Error('No provider requests allowed');}});
 const base=await listenLocalServer(service);
 try{
  const c=await(await fetch(base+'/config')).json();assert.deepEqual(c.options.chatWorkflows,[]);assert.equal(c.config.chatWorkflow,'');
  const list=await(await fetch(base+'/v1/models')).json();assert.deepEqual(list.data,[]);
  const health=await(await fetch(base+'/health')).json();assert.equal(health.ok,true);
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'你好'}]})});
  assert.equal(response.status,500);const result=await response.json();assert.match(result.error.message,/导入并选择聊天工作流/);assert.equal(calls,0);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

test('8GB automatic vision uses the imported external local workflow and passes the current QQ photo',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./external-server-',import.meta.url)));
 const file=join(dir,'workflow.json');writeFileSync(file,JSON.stringify(graph()));
 const configFile=join(dir,'config.json');
 const inspected=inspectWorkflow(graph(),{},{preferredKind:'chat'});assert.equal(inspected.ready,true);
 delete inspected.inputs.imageEnabled; // Simulate an import saved by an older gateway.
 writeFileSync(configFile,JSON.stringify({backend:'comfyui',chatWorkflow:'my-vl',voiceEnabled:false,memoryProfile:'8gb',visionMode:'auto',mediaDir:join(dir,'media'),workflowLibrary:[{id:'my-vl',name:'本地文字与看图',kind:'chat',file,inputs:inspected.inputs,output:{node:'2',field:'text',kind:'text'}}]}));
 const calls=[];
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{status:async()=>({reachable:true}),waitUntilIdle:async()=>{},release:async()=>({freed:true}),run:async(kind,args)=>{calls.push({kind,args});return{text:'模拟本地回复'};}},fetchImpl:async()=>{throw Error('No provider requests allowed');}});
 const base=await listenLocalServer(service);
 try{
  const h=await(await fetch(base+'/health')).json();assert.equal(h.capabilities.vision.route,'native');assert.deepEqual(h.config.workflowLibrary[0].inputs.imageEnabled,{node:'1',field:'use_image'});
  const response=await fetch(base+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'人设'},{role:'user',content:[{type:'text',text:'图片上是什么'},{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jI1kAAAAASUVORK5CYII='}}]}]})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.ok(calls.length);assert.ok(calls.every(c=>c.kind==='chat'));assert.equal(calls[0].args.imageFiles.length,1);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
