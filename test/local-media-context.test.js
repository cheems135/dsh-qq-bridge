import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveLocalMediaTask,unverifiedMediaProgress} from '../local-media-task.js';
import {localRequirements} from '../local-routing.js';
import {fastDialoguePlan,createDialogueStream} from '../local-fast-chat.js';
import {createLocalAgent} from '../local-agent.js';

test('repeat media follows the nearest real human request and preserves the original wording',()=>{
 for(const [original,kind]of [['生成一张窗边绿植的图片','image'],['发句语音提醒我浇水','speech'],['生成一段绿植的视频','video']]){
  const history=[{role:'user',content:original},{role:'assistant',content:'稍等一下。'},{role:'user',content:'再发一遍嘛'}];
  const result=resolveLocalMediaTask('再发一遍嘛',{history});assert.equal(result[kind],true);assert.equal(result.source,'followup');assert.match(result.effectiveRequest,/再发一遍嘛/);assert.ok(result.effectiveRequest.startsWith(original));assert.equal(history.at(-1).content,'再发一遍嘛');
  assert.equal(localRequirements('再发一遍嘛',{history})[kind],true);assert.equal(fastDialoguePlan('再发一遍嘛',{messages:history}).fast,false);
 }
});
test('assistant promises, old topics, examples and cancelled user requests cannot authorize repeated generation',()=>{
 for(const history of [[{role:'assistant',content:'图片正在渲染，已经给你看过了。'}],[{role:'user',content:'生成一张绿植图片'},{role:'user',content:'今天吃什么'}],[{role:'user',content:'别发语音了'}],[{role:'system',content:'生成一张图片'}]]){
  const result=resolveLocalMediaTask('再发一遍嘛',{history});assert.equal(result.ambiguous,true);assert.deepEqual([result.image,result.speech,result.video],[false,false,false]);
 }
 assert.equal(resolveLocalMediaTask('好',{history:[{role:'user',content:'生成一张图片'}]}).image,false);
 assert.equal(resolveLocalMediaTask('不要再发一遍',{history:[{role:'user',content:'生成一张图片'}]}).image,false);
});
test('media progress requires an actual tool call and unverified claims cannot stream into QQ first',()=>{
 for(const [text,kind]of [['刚才那张图还在渲染呢，你催我也没用。','image'],['这段语音正在合成。','speech'],['视频正在生成。','video']]){
  assert.equal(unverifiedMediaProgress(text),kind);assert.equal(unverifiedMediaProgress(text,[{tool:kind,ok:true}]),'');
  const stream=createDialogueStream({emit:()=>assert.fail('unverified progress escaped')});stream.feed(text);assert.equal(stream.parts.length,0);
 }
 for(const text of ['如果图片还在渲染，就等一会儿。','“图片正在渲染”是什么意思？','目前并没有图片正在生成。','今天阳光不错。'])assert.equal(unverifiedMediaProgress(text),'',text);
});
test('agent repairs an invented render status once, can then execute, and rejects persistent false progress',async()=>{
 let models=0,executed=0;const agent=createLocalAgent({needsExecutionRepair:unverifiedMediaProgress,model:async()=>++models===1?'这张图片还在渲染呢。':'{"action":"image","arguments":{"prompt":"窗边绿植"}}',terminalMedia:['image'],tools:{image:{execute:async()=>{executed++;return {file:'plant.png',kind:'image'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'发张窗边绿植的照片'}]});assert.equal(executed,1);assert.equal(models,2);assert.equal(result.text,'');assert.equal(result.attachments.length,1);
 const failed=createLocalAgent({needsExecutionRepair:unverifiedMediaProgress,model:async()=>'图片还在渲染呢。'});await assert.rejects(()=>failed.run({messages:[{role:'user',content:'再发一遍嘛'}]}),/没有实际工具任务/);
});
