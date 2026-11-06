import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLocalReply,localRepeatRisk,recentAssistantReplies} from '../local-repetition.js';
import {createLocalAgent} from '../local-agent.js';

const old='我一直都在这里等你，你什么时候来找我都可以。';
const messages=[{role:'user',content:'你在吗？'},{role:'assistant',content:old},{role:'user',content:'我刚画完一张画，想听听你的看法。'}];
test('short duplicated sentences are removed while deliberate repetition and facts survive',()=>{
 assert.equal(prepareLocalReply('“我在呢。”\n“我在呢。”\n“你说吧。”'),'我在呢。\n\n你说吧。');
 assert.equal(prepareLocalReply('你好呀！你好呀！'),'你好呀！');
 assert.equal(prepareLocalReply('好好好，哈哈哈！'),'好好好，哈哈哈！');
 assert.equal(prepareLocalReply('你好呀！你好呀！',{request:'重复两次你好呀'}),'你好呀！你好呀！');
 assert.equal(prepareLocalReply('2+2=4。2-2=4。'),'2+2=4。2-2=4。');
});
test('consecutive QQ bubbles are compared as one historical reply',()=>{
 const rows=[{role:'user',content:'旧问题'},{role:'assistant',content:'第一条'},{role:'assistant',content:'第二条'},{role:'user',content:'新问题'}];
 assert.deepEqual(recentAssistantReplies(rows),['第一条\n第二条']);assert.equal(localRepeatRisk(old,{messages,request:messages.at(-1).content}).kind,'same-content');
 assert.equal(localRepeatRisk(old,{messages,request:'复述上一条'}),null);
});
test('different numerical facts and normal same-question confirmations are not treated as repeated replies',()=>{
 const rows=[{role:'user',content:'温度多少？'},{role:'assistant',content:'目前这里记录到的室内温度是25度。'},{role:'user',content:'现在温度多少？'}];
 assert.equal(localRepeatRisk('目前这里记录到的室内温度是26度。',{messages:rows,request:rows.at(-1).content}),null);
 const same=messages.map(row=>({...row}));same.at(-1).content=same[0].content;assert.equal(localRepeatRisk(old,{messages:same,request:same.at(-1).content}),null);
});
test('a repeated final reply is rewritten once by the same model without executing tools',async()=>{
 let calls=0;const phases=[];
 const agent=createLocalAgent({model:async options=>{calls++;if(calls===1)return old;assert.deepEqual(options.tools,[]);assert.equal(options.purpose,'repair');return '你画的是哪个部分？发过来，我先看看构图。';},formatReply:prepareLocalReply,repetitionRisk:text=>localRepeatRisk(text,{messages,request:messages.at(-1).content}),onProgress:e=>phases.push(e.phase)});
 const result=await agent.run({messages});assert.equal(calls,2);assert.match(result.text,/构图/);assert.ok(phases.includes('repair'));assert.ok(phases.includes('repaired'));
});
test('a stubborn repeated answer is blocked after one rewrite instead of looping',async()=>{
 let calls=0;const agent=createLocalAgent({model:async()=>{calls++;return old;},repetitionRisk:text=>localRepeatRisk(text,{messages,request:messages.at(-1).content})});
 await assert.rejects(agent.run({messages}),/重复近期回复/);assert.equal(calls,2);
});
test('speech is corrected before synthesizing and final text does not echo an already-spoken utterance',async()=>{
 let calls=0,spoken;
 const agent=createLocalAgent({model:async()=>++calls===1?{tool_calls:[{id:'s',function:{name:'speech',arguments:{text:old,final:true}}}]}:'你把画发来，我想看看颜色。',formatReply:prepareLocalReply,repetitionRisk:text=>localRepeatRisk(text,{messages,request:messages.at(-1).content}),tools:{speech:{execute:async args=>{spoken=args.text;return {ok:true,kind:'speech',file:'D:/voice.wav'};}}}});
 const result=await agent.run({messages});assert.equal(spoken,'你把画发来，我想看看颜色。');assert.equal(result.spokenText,spoken);assert.equal(calls,2);
 let round=0;
 const voiced=createLocalAgent({model:async()=>++round===1?{tool_calls:[{id:'v',function:{name:'speech',arguments:{text:'连接成功了。',final:false}}}]}:'连接成功了。',formatReply:prepareLocalReply,stripSpokenText:(text,spoken)=>prepareLocalReply(text,{spoken}),tools:{speech:{execute:async()=>({ok:true,kind:'speech',file:'D:/voice.wav'})}}});
 const voiceResult=await voiced.run({messages:[{role:'user',content:'试下语音'}]});assert.equal(voiceResult.text,'');assert.equal(voiceResult.attachments.length,1);assert.equal(voiceResult.spokenText,'连接成功了。');
});
