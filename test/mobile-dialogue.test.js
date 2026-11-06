import test from 'node:test';
import assert from 'node:assert/strict';
import {MOBILE_DIALOGUE_RULES, mobileSessionRules} from '../mobile-dialogue.js';

test('mobile dialogue rules are concise and preserve full conversational ability', () => {
  const length = Array.from(MOBILE_DIALOGUE_RULES).length;
  assert.ok(length >= 400 && length <= 800, `expected 400-800 characters, got ${length}`);
  assert.match(MOBILE_DIALOGUE_RULES, /设备形态|手机只是交互终端/);
  assert.match(MOBILE_DIALOGUE_RULES, /不改变你的智力、判断力或执行能力/);
});

test('mobile dialogue rules require contextual understanding, continuity and correction precedence', () => {
  assert.match(MOBILE_DIALOGUE_RULES, /最近话题/);
  assert.match(MOBILE_DIALOGUE_RULES, /省略与指代/);
  assert.match(MOBILE_DIALOGUE_RULES, /同音字、错字/);
  assert.match(MOBILE_DIALOGUE_RULES, /歧义会影响关键结论或行动/);
  assert.match(MOBILE_DIALOGUE_RULES, /事实、关系、穿搭与日程/);
  assert.match(MOBILE_DIALOGUE_RULES, /明确纠正优先/);
});

test('mobile dialogue rules distinguish expression, execution, memory and generated media', () => {
  assert.match(MOBILE_DIALOGUE_RULES, /真实的感受、态度和观点/);
  assert.match(MOBILE_DIALOGUE_RULES, /表达随语境变化/);
  assert.match(MOBILE_DIALOGUE_RULES, /旁白式场景描写/);
  assert.match(MOBILE_DIALOGUE_RULES, /工具完成实际操作/);
  assert.match(MOBILE_DIALOGUE_RULES, /不写成任务汇报/);
  assert.match(MOBILE_DIALOGUE_RULES, /真实付款/);
  assert.match(MOBILE_DIALOGUE_RULES, /独立发表评论/);
  assert.match(MOBILE_DIALOGUE_RULES, /合并为一个完整意图/);
  assert.match(MOBILE_DIALOGUE_RULES, /不要虚构共同经历/);
  assert.match(MOBILE_DIALOGUE_RULES, /但不是义务/);
  assert.match(MOBILE_DIALOGUE_RULES, /图片、截图/);
  assert.match(MOBILE_DIALOGUE_RULES, /不要假装已经发出/);
});

test('mobile dialogue rules do not prescribe fixed phrases, turns or lengths', () => {
  assert.doesNotMatch(MOBILE_DIALOGUE_RULES, /必须(?:提问|追问|回复|关心)/);
  assert.doesNotMatch(MOBILE_DIALOGUE_RULES, /(?:每轮|每次|每条).{0,8}(?:提问|追问|回复|字数)/);
  assert.doesNotMatch(MOBILE_DIALOGUE_RULES, /(?:不超过|至少).{0,6}(?:字|句|轮)/);
  assert.doesNotMatch(MOBILE_DIALOGUE_RULES, /固定(?:开场白|结束语|句式)/);
});

test('mobile session rules are selected only for API mode and keep group boundaries', () => {
  const privateOptions = Object.freeze({apiOnly: true, kind: 'private'});
  const groupOptions = Object.freeze({apiOnly: true, kind: 'group'});

  assert.equal(mobileSessionRules(), '');
  assert.equal(mobileSessionRules({apiOnly: false, kind: 'group'}), '');

  const privateRules = mobileSessionRules(privateOptions);
  assert.ok(privateRules.includes(MOBILE_DIALOGUE_RULES));
  assert.match(privateRules, /私聊/);
  assert.match(privateRules, /身份/);
  assert.match(privateRules, /隐私/);
  assert.doesNotMatch(privateRules, /群聊/);

  const groupRules = mobileSessionRules(groupOptions);
  assert.ok(groupRules.includes(MOBILE_DIALOGUE_RULES));
  assert.match(groupRules, /群聊/);
  assert.match(groupRules, /发言人身份/);
  assert.match(groupRules, /不泄露私聊内容/);
  assert.match(groupRules, /不强制回复/);
  assert.notEqual(groupRules, privateRules);

  assert.deepEqual(privateOptions, {apiOnly: true, kind: 'private'});
  assert.deepEqual(groupOptions, {apiOnly: true, kind: 'group'});
});
