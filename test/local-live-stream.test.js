import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createLocalModelServer} from '../local-model-server.mjs';
import {requestLocalJson} from '../local-transport.js';
import {readOpenAIStream} from '../local-openai-stream.js';

async function fixture(extra,run){
 const directory=mkdtempSync(join(tmpdir(),'qq-stream-')),file=join(directory,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:false,mediaDir:directory,backend:'comfyui',dialoguePriority:'speed',...extra.config}));
 const service=createLocalModelServer({configFile:file,runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),...extra.runtime},fetchImpl:async()=>Response.json({ok:true}),logger:()=>{},...extra,env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'log')}});
 await new Promise(resolve=>service.server.listen(0,'127.0.0.1',resolve));
 try{await run('http://127.0.0.1:'+service.server.address().port,directory);}finally{service.server.closeAllConnections();await service.close();rmSync(directory,{recursive:true,force:true});}
}

test('actual gateway transport exposes a sentence before generation finishes, with no tool JSON',async()=>{
 let finish,first;const early=new Promise(resolve=>first=resolve),events=[];
 await fixture({model:async options=>{assert.deepEqual(options.tools,[]);assert.equal(options.outputTokens,256);assert.equal(options.fastDialogue,true);options.onText('今天已经很辛苦了，先歇一会儿。');await new Promise(resolve=>finish=resolve);options.onText('坐下来聊聊吧。');return '今天已经很辛苦了，先歇一会儿。坐下来聊聊吧。';}},async base=>{
  let completed=false;const result=requestLocalJson(base+'/v1/local/turn',{method:'POST',body:{stream:true,messages:[{role:'user',content:'今天有点累，陪我聊两句'}]},onEvent:event=>{events.push(event);first();}}).then(value=>(completed=true,value));
  await early;assert.equal(completed,false);assert.equal(events[0].index,0);assert.match(events[0].text,/辛苦/);finish();const body=await result;assert.equal(body.ok,true);assert.equal(body.body.streamedParts,2);assert.equal(events.length,2);
 });
});

test('fast dialogue explicitly escalates to real tools without executing a guessed action first',async()=>{
 let calls=0,executed=0;
 await fixture({tools:{bridge_probe:{kind:'data',description:'读实际资料',parameters:{type:'object',properties:{},additionalProperties:false},execute:async()=>{executed++;return {ok:true,text:'实际资料'};}}},model:async options=>{
  calls++;if(calls===1){assert.deepEqual(options.tools,[]);return '{"action":"need_tools"}';}if(calls===2){assert.ok(options.tools.length);return '{"action":"bridge_probe","arguments":{}}';}return '我查到了实际资料。';
 }},async base=>{const response=await requestLocalJson(base+'/v1/local/turn',{method:'POST',body:{messages:[{role:'user',content:'这件事你知道吗'}]}});assert.equal(response.ok,true);assert.equal(executed,1);assert.equal(calls,3);assert.equal(response.body.receipts[0].ok,true);});
});

test('saved persona reference reaches the mapped local image workflow without a chat vision pass',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');let runs=0,referenceFile;
 await fixture({config:{defaultWorkflows:{image:'my-image'},workflowLibrary:[{id:'my-image',name:'自定义',kind:'image',file:'workflow.json',inputs:{prompt:{node:'1',field:'text'},image:{node:'2',field:'image'}},output:{kind:'image',node:'3',field:'images'}}]},model:async()=>'{"action":"image","arguments":{"prompt":"角色在窗边喝茶"}}',runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(kind,args)=>{runs++;assert.equal(kind,'my-image');assert.match(args.prompt,/保持角色身份/);assert.match(args.prompt,/角色在窗边喝茶/);referenceFile=args.image;assert.deepEqual(readFileSync(referenceFile),png);return {media:[{kind:'image',file:referenceFile}]};}}},async base=>{
  const result=await requestLocalJson(base+'/v1/local/turn',{method:'POST',body:{messages:[{role:'user',content:'生成一张你的自拍'}],turnContext:{personaImage:{dataUrl:'data:image/png;base64,'+png.toString('base64'),description:'保持相同的脸部身份'}}}});
  assert.equal(result.ok,true,JSON.stringify(result.body));assert.equal(runs,1);assert.equal(result.body.attachments.length,1);assert.equal(existsSync(referenceFile),false,'temporary reference must be removed');
 });
});

test('provider SSE preserves split UTF-8, suppresses reasoning and verifies completion',async()=>{
 const encoder=new TextEncoder(),bytes=encoder.encode('data: {"choices":[{"delta":{"reasoning_content":"PRIVATE"}}]}\n\ndata: {"choices":[{"delta":{"content":"你好，今天过得怎么样？"}}]}\n\ndata: [DONE]\n\n');let i=0;const response=new Response(new ReadableStream({pull(controller){if(i===bytes.length)return controller.close();controller.enqueue(bytes.slice(i,++i));}}));
 const parts=[];const result=await readOpenAIStream(response,{onText:text=>parts.push(text)});assert.equal(parts.join(''),'你好，今天过得怎么样？');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 await assert.rejects(()=>readOpenAIStream(new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')),/未完整结束/);
});

test('local NDJSON keeps emitted text on interruption without pretending a final result or retrying',async()=>{
 let requests=0;const server=createServer((req,res)=>{requests++;res.writeHead(200,{'content-type':'application/x-ndjson'});res.write(JSON.stringify({event:'text',index:0,text:'这是已经生成的一句。'})+'\n');setTimeout(()=>res.destroy(),10);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const events=[];try{await assert.rejects(requestLocalJson('http://127.0.0.1:'+server.address().port,{onEvent:event=>events.push(event)}),/响应中断/);assert.equal(events.length,1);assert.equal(requests,1);}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});



