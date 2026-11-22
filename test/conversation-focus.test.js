import test from 'node:test';
import assert from 'node:assert/strict';
import {conversationStep, conversationHint} from '../conversation-care.js';

const turn = (words, previous = {}) => conversationStep(previous, words, {personaId:'p', now:5000});

test('a question returning to a past subject keeps its answer path and leaves work pending', () => {
  const old = turn('换个话题，明早我去看牙。');
  const next = turn('回到电影，小池指什么？', old);
  assert.equal(next.intent, 'answer');
  assert.match(conversationHint(next), /明确回到先前话题时，只接他现在问的那件事/);
  assert.equal(next.previousTopic, old.lastTopic);
  assert.equal(next.pauseUntil, 0);
  for (const question of ['那他是谁？','你刚才说的那部可以帮我查一下吗？','“回到电影”是啥意思？']) {
    assert.equal(turn(question, next).intent, 'answer');
  }
  assert.equal(turn('先别生成了', next).intent, 'redirect');
});

test('venting is recognized without a declared mood and the latest explicit request wins', () => {
  const vent = turn('我就想吐槽两句，累死我了');
  assert.equal(vent.support.mode, 'listen');
  assert.match(conversationHint(vent), /办法等他想听再提/);
  assert.equal(turn('我就是想跟你抱怨两句').support.mode, 'listen');
  assert.equal(turn('我只是想吐槽两句，不过帮我出个主意吧。').support.mode, 'advice');
  assert.equal(turn('不过到底该怎么办？', vent).intent, 'answer');
  assert.equal(turn('你能帮我想个办法吗？先别给我提建议，我就想吐槽。').support.mode, 'listen');
});

test('quoted or reported speech does not set the sender’s preference', () => {
  for (const text of ['她说“我就想吐槽两句”','我室友跟我说，我就想吐槽两句','她问我怎么办','“我就想吐槽”的日语怎么说？']) {
    assert.equal(turn(text).support, undefined, text);
  }
  assert.equal(turn('她说“你别抱怨”，我就想吐槽两句。').support.mode,'listen');
});

test('take responsibility when a friend draws a boundary about your jokes or a nickname', () => {
  for(const words of ['我是真的不喜欢这样。以后别拿这个开玩笑。','我不喜欢你这么叫我。','以后别叫我“老登”了。']){
    const state=turn(words);
    assert.equal(state.intent,'boundary',words);
    assert.match(conversationHint(state),/自己实际说了什么.*具体认下/);
    assert.equal(state.pauseUntil,0);
  }
  for(const words of ['我开玩笑的啦','她说“以后别拿这事开玩笑”。','室友说，别再这么叫我。','别给我提建议','别叫我起床。','我不喜欢这个电影。']){
    assert.notEqual(turn(words).intent,'boundary',words);
  }
});

test('a vent about an experience gets a reaction while a request for space leaves the floor open', () => {
  const vent=turn('对，我就想吐槽两句。',turn('改了四版，最后又选了第一版。'));
  assert.match(conversationHint(vent),/上文有具体经历.*感受或看法/);
  assert.doesNotMatch(conversationHint(turn('你先听我说完')), /感受或看法/);
  assert.equal(turn('我就想吐槽两句，不过你能给我点建议吗？').support.mode,'advice');
});
