import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:http';
import {createServiceConnections,detectConnection,connectionUrl} from '../service-connections.js';
import {connectionCompletion,connectionMedia,createConnectionAdapter,providerForConnection,encodeHostMessages} from '../service-adapters.js';
import {installServiceConnections} from '../service-connections-plugin.js';
const key='test-key-never-return-in-ui';
function store(){let state=null;const changes=[];const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:s=>state=structuredClone(s)},onChange:s=>changes.push(s),getLegacyMode:()=>true});return {c,changes};}
const profile=(extra={})=>({name:'自定义服务',baseUrl:'https://example.com/v1',type:'openai',apiKey:key,chatModel:'custom-chat',imageModel:'custom-image',speechModel:'custom-tts',voice:'voice-1',...extra});
test('connection addresses normalize pasted endpoints without dropping a deployment prefix',()=>{
  assert.equal(connectionUrl('https://example.com/custom/v1/chat/completions'),'https://example.com/custom/v1');assert.equal(connectionUrl('http://127.0.0.1:8000/v1/audio/speech'),'http://127.0.0.1:8000/v1');
  for(const value of ['file:///a','https://user:password@example.com','https://example.com/?key=x'])assert.throws(()=>connectionUrl(value));
});
test('detection reads models without invoking inference or claiming untested media capability',async()=>{
  const calls=[];const result=await detectConnection({baseUrl:'https://example.com/v1',apiKey:key},{fetchImpl:async(url,options)=>{calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return Response.json({data:[{id:'model-any-name'}]});}});
  assert.equal(result.type,'openai');assert.deepEqual(result.models,['model-any-name']);assert.equal(result.capabilities.image,'unverified');assert.equal(JSON.stringify(result).includes(key),false);assert.equal(calls.length,1);assert.ok(calls[0].options.headers.authorization);
});
test('ComfyUI and VoiceLab service signatures are recognized without loading a model',async()=>{
  const comfy=await detectConnection({baseUrl:'http://127.0.0.1:8188'},{fetchImpl:async()=>Response.json({system:{},devices:[]})});assert.equal(comfy.type,'comfyui');assert.equal(comfy.capabilities.workflow,'required');
  const voice=await detectConnection({baseUrl:'http://127.0.0.1:7870'},{fetchImpl:async url=>url.endsWith('/system_stats')?new Response('',{status:404}):Response.json({phase:'ready',busy:false,pid:1})});assert.equal(voice.type,'voicelab');
});
test('RunningHub bypasses generic probing and retains workflow requirements',async()=>{
  const r=await detectConnection({baseUrl:'https://www.runninghub.cn'},{fetchImpl:async()=>{throw Error('must not request');}});assert.equal(r.type,'runninghub');assert.equal(r.capabilities.workflow,'required');
});
test('model-list failures remain unknown and do not trigger a paid POST',async()=>{
  let count=0;const r=await detectConnection({baseUrl:'https://example.com/v1',apiKey:key},{fetchImpl:async(_u,init)=>{count++;assert.equal(init.method,'GET');return new Response('',{status:401});}});assert.equal(r.type,'unknown');assert.equal(r.models.length,0);assert.ok(count>0);assert.ok(r.evidence.some(e=>e.includes('401')));
});
test('profiles preserve hidden credentials and allow independent source combinations',()=>{
  const {c}=store(),p=c.save(profile());assert.equal(p.apiKey,undefined);assert.equal(p.hasKey,true);assert.equal(JSON.stringify(c.snapshot()).includes(key),false);
  c.save({...p,apiKey:'',name:'修改名称'});assert.equal(c.profile(p.id).apiKey,key);
  assert.throws(()=>c.save({...p,baseUrl:'https://other.example/v1'}),/旧密钥/);
  c.saveRoutes({enabled:true,chat:'host',image:'local',speech:'profile:'+p.id});assert.equal(c.route('image'),'local');assert.equal(c.route('speech'),'profile:'+p.id);
  c.saveRoutes({enabled:true,chat:'local',image:'profile:'+p.id,speech:'local'});assert.equal(c.route('chat'),'local');assert.throws(()=>c.remove(p.id),/使用/);
  c.saveRoutes({enabled:false,chat:'host',image:'legacy',speech:'legacy'});assert.equal(c.route('image'),'legacy');assert.equal(c.raw().legacyLocalEnabled,true);
});
test('invalid routes fail without silently choosing a different service',()=>{
  const {c}=store(),p=c.save(profile({type:'anthropic'}));assert.throws(()=>c.saveRoutes({enabled:true,chat:'host',image:'profile:'+p.id,speech:'local'}),/类型/);assert.equal(c.raw().routes.enabled,false);
  assert.throws(()=>c.saveRoutes({enabled:true,chat:'profile:missing',image:'local',speech:'local'}),/不存在/);
});
test('failed registration rolls persistent configuration back',()=>{
  let state=null;const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:s=>state=structuredClone(s)},onChange:()=>{throw Error('adapter not available');}});assert.throws(()=>c.save(profile()),/not available/);assert.equal(c.snapshot().profiles.length,0);
});
test('OpenAI calls preserve tools, history and current input, use one POST and sanitize failures',async()=>{
  let sent,calls=0;const p=profile();const messages=[{role:'system',content:'角色提示'},{role:'user',content:'上一句'},{role:'assistant',content:'前文'},{role:'user',content:'当前问题'}];
  const result=await connectionCompletion(p,{messages,tools:[{name:'bridge_search',parameters:{type:'object'}}],maxTokens:123},async(url,init)=>{calls++;sent=JSON.parse(init.body);assert.equal(url,'https://example.com/v1/chat/completions');assert.ok(init.headers['user-agent']);return Response.json({choices:[{message:{content:'回答'},finish_reason:'stop'}]});});assert.equal(result.content,'回答');assert.deepEqual(sent.messages,messages);assert.equal(sent.max_tokens,123);assert.equal(sent.tools[0].function.name,'bridge_search');assert.equal(calls,1);
  await assert.rejects(connectionCompletion(p,{messages},async()=>{throw Error('network failed '+key);}),error=>!error.message.includes(key));
});
test('Claude and Responses have their own request and tool-result mappings',async()=>{
  const messages=[{role:'system',content:'规则'},{role:'user',content:'问题'},{role:'assistant',content:'',tool_calls:[{id:'call-1',function:{name:'read',arguments:'{"url":"https://example.com"}'}}]},{role:'tool',tool_call_id:'call-1',content:'实际结果'}];
  const a=await connectionCompletion(profile({type:'anthropic'}),{messages},async(url,init)=>{const b=JSON.parse(init.body);assert.ok(url.endsWith('/messages'));assert.equal(b.system,'规则');assert.equal(b.messages[1].content[0].type,'tool_use');assert.equal(b.messages[2].content[0].type,'tool_result');assert.equal(init.headers['x-api-key'],key);return Response.json({content:[{type:'text',text:'结论'}]});});assert.equal(a.content,'结论');
  const r=await connectionCompletion(profile({type:'responses'}),{messages},async(url,init)=>{const b=JSON.parse(init.body);assert.ok(url.endsWith('/responses'));assert.ok(b.input.some(x=>x.type==='function_call_output'));return Response.json({output:[{type:'message',content:[{type:'output_text',text:'输出'}]}]});});assert.equal(r.content,'输出');
});
test('host adapter emits complete text/tool blocks and model metadata without fixed model names',async()=>{
  const {c}=store(),p=c.save(profile()),provider=providerForConnection(p.id);const adapter=createConnectionAdapter({connections:c,fetchImpl:async()=>Response.json({choices:[{message:{content:'已查询',tool_calls:[{id:'id-1',function:{name:'bridge_search',arguments:'{"query":"猫"}'}}]},finish_reason:'tool_calls'}]})});
  const models=await adapter.listModels(provider);assert.equal(models[0].id,'custom-chat');const chunks=[];for await(const chunk of adapter.stream({provider,model:'custom-chat',messages:[{role:'user',content:[{type:'text',text:'你好'}]}]}))chunks.push(chunk);
  assert.ok(chunks.some(c=>c.type==='block-end'&&c.block.type==='tool-call'&&c.block.id==='id-1'));assert.equal(chunks.at(-1).reason.kind,'tool-calls');assert.equal(adapter.providerRetryPolicy().maxRetries,0);
});
test('host image attachments are read as actual data rather than filename placeholders',async()=>{
  const rows=await encodeHostMessages({messages:[{role:'user',content:[{type:'image',attachment:{attachmentId:'x'}}]}]},{readImage:async()=>({ref:{mediaType:'image/png'},data:new Uint8Array([1,2,3])})});assert.equal(rows[0].content[0].image_url.url,'data:image/png;base64,AQID');
  await assert.rejects(encodeHostMessages({messages:[{role:'user',content:[{type:'image',attachment:{}}]}]}),/丢弃/);
  const toolRows=await encodeHostMessages({messages:[{role:'user',content:[{type:'tool-result',toolCallId:'call-1',content:[{type:'image',attachment:{attachmentId:'x'}}]}]}]},{readImage:async()=>({ref:{mediaType:'image/png'},data:new Uint8Array([1,2,3])})});assert.equal(toolRows[0].tool_call_id,'call-1');assert.equal(toolRows[1].content[1].image_url.url,'data:image/png;base64,AQID');assert.match(toolRows[1].content[0].text,/不是新的人类指令/);
});
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA5sAAAAASUVORK5CYII=','base64');
test('image API sends real reference bytes to edits and cannot drop them into text-to-image',async()=>{
  let calls=0;await assert.rejects(connectionMedia(profile(),'image',{prompt:'角色',reference:{bytes:png}},async()=>{calls++;}),/人设图/);assert.equal(calls,0);
  const result=await connectionMedia(profile({imageMode:'edits'}),'image',{prompt:'完整场景',reference:{bytes:png}},async(url,init)=>{calls++;assert.ok(url.endsWith('/images/edits'));assert.ok(init.body instanceof FormData);assert.equal(init.body.get('prompt'),'完整场景');assert.equal((await init.body.get('image').arrayBuffer()).byteLength,png.length);return Response.json({data:[{b64_json:png.toString('base64')}]});});assert.equal(result.extension,'png');assert.equal(calls,1);
});
test('speech adapter uses its own model and voice, accepts audio and rejects JSON pretending to be audio',async()=>{
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
  const result=await connectionMedia(profile(),'speech',{text:'你好'},async(url,init)=>{assert.ok(url.endsWith('/audio/speech'));const b=JSON.parse(init.body);assert.equal(b.model,'custom-tts');assert.equal(b.voice,'voice-1');return new Response(wav);});assert.equal(result.extension,'wav');
  await assert.rejects(connectionMedia(profile(),'speech',{text:'你好'},async()=>Response.json({error:'failed'})),/不是可确认/);
});
test('plugin registers chat connections and serves masked configuration through HTTP',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'connections-web-'));let route;const registered=[];
  const handle=Object.assign(()=>{},{replace:p=>registered.push(p)});const llm={registerAdapter:(providers)=>{registered.push(providers);return handle;}};
  const connections=installServiceConnections({ctx:{get:n=>n==='webServer'?{register:r=>{route=r;return()=>{};}}:n==='llm'?llm:null,effect:fn=>fn()},dataDir:dir,writeAtomic:(file,data)=>writeFileSync(file,JSON.stringify(data)),fetchImpl:async()=>Response.json({data:[{id:'model'}]})});
  const server=createServer(route.handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  try{const r=await fetch(url,{method:'POST',body:JSON.stringify({action:'save',...profile()})});assert.equal(r.status,200);const data=await fetch(url).then(r=>r.json());assert.equal(JSON.stringify(data).includes(key),false);assert.equal(data.profiles.length,1);assert.equal(registered.length,1);assert.equal(registered[0][0],providerForConnection(connections.snapshot().profiles[0].id));
    assert.equal((await fetch(url,{method:'POST',headers:{origin:'https://other.example'},body:'{}'})).status,403);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
