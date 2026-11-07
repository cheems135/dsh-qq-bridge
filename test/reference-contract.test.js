import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

test('reference prepared by the host is required even if the older subject flag says false',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  function localPersonaReferenceDiagnostics('),end=source.indexOf('\n  let localForegroundAt=',start);
 const diagnose=Function('personaImageInfo','activePersona','return ('+source.slice(start,end).trim()+');')(()=>({file:'identity.png'}),()=>({id:'persona'}));
 const result=diagnose({key:'private'}, {ownPortrait:false},{dataUrl:'data:image/png;base64,actual'});assert.equal(result.required,true);assert.equal(result.selectionPolicy,'persona-required');
 const missing=diagnose({key:'private'},null,null);assert.equal(missing.selectionPolicy,'subject-unresolved');assert.equal(missing.reason,'no_image_plan');
});

test('different chat models cannot omit or replace a prepared reference on an image tool call',async()=>{
 for(const modelId of ['local-custom-a','local-custom-b']){
  const dir=mkdtempSync(fileURLToPath(new URL('./reference-model-',import.meta.url))),configFile=join(dir,'config.json'),file=join(dir,'graph.json'),output=join(dir,'output.png');writeFileSync(output,png);
  writeFileSync(file,JSON.stringify({'1':{class_type:'LoadImage',inputs:{image:''}},'2':{class_type:'SaveImage',inputs:{images:['1',0]}}}));
  writeFileSync(configFile,JSON.stringify({backend:'openai',modelId,fastDialogue:false,voiceEnabled:false,memoryProfile:'workflow',workflowLibrary:[{id:'character-image',name:'角色图',kind:'image',file,inputs:{prompt:{node:'1',field:'image'},image:{node:'1',field:'image'}},output:{kind:'image',node:'2',field:'images'}}]}));
  let calls=0,asked=false;
  const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async({tools=[]})=>{
   if(!asked&&tools.some(t=>t.function.name==='image')){asked=true;return{choices:[{message:{content:'',tool_calls:[{id:'photo',type:'function',function:{name:'image',arguments:JSON.stringify({prompt:'普通人物在窗边阅读',image:'a-model-guessed-file.png'})}}]}}]};}
   return '这是刚才的照片。';
  },runtime:{queue:async()=>({running:0,pending:0}),release:async()=>({freed:true}),run:async(_kind,args,options)=>{
   calls++;assert.equal(args.requirePersonaReference,true);assert.notEqual(args.image,'a-model-guessed-file.png');assert.deepEqual(readFileSync(args.image),png);
   options.onInvocation({status:'submitted',workflowDetails:{imageBinding:{value:'actual-upload.png',onOutputPath:true}}});return{media:[{kind:'image',file:output}]};
  }}});
  const base=await listenLocalServer(service);
  try{
   const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'今天怎么样'}],turnContext:{personaImage:{dataUrl:'data:image/png;base64,'+png.toString('base64')},personaReferenceDiagnostics:{configured:true,plannedOwnPortrait:false,prepared:true}}})});
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(calls,1,JSON.stringify(result));assert.equal(result.attachments.length,1);assert.ok(result.invocations.some(row=>row.reference?.verified===true));
  }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('missing image planning never silently skips a configured reference and runs text-only generation',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./reference-plan-',import.meta.url))),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({backend:'openai',modelId:'arbitrary-local',voiceEnabled:false}));let calls=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},model:async({messages})=>{assert.match(JSON.stringify(messages),/拍摄主体还未明确/);return'想画我在窗边，还是只画窗边呀？';},tools:{image:{execute:async()=>{calls++;throw Error('Must not generate');}}},runtime:{status:async()=>({reachable:true})}});
 const base=await listenLocalServer(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'生成一张图片'}],turnContext:{personaReferenceDiagnostics:{configured:true,reason:'no_image_plan'}}})});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(calls,0);assert.equal(result.attachments.length,0);assert.match(result.text,/窗边/);assert.ok(result.invocations.some(row=>row.reference?.reason==='image_plan_missing_reference_not_bypassed'));
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
