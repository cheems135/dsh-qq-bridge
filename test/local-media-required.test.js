import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent} from '../local-agent.js';
import {localImageRequest} from '../media-intent.js';

test('current explicit image requests require execution; examples, negation and troubleshooting do not',()=>{
 for(const text of ['生成一张海边小猫的图片','帮我画一只猫','请生成图片："一只白猫"'])assert.equal(localImageRequest(text),true,text);
 for(const text of ['“生成一张图”这句话是什么意思','不要画猫','例如生成一张小猫的图片','生成图片的提示词怎么写','生图功能有问题，为什么没有调用工作流','你支持生成图片吗','刚才生成的图片里有什么','用 JSON 写一个图片工具调用示例'])assert.equal(localImageRequest(text),false,text);
});

test('a promise triggers one real image execution and no second model inference',async()=>{
 let models=0,executions=0,prompt;
 const agent=createLocalAgent({model:async()=>{models++;return '好呀，我这就画给你。';},requiredMedia:[{kind:'image',prompt:'生成一张海边小猫的图片'}],tools:{image:{execute:async args=>{executions++;prompt=args.prompt;return {file:'real.png',kind:'image'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'生成一张海边小猫的图片'}]});
 assert.equal(models,1);assert.equal(executions,1);assert.equal(prompt,'生成一张海边小猫的图片');assert.equal(result.text,'');assert.equal(result.attachments[0].file,'real.png');assert.equal(result.receipts[0].ok,true);
});

test('model prompt wins, failed image execution is never retried automatically or described as successful',async()=>{
 let calls=0,executions=0;
 const agent=createLocalAgent({requiredMedia:[{kind:'image',prompt:'画猫'}],model:async()=>++calls===1?'去画啦！\n{"action":"image","arguments":{"prompt":"a cat at sunset","workflowId":"chosen"}}':'画好了。',acceptMixedActions:true,tools:{image:{execute:async args=>{executions++;assert.equal(args.workflowId,'chosen');assert.equal(args.prompt,'a cat at sunset');throw Error('工作流缺少必需节点');}}}});
 const result=await agent.run({messages:[{role:'user',content:'画猫'}]});assert.equal(executions,1);assert.equal(result.attachments.length,0);assert.match(result.text,/本地配置/);assert.match(result.receipts[0].error,/工作流缺少必需节点/);assert.doesNotMatch(result.text,/画好了/);
});

test('required image completes before terminal voice; missing workflow returns an honest error',async()=>{
 const order=[];
 const agent=createLocalAgent({requiredMedia:[{kind:'image',prompt:'画猫'}],model:async()=>'{"action":"speech","arguments":{"text":"给你。","final":true}}',tools:{image:{execute:async()=>{order.push('image');return {file:'real.png',kind:'image'};}},speech:{execute:async()=>{order.push('speech');return {file:'real.wav',kind:'speech'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'画猫并语音介绍'}]});assert.deepEqual(order,['image','speech']);assert.equal(result.attachments.length,2);
 const missing=createLocalAgent({requiredMedia:[{kind:'image',prompt:'画猫'}],model:async()=> '已经生成图片啦。'});
 const failure=await missing.run({messages:[{role:'user',content:'画猫'}]});assert.match(failure.text,/本地配置/);assert.match(failure.receipts[0].error,/未暴露该工具/);assert.equal(failure.attachments.length,0);
});

test('rejected invented parameters can fall back to a valid request, while actual failed jobs remain single attempts',async()=>{
 let executed=0,models=0;
 const agent=createLocalAgent({requiredMedia:[{kind:'image',prompt:'生成一张小猫图片'}],model:async()=>++models===1?'{"action":"image","arguments":{"prompt":"cat","width":512}}':'已经画好了',tools:{image:{execute:async args=>{executed++;assert.deepEqual(args,{prompt:'生成一张小猫图片'});return {file:'real.png',kind:'image'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'生成一张小猫图片'}]});assert.equal(executed,1);assert.equal(result.text,'');assert.equal(result.attachments.length,1);assert.equal(result.receipts[0].rejected,true);
});

test('simple image receipt returns immediately without reloading the chat model',async()=>{
 let calls=0;const agent=createLocalAgent({requiredMedia:[{kind:'image',prompt:'画猫'}],terminalMedia:['image'],model:async()=>{calls++;return '{"action":"image","arguments":{"prompt":"cat"}}';},tools:{image:{execute:async()=>({kind:'image',file:'cat.png'})}}});
 const result=await agent.run({messages:[{role:'user',content:'画猫'}]});assert.equal(calls,1);assert.equal(result.text,'');assert.equal(result.attachments.length,1);
});

test('native speech-first batch uses the declared image prompt exactly once before speaking',async()=>{
 const order=[];let calls=0;
 const agent=createLocalAgent({requiredMedia:[{kind:'image',prompt:'user prompt'}],model:async()=>++calls===1?{tool_calls:[{id:'s',function:{name:'speech',arguments:{text:'给你。',final:true}}},{id:'i',function:{name:'image',arguments:{prompt:'model prompt'}}}]}:'完成',tools:{image:{execute:async args=>{assert.equal(args.prompt,'model prompt');order.push('image');return {file:'cat.png',kind:'image'};}},speech:{execute:async()=>{order.push('speech');return {file:'cat.wav',kind:'speech'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'生成图片，并用语音介绍'}]});assert.deepEqual(order,['image','speech']);assert.equal(result.attachments.length,2);assert.equal(calls,1);
});

