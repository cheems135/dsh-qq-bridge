import test from 'node:test';
import assert from 'node:assert/strict';
import {recentLifeConversations,currentLifeChatTurns,LIFE_CONVERSATION_WINDOW_MS} from '../life-conversation-context.js';

const now=Date.parse('2026-11-17T11:58:00+08:00');
const old=Date.parse('2026-11-17T00:50:00+08:00');

test('midday schedule does not continue an eleven-hour-old bedtime exchange',()=>{
 const conversations=[{key:'private:1',lastAt:old,topic:'数到七十再睡',messageIds:['old:in']},{key:'private:1',lastAt:now-60000,topic:'',lastReply:'那我开始数了',messageIds:['new:out']}];
 assert.deepEqual(recentLifeConversations(conversations,{now}),[]);
 const turns=[{at:old,role:'user',text:'数到七十再睡'},{at:old+1000,role:'assistant',text:'好，我开始数'},{at:now-60000,role:'assistant',text:'那我开始数了'}];
 assert.deepEqual(currentLifeChatTurns(turns,{now}),[]);
});

test('fresh incoming messages survive in both schedule paths, with reply context after the first incoming',()=>{
 const fresh=now-2*60000,conversations=[{lastAt:old,topic:'过期话题'},{lastAt:fresh,topic:'刚发的新图片',messageIds:['image:in']},{lastAt:now-10000,topic:'',messageIds:['proactive:out']}];
 assert.deepEqual(recentLifeConversations(conversations,{now}),[conversations[1]]);
 const turns=[{at:old,role:'user',text:'过期话题'},{at:fresh-1000,role:'assistant',text:'旧话题的主动续句'},{at:fresh,role:'user',text:'刚发的新图片'},{at:now-10000,role:'assistant',text:'看到图片了'}];
 assert.deepEqual(currentLifeChatTurns(turns,{now}),turns.slice(2));
});

test('time boundary accepts its final millisecond and rejects future timestamps',()=>{
 const edge={at:now-LIFE_CONVERSATION_WINDOW_MS,role:'user',text:'仍在本轮窗口'};
 assert.deepEqual(currentLifeChatTurns([edge,{at:now+1,role:'user',text:'未来消息'}],{now}),[edge]);
});
