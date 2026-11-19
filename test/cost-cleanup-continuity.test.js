import test from 'node:test';import assert from 'node:assert/strict';
import {retireConversation,RETAINED_CONVERSATION_SESSIONS,retainedConversationIds,precedingConversationSessions,verifiedConversationArchive} from '../session-retirement.js';
import {createHash} from 'node:crypto';
import {mediaPreviewNeeded} from '../background-cost-policy.js';
import {createMemoryHub} from '../memory-hub.js';
import {createLifeExecution} from '../life-execution.js';
import {createLearningMemory} from '../learning-memory.js';
import {modelPurpose} from '../model-invocation-audit.js';
import {readFileSync} from 'node:fs';
const clock=Date.parse('2026-11-15T10:00:00+08:00');
function store(){const files=new Map();return {files,list:()=>[...files.keys()],read:key=>{if(!files.has(key))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(key));},write:(key,value)=>files.set(key,structuredClone(value))};}
function retirement(){const storage=store(),order=[];let removed=0,protectedNow=false;const options={previousId:'old',currentId:'current',scope:{accountId:'a',personaId:'p',key:'private:12345'},storage,readSession:async()=>({header:{id:'old'},events:[{type:'user/message',data:{text:'原始全文'}}]}),preserveMessages:async()=>{order.push('preserve');return true;},isProtected:()=>protectedNow,remove:async id=>{assert.equal(id,'old');removed++;order.push('remove');return {mode:'archived'};}};return {options,storage,order,get removed(){return removed;},protect:()=>protectedNow=true};}
test('complete transcript and source memory must be read back before the previous session is retired',async()=>{
 const f=retirement(),result=await retireConversation(f.options);assert.equal(result.status,'retired');assert.equal(result.mode,'archived');assert.equal(result.eventCount,1);assert.deepEqual(f.order,['preserve','remove']);assert.equal(f.removed,1);assert.equal([...f.storage.files.values()][0].events[0].data.text,'原始全文');
});
test('no previous session, current session, and live protected tasks are never removed',async()=>{
 for(const change of [{previousId:''},{previousId:'current'},{isProtected:()=>true}]){const f=retirement();assert.equal((await retireConversation({...f.options,...change})).status,'skipped');assert.equal(f.storage.files.size,0);assert.equal(f.removed,0);}
});
test('failed full-memory write, corrupt readback, incomplete export and a new active reference retain the old session',async()=>{
 for(const mode of ['write','readback','source','memory','race']){const f=retirement();
  if(mode==='write')f.options.storage={...f.storage,write:()=>{throw Error('disk full');}};
  if(mode==='readback')f.options.storage={...f.storage,read:key=>({...f.storage.read(key),events:[]})};
  if(mode==='source')f.options.readSession=async()=>({header:{id:'old'}});
  if(mode==='memory')f.options.preserveMessages=async()=>false;
  if(mode==='race')f.options.preserveMessages=async()=>{f.protect();return true;};
  if(mode==='race')assert.equal((await retireConversation(f.options)).status,'preserved');else await assert.rejects(retireConversation(f.options));assert.equal(f.removed,0,mode);
 }
});
test('ordinary chat does not need a separate paid media decision, while invitations and contextual acceptance still do',()=>{
 for(const text of ['今天有点忙','这个代码又出错了','谢谢你','刚才那个问题解决了'])assert.equal(mediaPreviewNeeded(text),false,text);
 assert(mediaPreviewNeeded('给我看看你今天的样子'));assert(mediaPreviewNeeded('好呀',[{role:'assistant',text:'要不要给你唱一小段？'}]));assert.equal(mediaPreviewNeeded('好呀',[{role:'assistant',text:'今天就早点休息吧'}]),false);
});
test('sleep plans never invoke paid execution, including when sleeping checks are switched off',async()=>{
 for(const sleep of [true,false]){let calls=0,saved;const meta={accountId:'a',personaId:'p'},engine=createLifeExecution({storage:{read:()=>saved,write:v=>saved=structuredClone(v)},config:()=>({execute:true,sleep,maxTasksPerDay:0}),roles:()=>[{meta}],sceneFor:()=>({date:'2026-11-15',start:'09:00',end:'11:00',taskKind:'sleep',activity:'睡觉'}),allowed:()=>true,dispatch:()=>{calls++;return 'session';},now:()=>clock});await engine.tick();await engine.tick();assert.equal(calls,0);assert(['sleeping','paused'].includes(engine.snapshot(meta).jobs[0].status));await engine.close();}
});
test('ordinary learning retains all sources, merges four queued jobs into one paid extraction and waits before another batch',async()=>{
 const storage=store(),meta={key:'private:12345',accountId:'a',personaId:'p'};let now=clock,calls=0,sourceCount=0;
 const learning=createLearningMemory({storage,passiveBatching:true,now:()=>now,config:()=>({enabled:true,passive:true}),allowed:()=>true,signature:()=> 'v',roles:()=>[],ask:async(_system,input)=>{calls++;sourceCount=JSON.parse(input).sources.length;return '{"items":[]}';},research:async()=>[]});
 learning.observe(meta,{id:'one',userWords:'今天聊了一段新的摄影话题'});assert.equal((await learning.process(meta)).skipped,'batching');assert.equal(calls,0);assert.equal(learning.snapshot(meta).pending.length,1);
 for(let i=2;i<=4;i++)learning.observe(meta,{id:'n'+i,userWords:'这是一段新的摄影交流话题'+i});
 await learning.process(meta);assert.equal(calls,1);assert.equal(sourceCount,4);assert.equal(learning.snapshot(meta).pending.length,0);
 learning.observe(meta,{id:'five',userWords:'现在又想到一种新的绘画方法'});assert.equal((await learning.process(meta)).skipped,'batching');assert.equal(calls,1);now+=5*60000;await learning.process(meta);assert.equal(calls,2);learning.close();
});
test('public group events reach the owner private chat immediately without a summarizer, preserving who said what',async()=>{
 const storage=store(),hub=createMemoryHub({storage,allowed:()=>true,now:()=>clock});const group={accountId:'a',key:'group:200000001',personaId:'p',personaVersion:'v'},owner={...group,key:'private:12345',isOwner:true};
 hub.record(group,{dir:'in',messageId:'g1',time:clock,speakerId:'54321',speakerName:'阿明',text:'阿明说新游戏的存档损坏了'});
 hub.record(group,{dir:'out',delivery:'sent',messageId:'g2',time:clock+1,text:'我只是看到了报错，还没修好存档'});
 const immediate=hub.continuity(owner,'刚刚群里发生了什么');assert.match(immediate,/阿明|存档/);assert.match(immediate,/还没修好/);
 const recalled=await hub.recall(owner,'群里的游戏存档',{expand:false});assert.match(recalled.text,/存档/);
 assert.equal(hub.continuity({...owner,isOwner:false},'群里的游戏存档').includes('阿明'),false);
 assert.equal(hub.continuity({...owner,accountId:'other'},'群里的游戏存档'),'');hub.close();
});
test('cross-place continuity never transfers another persona or private relationship details to a group',()=>{
 const storage=store(),hub=createMemoryHub({storage,allowed:()=>true,now:()=>clock}),privateMeta={accountId:'a',key:'private:12345',personaId:'p',personaVersion:'v'};
 hub.record(privateMeta,{dir:'in',messageId:'p1',time:clock,text:'我喜欢爸爸偷偷给我的私人礼物'});
 hub.record(privateMeta,{dir:'out',delivery:'sent',messageId:'p2',time:clock,text:'我刚读完一本绘画书'});
 const publicText=hub.continuity({...privateMeta,key:'group:200000001'},'绘画');assert.match(publicText,/绘画书/);assert(!publicText.includes('私人礼物'));assert.equal(hub.continuity({...privateMeta,key:'group:200000001',personaId:'other'},'绘画'),'');hub.close();
});
test('full originals are chunked, verified and searchable, and duplicate preservation does not request another analysis',()=>{
 const storage=store(),hub=createMemoryHub({storage,allowed:()=>true,now:()=>clock}),meta={accountId:'a',key:'private:12345',personaId:'p',personaVersion:'v'},text='原始长对话'.repeat(5500);
 assert(hub.preserve(meta,[{dir:'in',time:clock,messageId:'long',text}],'old'));const count=storage.files.size;assert(count>=3);assert(hub.preserve(meta,[{dir:'in',time:clock,messageId:'long',text}],'old'));assert.equal(storage.files.size,count);assert.equal(hub.snapshot(meta).pending,0);hub.close();
});
test('billing purpose follows the actual operation rather than unrelated words later in the prompt',()=>{
 assert.equal(modelPurpose('【表达形式判断】结合情绪和日程选择'),'选择文字或媒体表达');assert.equal(modelPurpose('【任务事实核对】核对日程；\n【个人记忆整理】保存来源'),'整理或检索记忆');assert.equal(modelPurpose('【一天一篇的私人日记】参考日程'),'撰写私人日记');assert.equal(modelPurpose('【对话记忆接续摘要】整理记忆'),'整理上下文接续摘要');
});
test('only the real current speaker can request their own private conversation in a group',async()=>{
 const storage=store(),hub=createMemoryHub({storage,allowed:()=>true,now:()=>clock}),meta={accountId:'a',key:'private:12345',personaId:'p',personaVersion:'v'};
 hub.record(meta,{dir:'in',time:clock,messageId:'self',text:'我刚才请你检查星际游戏的蓝色存档图标'});
 const group={...meta,key:'group:200000001',speakerId:'12345'};
 assert.equal((await hub.recall(group,'星际游戏存档',{expand:false})).text,'');
 assert.match((await hub.recall({...group,shareOwnPrivate:true},'星际游戏存档',{expand:false})).text,/蓝色存档/);
 assert.equal((await hub.recall({...group,shareOwnPrivate:true,speakerId:'54321'},'星际游戏存档',{expand:false})).text,'');hub.close();
});
test('actual host retirement uses verified saved mapping, full persistence and original-memory receipts before archiving',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');const a=source.indexOf('  async function cleanupPreviousConversation('),b=source.indexOf('  const contextHandoffs=',a),code=source.slice(a,b);
 const meta={key:'private:12345',accountId:'a',personaId:'p',personaVersion:'v'};
 const state={chats:{'private:12345':{sessionId:'current'}},lifeSessions:{},pendingSessionRetirements:[]},storage=store(),calls=[];let closed=false;
 state.pendingSessionRetirements.push({...meta,previousId:'old',at:1},...Array.from({length:3},(_,i)=>({...meta,previousId:'other-'+i,at:i+2})));
 const deps={stopped:false,accountPaused:false,personaContextIdentity:()=> 'v',settings:{activeAccountId:'a',memory:{enabled:true}},hubMeta:()=>({key:'private:12345',accountId:'a',personaId:'p',personaVersion:'v'}),state,chats:new Map(),cfg:{stateFile:'state',dataDir:'data'},readFileSync:file=>file==='state'?JSON.stringify(state):JSON.stringify(storage.read(file)),memoryHub:{preserve:()=>{calls.push('memory');return true;}},join:(...p)=>p.join('/'),ctx:{sessionController:{delete:async()=>assert.fail('auto-retirement must never delete a session')},get:name=>name==='sessionPersistence'?{open:async()=>({header:{id:'old'},read:async()=>({events:[{seq:0,type:'user/message'}]}),close:async()=>{closed=true;}})}:{archiveSession:async({sessionId})=>calls.push('archive:'+sessionId),unpinSession:async()=>calls.push('unpin')}},retireConversation,retainedConversationIds,writeAtomic:(f,v)=>storage.write(f,v),messages:[],saveState:()=>{},recordInvocation:()=>{},randomUUID:()=> 'id',invocationScope:()=>({})};
 const cleanup=Function(...Object.keys(deps),code+';return cleanupPreviousConversation;')(...Object.values(deps));
 assert.equal((await cleanup('old','current',{key:'private:12345'})).status,'retained');
 assert.deepEqual(calls,[]);
 assert.equal((await cleanup('newer','current',{key:'private:12345'})).status,'retained');
 const result=await cleanup('old','current',{key:'private:12345'});assert.equal(result.mode,'archived');assert.deepEqual(calls,['memory','archive:old','unpin']);assert(closed);assert.equal(state.chats['private:12345'].sessionId,'current');
 state.chats['private:12345'].sessionId='old';assert.equal((await cleanup('old','old',{key:'private:12345'})).status,'skipped');assert.equal(calls.length,3);
});

test('the current page and four most recent previous pages are retained independently per contact and persona',()=>{
 const scope={accountId:'a',personaId:'p',key:'private:12345'};
 const rows=[...Array.from({length:7},(_,i)=>({...scope,previousId:'page-'+i,at:i})),
  {...scope,previousId:'page-6',at:9},
  {...scope,accountId:'b',previousId:'other-account',at:10},
  {...scope,personaId:'q',previousId:'other-persona',at:11},
  {...scope,key:'group:12345',previousId:'other-chat',at:12}];
 assert.deepEqual([...retainedConversationIds(rows,scope,'current')],['current','page-6','page-5','page-4','page-3']);
});

test('the actual retention startup restores four verified archived pages without reviving older or unrelated sessions',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const a=source.indexOf('  const checkedConversationArchives='),b=source.indexOf('  let sessionRetirementBusy=',a);
 assert.ok(a>=0&&b>a);
 const scope={accountId:'a',personaId:'p',key:'private:12345',personaVersion:'v'};
 const state={chats:{[scope.key]:{sessionId:'page-6'}},sessionRetirements:[]},storage=store(),restored=[];
 for(let i=0;i<6;i++){
  const id='page-'+i,file='session-'+String(i).repeat(64)+'.json';
  state.sessionRetirements.push({previousId:id,currentId:'page-'+(i+1),at:i,mode:'archived',file});
  const payload={version:1,scope,sessionId:id,header:{id},events:[{type:'user/message',data:{text:'原始消息'}}]};
  storage.write('data/session-memory/'+file,{...payload,sha256:createHash('sha256').update(JSON.stringify(payload)).digest('hex')});
 }
 const ctx={get:()=>({unarchiveSession:async()=>{}})};
 const deps={state,ctx,hubMeta:()=>scope,retainedConversationIds,RETAINED_CONVERSATION_SESSIONS,precedingConversationSessions,verifiedConversationArchive,
  readFileSync:file=>JSON.stringify(storage.read(file)),cfg:{dataDir:'data'},join:(...parts)=>parts.join('/'),
  stopped:false,accountPaused:false,settings:{activeAccountId:'a'},personaContextIdentity:()=> 'v',recordsAllowed:()=>true,
  keepSessionAlive:async (id,options)=>{assert.equal(options.restoreArchived,true);restored.push(id);},saveState:()=>{}};
 const restore=Function(...Object.keys(deps),source.slice(a,b)+';return restoreRecentConversationPages;')(...Object.values(deps));
 await restore(scope.key,'page-6');
 await restore(scope.key,'page-6');
 assert.deepEqual(restored,['page-5','page-4','page-3','page-2']);
 assert.equal(retainedConversationIds(state.pendingSessionRetirements,scope,'page-6').size,5);
 const copy=storage.read('data/session-memory/session-'+'5'.repeat(64)+'.json');
 assert(!verifiedConversationArchive(copy,{...scope,personaId:'other'},'page-5'));
 copy.events[0].data.text='altered';
 assert(!verifiedConversationArchive(copy,scope,'page-5'));
});
