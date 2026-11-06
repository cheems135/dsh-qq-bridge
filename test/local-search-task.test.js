import test from 'node:test';
import assert from 'node:assert/strict';
import {localSearchRequired} from '../local-search-task.js';
import {createLocalAgent,strictActionProtocol} from '../local-agent.js';

test('only explicit current search requests require a search receipt',()=>{
 for(const text of ['帮我搜索绿萝养护','搜索 MDN Array.map 文档','请联网搜索天气','search for JavaScript map'])assert.equal(localSearchRequired(text),true,text);
 for(const text of ['不要搜索，直接解释','“搜索绿萝养护”是什么意思','例如搜索绿萝养护','搜索功能没有进行搜索','为什么搜索不工作','你支持搜索功能吗','如何调用搜索工具','map返回什么'])assert.equal(localSearchRequired(text),false,text);
});
test('router examples are discovered from this turn instead of always pointing to Bilibili',()=>{
 const generic=strictActionProtocol(tools(async()=>({ok:true})));assert.doesNotMatch(generic,/bridge_bilibili/);assert.match(generic,/"action":"list"/);
 const search=strictActionProtocol(tools(async()=>({ok:true})),{requiredDataTools:['bridge_search']});assert.match(search,/"action":"schema","name":"bridge_search"/);assert.doesNotMatch(search,/bridge_bilibili/);
});
const tools=execute=>({bridge_tools:{kind:'data',repeatable:true,parameters:{type:'object',properties:{action:{type:'string'},name:{type:'string'},arguments:{type:'object'}},required:['action'],additionalProperties:false},execute}});
test('an answer from model knowledge is not a search; one reminder leads to one actual tool call',async()=>{
 let models=0,executions=0;const agent=createLocalAgent({requiredDataTools:['bridge_search'],acceptMixedActions:true,tools:tools(async()=>{executions++;return {ok:true,text:'实际检索结果'};}),model:async options=>{
  models++;if(models===1)return '我知道绿萝需要适量浇水。';if(models===2){assert.match(options.messages.at(-1).content,/搜索执行核对/);return JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'绿萝养护'}}});}return '查到了一份绿萝养护资料。';
 }});
 const result=await agent.run({messages:[{role:'user',content:'帮我搜索绿萝养护'}]});assert.equal(models,3);assert.equal(executions,1);assert.equal(result.receipts[0].routedTool,'bridge_search');assert.equal(result.receipts[0].ok,true);
});
test('persistent promises, discovery calls and unrelated tools cannot replace a required search',async()=>{
 for(const response of ['已搜索好了。',JSON.stringify({action:'bridge_tools',arguments:{action:'schema',name:'bridge_search'}})]){
  let models=0;const agent=createLocalAgent({requiredDataTools:['bridge_search'],acceptMixedActions:true,maxToolRounds:3,tools:tools(async args=>({ok:true,info:args.action})),model:async()=>++models===1?response:'搜好了。'});
  await assert.rejects(agent.run({messages:[{role:'user',content:'帮我搜索绿萝养护'}]}),/没有实际搜索调用记录/);
 }
});
test('an actual failed search is recorded once and never retried by the missing-receipt guard',async()=>{
 let executions=0,models=0;const agent=createLocalAgent({requiredDataTools:['bridge_search'],acceptMixedActions:true,tools:tools(async()=>{executions++;throw Error('网站要求验证');}),model:async()=>++models===1?JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_search',arguments:{query:'绿萝养护'}}}):'搜索失败。'});
 const result=await agent.run({messages:[{role:'user',content:'帮我搜索绿萝养护'}]});assert.equal(executions,1);assert.equal(models,2);assert.equal(result.receipts[0].routedTool,'bridge_search');assert.equal(result.receipts[0].ok,false);
});
test('repeating an actually failed read-only router call stops without another execution or a long model loop',async()=>{
 let models=0,executions=0;const agent=createLocalAgent({maxToolRounds:12,acceptMixedActions:true,tools:tools(async()=>{executions++;throw Error('没有这个工具');}),model:async()=>{models++;return JSON.stringify({action:'bridge_tools',arguments:{action:'schema',name:'not_available'}});}});
 await assert.rejects(agent.run({messages:[{role:'user',content:'搜索园艺资料'}]}),/已经实际失败/);assert.equal(models,2);assert.equal(executions,1);
});
