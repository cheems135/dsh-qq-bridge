import test from 'node:test';
import assert from 'node:assert/strict';
import {DIALOGUE_ONLY_RULE,requestedActionNarration,stripUnrequestedActions} from '../dialogue-only.js';
import {cleanLocalReply,localDialogueInstruction} from '../local-reply.js';

test('default dialogue removes inline and trailing gestures without removing spoken words',()=>{
 assert.equal(stripUnrequestedActions('被你发现啦～（不好意思地吐了吐舌头，把手机藏进被子）'),'被你发现啦～');
 assert.equal(stripUnrequestedActions('（低下头）我知道啦。*轻轻点头*\n那明天见（微笑）'),'我知道啦。\n那明天见');
 assert.equal(stripUnrequestedActions('好呀（转身（悄悄地）把书放下）！'),'好呀！');
});

test('screen gestures are narration, without altering ordinary quoted content or image parameters',()=>{
 const gesture='（手停在屏幕上，贴了一会儿）';
 assert.equal(stripUnrequestedActions('我还在呢。\n'+gesture),'我还在呢。');
 assert.equal(stripUnrequestedActions('好呀（指尖落在窗边）'),'好呀');
 assert.equal(stripUnrequestedActions('现在手停在屏幕上不方便操作。'),'现在手停在屏幕上不方便操作。');
 assert.equal(stripUnrequestedActions('（备注：手停在屏幕上是图片描述）'),'（备注：手停在屏幕上是图片描述）');
 assert.equal(stripUnrequestedActions('[图:指尖落在窗边]'),'[图:指尖落在窗边]');
 assert.equal(stripUnrequestedActions(gesture,{request:'请逐字引用'}),gesture);
 assert.equal(stripUnrequestedActions(gesture,{request:'请写一个短故事'}),gesture);
});
test('only an explicit current creative request enables stage directions',()=>{
 const text='（微笑）你好。';
 assert.equal(stripUnrequestedActions(text,{request:'你是个小说家吗？'}),'你好。');
 assert.equal(stripUnrequestedActions(text,{request:'不要写动作，只聊天'}),'你好。');
 assert.equal(stripUnrequestedActions(text,{request:'请加上动作描写'}),text);
 assert.equal(stripUnrequestedActions(text,{request:'写一个短故事'}),text);
 assert.equal(requestedActionNarration('不要写故事，不要加入动作描写'),false);
 assert.equal(stripUnrequestedActions(text,{request:'写个故事，但是不要动作描写'}),'你好。');
});
test('ordinary parentheses, glosses, source code, JSON and media commands survive',()=>{
 const input='明天见（上午9点）。smile（微笑）\n`print("（微笑）")`\n[图:微笑（柔和光线），坐在书桌旁]\n[语音]你好（点头）';
 assert.equal(stripUnrequestedActions(input),'明天见（上午9点）。smile（微笑）\n`print("（微笑）")`\n[图:微笑（柔和光线），坐在书桌旁]\n[语音]你好');
 assert.equal(stripUnrequestedActions('{"prompt":"（微笑）"}'),'{"prompt":"（微笑）"}');
 assert.equal(stripUnrequestedActions('[图:微笑（柔和光线）\n挥手（拿起书本）]'),'[图:微笑（柔和光线）\n挥手（拿起书本）]');
 assert.equal(stripUnrequestedActions('（微笑）',{request:'请原样引用这段文字'}),'（微笑）');
});
test('the local final-reply path uses the same default as API delivery',()=>{
 assert.equal(cleanLocalReply('知道了～（不好意思地吐了吐舌头，把手机藏起来）',{request:'你在做什么？'}),'知道了～');
 assert.equal(cleanLocalReply('（微笑）你好。',{request:'请写一个故事'}),'（微笑）你好。');
 assert.match(localDialogueInstruction('你好'),/不加括号/);
 assert.match(DIALOGUE_ONLY_RULE,/换人设不改变/);
});

 test('soft voice and pout stage directions are removed across paragraph boundaries',()=>{
 const reply='嗯……爸爸～\n\n（有些委屈地瘪了瘪嘴，声音软软糯糯的，带着一丝撒娇的鼻音）';
 assert.equal(stripUnrequestedActions(reply),'嗯……爸爸～');
 assert.equal(stripUnrequestedActions('嗯……爸爸～\n\n(声音软软糯糯的，带着一丝撒娇的鼻音)'),'嗯……爸爸～');
 assert.equal(stripUnrequestedActions('好啦\n（嘟着嘴）'),'好啦');
 assert.equal(stripUnrequestedActions('声音（单位：分贝）'),'声音（单位：分贝）');
 });
