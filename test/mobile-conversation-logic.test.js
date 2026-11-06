import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryHub} from '../memory-hub.js';
import {createLifeMemory} from '../life-memory.js';
import {conversationStep,conversationHint} from '../conversation-care.js';
import {parseGroupDecision,mergeGroupWindow} from '../group-conversation.js';
const memoryStorage=()=>{const files=new Map();return {list:()=>[...files.keys()],read:key=>{if(!files.has(key))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(key));},write:(key,value)=>files.set(key,structuredClone(value)),remove:key=>files.delete(key)};};

test('phone API context carries the previous topic and accepts a correction before the next answer',()=>{
 const first=conversationStep({},'今天把那盆花放到窗边了',{personaId:'p',now:1000});
 const second=conversationStep(first,'不是白色，是蓝色的花盆',{personaId:'p',now:2000});assert.equal(second.previousTopic,'今天把那盆花放到窗边了');assert.equal(second.lastTopic,'不是白色，是蓝色的花盆');
 const repair=conversationStep(second,'你说错了，我刚说的是蓝色',{personaId:'p',now:3000});assert.equal(repair.intent,'repair');assert.match(conversationHint(repair),/改对/);
});
test('phone memory recalls actual previous turns, retains speaker identity and keeps private user words out of a group',async()=>{
 const hub=createMemoryHub({storage:memoryStorage(),allowed:()=>true,now:()=>10000});const p={accountId:'a',key:'private:12345',personaId:'p',personaVersion:'v'},g={...p,key:'group:67890'};
 try{hub.record(p,{id:'private-flower',at:1000,role:'user',speakerId:'12345',text:'我的私人花盆藏在书房，颜色是蓝色',actual:true});hub.record(g,{id:'group-cat',at:2000,role:'user',speakerId:'54321',text:'我家的猫叫小米',actual:true});
  const recall=await hub.recall(p,'花盆 颜色 蓝色');assert.match(recall.text,/蓝色/);const group=await hub.recall(g,'书房 花盆 蓝色');assert.ok(!group.text.includes('藏在书房'));const cat=await hub.recall(g,'猫 小米',{speakerId:'54321'});assert.match(cat.text,/小米/);assert.equal(cat.records.some(r=>r.speakerId==='54321'),true);
 }finally{hub.close();}
});
test('phone schedule keeps the same current outfit and scene for conversation and photo planning across reload',()=>{
 const storage=memoryStorage(),meta={kind:'life',accountId:'a',key:'',personaId:'p'},role={meta,name:'测试角色',prompt:'日常轻松聊天'};
 const config=()=>({life:{enabled:true},memory:{enabled:true,schedule:'daily'}}),options={storage,config,allowed:()=>true,roles:()=>[role],signature:()=>'',online:()=>true,now:()=>Date.parse('2026-11-05T14:00:00+08:00'),ask:async()=>{throw Error('No model generation in this test');}};
 const life=createLifeMemory(options);
 try{life.chooseActivity(role,{activity:'在窗边读书',taskKind:'read',location:'阳光下的书桌与绿植',outfit:'蓝色连衣裙和白色发带',minutes:30},{request:'换上蓝色连衣裙和白色发带，在窗边读书'});const scene=life.lifeScene(meta);assert.match(scene.outfit,/蓝色连衣裙/);assert.match(scene.location,/书桌/);const reloaded=createLifeMemory(options);try{assert.equal(reloaded.lifeScene(meta).outfit,scene.outfit);assert.equal(reloaded.lifeScene(meta).location,scene.location);}finally{reloaded.close();}}finally{life.close();}
});
test('phone group context attributes multiple people and pictures to their own message rather than merging identities',()=>{
 const batch=[{message_id:1,user_id:12345,raw_message:'这张照片怎么样',message:[{type:'text',data:{text:'这张照片怎么样'}}]},{message_id:2,user_id:54321,raw_message:'我刚发的',message:[{type:'image',data:{url:'https://example.test/photo.png'}}]}];
 const plan=parseGroupDecision(JSON.stringify({respond:true,focusIds:['1','2'],depth:'normal',images:'detail',reason:'回应正在讨论的照片'}),{ids:['1','2'],direct:true,hasText:true,hasImages:true});const merged=mergeGroupWindow(batch,plan);assert.ok(merged);assert.equal(plan.depth,'normal');assert.equal(merged.message.some(p=>p.type==='image'),true);assert.deepEqual(merged._bridgeGroupSpeakers.map(p=>p.id),['12345','54321']);assert.equal(merged.user_id,54321);
});
