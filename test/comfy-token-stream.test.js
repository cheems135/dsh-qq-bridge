import test from 'node:test';
import assert from 'node:assert/strict';
import {createComfyRuntime} from '../comfyui-runtime.js';

test('Comfy adapter is detected before submission and scoped token polling precedes final history',async()=>{
 const events=[],calls=[];let histories=0,availableChecked=false;
 const runtime=createComfyRuntime({getConfig:{enabled:true,baseUrl:'http://127.0.0.1:8188',workflows:{chat:{api:{'1':{class_type:'QwenTE_MultiTurnChat',inputs:{text:'',requestId:''}}},inputs:{text:{node:'1',field:'text'},requestId:{node:'1',field:'requestId'}},output:{node:'1',field:'text'},timeoutMs:5000}}},fetchImpl:async(url,init={})=>{
  calls.push(url);
  if(url.endsWith('/qq_bridge/stream/health')){availableChecked=true;return Response.json({available:true,version:1});}
  if(url.endsWith('/prompt')){assert.equal(availableChecked,true);return Response.json({prompt_id:'mine'});}
  if(url.includes('/qq_bridge/stream/')){assert.match(url,/1793782000000-qqs-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/);return Response.json({text:events.length?'':'第一句话已经完成。',offset:10,done:false});}
  if(url.includes('/history/'))return Response.json(++histories===1?{}:{mine:{outputs:{'1':{text:['第一句话已经完成。后面也说完了。']}}}});
  throw Error('unexpected '+url);
 }});
 const result=await runtime.run('chat',{text:'你好',requestId:'1793782000000-qqs-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',streamText:true},{onText:text=>{events.push(text);assert.equal(histories,0);}});
 assert.equal(events.join(''),'第一句话已经完成。');assert.match(result.text,/后面也说完/);assert.equal(calls.filter(url=>url.endsWith('/prompt')).length,1);
});

test('missing streaming adapter preserves ordinary workflow execution without token polling',async()=>{
 const calls=[];const runtime=createComfyRuntime({getConfig:{baseUrl:'http://127.0.0.1:8188',workflows:{chat:{api:{'1':{class_type:'Text',inputs:{text:''}}},inputs:{text:{node:'1',field:'text'}},output:{node:'1',field:'text'}}}},fetchImpl:async(url)=>{calls.push(url);if(url.endsWith('/health'))return new Response('not found',{status:404});if(url.endsWith('/prompt'))return Response.json({prompt_id:'mine'});return Response.json({mine:{outputs:{'1':{text:['完整回复']}}}});}});
 const result=await runtime.run('chat',{text:'你好',streamText:true},{onText:()=>assert.fail('no adapter')});assert.equal(result.text,'完整回复');assert.equal(calls.filter(url=>url.includes('/qq_bridge/stream/')&&!url.endsWith('/health')).length,0);
});
