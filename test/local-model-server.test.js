import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalModelServer} from '../local-model-server.mjs';

import {listenLocalServer as listen} from './local-server-listen.js';

function configFile(directory, value = {}) {
  const file = join(directory, 'config.json');
  writeFileSync(file, JSON.stringify({
    backend: 'comfyui',
    dialoguePriority:'speed',
    chatWorkflow: 'chat-4b',
    comfyUrl: 'http://127.0.0.1:8188',
    modelBaseUrl: 'http://127.0.0.1:8000/v1',
    voiceEnabled: false,
    mediaDir: join(directory, 'media'),
    ...value,
  }));
  return file;
}

const quietRuntime = {
  async status() { return {reachable: true, workflows: []}; },
  async release() { return {freed: true}; },
  async caption() { return {text: 'caption'}; },
};

test('health and config expose the real chat workflow and workflow library', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-agent-server-'));
  const service = createLocalModelServer({
    configFile: configFile(directory),
    runtime: quietRuntime,
    model: async () => 'ok',
    fetchImpl: async () => new Response('', {status: 200}),
    logger: () => {},
  });
  const base = await listen(service);
  try {
    const health = await (await fetch(base + '/health')).json();
    assert.equal(health.chat.model, 'chat-4b');
    assert.equal(health.chat.chatWorkflow, 'chat-4b');
    const config = await (await fetch(base + '/config')).json();
    assert.equal(config.modelId, 'chat-4b');
    assert.deepEqual(config.options.backends, ['comfyui', 'openai']);
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('ordinary OpenAI-compatible chat never receives or executes media tools', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-agent-server-'));
  let seen;
  const service = createLocalModelServer({
    configFile: configFile(directory, {
      workflowLibrary: [{
        id: 'image-a', name: '图片', kind: 'image', file: 'a.json',
        inputs: {prompt: {node: '1', field: 'text'}},
      }],
    }),
    runtime: quietRuntime,
    model: async options => {
      seen = options;
      return {choices: [{message: {role: 'assistant', content: '普通回答'}}]};
    },
    fetchImpl: async () => new Response('', {status: 200}),
    logger: () => {},
  });
  const base = await listen(service);
  try {
    const response = await fetch(base + '/v1/chat/completions', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({messages: [{role: 'user', content: '你好'}]}),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.choices[0].message.content, '普通回答');
    assert.deepEqual(seen.tools, []);
    assert.equal(seen.protocol, '');
    assert.equal(body._local.receipts.length, 0);
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('local turn dispatches tool once and returns text plus attachment in one response', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-agent-server-'));
  let toolCalls = 0;
  let modelCalls = 0;
  const service = createLocalModelServer({
    configFile: configFile(directory),
    runtime: quietRuntime,
    tools: {
      image: {
        workflows: [{id: 'image-a', name: '图片', description: '日常'}],
        async execute() {
          toolCalls += 1;
          return {ok: true, kind: 'image', file: join(directory, 'out.png'), media: [{kind: 'image', file: join(directory, 'out.png')}]};
        },
      },
    },
    model: async () => {
      modelCalls += 1;
      if (modelCalls === 1) return {choices: [{message: {role: 'assistant', content: '', tool_calls: [
        {id: 'x', function: {name: 'image', arguments: {prompt: '测试', workflowId: 'image-a'}}},
        {id: 'y', function: {name: 'image', arguments: {prompt: '测试', workflowId: 'image-a'}}},
      ]}}]};
      return {choices: [{message: {role: 'assistant', content: '已经生成。'}}]};
    },
    fetchImpl: async () => new Response('', {status: 200}),
    logger: () => {},
  });
  const base = await listen(service);
  try {
    const response = await fetch(base + '/v1/local/turn', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({messages: [{role: 'user', content: '生成图片并说明画面'}]}),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.text, '已经生成。');
    assert.equal(body.attachments.length, 1);
    assert.equal(toolCalls, 1);
    assert.equal(body.qqDelivered, false);
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('Comfy chat merges protocol into system and uses fresh millisecond request ids', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-agent-server-'));
  const requests = [];
  const runtime = {
    async run(kind, args) {
      assert.equal(kind, 'chat');
      requests.push(args);
      return {text: '本地回答'};
    },
    async status() { return {reachable: true}; },
    async release() { return {freed: true}; },
  };
  const service = createLocalModelServer({
    configFile: configFile(directory, {
      workflowLibrary: [{
        id: 'image-a', name: '图片', kind: 'image', file: 'a.json',
        inputs: {prompt: {node: '1', field: 'text'}},
      }],
    }),
    runtime,
    fetchImpl: async url => new Response('', {status: String(url).includes('unload') ? 200 : 503}),
    logger: () => {},
  });
  const base = await listen(service);
  try {
    for (let index = 0; index < 2; index += 1) {
      const response = await fetch(base + '/v1/local/turn', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({messages: [
          {role: 'system', content: '系统角色'},
          {role: 'user', content: '问题 ' + index},
        ]}),
      });
      assert.equal(response.status, 200);
    }
    assert.equal(requests.length, 2);
    assert.match(requests[0].requestId, /^\d{13}-(?:qqs-)?[0-9a-f-]{36}$/);
    assert.match(requests[1].requestId, /^\d{13}-(?:qqs-)?[0-9a-f-]{36}$/);
    assert.notEqual(requests[0].requestId, requests[1].requestId);
    assert.match(requests[0].system, /普通对话/);
    assert.equal(requests[0].history.some(item => item.role === 'system'), false);
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

test('CORS rejects non-loopback origins and invalid config is not acknowledged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-agent-server-'));
  const service = createLocalModelServer({
    configFile: configFile(directory),
    runtime: quietRuntime,
    model: async () => 'ok',
    fetchImpl: async () => new Response('', {status: 200}),
    logger: () => {},
  });
  const base = await listen(service);
  try {
    const blocked = await fetch(base + '/health', {headers: {origin: 'https://example.com'}});
    assert.equal(blocked.status, 403);
    const allowed = await fetch(base + '/health', {headers: {origin: 'http://127.0.0.1:54321'}});
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://127.0.0.1:54321');
    const invalid = await fetch(base + '/config', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({backend: 'remote', modelBaseUrl: 'http://127.0.0.1:8000/v1'}),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).ok, undefined);
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});

const sampleImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const imageMessages=()=>[{role:'system',content:'角色性格温柔，示例里可以有故事场景。'},{role:'user',content:[{type:'text',text:'图里是什么颜色？'},{type:'image_url',image_url:{url:sampleImage}}]}];

test('small Comfy VL chat receives the actual image once with the latest question and no extra caption pass',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'local-native-vision-')),calls=[];let received;
  const runtime={...quietRuntime,release:async()=>{calls.push('release');return {freed:true};},caption:async()=>{throw Error('should not caption');},run:async(kind,args)=>{received=args;calls.push(kind);assert.ok(existsSync(args.imageFiles[0]));return {text:'“蓝色。😊”\n“你喜欢吗？”'};}};
  const service=createLocalModelServer({configFile:configFile(directory),env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'test.log')},runtime,logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});
  const base=await listen(service);
  try{
    const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:imageMessages()})});const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.text,'蓝色。😊\n你喜欢吗？');
    assert.equal(received.text,'图里是什么颜色？');assert.equal(received.imageFiles.length,1);assert.match(received.system,/只输出你直接对对方说的话/);
    assert.deepEqual(calls,['release','chat']);assert.equal(existsSync(received.imageFiles[0]),false,'temporary input removed after the turn');
  }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('large chat uses question-aware lightweight vision and serial model switching',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'local-caption-vision-')),calls=[];let captionArgs;
  const runtime={...quietRuntime,release:async()=>{calls.push('release');return {freed:true};},caption:async args=>{captionArgs=args;calls.push('caption');return {text:'图片主体是蓝色方块。'};},run:async(kind,args)=>{calls.push(kind);assert.match(args.system,/蓝色方块/);assert.equal(args.imageFiles.length,0);return {text:'是蓝色的。'};}};
  const service=createLocalModelServer({configFile:configFile(directory,{chatWorkflow:'chat-35b'}),env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'test.log')},runtime,logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});const base=await listen(service);
  try{
    const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:imageMessages()})});const body=await response.json();
    assert.equal(response.status,200,JSON.stringify(body));assert.equal(body.text,'是蓝色的。');
    assert.match(captionArgs.text,/图里是什么颜色/);assert.deepEqual(calls,['release','caption','release','chat']);
  }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('local OpenAI multimodal payload keeps images through the agent and does not leak internal metadata',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'local-openai-vision-'));let sent;
  const service=createLocalModelServer({configFile:configFile(directory,{backend:'openai',modelId:'any-vl-model'}),env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'test.log')},runtime:quietRuntime,logger:()=>{},fetchImpl:async(url,init)=>{sent=JSON.parse(init.body);return Response.json({choices:[{message:{content:'蓝色。'}}]});}});const base=await listen(service);
  try{
    const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:imageMessages()})});assert.equal(response.status,200);
    assert.equal(sent.model,'any-vl-model');assert.equal(sent.messages.at(-1).content[1].image_url.url,sampleImage);
    assert.ok(!sent.messages.some(row=>Object.hasOwn(row,'_localImages')));
  }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('old image attachments are not re-read on a later text-only turn',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'local-old-vision-'));let captions=0,seen;
  const service=createLocalModelServer({configFile:configFile(directory,{visionMode:'caption'}),runtime:{...quietRuntime,caption:async()=>{captions++;return {text:'old image'};}},model:async({messages})=>{seen=messages;return '可以呀。';},logger:()=>{}});const base=await listen(service);
  try{
    const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[...imageMessages(),{role:'assistant',content:'蓝色'},{role:'user',content:'接着聊'}]})});assert.equal(response.status,200);assert.equal(captions,0);assert.ok(seen.every(row=>typeof row.content==='string'));
  }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('execution status is readable during generation and records result metadata without chat contents',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-live-status-'));let release,ready;const started=new Promise(r=>ready=r);
 const service=createLocalModelServer({configFile:configFile(directory),runtime:quietRuntime,logger:()=>{},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async()=>{ready();await new Promise(r=>release=r);return 'PRIVATE_FINAL_REPLY';}});const base=await listen(service);
 try{
  const running=fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({origin:'preview',messages:[{role:'user',content:'PRIVATE_USER_PROMPT'}]})});await started;
  const live=await(await fetch(base+'/v1/local/status')).json();assert.equal(live.execution.active.length,1);assert.equal(live.execution.active[0].phase,'model');assert.equal(live.execution.active[0].origin,'preview');assert.doesNotMatch(JSON.stringify(live),/PRIVATE_/);
  release();assert.equal((await running).status,200);
  const done=await(await fetch(base+'/v1/local/status')).json();assert.equal(done.execution.active.length,0);assert.equal(done.execution.recent[0].status,'succeeded');assert.equal(done.execution.recent[0].result.textChars,19);assert.doesNotMatch(JSON.stringify(done),/PRIVATE_/);
 }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('Comfy context overflow resets old history once and preserves current question and persona',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-context-recovery-')),calls=[];let releases=0;
 const runtime={...quietRuntime,release:async()=>{releases++;return {freed:true};},run:async(kind,args)=>{calls.push(args);if(calls.length===1)throw Error('当前系统提示词超过可用输入上下文 3456');return {text:'上下文已经整理，可以接着聊。',context:{used_tokens:3100,context_limit:4096}};}};
 const service=createLocalModelServer({configFile:configFile(directory),runtime,logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});const base=await listen(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'system',content:'完整角色设定'},{role:'user',content:'旧问题'},{role:'assistant',content:'旧回答'},{role:'user',content:'这是当前问题'}]})});const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(calls.length,2);assert.deepEqual(calls[1].history,[]);assert.match(calls[1].system,/完整角色设定/);assert.equal(calls[1].text,'这是当前问题');assert.notEqual(calls[0].requestId,calls[1].requestId);assert.equal(body.context.reset,true);assert.ok(releases>=2);
 }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('persistent context overflow stops after one recovery and network errors never restart generation',async()=>{
 for(const message of ['超过可用输入上下文 3456','fetch failed']){
  const directory=mkdtempSync(join(tmpdir(),'local-context-limit-'));let calls=0;
  const service=createLocalModelServer({configFile:configFile(directory),runtime:{...quietRuntime,run:async()=>{calls++;throw Error(message);}},logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});const base=await listen(service);
  try{const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'当前问题'}]})});assert.equal(response.status,500);assert.equal(calls,message==='fetch failed'?1:2);const status=await(await fetch(base+'/v1/local/status')).json();assert.equal(status.execution.recent[0].status,'failed');}
  finally{await service.close();rmSync(directory,{recursive:true,force:true});}
 }
});

test('OpenAI-compatible local services also recover from context errors without retrying executed tools',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-openai-context-')),calls=[];
 const service=createLocalModelServer({configFile:configFile(directory,{backend:'openai',modelId:'arbitrary-local-model'}),runtime:quietRuntime,logger:()=>{},fetchImpl:async(url,init={})=>{
  if(url.endsWith('/queue'))return Response.json({queue_running:[],queue_pending:[]});
  calls.push(JSON.parse(init.body));if(calls.length===1)return Response.json({error:{message:'maximum context length exceeded'}},{status:400});
  return Response.json({choices:[{message:{content:'已经整理好旧上下文。'}}]});
 }});const base=await listen(service);
 try{const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'system',content:'保留人设'},{role:'user',content:'旧问题'},{role:'assistant',content:'旧回答'},{role:'user',content:'新问题'}]})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(calls.length,2);assert.ok(!calls[1].messages.some(row=>row.content==='旧问题'));assert.ok(calls[1].messages.some(row=>row.content==='新问题'));assert.equal(body.context.reset,true);}
 finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('fixed prompt overflow actually shrinks the retry and never executes a successful tool twice',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-fixed-prompt-')),calls=[];let toolCalls=0;
 const persona='你叫小青。性格温柔但有主见。'+Array.from({length:150},(_,i)=>'背景 '+i+'：今天穿过庭院望着天空，回想从前的生活。').join('\n')+'禁止伪造工具成功。';
 const runtime={...quietRuntime,release:async()=>({freed:true}),run:async(kind,args)=>{
  calls.push(args);if(calls.length===1)return {text:'{"action":"bridge_probe","arguments":{"action":"read"}}'};
  if(calls.length===2)throw Error('当前系统提示词、Skill reference 和用户消息约需 3570 tokens，超过可用输入上下文 3456。');
  return {text:'构图中猫的位置和留白都可以继续检查。'};
 }};
 const service=createLocalModelServer({configFile:configFile(directory),env:{LOCAL_AI_LOG_FILE:join(directory,'log')},runtime,tools:{bridge_probe:{kind:'data',description:'读取绘画信息',parameters:{type:'object',properties:{action:{type:'string',enum:['read']}},required:['action']},execute:async()=>{toolCalls++;return {ok:true,text:'猫在画面左侧。',completed:true};}}},logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});const base=await listen(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'system',content:persona},{role:'user',content:'请读取信息，检查我画的猫的构图。'}]})});const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(toolCalls,1);assert.equal(calls.length,3);assert.ok(calls[2].system.length<calls[1].system.length,'retry must shrink fixed prompt, not just clear history');assert.match(calls[2].system,/你叫小青/);assert.match(calls[2].system,/性格温柔但有主见/);assert.match(calls[2].system,/禁止伪造/);assert.ok(calls[2].text.startsWith('请读取信息，检查我画的猫的构图。'));assert.match(calls[2].text,/猫在画面左侧/);assert.equal(body.context.reset,true);assert.equal(body.context.personaCompacted,true);
  const state=await(await fetch(base+'/v1/local/status')).json();assert.equal(state.execution.recent[0].context.personaCompacted,true);assert.doesNotMatch(JSON.stringify(state),/猫在画面左侧|你叫小青/);
 }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('OpenAI overflow compacts fixed recalled text and strips context metadata before calling an arbitrary model',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-openai-fixed-')),calls=[];
 const service=createLocalModelServer({configFile:configFile(directory,{backend:'openai',modelId:'custom-model'}),runtime:quietRuntime,logger:()=>{},fetchImpl:async(url,init={})=>{
  calls.push(JSON.parse(init.body));if(calls.length===1)return Response.json({error:{message:'maximum context length exceeded'}},{status:400});return Response.json({choices:[{message:{content:'好的，继续检查构图。'}}]});
 }});const base=await listen(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'system',_localContextKind:'persona',content:'你叫小青，温柔但有主见。'},{role:'system',_localContextKind:'memory',content:'【本地对话可参考的已有记忆及来源】\n'+'来源1：绘画练习，猫的构图。'.repeat(400)},{role:'user',content:'继续检查猫的构图。'}]})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(calls.length,2);assert.ok(JSON.stringify(calls[1].messages).length<JSON.stringify(calls[0].messages).length/2);assert.match(calls[1].messages[0].content,/你叫小青/);assert.equal(calls[1].messages.at(-1).content,'继续检查猫的构图。');assert.ok(calls.every(call=>!JSON.stringify(call).includes('_localContextKind')));assert.equal(body.context.promptCompacted,true);
 }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('planning estimates never reject a full current question that the actual tokenizer can accept',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-token-estimate-'));let received;
 const question='这是必须完整保留的当前问题。'.repeat(350);
 const service=createLocalModelServer({configFile:configFile(directory),runtime:{...quietRuntime,run:async(kind,args)=>{received=args;return {text:'已收到当前完整问题。',context:{used_tokens:2900,context_limit:4096}};}},logger:()=>{},fetchImpl:async()=>Response.json({ok:true})});const base=await listen(service);
 try{const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:question}]})});assert.equal(response.status,200);assert.equal(received.text,question);}
 finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('one local inference supplies validated mood and voice direction while private metadata stays out of speech and status',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-mood-voice-'));let calls=0,voiceCalls=0,instruction='',spoken='';
 const service=createLocalModelServer({configFile:configFile(directory,{voiceEnabled:true}),env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'log')},runtime:quietRuntime,logger:()=>{},model:async()=>{calls++;return JSON.stringify({action:'speech',arguments:{text:'谢谢你一直陪我。',final:true},mood:{moodDelta:2,dims:{happy:3},reason:'对方表达感谢',evidenceQuote:'谢谢你',confidence:85}});},fetchImpl:async(url,init={})=>{
  if(url.endsWith('/api/presets'))return Response.json({items:[{id:'test-voice',name:'测试',has_audio:true}]});
  if(url.endsWith('/api/tts')){voiceCalls++;instruction=init.body.get('instruction');spoken=init.body.get('text');return new Response(Buffer.concat([Buffer.from('RIFF0000WAVE'),Buffer.alloc(32)]),{headers:{'content-type':'audio/wav'}});}
  return Response.json({ok:true,queue_running:[],queue_pending:[]});
 }});const base=await listen(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'谢谢你，用语音说一句。'}],turnContext:{judgeMood:true,mood:{score:65,dims:{}},features:{memory:1,mood:1,private:'PRIVATE'}}})});const body=await response.json();
  assert.equal(response.status,200,JSON.stringify(body));assert.equal(calls,1);assert.equal(voiceCalls,1);assert.match(instruction,/轻快/);assert.equal(spoken,'谢谢你一直陪我。');assert.equal(body.text,'');assert.equal(body.mood.evidenceQuote,'谢谢你');assert.equal(body.attachments[0].kind,'speech');
  const state=await(await fetch(base+'/v1/local/status')).json();assert.equal(state.execution.recent[0].features.memory,1);assert.doesNotMatch(JSON.stringify(state),/谢谢你|对方表达感谢|PRIVATE/);
 }finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('background analysis defers to foreground chats and manual ComfyUI tasks without an inference or a misleading failed result',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-analysis-priority-'));let ready,complete,calls=0,manual=false;const started=new Promise(resolve=>ready=resolve);
 const service=createLocalModelServer({configFile:configFile(directory),runtime:quietRuntime,logger:()=>{},fetchImpl:async()=>Response.json({queue_running:manual?[[1]]:[],queue_pending:[]}),model:async()=>{calls++;if(calls===1){ready();await new Promise(resolve=>complete=resolve);}return {choices:[{message:{content:'聊天已完成。'}}]};}});const base=await listen(service);
 try{
  const pending=fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({origin:'qq',messages:[{role:'user',content:'先回答我'}]})});await started;
  const deferred=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,messages:[{role:'user',content:'后台学习'}]})});assert.equal(deferred.status,503);assert.equal(calls,1);
  let state=await(await fetch(base+'/v1/local/status')).json();assert.equal(state.execution.recent.length,0);assert.equal(state.execution.active.length,1);
  complete();assert.equal((await pending).status,200);manual=true;
  // Refresh the cached queue in a separate service to avoid a timing-based test.
  const manualService=createLocalModelServer({configFile:configFile(directory),runtime:quietRuntime,logger:()=>{},fetchImpl:async()=>Response.json({queue_running:[[1]],queue_pending:[]}),model:async()=>{throw Error('must preserve manual task');}});const manualBase=await listen(manualService);
  try{const response=await fetch(manualBase+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,messages:[{role:'user',content:'后台学习'}]})});assert.equal(response.status,503);state=await(await fetch(manualBase+'/v1/local/status')).json();assert.equal(state.execution.recent.length,0);}finally{await manualService.close();}
 }finally{complete?.();await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('idle background analysis uses the chosen backend with a bounded token budget and no tools',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-analysis-budget-'));let received;
 const service=createLocalModelServer({configFile:configFile(directory),runtime:{...quietRuntime,run:async(kind,args)=>{received=args;return {text:'{"items":[]}'};}},logger:()=>{},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]})});const base=await listen(service);
 try{const response=await fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,max_tokens:128,messages:[{role:'system',content:'只输出JSON，不调用工具。'},{role:'user',content:'整理已有资料。'}]})});const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(received.maxTokens,128);assert.doesNotMatch(received.system,/本地工具协议/);assert.equal(body.choices[0].message.content,'{"items":[]}');const state=await(await fetch(base+'/v1/local/status')).json();assert.equal(state.execution.recent[0].origin,'analysis');}
 finally{await service.close();rmSync(directory,{recursive:true,force:true});}
});

test('concurrent background analysis claims once before asynchronous checks and yields after a foreground turn',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-idle-claim-'));let complete,started,calls=0;const ready=new Promise(resolve=>started=resolve);
 const service=createLocalModelServer({configFile:configFile(directory),runtime:quietRuntime,logger:()=>{},env:{LOCAL_AI_WORK_DIR:directory},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async()=>{if(++calls===1){started();await new Promise(resolve=>complete=resolve);}return {choices:[{message:{content:'{"items":[]}'}}]};}});const base=await listen(service);
 const analyze=()=>fetch(base+'/v1/chat/completions',{method:'POST',body:JSON.stringify({analysis:true,messages:[{role:'user',content:'整理资料'}]})});
 try{
  const first=analyze();await ready;const second=await analyze();assert.equal(second.status,503);assert.equal(calls,1);complete();assert.equal((await first).status,200);
  assert.equal((await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({origin:'qq',messages:[{role:'user',content:'你好'}]})})).status,200);
  const before=calls;assert.equal((await analyze()).status,503);assert.equal(calls,before);
 }finally{complete?.();service.server.closeAllConnections();await service.close();rmSync(directory,{recursive:true,force:true});}
});




