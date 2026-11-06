import test from 'node:test';
import assert from 'node:assert/strict';
import {fastDialoguePlan,createDialogueStream,removeStreamedPrefix} from '../local-fast-chat.js';
import {localIssueReply} from '../local-issue-reply.js';
import {createWaitNotice,cleanWaitNotice,personaWaitStyle} from '../local-wait-notice.js';

test('only ordinary conversation is accelerated; tool followups, creative and detailed requests retain full path',()=>{
 for(const request of ['今天有点累，陪我聊两句。','谢谢你，我已经好很多了。','你好呀'])assert.equal(fastDialoguePlan(request).fast,true,request);
 for(const request of ['请读取构图信息','生成一张你的自拍','打开B站','详细解释原因','画一只猫','用语音说晚安','现在天气怎么样','写一段JSON代码','分析一下这个问题'])assert.equal(fastDialoguePlan(request).fast,false,request);
 assert.equal(fastDialoguePlan('继续',{messages:[{role:'user',content:'帮我搜索资料'}]}).fast,false);
 assert.equal(fastDialoguePlan('你好',{hasImages:true}).fast,false);assert.equal(fastDialoguePlan('你好',{pending:true}).fast,false);
 assert.equal(fastDialoguePlan('你好',{maxTokens:128}).outputTokens,128);
});
test('quality mode allows a complete reply and streams intentional paragraphs instead of every sentence',()=>{
 assert.equal(fastDialoguePlan('这件事你怎么看',{priority:'quality',maxTokens:512}).outputTokens,512);
 const emitted=[],stream=createDialogueStream({paragraphs:true,request:'这件事你怎么看',emit:text=>emitted.push(text)});stream.feed('先把这个想法说完整。再补充具体原因。');assert.equal(emitted.length,0);stream.feed('\n换个角度也可以继续聊。');assert.equal(emitted.length,1);assert.match(emitted[0],/说完整.*原因/);assert.equal(stream.finish(emitted[0]).tail,'');
});

test('text stream emits complete new sentences before final output and removes their prefix exactly once',()=>{
 const sent=[],stream=createDialogueStream({request:'今天有点累',emit:(text,index)=>sent.push({text,index})});
 stream.feed('那就先把今天的事放一放。');assert.equal(sent.length,1);
 stream.feed('坐下来休息一下吧。');assert.equal(sent.length,2);
 const result=stream.finish('那就先把今天的事放一放。\n坐下来休息一下吧。\n我陪你聊聊。');assert.equal(result.consistent,true);assert.equal(result.tail,'我陪你聊聊。');assert.deepEqual(sent.map(v=>v.index),[0,1]);
 assert.equal(removeStreamedPrefix('完全不同的内容',sent.map(v=>v.text)).consistent,false);
});

test('a model repeating its current sentence cannot publish the same sentence twice',()=>{
 const sent=[],s=createDialogueStream({emit:text=>sent.push(text)});s.feed('先把今天的事放一放，好好歇会儿。');s.feed('先把今天的事放一放，好好歇会儿。');assert.equal(sent.length,1);assert.equal(s.finish('先把今天的事放一放，好好歇会儿。').consistent,true);
});

test('stream hides thought, tool JSON and optional mood metadata, and suppresses repeated openings',()=>{
 const sent=[],stream=createDialogueStream({emit:text=>sent.push(text)});
 stream.feed('<think>不能发出的内部文本');assert.equal(sent.length,0);
 stream.feed('</think>{"action":"final","text":"今天已经辛苦了，先好好歇会儿。');assert.equal(sent.length,1);
 stream.feed('","mood":{"reason":"PRIVATE"}}');assert.equal(sent.length,1);assert.doesNotMatch(sent.join(''),/think|PRIVATE|action/);
 for(const raw of ['{"action":"image","arguments":{"prompt":"PRIVATE。"}}','```json\n{"action":"speech"}\n```']){const s=createDialogueStream({emit:()=>assert.fail('internal text leaked')});s.feed(raw);}
 const old='今天已经辛苦了，先好好歇会儿。';const repeat=createDialogueStream({messages:[{role:'user',content:'昨天很累'},{role:'assistant',content:old},{role:'user',content:'今天呢'}],request:'今天呢',emit:()=>assert.fail('old opening leaked')});repeat.feed(old);
});

test('slow-media notice is delayed, uses model persona wording once and is cancelled on completion',()=>{
 let callback,cancelled=0;const sent=[];
 const n=createWaitNotice({style:'playful',emit:e=>sent.push(e),setTimer:fn=>(callback=fn,1),clearTimer:()=>cancelled++});
 n.set('哼，先等本大人一小会儿。');n.start('image');assert.equal(sent.length,0);callback();n.start('speech');assert.equal(sent.length,1);assert.equal(sent[0].text,'哼，先等本大人一小会儿。');
 const quick=createWaitNotice({emit:e=>sent.push(e),setTimer:fn=>(callback=fn,1),clearTimer:()=>cancelled++});quick.start('speech');quick.stop();assert.equal(cancelled,1);
 for(const text of ['已经生成好了','3秒就好','{"action":"image"}','C:/secret.png'])assert.equal(cleanWaitNotice(text),'');
 assert.equal(personaWaitStyle('性格傲娇'),'playful');assert.equal(personaWaitStyle('严谨正式'),'formal');
});

test('friendly error copy retains the cause category without exposing raw stack, paths or retry promises',()=>{
 for(const [error,pattern]of [[Object.assign(Error('connect'),{code:'ECONNREFUSED'}),/启动/],[Error('ComfyUI out of memory'),/显存/],[Error('context length exceeded'),/分几条/],[Error('503 busy queue'),/任务/],[Error('LOCAL_DEADLINE 超时'),/等得有点久/]])assert.match(localIssueReply(error),pattern);
 assert.doesNotMatch(localIssueReply(Error('TypeError C:/private/settings.json sk-secret')),/TypeError|private|sk-secret/);
});
