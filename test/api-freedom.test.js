import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createServiceConnections,connectionRequestUrl} from '../service-connections.js';
import {connectionCompletion,connectionMedia,mergeConnectionModelGroups,providerForConnection} from '../service-adapters.js';

function setup(local=false){let state=null;return createServiceConnections({storage:{read:()=>structuredClone(state),write:s=>state=structuredClone(s)},getLegacyMode:()=>local});}
const input=(extra={})=>({name:'任意服务',type:'openai',baseUrl:'https://example.com/v1',apiKey:'only-test-key',chatModel:'arbitrary-chat',imageModel:'arbitrary-image',speechModel:'arbitrary-speech',voice:'my-voice',...extra});

test('switching a single API source preserves the other API or local sources',()=>{
 for(const local of [false,true]){
  const c=setup(local),a=c.save(input()),b=c.save(input({name:'other'}));
  c.use(a.id,'image');assert.equal(c.route('chat'),local?'local':'host');assert.equal(c.route('speech'),local?'local':'legacy');
  c.use(b.id,'speech');assert.equal(c.route('image'),'profile:'+a.id);assert.equal(c.route('speech'),'profile:'+b.id);
  c.use(a.id,'chat');assert.equal(c.route('speech'),'profile:'+b.id);assert.equal(c.route('chat'),'profile:'+a.id);
  c.saveRoutes({...c.raw().routes,enabled:false});assert.equal(c.raw().legacyLocalEnabled,local);
 }
});

test('connections without a required voice or protocol cannot be activated for speech',()=>{
 const c=setup(),p=c.save(input({voice:''}));assert.throws(()=>c.use(p.id,'speech'),/音色/);assert.equal(c.raw().routes.enabled,false);
 const claude=c.save(input({type:'anthropic'}));assert.throws(()=>c.use(claude.id,'image'),/类型/);assert.equal(c.raw().routes.enabled,false);
});

test('model-page selection changes the active chat model and restoring default preserves media routes',()=>{
 const c=setup(),p=c.save(input());c.use(p.id,'image');c.use(p.id,'speech');
 c.selectChatModel({provider:providerForConnection(p.id),model:'a-new-chat-model'});
 assert.equal(c.route('chat'),'profile:'+p.id);assert.equal(c.profile(p.id).chatModel,'a-new-chat-model');
 c.selectChatModel(null);assert.equal(c.route('chat'),'host');assert.equal(c.route('image'),'profile:'+p.id);assert.equal(c.route('speech'),'profile:'+p.id);
});

test('manual paths and arbitrary models survive save/edit without exposing keys',()=>{
 const c=setup(),p=c.save(input({paths:{chat:'/custom/chat',image:'render',speech:'https://example.com/custom/speech'},audioFormat:'mp3'}));
 assert.equal(p.paths.chat,'/custom/chat');assert.equal(p.paths.image,'/v1/render');assert.equal(p.paths.speech,'/custom/speech');
 const edited=c.save({...p,apiKey:'',name:'edited'});assert.deepEqual(edited.paths,p.paths);assert.equal(edited.audioFormat,'mp3');assert.equal(c.profile(p.id).apiKey,'only-test-key');assert.equal(JSON.stringify(c.snapshot()).includes('only-test-key'),false);
});

test('a connection selected outside the mixed routes cannot be deleted while in use',()=>{
 let state=null,selected='';const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:s=>state=structuredClone(s)},isProfileInUse:id=>id===selected});
 const p=c.save(input());selected=p.id;assert.throws(()=>c.remove(p.id),/聊天模型/);assert.equal(c.snapshot().profiles.length,1);selected='';c.remove(p.id);assert.equal(c.snapshot().profiles.length,0);
});

test('custom endpoints never forward authorization to a different origin or embed secrets',()=>{
 for(const chat of ['https://evil.example/chat','//evil.example/chat','https://user:password@example.com/chat','/chat?key=secret','/chat#secret'])assert.throws(()=>connectionRequestUrl(input({paths:{chat}}),'chat','chat/completions'));
});

test('custom chat endpoint transmits the chosen model and returns actual tool calls',async()=>{
 const result=await connectionCompletion(input({paths:{chat:'/custom/messages'}}),{messages:[{role:'user',content:'search'}],tools:[{name:'search',parameters:{type:'object'}}]},async(url,init)=>{
  assert.equal(url,'https://example.com/custom/messages');const body=JSON.parse(init.body);assert.equal(body.model,'arbitrary-chat');assert.equal(body.tools[0].function.name,'search');
  return Response.json({choices:[{message:{content:'',tool_calls:[{id:'one',type:'function',function:{name:'search',arguments:'{"q":"test"}'}}]},finish_reason:'tool_calls'}]});
 });assert.equal(result.tool_calls[0].function.name,'search');
});

test('custom image and speech URLs use their own models and requested audio format',async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA5sAAAAASUVORK5CYII=','base64');
 await connectionMedia(input({paths:{image:'/custom/images'}}),'image',{prompt:'scene'},async(url,init)=>{assert.equal(url,'https://example.com/custom/images');assert.equal(JSON.parse(init.body).model,'arbitrary-image');return Response.json({data:[{b64_json:png.toString('base64')}]});});
 const audio=await connectionMedia(input({paths:{speech:'/custom/tts'},audioFormat:'mp3'}),'speech',{text:'hello'},async(url,init)=>{assert.equal(url,'https://example.com/custom/tts');const b=JSON.parse(init.body);assert.equal(b.model,'arbitrary-speech');assert.equal(b.voice,'my-voice');assert.equal(b.response_format,'mp3');return new Response(Buffer.from('ID3test'));});assert.equal(audio.extension,'mp3');
});

test('custom models appear alongside the default DeepSeek catalog without duplicates or credentials',()=>{
 const c=setup(),p=c.save(input()),host=[{id:'deepseek-official',name:'DeepSeek',models:[{id:'default-chat'}]}];
 const groups=mergeConnectionModelGroups(host,c.snapshot().profiles);assert.equal(groups[0].id,'deepseek-official');assert.equal(groups[1].models[0].id,'arbitrary-chat');assert.equal(groups[1].id,providerForConnection(p.id));
 assert.equal(mergeConnectionModelGroups(groups,c.snapshot().profiles).length,2);assert.equal(JSON.stringify(groups).includes('only-test-key'),false);
});

test('auxiliary model calls honor the selected non-DeepSeek API and explicit per-turn overrides',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  function apiChatRoute('),end=source.indexOf('\n  }',start);
 const selected={provider:'custom-provider',model:'custom-model'};
 const context=vm.createContext({effectiveModel:()=>selected,ctx:{get:()=>({currentSelection:()=>({provider:'deepseek-official',model:'default'})})},cfg:{model:{provider:'deepseek-official',model:'default'}}});
 vm.runInContext(source.slice(start,end+4),context);
 assert.equal(context.apiChatRoute().provider,'custom-provider');assert.equal(context.apiChatRoute({provider:'override',model:'one'}).provider,'override');
 context.effectiveModel=()=>null;assert.equal(context.apiChatRoute().provider,'deepseek-official');
});
