import test from 'node:test';
import assert from 'node:assert/strict';
import {fitLocalContext,isContextLimitError,readComfyContext,optimizeLocalContext,compactLocalProtocol,contextLimitFeedback,estimateTokens} from '../local-context.js';
import {buildPromptContext} from '../local-config.js';
import {strictActionProtocol} from '../local-agent.js';
test('context pressure drops complete old turns while preserving persona and current request',()=>{
 const source={system:'完整人设',user:'当前问题',history:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'旧'.repeat(500)}))};
 const result=fitLocalContext(source,{window:2048,maxTokens:512});assert.equal(result.system,source.system);assert.equal(result.user,source.user);assert.ok(result.context.droppedMessages>0);assert.ok(!result.history.length||result.history[0].role==='user');assert.equal(source.history.length,8);
 const reset=fitLocalContext(source,{window:2048,reset:true});assert.deepEqual(reset.history,[]);assert.equal(reset.context.reset,true);
});
test('quality mode reserves actual recent choices and keeps them through a bounded context recovery',()=>{
 const persona=('你叫青岚，喜欢安静，表达自然。不要编造共同经历。').repeat(130),history=[{role:'user',content:'周末两个地方，商场还是青禾公园？'},{role:'assistant',content:'第一是星河商场，第二是青禾公园。你想安静我选第二个。'},{role:'user',content:'那就第二个，我怕到时候下雨。'},{role:'assistant',content:'去青禾公园，带把折叠伞就好。'}];
 const source={system:persona,systemSections:[{kind:'persona',text:persona}],user:'你还记得我们去哪吗？',history};
 for(const reset of [false,true]){const result=optimizeLocalContext(source,{window:4096,maxTokens:512,continuity:true,reset});assert.equal(result.history.length,4);assert.match(result.history[1].content,/第二.*青禾公园/);assert.equal(result.user,source.user);assert.ok(result.context.inputEstimate<=result.context.inputBudget);assert.equal(result.context.retainedMessages,4);assert.equal(source.system,persona);}
});

test('fixed prompt pressure reduces recalled memory and protocol before the actual persona',()=>{
 const persona='你叫小青，性格温柔；称呼对方为朋友，不编造旧事。';
 const protocol=strictActionProtocol({speech:{execute:()=>{}},bridge_tools:{kind:'data',description:'用通用工具查询和执行。'.repeat(50),parameters:{type:'object',properties:{action:{type:'string'}},required:['action']},execute:()=>{}}});
 const source=buildPromptContext([{role:'system',content:persona},{role:'system',content:'【本地对话可参考的已有记忆及来源】\n'+Array.from({length:90},(_,i)=>'来源 '+i+'：朋友讨论了不同的绘画构图与色彩练习。').join('\n')},{role:'user',content:'我刚画完猫，请看看构图。'}],{withSections:true});
 const fitted=optimizeLocalContext(source,{protocol,window:4096});
 assert.match(fitted.system,new RegExp(persona));assert.equal(fitted.user,source.user);assert.equal(fitted.context.personaCompacted,false);assert.equal(fitted.context.promptCompacted,true);assert.ok(fitted.context.inputEstimate<fitted.context.inputBudget);assert.ok(fitted.protocol.length<protocol.length);assert.ok(source.system.length>fitted.system.length);assert.match(fitted.protocol,/schema/);
});

test('oversized fixed persona uses marked existing key sentences without rewriting the saved source',()=>{
 const persona='你叫小青。性格温柔但有主见。'+Array.from({length:160},(_,i)=>'背景 '+i+'：今天穿过庭院望着天空，回想从前的生活。').join('\n')+'禁止假装已经发送未发送的消息。';
 const source=buildPromptContext([{role:'system',content:persona,_localContextKind:'persona'},{role:'user',content:'刚画完猫，接着聊聊构图。'}],{withSections:true});
 const fitted=optimizeLocalContext(source,{window:4096});
 assert.equal(fitted.context.personaCompacted,true);assert.match(fitted.system,/你叫小青/);assert.match(fitted.system,/性格温柔但有主见/);assert.match(fitted.system,/禁止假装/);assert.match(fitted.system,/本轮资料已按容量摘取/);assert.equal(fitted.user,source.user);assert.equal(source.system,persona);assert.ok(fitted.context.inputEstimate<fitted.context.inputBudget);
 const retry=optimizeLocalContext(source,{window:4096,aggressive:true,reset:true});assert.ok(retry.system.length<fitted.system.length);
});

test('deduplication and tool receipts never truncate the current user request',()=>{
 const source=buildPromptContext([{role:'system',content:'你叫小青。'},{role:'system',content:'你叫小青。'},{role:'user',content:'请原样保留：```js\nconst value = "不可截断";\n```'},{role:'user',_localReceipt:true,content:'SUCCESS_OLD_RECEIPT。'.repeat(700)+'工具已经完成。'}],{withSections:true});
 const fitted=optimizeLocalContext(source,{window:2048,aggressive:true});
 assert.ok(fitted.user.startsWith(source.originalUser));assert.equal(fitted.system.split('你叫小青').length-1,1);assert.ok(fitted.context.compactedSections.includes('receipts'));assert.match(fitted.user,/不得重复执行/);
 const huge=buildPromptContext([{role:'system',content:'角色。'},{role:'user',content:'不要截断'.repeat(2000)}],{withSections:true});const blocked=optimizeLocalContext(huge,{window:2048});assert.equal(blocked.context.requiredTooLarge,true);assert.ok(blocked.user===huge.user);
});

test('compact protocols retain custom schemas and selectable workflows and leave repair instructions intact',()=>{
 const protocol=strictActionProtocol({image:{execute:()=>{},workflows:[{id:'draw-cat',name:'画猫工作流'}]},bridge_custom:{kind:'data',description:'自定义工具',parameters:{type:'object',properties:{requiredSpecial:{type:'string'}},required:['requiredSpecial']},execute:()=>{}}});
 const compact=compactLocalProtocol(protocol);assert.match(compact,/requiredSpecial/);assert.match(compact,/draw-cat/);assert.match(compact,/workflowId/);assert.doesNotMatch(compact,/bridge_tools 参数/);
 assert.equal(compactLocalProtocol('只输出修正后的正文，不能调用工具。'),'只输出修正后的正文，不能调用工具。');
 assert.deepEqual(contextLimitFeedback('当前系统提示词、Skill reference 和用户消息约需 3555 tokens，超过可用输入上下文 3456。'),{required:3555,budget:3456});
 assert.ok(estimateTokens('中文 English')>0);
});
test('oversized mandatory input is reported without silently cutting it',()=>{
 const source={system:'人设'.repeat(4000),user:'当前完整消息',history:[]},result=fitLocalContext(source,{window:4096});assert.equal(result.context.requiredTooLarge,true);assert.equal(result.system,source.system);assert.equal(result.user,source.user);
});
test('only context errors qualify for recovery and node metadata never exposes history',()=>{
 assert.ok(isContextLimitError(Error('超过可用输入上下文 3456')));assert.ok(isContextLimitError(Error('maximum context length exceeded')));assert.equal(isContextLimitError(Error('fetch failed')),false);assert.equal(isContextLimitError(Error('CUDA out of memory')),false);
 assert.equal(isContextLimitError(Error('CUDA out of memory while allocating n_ctx=4096')),false);assert.equal(isContextLimitError(Error('failed to initialize n_ctx=4096')),false);
 const entry={outputs:{'1':{'上下文状态JSON':[JSON.stringify({used_tokens:3000,context_limit:4096,history:'PRIVATE_HISTORY'})]}}};
 const value=readComfyContext(entry,'1');assert.equal(value.used_tokens,3000);assert.doesNotMatch(JSON.stringify(value),/PRIVATE_HISTORY/);
});
