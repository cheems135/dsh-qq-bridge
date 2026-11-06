import {listenLocalServer} from './local-server-listen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createInvocationJournal,redactInvocation} from '../invocation-journal.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {createComfyRuntime} from '../comfyui-runtime.js';
import {requestLocalJson} from '../local-transport.js';
function journal(){let rows=[],saved=0;return {store:createInvocationJournal({getRows:()=>rows,setRows:value=>rows=value,save:()=>saved++,limit:3}),rows:()=>rows,saved:()=>saved};}
test('one journal tracks local and API media without replacing actual submitted prompts on completion',()=>{
 const h=journal(),scope={accountId:'a',backend:'local'};h.store.record({id:'image1',tool:'image',status:'started',arguments:{prompt:'模型原词'}},scope);h.store.record({id:'image1',status:'submitted',submittedArguments:{prompt:'带人设约束的实际词',negativePrompt:'反向词',seed:77}},scope);h.store.record({id:'image1',status:'returned',arguments:{prompt:'模型原词'},result:{files:['example.png']}},scope);
 h.store.record({id:'video1',kind:'video',status:'failed',error:'服务未就绪'},{accountId:'a',backend:'api'});h.store.record({id:'other',status:'started'},{accountId:'b',backend:'api'});
 assert.equal(h.store.list({accountId:'a'}).length,2);assert.equal(h.store.list({accountId:'a',backend:'api'})[0].kind,'video');assert.equal(h.store.list({accountId:'a',backend:'local'})[0].submittedArguments.prompt,'带人设约束的实际词');h.store.record({id:'fourth'},{accountId:'a'});assert.equal(h.rows().length,3);
});
test('journal removes credentials and binary media while preserving editable prompt parameters',()=>{
 const value=redactInvocation({prompt:'a red cat',apiKey:'PRIVATE',headers:{Authorization:'Bearer PRIVATE','x-api-key':'PRIVATE'},nodeInfoList:[{fieldName:'api_key',fieldValue:'PRIVATE'}],image:{type:'image',data:'PRIVATE'},file:'data:image/png;base64,PRIVATE',negativePrompt:'blurry',max_tokens:512});const text=JSON.stringify(value);assert.ok(!text.includes('PRIVATE'));assert.equal(value.prompt,'a red cat');assert.equal(value.max_tokens,512);assert.equal(value.negativePrompt,'blurry');
});
test('finished records never regress on delayed events and polling does not rewrite unchanged rows',()=>{
 const h=journal();h.store.record({id:'x',status:'returned',updatedAt:100},{accountId:'a'});const saves=h.saved();h.store.record({id:'x',status:'started',updatedAt:50},{accountId:'a'});assert.equal(h.saved(),saves);assert.equal(h.rows()[0].status,'returned');
});
test('gateway streams and persists exact media arguments, failures and tool results without a QQ send',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'invocation-gateway-'));let calls=0;
 writeFileSync(join(dir,'config.json'),JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir}));
 const service=createLocalModelServer({
  configFile:join(dir,'config.json'),env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},
  runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},logger:()=>{},
  tools:{image:{execute:async(args,options)=>{
   options.onProgress({phase:'invocation',invocation:{id:options.invocationId,kind:'image',status:'submitted',submittedArguments:{prompt:'实际提交：'+args.prompt,negativePrompt:'模糊',seed:99}}});
   return {media:[{kind:'image',file:join(dir,'test.png')}]};
  }}},
  model:async()=>++calls===1?'{"action":"image","arguments":{"prompt":"红色小猫"}}':'已取得图片。',
 });
 try{await listenLocalServer(service);const base='http://127.0.0.1:'+service.server.address().port,events=[];const result=await requestLocalJson(base+'/v1/local/turn',{method:'POST',body:{stream:true,origin:'preview',messages:[{role:'user',content:'生成一张图片'}],turnContext:{recordScope:{accountId:'test-account',personaId:'test-persona',chat:'panel:local'}}},onEvent:event=>events.push(event)});assert.equal(result.ok,true);assert.ok(events.some(e=>e.event==='invocation'&&e.record.status==='submitted'));const list=await(await fetch(base+'/v1/local/invocations')).json();assert.equal(list.records.length,1);const row=list.records[0];assert.equal(row.status,'returned');assert.equal(row.backend,'local');assert.equal(row.arguments.prompt,'红色小猫');assert.equal(row.submittedArguments.prompt,'实际提交：红色小猫');assert.equal(result.body.invocations.length,1);assert.equal(result.body.qqDelivered,false);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
test('ComfyUI runtime reports final mapped input values immediately before the actual submission',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'invocation-workflow-')),events=[];const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const runtime=createComfyRuntime({root:dir,getConfig:()=>({enabled:true,baseUrl:'http://127.0.0.1:8188',mediaDir:dir,memoryProfile:'workflow',workflows:{pic:{api:{1:{class_type:'Text',inputs:{text:''}},2:{class_type:'SaveImage',inputs:{}}},inputs:{prompt:{node:'1',field:'text'}},output:{kind:'image',node:'2'},timeoutMs:5000}}}),fetchImpl:async(url)=>{const u=new URL(url);if(u.pathname==='/prompt')return Response.json({prompt_id:'test'});if(u.pathname==='/history/test')return Response.json({test:{outputs:{2:{images:[{filename:'image.png',subfolder:'',type:'output'}]}}}});if(u.pathname==='/view')return new Response(image,{headers:{'content-type':'image/png'}});return Response.json({queue_running:[],queue_pending:[]});}});
 try{await runtime.run('pic',{prompt:'实际图片提示词'},{onInvocation:event=>events.push(event)});assert.equal(events.length,2);assert.equal(events[1].promptId,"test");assert.match(events[1].clientId,/^bridge-/);assert.equal(events[0].submittedArguments.submittedNodes.prompt.value,'实际图片提示词');assert.equal(events[0].status,'submitted');}finally{rmSync(dir,{recursive:true,force:true});}
});
