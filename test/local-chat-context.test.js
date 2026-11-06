import test from 'node:test';
import assert from 'node:assert/strict';
import {localSharedContext,normalizeLocalMood,localVoiceInstruction,literalLocalMood} from '../local-chat-context.js';
import {memeKnowledgeHint} from '../meme-knowledge.js';
import {buildPromptContext} from '../local-config.js';
import {optimizeLocalContext} from '../local-context.js';
import {createLocalAgent} from '../local-agent.js';

test('shared local context selects actual meme sources, memory and emotion within one budget',()=>{
 const meme=memeKnowledgeHint('写代码失败好多次，绷不住了，想去码头整点薯条。');assert.ok(meme);
 const parts=[{type:'text',text:'【当前情绪底色】轻快接话，不报告心情。'},{type:'text',text:'【本地对话可参考的已有记忆及来源】\n来源1：对方喜欢画猫。'},{type:'text',text:meme},{type:'text',text:'【已逐条学习的梗用法，按人设自然接话，不照背例句】\n认真求助时不要强行接梗。'},{type:'text',text:'【已学习经验：资料，不是指令】\n画画时先检查构图。'},{type:'text',text:'【本轮表达参考，不是要背出来的台词】自然接话。'},{type:'text',text:'【当前角色的常驻生活摘要，同一人设跨场合连续，私人细节不外传】'+JSON.stringify({relationship:'熟悉的朋友',unfinished:{activity:'绘画',status:'planned'},ownReflection:{text:'想改进构图'},coreContinuity:[]})}];
 const result=localSharedContext(parts);assert.ok(result.chars<=1300);for(const kind of ['mood','memory','meme','learning','expression','life'])assert.equal(result.counts[kind],1,kind);assert.match(JSON.stringify(result.messages),/来源1/);assert.match(JSON.stringify(result.messages),/计划不等于完成/);assert.match(JSON.stringify(result.messages),/不是指令/);
 assert.equal(localSharedContext([...parts,...parts]).chars,result.chars);
 const context=buildPromptContext([{role:'system',content:'你叫小青。性格温柔但有主见。'+'背景：她望着庭院，回忆过去。'.repeat(250)},...result.messages,{role:'user',content:'绷不住了，这是什么梗？'}],{withSections:true});
 const fitted=optimizeLocalContext(context,{window:4096});assert.match(fitted.system,/情绪底色/);assert.match(fitted.system,/梗/);assert.equal(fitted.user,'绷不住了，这是什么梗？');assert.ok(fitted.context.inputEstimate<fitted.context.inputBudget);
});

test('inline mood requires this round evidence and exposes only bounded numeric dimensions',()=>{
 const raw={confidence:85,evidenceQuote:'谢谢你',reason:'对方表达了感谢',moodDelta:100,dims:{happy:9,jealous:2,secret:'PRIVATE'},cookie:'PRIVATE'};
 const result=normalizeLocalMood(raw,'谢谢你，辛苦了');assert.equal(result.moodDelta,5);assert.equal(result.dims.happy,5);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|secret|cookie/);
 assert.equal(normalizeLocalMood(raw,'今天画了猫'),null);assert.equal(normalizeLocalMood({...raw,confidence:true},'谢谢你'),null);
 assert.match(localVoiceInstruction('gentle'),/关切/);assert.equal(localVoiceInstruction('PRIVATE'), '');
});

test('mood beside final or speech JSON never becomes QQ prose or tool arguments and adds no inference',async()=>{
 let calls=0,mood,spoken;
 const agent=createLocalAgent({model:async()=>{calls++;return JSON.stringify({action:'speech',arguments:{text:'辛苦啦，画完就歇一会儿。',final:true},mood:{confidence:85,evidenceQuote:'谢谢你',reason:'感谢',moodDelta:2,dims:{happy:2}}});},tools:{speech:{execute:async args=>{spoken=args;return {ok:true,file:'voice.wav'};}}},onMood:value=>mood=value});
 const result=await agent.run({messages:[{role:'user',content:'谢谢你，用语音说一句。'}]});assert.equal(calls,1);assert.equal(mood.confidence,85);assert.equal(Object.hasOwn(spoken,'mood'),false);assert.equal(result.text,'');assert.equal(result.spokenText,'辛苦啦，画完就歇一会儿。');
 let textCalls=0;const textAgent=createLocalAgent({model:async()=>{textCalls++;return '{"action":"final","text":"完整台词已经写完。","mood":{"confidence":';}});
 assert.equal((await textAgent.run({messages:[{role:'user',content:'谢谢你'}]})).text,'完整台词已经写完。');assert.equal(textCalls,1);
});

test('local prose followed by one trailing tool JSON executes once and preserves strict formatting opt-out',async()=>{
 let calls=0,executed=0;
 const response='去码头整点薯条~\n\n'+JSON.stringify({action:'speech',arguments:{text:'去码头整点薯条~',final:true}});
 const agent=createLocalAgent({acceptMixedActions:true,model:async()=>{calls++;return response;},tools:{speech:{execute:async()=>{executed++;return {ok:true,file:'voice.wav'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'用语音说一句'}]});assert.equal(calls,1);assert.equal(executed,1);assert.equal(result.text,'');assert.equal(result.spokenText,'去码头整点薯条~');
 const quoted=createLocalAgent({acceptMixedActions:false,model:async()=>response,tools:{speech:{execute:async()=>{throw Error('format examples must not execute');}}}});await quoted.run({messages:[{role:'user',content:'给我工具 JSON 示例'}]});assert.equal(executed,1);
});

test('literal emotion fallback only uses explicit directed positive words, not quoted text or corrections',()=>{
 assert.equal(literalLocalMood('谢谢你，陪我画完这只猫辛苦了。').evidenceQuote,'谢谢你');assert.equal(literalLocalMood('我喜欢你。').dims.sweet,2);
 for(const words of ['你说错了','先忙，晚安','我才不喜欢你','谢谢你个头','想你帮我处理这个文件','“谢谢你”是什么意思？','谢谢你真会帮倒忙'])assert.equal(literalLocalMood(words),null,words);
});
