import test from 'node:test';import assert from 'node:assert/strict';
import {selectMediaIntent,mediaIntentHint} from '../media-intent.js';
import {initiativeGrounding} from '../initiative-grounding.js';
test('media planning cannot replace user words with an invented reply',()=>{
 const intent=selectMediaIntent('你准备听啥呢',{form:'voice',confidence:.85,reason:'声音适合表达',request:'我就听你安排，你想听什么呀'});
 assert.equal(intent.request,'你准备听啥呢');assert.deepEqual(intent.kinds,['voice']);const hint=mediaIntentHint(intent);assert.match(hint,/建议，不是对方明确要求/);assert.doesNotMatch(hint,/我就听你安排/);
 const explicit=selectMediaIntent('发语音跟我说晚安');assert.match(mediaIntentHint(explicit),/明确邀请/);
});
test('autonomous facts preserve failure and partial results without converting wishes or summaries to receipts',()=>{
 const now=Date.now(),hint=initiativeGrounding([{updatedAt:now,status:'failed',actuallyCompleted:false,scene:{activity:'听音乐'},checkpoint:{summary:'已经听完了'},evidence:[{at:now,tool:'bridge_audio',ok:false,substantive:true,coverage:'音乐好听'},{at:now,tool:'bridge_browser',ok:true,substantive:true,partial:true,coverage:'专辑页面标题'}]}],now);
 assert.match(hint,/"completed":false/);assert.match(hint,/"partial":true/);assert.doesNotMatch(hint,/已经听完了|音乐好听/);assert.match(hint,/页面文字不证明听过音频/);
});
