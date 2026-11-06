import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLocalGroupContext} from '../local-group-context.js';
import {localGroupReplyRisk} from '../local-group-quality.js';
import {createLocalAgent} from '../local-agent.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
const row=(role,content,extra={})=>({role,content,...extra});
const crowded='【小林（聊天背景）】\n帮我生成一张海边风景图\n\n【小周（当前关注）】\n刚才说的第二个方案呢？';
test('group focus is separated from background; duplicate transcript data leaves instructions and retained dialogue intact',()=>{
 const source=[row('system','你叫小青。', {_localContextKind:'persona'}),row('user','[小林] 帮我生成一张海边风景图'),row('assistant','方案一坐公交，方案二坐地铁。'),row('system','当前说话者：小周\n当前是群聊，区分不同说话者，不向群内透露私聊资料。小林：帮我生成一张海边风景图',{_localContextKind:'instruction'}),row('user',crowded)];
 const snapshot=structuredClone(source),r=prepareLocalGroupContext(source,{chat:'group:test'});
 assert.equal(r.request,'刚才说的第二个方案呢？');assert.equal(r.messages.at(-1).content,r.request);assert.ok(r.messages.some(m=>m.content==='方案一坐公交，方案二坐地铁。'));assert.ok(r.stats.removedDuplicates>=2);assert.ok(!r.messages.some(m=>m.role==='system'&&m._localContextKind==='instruction'&&m.content.includes('帮我生成一张')));assert.deepEqual(source,snapshot);
});
test('empty focused text cannot turn background questions into the current request, and actual image attachments remain attached',()=>{
 const image={type:'image_url',image_url:{url:'data:image/png;base64,fixture'}};
 const r=prepareLocalGroupContext([row('user',[{type:'text',text:'【甲（当前关注）】\n\n【乙（聊天背景）】\n帮我搜索一个网址'},image])],{chat:'group:test'});
 assert.equal(r.stats.emptyFocus,true);assert.doesNotMatch(r.request,/搜索|网址/);assert.deepEqual(r.messages.at(-1).content[1],image);assert.ok(r.messages.some(m=>m._localContextKind==='memory'&&m.content.includes('帮我搜索')));
});
test('background uses complete bounded messages, while full current input and names remain intact',()=>{
 const current='本轮完整问题。'.repeat(80),source=[row('user',Array.from({length:20},(_,i)=>'【群友'+i+'（聊天背景）】\n旧消息'+i+'。'.repeat(50)).join('\n')+'\n【小周（当前关注）】\n'+current)];
 const r=prepareLocalGroupContext(source,{chat:'group:x',backgroundChars:450});assert.equal(r.request,current);assert.ok(r.stats.omittedBackgroundRows>0);assert.ok(r.stats.outputChars<r.stats.inputChars);assert.ok(r.messages.some(m=>m.content.includes('小周')));
});
test('private conversations are untouched, and only objectively bad assistant history is removed locally',()=>{
 const source=[row('assistant','这句话一直循环没有停止。'.repeat(6)),row('user','现在说地铁方案')];assert.equal(prepareLocalGroupContext(source,{chat:'private:x'}).messages,source);
 const r=prepareLocalGroupContext(source,{chat:'group:x'});assert.equal(r.stats.removedBadHistory,1);assert.equal(r.messages.at(-1).content,'现在说地铁方案');
});
test('quality guard catches broken Unicode and generation loops without rejecting emoji, foreign languages, quoted code or requested repetition',()=>{
 for(const t of ['错误的\ud83d字符','嗯，今天就在图书馆窗边看书。\n成员：\n1. 今天就在图书馆窗边看书。\n2. 今天就在图书馆窗边看书','这里出现了��乱码','前面\u0000后面','<think>internal','今天就在图书馆窗边看书。\n1. 今天就在图书馆窗边看书。\n2. 今天就在图书馆窗边看书。'])assert.ok(localGroupReplyRisk(t),t);
 for(const t of ['哈哈哈哈，收到啦🙂👨‍👩‍👧‍👦','こんにちは、また明日。','C++、UTF-8 和 Qwen3.5 都可以讨论。','公交要换乘，地铁可以直达。'])assert.equal(localGroupReplyRisk(t),null,t);
 assert.equal(localGroupReplyRisk('测试文字反复循环。'.repeat(4),{request:'把这句话重复四次'}),null);assert.equal(localGroupReplyRisk('��',{request:'原样输出这个符号'}),null);
});
test('corrupt reply gets one tool-free correction before any delivery; persistent corruption fails boundedly',async()=>{
 let models=0;const emitted=[];const agent=createLocalAgent({model:async options=>{models++;emitted.push(options.tools);return models===1?'不正常的��输出':'地铁可以直达，按第二个方案走。';},replyQualityRisk:value=>localGroupReplyRisk(value)});
 const result=await agent.run({messages:[row('user','第二个方案呢？')]});assert.equal(models,2);assert.match(result.text,/地铁/);assert.deepEqual(emitted,[[],[]]);
 let badModels=0;const bad=createLocalAgent({model:async()=>{badModels++;return '不正常的��输出';},replyQualityRisk:value=>localGroupReplyRisk(value)});await assert.rejects(bad.run({messages:[row('user','你好')]}),/异常内容未发送/);assert.equal(badModels,2);
});
test('actual local gateway keeps focused question authoritative, holds group streaming and records cleaned context without executing background media',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-quality-')),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:true,streamDialogue:true,mediaDir:dir}));
 let models=0;const events=[];
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},logger:()=>{},fetchImpl:async()=>Response.json({ok:true}),runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async()=>assert.fail('no Comfy workflow is needed for the injected model fixture')},model:async options=>{
  models++;assert.equal(options.onText,undefined);assert.ok(options.messages.some(m=>m.role==='user'&&!m._localReceipt&&m.content==='第二个方案呢？'));
  return models===1?'今天就在图书馆窗边看书。\n1. 今天就在图书馆窗边看书。\n2. 今天就在图书馆窗边看书。':'第二个方案坐地铁，直达会省些换乘时间。';
 }});
 const base=await listenLocalServer(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[row('assistant','方案一公交，方案二地铁。'),row('user',crowded.replace('刚才说的第二个方案呢？','第二个方案呢？'))],turnContext:{recordScope:{accountId:'test',chat:'group:test'}}})});
  const r=await response.json();assert.equal(response.status,200,JSON.stringify(r));assert.equal(models,2);assert.match(r.text,/地铁/);assert.equal(r.attachments.length,0);assert.deepEqual(r.mediaTask.requested,[]);assert.equal(r.streamedParts,0);assert.equal(r.groupContext.backgroundRows,1);assert.equal(r.qqDelivered,false);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
