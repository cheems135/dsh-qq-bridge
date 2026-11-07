import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import vm from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createComfyRuntime} from '../comfyui-runtime.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');

test('the records panel distinguishes selected references, verified workflow bindings and subject clarification',()=>{
 const html=readFileSync(new URL('../console.html',import.meta.url),'utf8'),start=html.indexOf('  function invocationExtraDetails(row)'),end=html.indexOf('  function paintInvocations(',start);
 const c=vm.createContext({esc:s=>String(s??'').replace(/[&<>"']/g,'_')});vm.runInContext(html.slice(start,end)+'\nthis.render=invocationExtraDetails;',c);
 assert.match(c.render({tool:'image',reference:{selected:true,used:false}}),/已选中，尚未确认上传绑定/);
 const bound=c.render({tool:'image',reference:{selected:true,used:true,verified:true,uploadedImage:'reference.png',onOutputPath:true,reason:'persona_reference_bound_to_submitted_workflow'}});assert.match(bound,/已上传并连接到输出分支/);assert.match(bound,/输出分支连通：是/);assert.match(bound,/不代表最终画面必然保持身份/);
 assert.match(c.render({tool:'image',reference:{reason:'subject_needs_clarification',used:false}}),/没有提交无参考图/);
});

test('the actual gateway blocks a missing required persona image and records binding verification only after runtime submission',async()=>{
 for(const withImage of [false,true]){
  const dir=mkdtempSync(join(tmpdir(),'gateway-reference-')),configFile=join(dir,'config.json'),workflow=join(dir,'image.json'),resultFile=join(dir,'result.png');writeFileSync(resultFile,png);
  writeFileSync(workflow,JSON.stringify({'1':{class_type:'LoadImage',inputs:{image:''}},'2':{class_type:'SaveImage',inputs:{images:['1',0]}},'3':{class_type:'PrimitiveString',inputs:{value:''}}}));
  writeFileSync(configFile,JSON.stringify({backend:'openai',modelId:'test-local-service',voiceEnabled:false,memoryProfile:'workflow',workflowLibrary:[{id:'portrait-workflow',name:'角色图片',kind:'image',file:workflow,inputs:{image:{node:'1',field:'image'},prompt:{node:'3',field:'value'}},output:{node:'2',field:'images',kind:'image'}}]}));
  let mediaCalls=0;
  const runtime={queue:async()=>({running:0,pending:0}),release:async()=>({freed:true}),close:()=>{},run:async(_kind,args,options)=>{mediaCalls++;assert.equal(args.requirePersonaReference,true);assert.ok(args.image);options.onInvocation({status:'submitted',workflowDetails:{imageBinding:{value:'bridge/identity.png',onOutputPath:true}}});options.onInvocation({status:'submitted',promptId:'our-prompt'});return {ok:true,media:[{kind:'image',file:resultFile}]};}};
  const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},runtime,logger:()=>{},model:async()=> '先等我一下。',fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]})});const base=await listenLocalServer(service);
  try{const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'发一张你的自拍'}],turnContext:{mediaOnly:{kind:'image',prompt:'窗边读书的角色自拍'},personaReferenceDiagnostics:{configured:true,plannedOwnPortrait:true},...(withImage?{personaImage:{dataUrl:'data:image/png;base64,'+png.toString('base64')}}:{})}})});const body=await response.json();
   if(withImage){assert.equal(mediaCalls,1,JSON.stringify(body));assert.equal(body.attachments.length,1);const row=body.invocations.find(r=>r.tool==='image');assert.equal(row.reference.used,true);assert.equal(row.reference.verified,true);assert.equal(row.reference.uploadedImage,'bridge/identity.png');assert.equal(row.reference.onOutputPath,true);assert.equal(row.reference.sha256.length,64);}
   else{assert.equal(mediaCalls,0);assert.ok(body.invocations.some(r=>r.status==='failed'&&/人设/.test(r.error||r.result?.error||'')),JSON.stringify(body));}
  }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
 }
});

test('required persona reference is uploaded, bound and kept on the actual submitted output path',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reference-integrity-')),file=join(dir,'identity.png');writeFileSync(file,png);
 const graph={ref:{class_type:'LoadImage',inputs:{image:''}},enc:{class_type:'Encode',inputs:{image:['ref',0],text:''}},save:{class_type:'SaveImage',inputs:{images:['enc',0]}}};
 let uploaded=false,submitted=null;const events=[];
 const runtime=createComfyRuntime({root:dir,mediaDir:dir,getConfig:()=>({baseUrl:'http://127.0.0.1:8188',workflows:{studio:{api:graph,inputs:{image:{node:'ref',field:'image'},prompt:{node:'enc',field:'text'}},output:{node:'save',kind:'image',field:'images'}}}}),fetchImpl:async(url,init={})=>{
  if(url.endsWith('/upload/image')){assert.deepEqual(Buffer.from(await init.body.get('image').arrayBuffer()),png);uploaded=true;return Response.json({name:'identity-upload.png',subfolder:'bridge'});}
  if(url.endsWith('/prompt')){assert.equal(uploaded,true);submitted=JSON.parse(init.body).prompt;return Response.json({prompt_id:'verified'});}
  if(url.endsWith('/history/verified'))return Response.json({verified:{outputs:{save:{images:[{filename:'result.png',type:'output'}]}}}});
  if(url.includes('/view?'))return new Response(png,{headers:{'content-type':'image/png'}});throw Error('unexpected '+url);
 }});
 try{await runtime.run('studio',{image:file,requirePersonaReference:true,prompt:'窗边读书的人像'},{onInvocation:e=>events.push(e)});assert.equal(submitted.ref.inputs.image,'bridge/identity-upload.png');assert.equal(events[0].workflowDetails.imageBinding.onOutputPath,true);assert.equal(events[0].workflowDetails.imageBinding.value,'bridge/identity-upload.png');assert.equal(graph.ref.inputs.image,'');}
 finally{rmSync(dir,{recursive:true,force:true});}
});

test('missing references, absent mappings and disconnected image nodes cannot fall back to text-only submission',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'reference-fail-')),file=join(dir,'identity.png');writeFileSync(file,png);
 try{for(const scenario of ['no-image','no-map','disconnected']){
  let network=0;const api={ref:{class_type:'LoadImage',inputs:{image:''}},save:{class_type:'SaveImage',inputs:scenario==='disconnected'?{}:{images:['ref',0]}}};
  const runtime=createComfyRuntime({root:dir,getConfig:()=>({baseUrl:'http://127.0.0.1:8188',workflows:{studio:{api,inputs:scenario==='no-map'?{}:{image:{node:'ref',field:'image'}},output:{node:'save',kind:'image'}}}}),fetchImpl:async()=>{network++;throw Error('must not upload or submit');}});
  await assert.rejects(runtime.run('studio',{image:scenario==='no-image'?undefined:file,requirePersonaReference:true,prompt:'窗边读书'}),/人设/);assert.equal(network,0,scenario);
 }}finally{rmSync(dir,{recursive:true,force:true});}
});

test('ambiguous photo subjects ask naturally without submitting any media workflow and record why',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'subject-clarify-')),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({backend:'openai',modelId:'test-local-model',voiceEnabled:false,dialoguePriority:'speed'}));let mediaCalls=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:{queue:async()=>({running:0,pending:0}),release:async()=>({ok:true}),close:()=>{}},model:async({messages})=>{assert.match(JSON.stringify(messages),/拍摄主体还未明确/);return '你想看我，还是拍窗外给你看呀？';},tools:{image:{execute:async()=>{mediaCalls++;throw Error('no media permitted');}}}});
 const base=await listenLocalServer(service);
 try{for(const legacyHost of [false,true]){const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'拍一张给我看看'}],turnContext:{imagePlan:legacyHost?{ownPortrait:false}:{subjectResolution:{source:'needs-subject',ambiguous:true}},personaReferenceDiagnostics:{configured:true,prepared:false}}})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(mediaCalls,0);assert.equal(body.attachments.length,0);assert.match(body.text,/想看我/);assert.ok(body.invocations.some(r=>r.reference?.reason==='subject_needs_clarification'));}}
 finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
