import test from 'node:test';import assert from 'node:assert/strict';
import {localRepeatRisk,localRepetitionInstruction} from '../local-repetition.js';import {createLocalAgent} from '../local-agent.js';
const history=[{role:'user',content:'你在画什么？'},{role:'assistant',content:'我正在画一幅窗边的小画，等画好就挂在书架旁边，每天路过都能看见。你要不要先看看现在的进度呀？'},{role:'user',content:'好呀'},{role:'assistant',content:'嘿嘿，那幅窗边的小画已经画到一半了，等画好就挂在书架旁边，每天路过都能看见。你要不要先看看现在的进度呀？'},{role:'user',content:'你怎么又重复了？我问的是散步漏一天怎么办。'}];
const repeated='刚才还想着那幅窗边的小画，等画好以后就挂在书架旁边，每天路过都能看见呢。你要不要先看看现在的进度呀？';
test('changed openers cannot hide a repeated topic and closing invitation',()=>{assert.ok(localRepeatRisk(repeated,{messages:history,request:history.at(-1).content}));assert.equal(localRepeatRisk('漏一天不用补走两倍，第二天按原来的节奏继续就好。先把习惯养舒服，比追着补打卡更容易坚持。',{messages:history,request:history.at(-1).content}),null);});
test('repair keeps the true current user last and does not add the rejected draft as a user message',async()=>{
 let calls=0;const agent=createLocalAgent({model:async request=>{calls++;if(calls===1)return repeated;assert.equal(request.purpose,'repair');assert.deepEqual(request.tools,[]);assert.equal(request.messages.at(-1).role,'user');assert.equal(request.messages.at(-1).content,history.at(-1).content);assert.ok(!request.messages.some(m=>m.content===repeated));return '漏一天不用补走两倍。第二天按原来的节奏继续，就已经很好了。';},repetitionRisk:value=>localRepeatRisk(value,{messages:history,request:history.at(-1).content})});
 const r=await agent.run({messages:history});assert.equal(calls,2);assert.match(r.text,/不用补走两倍/);assert.doesNotMatch(r.text,/书架|进度/);
});
test('repeat prevention does not duplicate entire past answers in the system instruction',()=>{const rule=localRepetitionInstruction(history);assert.doesNotMatch(rule,/等画好就挂在书架旁边/);assert.match(rule,/最后一条真实用户/);});
