import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createMemoryHub} from '../memory-hub.js';
import {createLifeExecution} from '../life-execution.js';
import {createLocalGroupWindow} from '../local-group-window.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),html=readFileSync(new URL('../console.html',import.meta.url),'utf8');
function extract(code,name,deps={}){const start=code.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);for(let end=code.indexOf('}',start);end>=0;end=code.indexOf('}',end+1)){let factory;try{factory=Function(...Object.keys(deps),'return ('+code.slice(start,end+1)+');');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return factory(...Object.values(deps));}throw Error(name);}
function memoryFixture(){const files=new Map();let now=Date.now();const hub=createMemoryHub({storage:{list:()=>[...files.keys()],read:n=>{if(!files.has(n))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(n));},write:(n,v)=>files.set(n,structuredClone(v))},allowed:m=>m.accountId==='a',now:()=>now,signature:()=> 'v'});const meta=key=>({key,accountId:'a',personaId:'p',personaVersion:'v'});const record=(key,speakerId,text,extra={})=>hub.record(meta(key),{dir:'in',text,speakerId,messageId:String(++now),time:now,...extra});return {hub,meta,record};}
test('actual shared hub recalls a persons public group self-report in their private conversation without nickname matching',async()=>{
 const h=memoryFixture();try{
  h.record('group:55555','11111','我喜欢画水彩猫，最近每天练习。',{speakerName:'同昵称'});
  h.record('private:22222','22222','我喜欢画水彩狗。',{speakerName:'同昵称'});
  const got=await h.hub.recall(h.meta('private:11111'),'上次画水彩猫',{expand:false,maxChars:1800});
  assert.match(got.text,/水彩猫/);assert.doesNotMatch(got.text,/水彩狗/);assert(got.records.some(r=>r.originKey==='group:55555'&&r.speakerId==='11111'));
 }finally{h.hub.close();}
});
test('private non-sensitive preferences follow only their real QQ speaker into a group; secrets and other people stay private',async()=>{
 const h=memoryFixture();try{
  h.record('private:11111','11111','我喜欢画水彩猫。我的银行卡密码是123456。');
  h.record('private:22222','22222','我喜欢画水彩狗。');
  h.record('private:11111','11111','我喜欢水彩秘密作品，不要告诉别人。',{private:true});
  const own=await h.hub.recall(h.meta('group:55555'),'画水彩',{speakerId:'11111',expand:false,maxChars:2500});
  assert.match(own.text,/水彩猫/);assert.doesNotMatch(own.text,/123456|密码|水彩狗|秘密作品/);assert(own.records.some(r=>r.disclosure==='same-person-preference'));
  const stranger=await h.hub.recall(h.meta('group:55555'),'画水彩猫',{speakerId:'33333',expand:false});assert.doesNotMatch(stranger.text,/水彩猫/);
  const noActor=await h.hub.recall(h.meta('group:55555'),'画水彩猫',{expand:false});assert.doesNotMatch(noActor.text,/水彩猫/);
 }finally{h.hub.close();}
});
test('same person public statements connect across allowed groups and clearing the source suppresses cross-recall',async()=>{
 const h=memoryFixture();try{
  h.record('group:55555','11111','我喜欢听古典音乐的小提琴。');
  const got=await h.hub.recall(h.meta('group:66666'),'喜欢听什么古典音乐',{speakerId:'11111',expand:false});assert.match(got.text,/小提琴/);
  const other=await h.hub.recall(h.meta('group:66666'),'喜欢听什么古典音乐',{speakerId:'22222',expand:false});assert.doesNotMatch(other.text,/小提琴/);
  h.hub.clear(h.meta('group:55555'));const after=await h.hub.recall(h.meta('private:11111'),'古典音乐',{expand:false});assert.doesNotMatch(after.text,/小提琴/);
 }finally{h.hub.close();}
});
function sleepFixture(){let time=Date.parse('2026-11-06T23:10:00+08:00'),plan={date:'2026-11-06',start:'23:00',end:'24:00',activity:'睡觉',taskKind:'sleep',planned:true},actual={date:'2026-11-06',start:'20:00',activity:'浏览视频',taskKind:'browse',actual:true},stored,stops=0,dispatches=0;
 const role={meta:{accountId:'a',personaId:'p'}},engine=createLifeExecution({storage:{read:()=>stored,write:v=>{stored=structuredClone(v);}},config:()=>({enabled:true,sleep:true,execute:true,maxTasksPerDay:0}),roles:()=>[role],sceneFor:()=>plan,activityFor:()=>actual,allowed:()=>true,dispatch:async()=>{dispatches++;return 'session';},stop:async()=>{stops++;},now:()=>time});
 return {engine,role,get stops(){return stops;},get dispatches(){return dispatches;},set plan(v){plan=v;},set actual(v){actual=v;},advance:ms=>time+=ms};}
test('scheduled sleep suppresses autonomous execution even when a previous activity remains running',async()=>{
 const h=sleepFixture();assert.equal(h.engine.asleep(h.role.meta),true);assert.equal(h.engine.snapshot(h.role.meta).scene.activity,'睡觉');await h.engine.tick();assert.equal(h.stops,1);assert.equal(h.dispatches,0);
 h.plan={date:'2026-11-07',start:'08:00',activity:'浏览网页',taskKind:'browse',planned:true};assert.equal(h.engine.asleep(h.role.meta),false);
});
test('explicit wake is temporary and resuming rest takes effect without a model call',()=>{
 const h=sleepFixture();h.engine.wake(h.role.meta);assert.equal(h.engine.asleep(h.role.meta),false);h.advance(20*60000+1);assert.equal(h.engine.asleep(h.role.meta),true);
 h.engine.wake(h.role.meta,{minutes:5});assert.equal(h.engine.asleep(h.role.meta),false);h.engine.rest(h.role.meta);assert.equal(h.engine.asleep(h.role.meta),true);
 h.actual={date:'2026-11-06',start:'23:10',activity:'我决定现在睡觉',taskKind:'sleep',actual:true};assert.equal(h.engine.asleep(h.role.meta),true);
});
test('API and local use the same 120-second observation clock and generation pauses it independently for each group',()=>{
 for(const local of [false,true]){let time=0;const settings={activeAccountId:'a',localChat:{enabled:local}},window=createLocalGroupWindow({now:()=>time}),meta={accountId:'a',personaId:'p'},deps={Date:{now:()=>time},settings,localGroupWindow:window,localGroupKey:(m,g)=>JSON.stringify([m.accountId,m.personaId,g]),calendarMeta:()=>meta,activePersona:()=>({id:'p'})};
  const touch=extract(source,'touchGroupActive',deps),active=extract(source,'groupActive',deps),pause=extract(source,'pauseLocalGroupWindow',deps);
  touch('55555',meta);time=10000;const release=pause({kind:'group',key:'group:55555',chatId:'55555'});time=310000;assert.equal(active('55555',meta),true);assert.equal(active('66666',meta),false);release();release();time+=109999;assert.equal(active('55555',meta),true);time++;assert.equal(active('55555',meta),false);
 }
 assert.match(source,/resumeObservation:pauseLocalGroupWindow\(chat\)/);assert.match(source,/turn\?\.resumeObservation\?\.\(\)/);
 assert.doesNotMatch(source,/GROUP_ACTIVE_MS|groupActiveUntil/);
});
test('the host admission accepts a non-mentioned followup inside the observation window and filters it after expiry',()=>{
 let active=true;const deps={settings:{groupRequireAt:true},lifeExecution:{asleep:()=>false},calendarMeta:()=>({}),activePersona:()=>({id:'p'}),effectiveGroups:()=>['55555'],effectiveUsers:()=>['11111'],mentionsSelf:()=>false,groupOpen:()=>false,groupActive:()=>active};
 const allowed=extract(source,'incomingAllowed',deps),payload={message_type:'group',group_id:'55555',user_id:'11111',self_id:'99999',message:[]};assert.equal(allowed(payload),true);active=false;assert.equal(allowed(payload),false);
 deps.lifeExecution.asleep=()=>true;active=true;assert.equal(allowed(payload),undefined);
});
test('adjacent same-activity schedule slots merge in display without mutating schedule or losing original job references',()=>{
 const merge=extract(html,'mergeDisplaySlots'),slots=[{start:600,end:630,activity:'画画',taskKind:'draw',startClock:'10:00',endClock:'10:30',state:'past'},{start:630,end:660,activity:'画画',taskKind:'draw',startClock:'10:30',endClock:'11:00',state:'current'},{start:660,end:690,activity:'听歌',taskKind:'listen'}],before=JSON.stringify(slots),got=merge(slots);
 assert.equal(got.length,2);assert.equal(got[0].end,660);assert.equal(got[0].endClock,'11:00');assert.equal(got[0].state,'current');assert.equal(got[0]._displaySlots.length,2);assert.equal(JSON.stringify(slots),before);
 assert.equal(merge([{start:0,end:30,activity:'画画'},{start:40,end:60,activity:'画画'}]).length,2);
 assert.equal(merge([{start:0,end:30,activity:'聊天',groupIds:['11111']},{start:30,end:60,activity:'聊天',groupIds:['22222']}]).length,2);
 for(const script of html.matchAll(/<script\b[^>]*>([^]*?)<\/script>/gi))new vm.Script(script[1]);
 assert.match(html,/slots=mergeDisplaySlots\(today\.slots/);assert.match(html,/mergeDisplaySlots\(Object\.values\(pair\[1\]\)/);
});
