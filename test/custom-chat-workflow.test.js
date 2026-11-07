import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createComfyRuntime} from '../comfyui-runtime.js';
import {bindChatWorkflowContext} from '../local-config.js';

test('generic chat preserves context either through separate mappings or in the single user prompt',()=>{
 const args={text:'今天穿什么',system:'原有人设',history:[{role:'user',content:'昨天说好了蓝色'}]};
 const single=bindChatWorkflowContext({inputs:{text:{node:'1',field:'question'}}},args);assert.match(single.text,/原有人设/);assert.match(single.text,/昨天说好了蓝色/);assert.match(single.text,/今天穿什么/);
 assert.strictEqual(bindChatWorkflowContext({inputs:{text:{node:'1',field:'question'},system:{node:'1',field:'system'},history:{node:'1',field:'history'}}},args),args);
 assert.throws(()=>bindChatWorkflowContext({inputs:{text:{node:'1',field:'question'},system:{node:'1',field:'question'}}},args),/同一个字段/);
});

test('actual Comfy chat submission uses the custom model, maps context, prunes unrelated generation and reads only the chosen output',async()=>{
 for(const valid of [true,false]){
  const dir=mkdtempSync(fileURLToPath(new URL('./generic-chat-',import.meta.url)));let submitted,free=0;
  const graph={'a':{class_type:'MyLanguageEngine',inputs:{question:'',model:'my-other-model.gguf'}},'b':{class_type:'MyTextOutput',inputs:{value:['a',0]}},'image':{class_type:'SaveImage',inputs:{images:['unused',0]}},'unused':{class_type:'DoNotGenerate',inputs:{prompt:'unrelated'}}};
  const spec={api:graph,inputs:{text:{node:'a',field:'question'}},output:{kind:'text',node:'b',field:'answer'},timeoutMs:5000};
  const runtime=createComfyRuntime({root:dir,getConfig:()=>({enabled:true,baseUrl:'http://127.0.0.1:8188',mediaDir:dir,keepWarm:true,workflows:{chat:spec}}),fetchImpl:async(url,o={})=>{
   if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
   if(url.endsWith('/free')){free++;return Response.json({});}
   if(url.endsWith('/prompt')){submitted=JSON.parse(o.body).prompt;return Response.json({prompt_id:'custom-chat'});}
   if(url.includes('/history/'))return Response.json({'custom-chat':{outputs:{b:valid?{answer:['实际模型回复']}:{wrong:['不是选中的字段']},other:{text:['不能当成回答的模板文本']}}}});
   throw Error('Unexpected request '+url);
  }});
  try{
   if(valid){const result=await runtime.run('chat',{text:'用户原话',system:'完整人设',history:[{role:'assistant',content:'上一轮回复'}]});assert.equal(result.text,'实际模型回复');assert.equal(submitted.a.inputs.model,'my-other-model.gguf');assert.match(submitted.a.inputs.question,/完整人设/);assert.match(submitted.a.inputs.question,/上一轮回复/);assert.match(submitted.a.inputs.question,/用户原话/);assert.deepEqual(Object.keys(submitted),['a','b']);const released=await runtime.release();assert.equal(released.freed,true);assert.equal(free,1);}
   else await assert.rejects(runtime.run('chat',{text:'hi'}),/没有回传文本字段 answer/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
});
