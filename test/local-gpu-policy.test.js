import test from 'node:test';
import assert from 'node:assert/strict';
import {applyLocalGpuPolicy,modelBillions} from '../local-gpu-policy.js';
import {createComfyRuntime} from '../comfyui-runtime.js';

test('8GB profile bounds known Qwen contexts and makes large MoE experts use CPU',()=>{
  const graph={'1':{class_type:'QwenTE_ModelLoader',inputs:{'主模型':'Qwen3.6-35B-A3B-IQ2_M.gguf','模型系列':'Qwen3.6-VL','GPU层数':-1,'上下文长度':32768,'MoE专家上CPU':false,'KV缓存K类型':'f16','KV缓存V类型':'f16'}},'2':{class_type:'QwenTE_ChatSettings',inputs:{'最大边长':2048}}};
  const original=JSON.stringify(graph);
  const changed=applyLocalGpuPolicy(structuredClone(graph),{memoryProfile:'8gb',vision:true});
  assert.equal(changed['1'].inputs['MoE专家上CPU'],true);assert.equal(changed['1'].inputs['上下文长度'],6144);assert.equal(changed['2'].inputs['最大边长'],768);
  assert.equal(JSON.stringify(graph),original);
  assert.deepEqual(applyLocalGpuPolicy(structuredClone(graph),{memoryProfile:'workflow'}),graph);
  assert.equal(modelBillions('Q35-4B-G-UD/Qwen3.5-4B-UD-Q4_K_XL.gguf'),4);
});

test('release never unloads or interrupts when ComfyUI has another job',async()=>{
  const calls=[];
  const runtime=createComfyRuntime({getConfig:{baseUrl:'http://127.0.0.1:8188'},fetchImpl:async(url,init={})=>{calls.push({url,method:init.method||'GET'});return Response.json({queue_running:[[1,'manual-job']],queue_pending:[]});}});
  const result=await runtime.release();
  assert.equal(result.freed,false);assert.equal(result.busy,true);
  assert.deepEqual(calls.map(row=>row.method),['GET']);
});

test('failed unload cannot fall through to an unguarded global free',async()=>{
  const calls=[];
  const runtime=createComfyRuntime({getConfig:{baseUrl:'http://127.0.0.1:8188'},fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});return new Response('unavailable',{status:503});}});
  const result=await runtime.release();assert.equal(result.freed,false);assert.ok(!calls.some(url=>url.endsWith('/free')));
});

test('a manual job appearing during unload prevents global free and another GPU model',async()=>{
  const calls=[];let queues=0;
  const runtime=createComfyRuntime({getConfig:{baseUrl:'http://127.0.0.1:8188'},fetchImpl:async(url)=>{
    calls.push(url);
    if(url.endsWith('/queue'))return Response.json({queue_running:++queues===1?[]:[[1,'new-manual-job']],queue_pending:[]});
    if(url.endsWith('/prompt'))return Response.json({prompt_id:'unload'});
    if(url.endsWith('/history/unload'))return Response.json({unload:{outputs:{'1':{text:['released']}}}});
    throw Error('unexpected '+url);
  }});
  const result=await runtime.release();assert.equal(result.freed,false);assert.equal(result.busy,true);assert.ok(!calls.some(url=>url.endsWith('/free')));
});
