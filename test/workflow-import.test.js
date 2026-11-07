import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';
import {chatWorkflowSpec} from '../local-config.js';
import {listenLocalServer} from './local-server-listen.js';

export const graph={
  '10':{class_type:'CustomImageGenerator',inputs:{prompt:'original prompt',seed:1}},
  '20':{class_type:'SaveImage',inputs:{images:['10',0],filename_prefix:'test'}},
};

async function fixture(run){
  const directory=mkdtempSync(join(tmpdir(),'workflow-import-'));
  const calls=[];
  const runtime={status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(kind,args)=>{calls.push({kind,args});return {text:'本地回复成功'};}};
  const service=createLocalModelServer({env:{LOCALAPPDATA:directory,LOCAL_AI_WORKFLOW_DIR:join(directory,'imported')},configFile:join(directory,'config.json'),runtime,logger:()=>{},fetchImpl:async url=>{
    if(String(url).endsWith('/models'))return Response.json({data:[{id:'any-local-model-a'},{id:'my-custom-70b'}]});
    if(String(url).endsWith('/api/model/unload'))return Response.json({ok:true});
    throw Error('Unexpected request '+url);
  }});
  const origin=await listenLocalServer(service);
  const post=async(path,body)=>{
    const r=await fetch(origin+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await r.json();return {status:r.status,data};
  };
  try{await run({post,service,directory,calls});}finally{service.server.closeAllConnections();await service.close();rmSync(directory,{recursive:true,force:true});}
}

test('upload, inspect and import persists normalized graph plus automatic bindings without generating',()=>fixture(async({post,calls})=>{
  const inspected=await post('/v1/local/workflow/inspect',{workflow:graph,filename:'我的工作流.json'});
  assert.equal(inspected.status,200);assert.equal(inspected.data.analysis.ready,true);assert.equal(inspected.data.analysis.inputs.prompt.node,'10');
  const imported=await post('/v1/local/workflow/import',{token:inspected.data.token,name:'自己的生图'});
  assert.equal(imported.status,200,JSON.stringify(imported.data));
  assert.equal(imported.data.entry.name,'自己的生图');assert.equal(imported.data.entry.inputs.prompt.field,'prompt');
  assert.equal(JSON.parse(readFileSync(imported.data.entry.file,'utf8'))['10'].inputs.prompt,'original prompt');
  assert.equal(imported.data.config.workflowLibrary[0].autoDetection.format,'api');assert.equal(calls.length,0);
  assert.equal((await post('/v1/local/workflow/import',{token:inspected.data.token})).status,400);
}));

test('imported chat workflows are selectable and run without requiring one of the three presets',()=>fixture(async({post,service,calls})=>{
  const chat={'9':{class_type:'QwenTE_MultiTurnChat',inputs:{'用户消息':'','对话历史JSON':'[]','请求ID':'old','增强设置':['8',0]}},'8':{class_type:'QwenTE_ChatSettings',inputs:{'系统提示词':'','温度':0.7,'最大生成token':256}}};
  const inspected=await post('/v1/local/workflow/inspect',{workflow:chat,filename:'自己的聊天模型.json'});
  assert.equal(inspected.data.analysis.kind,'chat');
  const imported=await post('/v1/local/workflow/import',{token:inspected.data.token});
  assert.equal(imported.status,200,JSON.stringify(imported.data));
  const id=imported.data.entry.id;
  const configured=await post('/config',{backend:'comfyui',chatWorkflow:id,voiceEnabled:false});
  assert.equal(configured.status,200,JSON.stringify(configured.data));assert.equal(service.config.modelId,id);
  assert.equal(chatWorkflowSpec(service.config).inputs.text.field,'用户消息');
  const result=await post('/v1/local/turn',{messages:[{role:'system',content:'完整人设'},{role:'user',content:'测试一句话'}]});
  assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.text,'本地回复成功');assert.equal(calls[0].args.text,'测试一句话');
}));

test('model listing reads arbitrary local providers and does not restrict model ids',()=>fixture(async({post})=>{
  const result=await post('/v1/local/models',{baseUrl:'http://127.0.0.1:1234/v1'});
  assert.equal(result.status,200);assert.deepEqual(result.data.models.map(x=>x.id),['any-local-model-a','my-custom-70b']);
  const config=await post('/config',{backend:'openai',modelBaseUrl:'http://127.0.0.1:1234/v1',modelId:'unlisted-but-valid'});
  assert.equal(config.status,200);assert.equal(config.data.config.modelId,'unlisted-but-valid');
}));

test('bad import selections are rejected without pretending that the workflow is usable',()=>fixture(async({post})=>{
  const inspected=await post('/v1/local/workflow/inspect',{workflow:graph});
  assert.equal((await post('/v1/local/workflow/import',{token:inspected.data.token,inputs:{prompt:{node:'missing',field:'text'}}})).status,400);
}));

test('choosing one output imports only its ancestors, avoiding unintended extra generations',()=>fixture(async({post})=>{
  const multiple={...graph,'30':{class_type:'CustomImageGenerator',inputs:{prompt:'other image'}},'40':{class_type:'SaveImage',inputs:{images:['30',0],filename_prefix:'other'}}};
  const inspected=await post('/v1/local/workflow/inspect',{workflow:multiple});
  const imported=await post('/v1/local/workflow/import',{token:inspected.data.token,kind:'image',inputs:{prompt:{node:'10',field:'prompt'}},output:inspected.data.analysis.outputs.find(x=>x.node==='20')});
  assert.equal(imported.status,200,JSON.stringify(imported.data));
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(imported.data.entry.file,'utf8'))),['10','20']);
}));

test('an arbitrary chat workflow can use a manually confirmed text receipt and become the active chat atomically',()=>fixture(async({post,service,calls})=>{
 const graph={'71':{class_type:'MyLocalLanguageEngine',inputs:{question:'原问题',model:'any-local-model.gguf'}}};
 const inspected=await post('/v1/local/workflow/inspect',{workflow:graph,kind:'chat',filename:'自选聊天.json'});
 assert.equal(inspected.status,200);assert.equal(inspected.data.analysis.errors.length,0);assert.equal(inspected.data.analysis.inputs.prompt.field,'question');assert.equal(inspected.data.analysis.manualOutputs.length,1);
 const result=await post('/v1/local/workflow/import',{token:inspected.data.token,kind:'chat',name:'自定义语言模型',inputs:inspected.data.analysis.inputs,output:{node:'71',field:'answer',kind:'chat',manual:true},activateChat:true});
 assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(service.config.chatWorkflow,result.data.entry.id);assert.equal(service.config.modelId,result.data.entry.id);assert.equal(result.data.config.backend,'comfyui');assert.equal(calls.length,0);
 const r=await fetch('http://127.0.0.1:'+service.server.address().port+'/config'),config=await r.json();assert.ok(config.options.chatWorkflows.includes(result.data.entry.id));assert.equal(config.options.chatWorkflowManagement,true);
}));

test('chat import in a mixed workflow chooses text ancestors instead of the default image branch',()=>fixture(async({post,calls})=>{
 const mixed={...graph,'51':{class_type:'MyLanguageNode',inputs:{user_message:'你好'}},'52':{class_type:'ShowText',inputs:{text:['51',0]}}};
 const r=await post('/v1/local/workflow/inspect',{workflow:mixed,kind:'chat'});assert.equal(r.data.analysis.kind,'chat');assert.equal(r.data.analysis.inputs.prompt.node,'51');
 const imported=await post('/v1/local/workflow/import',{token:r.data.token,kind:'chat',inputs:r.data.analysis.inputs,output:r.data.analysis.outputs.find(x=>x.node==='52'),activateChat:true});
 assert.equal(imported.status,200,JSON.stringify(imported.data));assert.deepEqual(Object.keys(JSON.parse(readFileSync(imported.data.entry.file,'utf8'))),['51','52']);assert.equal(calls.length,0);
}));

test('manual chat output still rejects missing nodes and unsafe field names',()=>fixture(async({post})=>{
 const inspected=await post('/v1/local/workflow/inspect',{workflow:{'7':{class_type:'MyLanguageNode',inputs:{question:'hi'}}},kind:'chat'});
 for(const output of [{node:'missing',field:'answer'},{node:'7',field:'__proto__'}])assert.equal((await post('/v1/local/workflow/import',{token:inspected.data.token,kind:'chat',output:{...output,kind:'chat',manual:true},inputs:inspected.data.analysis.inputs})).status,400);
}));
