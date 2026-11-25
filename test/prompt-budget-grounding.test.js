import test from 'node:test';
import assert from 'node:assert/strict';
import {createPromptBudget,BUDGET_MARKER} from '../prompt-budget.js';
import {conversationExecutionGrounding} from '../initiative-grounding.js';

test('old turns drop signed policies while keeping their unique facts, user messages and tools',()=>{
 const budget=createPromptBudget();
 const messages=[];
 for(let i=0;i<5;i++){
  const scope={accountId:'a',personaId:'p',key:'private:1'};
  const executionFacts={type:'text',text:conversationExecutionGrounding({scope,rows:[{...scope,chat:scope.key,at:Date.now(),tool:'bridge_browser',status:'returned',result:{title:'第'+i+'页'}}],operating:{platform:'电脑',chat:'private',deviceTools:true}})};
  const words={type:'text',text:'用户原话'+i};
  const content=[executionFacts,words];
  budget.pack(content,{executionFacts,protectedParts:new Set(content)});
  messages.push({role:'user',content},{role:'assistant',content:'回复'+i},{role:'tool',content:'回执'+i});
 }
 const original=JSON.stringify(messages);
 const result=budget.request({system:BUDGET_MARKER,messages});
 assert.equal(result.blocks,3);assert.equal(JSON.stringify(messages),original);
 for(let i=0;i<5;i++){
  const turn=JSON.stringify(result.messages[3*i]);
  assert.equal(turn.includes('【谁来操作】'),i>=3);
  assert.ok(turn.includes('第'+i+'页'));assert.ok(turn.includes('用户原话'+i));
  assert.deepEqual(result.messages[3*i+2],messages[3*i+2]);
 }
 assert.equal(budget.request({system:'unrelated',messages}).changed,false);
});

test('old ordinary and schedule-only turns lose outdated policy but keep their original facts',()=>{
 const budget=createPromptBudget(), messages=[];
 for(const [index,label] of ['写短一点','我想听听后续','再改一句','好多了'].entries()){
  const jobs=index===1?[{scene:{activity:'读到镇上钟楼的来历'},at:1,updatedAt:Date.now()-100,status:'completed',actuallyCompleted:true,evidence:[]}]:[];
  const executionFacts={type:'text',text:conversationExecutionGrounding({jobs})};
  const words={type:'text',text:label},content=[executionFacts,words];
  budget.pack(content,{executionFacts,protectedParts:new Set(content)});
  messages.push({role:'user',content});
 }
 const {messages:trimmed}=budget.request({system:BUDGET_MARKER,messages});
 assert.doesNotMatch(JSON.stringify(trimmed.slice(0,2)),/经历与执行状态/);
 assert.match(JSON.stringify(trimmed[0]),/写短一点/);
 assert.match(JSON.stringify(trimmed[1]),/镇上钟楼的来历/);
});
