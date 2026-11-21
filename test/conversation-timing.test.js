import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationTimingHint,routineFollowupDenial} from '../conversation-timing.js';
import {initiativeConversation} from '../operation-context.js';

const noon = Date.parse('2026-08-17T12:27:00+08:00');

test('someone who just woke at noon can be greeted without guessing their meals or sleep schedule', () => {
  const hint = conversationTimingHint('刚刚睡醒呢', {now:noon});
  assert.match(hint, /12:27/);
  assert.match(hint, /自己刚醒/);
  assert.match(hint, /醒来的原因/);
  assert.match(hint, /是否吃过饭都未知/);
  assert.match(hint, /不用再问几点/);
  for (const words of ['你睡醒了吗？', '她刚刚睡醒呢', '“刚刚睡醒呢”这句话怎么翻译？', '帮我把照片亮度调高']) {
    assert.equal(conversationTimingHint(words, {now:noon}), '');
  }
});

test('greetings, a stated break and a delayed reply use the relevant clock', () => {
  const evening = Date.parse('2026-08-17T22:20:00+08:00');
  assert.match(conversationTimingHint('晚上好', {now:evening}), /22:20.*晚上好用于开场/);
  assert.match(conversationTimingHint('晚安', {now:noon}), /晚安用于休息或道别/);
  assert.match(conversationTimingHint('我先去睡了，晚安', {now:evening}), /省去自己的离线状态/);
  assert.match(conversationTimingHint('我准备午睡了', {now:noon}), /休息时顺着道别/);
  assert.match(conversationTimingHint('得了得了我要洗澡了', {now:noon}), /不布置任务或催他回来/);
  assert.match(conversationTimingHint('早安', {now:evening,receivedAt:noon}), /22:20.*发于 2026-08-17 12:27/);
});

test('silence across midnight keeps an old plan in its own day, with the outcome still unknown', () => {
  const sent = Date.parse('2026-08-16T23:00:00+08:00');
  const now = Date.parse('2026-08-17T07:11:00+08:00');
  const history = [
    {role:'user',at:sent,text:'等一下我修'},
    {role:'assistant',at:sent+7000,text:'你先弄，弄好再说'},
  ];
  const result = initiativeConversation(history, true, now);
  assert.deepEqual(result.turns[0], ['对方','等一下我修','2026-08-16 23:00']);
  assert.match(result.replyState, /没有收到对方的新消息.*隔了很久.*进度未知/);
  assert.match(result.replyState, /新想法可照常分享/);
  const midnight = Date.parse('2026-08-17T00:01:00+08:00');
  const justBefore = [{role:'user',at:midnight-120000,text:'继续刚才的话题'}];
  assert.doesNotMatch(initiativeConversation(justBefore, false, midnight).replyState, /隔了很久/);
});

test('only completion checks connected to the latest stated routine are held', () => {
  for (const [received, draft] of [
    ['等一下我修', '没催你哦，就是想问一声：修好了没嘛'],
    ['等一下我修', '[语音:轻声]你修好了吗？'],
    ['得了得了我要洗澡了', '洗完没嘛…刚好我把那局看完了'],
    ['我先去吃饭了', '午饭吃完了吗？'],
    ['我要去睡了', '你醒了吗？'],
  ]) {
    assert.match(routineFollowupDenial(draft, {text:received}), /未要求追问/);
  }
  assert.equal(routineFollowupDenial('昨晚那盘棋的结尾我又琢磨出一招', {text:'等一下我修'}), '');
  assert.equal(routineFollowupDenial('修好了没嘛', {text:'我回来了，已经修好了'}), '');
  assert.equal(routineFollowupDenial('修好了吗？', {text:'我先修，九点提醒我'}), '');
  assert.equal(routineFollowupDenial('我不想再说“修好了没嘛”', {text:'等一下我修'}), '');
});
