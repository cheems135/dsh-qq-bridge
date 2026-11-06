import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanLocalReply,requestedFormatting,needsDialogueRepair} from '../local-reply.js';
import {createLocalAgent} from '../local-agent.js';

test('chat removes whole-utterance quotes, narration wrappers and escaped line markers',()=>{
  assert.equal(cleanLocalReply('“你好呀。”\n“今天怎么样？”'),'你好呀。\n今天怎么样？');
  assert.equal(cleanLocalReply('"你好呀。\\n今天怎么样？"'),'你好呀。\n今天怎么样？');
  assert.equal(cleanLocalReply('（她抬起头，轻声笑了笑）\n她轻声说道：“你好呀。”'),'你好呀。');
  assert.equal(cleanLocalReply('*微笑* 你好呀😊'),'你好呀😊');
  assert.equal(cleanLocalReply('**她微笑**\n*你好呀*'),'你好呀');
  assert.equal(cleanLocalReply('<think>内部思考</think>\n**你好呀。**'),'你好呀。');
});

test('meaningful punctuation, quoted terms and explanatory parentheses survive',()=>{
  const value='我刚看了“流浪地球”，很好看！\n（大概十分钟）我就回来 😊';
  assert.equal(cleanLocalReply(value),value);
  assert.equal(cleanLocalReply('（微笑的意思是友善）'),'（微笑的意思是友善）');
  assert.equal(cleanLocalReply('她看着的那部电影是什么？'),'她看着的那部电影是什么？');
  assert.equal(cleanLocalReply('去 D:\\new\\note.txt 看看。'),'去 D:\\new\\note.txt 看看。');
});

test('explicit writing, translation, quotations and code override dialogue presentation',()=>{
  for(const request of ['给我写一个故事','用语音讲一个童话','输出 JSON 格式','原样保留引号','翻译这句话','帮我修改代码']){
    assert.equal(requestedFormatting(request),true,request);
    const value='她轻声说道：“你好。”\n*她笑了*';
    assert.equal(cleanLocalReply(value,{request}),value,request);
  }
  assert.equal(requestedFormatting('不要讲故事，直接跟我聊天'),false);
  assert.equal(cleanLocalReply('```js\nconst a = "hi";\n```'),'```js\nconst a = "hi";\n```');
});

test('obvious story-only output is repaired once without repeating tools',async()=>{
  let count=0;
  const agent=createLocalAgent({model:async({tools})=>{count++;if(count===1)return '（她抬起头，轻声笑了笑）';assert.deepEqual(tools,[]);return '“我在呢。”';},formatReply:cleanLocalReply,needsReplyRepair:needsDialogueRepair});
  const result=await agent.run({messages:[{role:'user',content:'你在吗？'}]});
  assert.equal(result.text,'我在呢。');assert.equal(count,2);
  let badCount=0;
  const stubborn=createLocalAgent({model:async()=>{badCount++;return '（她抬起头）';},formatReply:cleanLocalReply,needsReplyRepair:needsDialogueRepair});
  await assert.rejects(()=>stubborn.run({messages:[{role:'user',content:'你好'}]}),/场景旁白/);
  assert.equal(badCount,2);
});

test('speech synthesis receives cleaned speech and its saved transcript matches',async()=>{
  let spoken;
  const agent=createLocalAgent({model:async()=>({tool_calls:[{id:'a',function:{name:'speech',arguments:{text:'（她轻声笑了笑）\n“我在呢。”',final:true}}}]}),formatReply:cleanLocalReply,tools:{speech:{execute:async args=>{spoken=args.text;return {ok:true,kind:'speech',file:'D:/test.wav'};}}}});
  const result=await agent.run({messages:[{role:'user',content:'语音回我'}]});
  assert.equal(spoken,'我在呢。');assert.equal(result.spokenText,spoken);assert.equal(result.text,'');
});
