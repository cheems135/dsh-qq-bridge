import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent, toOpenAITools} from '../local-agent.js';

function toolResult(kind, file) {
  return {ok: true, kind, file, media: [{kind, file}], text: `${kind} completed`};
}

test('tool schema lists workflow ids and optional source image', () => {
  const tools = toOpenAITools({
    image: {
      execute() {},
      workflows: [{id: 'soft', name: '柔和', description: '日常自拍'}],
    },
    video: {execute() {}, workflows: [{id: 'motion', name: '动态'}]},
  });
  const image = tools.find(item => item.function.name === 'image');
  assert.ok(image.function.parameters.properties.workflowId);
  assert.match(image.function.parameters.properties.workflowId.description, /soft/);
  assert.ok(image.function.parameters.properties.image);
  assert.deepEqual(image.function.parameters.required, ['prompt']);
});

test('speech image and video dispatch with real files and duplicate tools run once', async () => {
  const calls = [];
  const tools = Object.fromEntries(['speech', 'image', 'video'].map(kind => [kind, {
    workflows: kind === 'speech' ? [] : [{id: kind + '-workflow', name: kind}],
    async execute(args) {
      calls.push({kind, args});
      return toolResult(kind, `D:/tmp/${kind}.bin`);
    },
  }]));
  const responses = [
    {choices: [{message: {role: 'assistant', content: '', tool_calls: [
      {id: 'a', function: {name: 'speech', arguments: {text: '你好'}}},
      {id: 'b', function: {name: 'speech', arguments: {text: '你好'}}},
    ]}}]},
    {choices: [{message: {role: 'assistant', content: '', tool_calls: [
      {id: 'c', function: {name: 'image', arguments: {prompt: '海边', workflowId: 'image-workflow'}}},
    ]}}]},
    {choices: [{message: {role: 'assistant', content: '', tool_calls: [
      {id: 'd', function: {name: 'video', arguments: {prompt: '走路'}}},
    ]}}]},
    {choices: [{message: {role: 'assistant', content: '都完成了'}}]},
  ];
  const agent = createLocalAgent({model: async () => responses.shift(), tools, maxToolRounds: 4});
  const result = await agent.run({messages: [{role: 'system', content: '角色'}, {role: 'user', content: '试用'}]});
  assert.equal(result.text, '都完成了');
  assert.deepEqual(result.attachments.map(item => item.kind), ['speech', 'image', 'video']);
  assert.equal(calls.filter(item => item.kind === 'speech').length, 1);
  assert.ok(result.receipts.some(item => item.duplicate === true));
});

test('failed tools yield failure receipts without pretending files exist', async () => {
  const responses = [
    {choices: [{message: {role: 'assistant', content: '', tool_calls: [
      {id: 'a', function: {name: 'image', arguments: {prompt: '失败测试'}}},
    ]}}]},
    {choices: [{message: {role: 'assistant', content: '图片没有生成成功。'}}]},
  ];
  const agent = createLocalAgent({
    model: async () => responses.shift(),
    tools: {image: {execute: async () => ({ok: false, error: 'ComfyUI 执行失败'})}},
  });
  const result = await agent.run({messages: [{role: 'user', content: '画图'}]});
  assert.equal(result.attachments.length, 0);
  assert.match(result.text, /这张图.*没能完整接上/);
  assert.equal(result.receipts[0].ok, false);
  assert.match(result.receipts[0].error, /失败/);
});

test('generated attachments survive a later model failure', async () => {
  let call = 0;
  const agent = createLocalAgent({
    model: async () => {
      call += 1;
      if (call === 1) return {choices: [{message: {role: 'assistant', content: '', tool_calls: [
        {id: 'a', function: {name: 'image', arguments: {prompt: '已生成'}}},
      ]}}]};
      throw new Error('最终文字模型失败');
    },
    tools: {image: {execute: async () => toolResult('image', 'D:/tmp/generated.png')}},
  });
  const result = await agent.run({messages: [{role: 'user', content: '生成'}]});
  assert.equal(result.attachments.length, 1);
  assert.match(result.text, /已生成 1 个媒体文件/);
  assert.equal(result.partial, true);
  assert.equal(result.receipts[0].ok, true);
});

test('configured tool whitelist hides unavailable media tools', () => {
  const agent = createLocalAgent({model: async () => 'ok', tools: {speech: {execute: async () => ({})}}});
  assert.deepEqual(agent.exposedTools(), ['speech']);
});

test('speech is returned immediately without a second model call or duplicate text',async()=>{
  let calls=0;
  const agent=createLocalAgent({model:async()=>{calls++;return '{"action":"speech","arguments":{"text":"连接成功。"}}';},tools:{speech:{execute:async()=>toolResult('speech','D:/voice.wav')}}});
  const result=await agent.run({messages:[{role:'user',content:'说一句话'}]});
  assert.equal(calls,1);assert.equal(result.text,'');assert.equal(result.spokenText,'连接成功。');assert.equal(result.attachments.length,1);assert.equal(result.receipts[0].ok,true);
});

test('explicit terminal speech can finish a multimedia turn after real receipt',async()=>{
  let calls=0;
  const agent=createLocalAgent({model:async()=>{calls++;return {tool_calls:[{id:'s',function:{name:'speech',arguments:{text:'完成。',final:true}}}]};},tools:{speech:{execute:async()=>toolResult('speech','D:/voice.wav')},image:{execute:async()=>{throw Error('unexpected');}}}});
  const result=await agent.run({messages:[{role:'user',content:'语音'}]});
  assert.equal(calls,1);assert.equal(result.text,'');assert.equal(result.spokenText,'完成。');
});

test('failed speech is reported to the model instead of terminal success',async()=>{
  let calls=0;
  const agent=createLocalAgent({model:async()=>++calls===1?'{"action":"speech","arguments":{"text":"你好","final":true}}':'语音没有生成成功。',tools:{speech:{execute:async()=>{throw Error('TTS unavailable');}}}});
  const result=await agent.run({messages:[{role:'user',content:'语音'}]});
  assert.equal(calls,2);assert.equal(result.attachments.length,0);assert.equal(result.receipts[0].ok,false);assert.match(result.text,/这段语音.*没能完整接上/);
});

test('nonterminal speech can continue and changing final flag cannot repeat the audio',async()=>{
  let calls=0,speech=0;
  const replies=['{"action":"speech","arguments":{"text":"你好","final":false}}','{"action":"speech","arguments":{"text":"你好","final":true}}','完成'];
  const agent=createLocalAgent({model:async()=>{calls++;return replies.shift();},tools:{speech:{execute:async()=>{speech++;return toolResult('speech','D:/voice.wav');}}}});
  const result=await agent.run({messages:[{role:'user',content:'语音'}]});
  assert.equal(calls,3);assert.equal(speech,1);assert.equal(result.text,'完成');assert.ok(result.receipts.some(r=>r.duplicate));
});

