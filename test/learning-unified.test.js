import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';
import {createLearningMemory,groundedLearning} from '../learning-memory.js';
import {groupMemoryScopes} from '../ui/memory-library.js';
import {createExpressionLearning} from '../expression-learning.js';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function fixture(){let now=Date.parse('2026-11-25T22:00:00+08:00');const files=new Map(),meta={accountId:'a',key:'private:12345',personaId:'new'},old={...meta,personaId:'old'};
 const put=(m,items)=>files.set(hash([m.accountId,m.key,m.personaId])+'.json',{version:1,meta:m,items,queue:[],seen:[],suppressed:[],topics:[],applications:[],status:null,log:[],epoch:'initial'});
 const item=(id,summary,extra={})=>({id,kind:'meme',summary,when:'相关话题',avoid:'不要混淆字面含义',quote:'来源原句',source:{type:'web',id,url:'https://example.com/'+id,title:'实际读取的资料',at:now-86400000},at:now-86400000,expiresAt:now+86400000,used:0,...extra});
 const store={list:()=>[...files.keys()],read:n=>{if(!files.has(n))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(n));},write:(n,v)=>files.set(n,structuredClone(v))};
 const service=createLearningMemory({storage:store,now:()=>now,allowed:m=>m.accountId==='a',config:()=>({enabled:true}),signature:()=> 'one',roles:()=>[],ask:()=>assert.fail('retrieval must not call a model')});return {service,put,item,meta,old,files};}
test('a concept named in ordinary chat recalls its known meaning across persona changes, even after review date and history resets',()=>{
 const f=fixture();f.put(f.old,[f.item('soup','“丝瓜汤”式表达：借养生关心回避实际情绪冲突。',{expiresAt:1})]);
 const r=f.service.recall(f.meta,'丝瓜汤',{after:Date.now(),continuity:false,maxChars:500});assert.match(r.text,/情绪冲突/);assert.match(r.text,/旧资料待复核/);assert.equal(r.ids.length,1);assert(r.text.length<=500);f.service.close();
});
test('already-read public group knowledge is available to a private conversation without importing group private quotes',()=>{
 const f=fixture();f.put({...f.old,key:'group:54321'},[f.item('camera','“古早监控”指把经典典故做成带时间戳的监控视角视频。')]);
 const r=f.service.recall(f.meta,'那古早监控呢');assert.match(r.text,/经典典故/);assert.doesNotMatch(r.text,/来源原句/);assert.equal(r.sources[0].shared,true);f.service.close();
});
test('private facts and unrelated generic knowledge do not leak across conversations or accounts',()=>{
 const f=fixture();f.put({...f.old,key:'private:67890'},[f.item('secret','某人的私事',{kind:'social',portable:false,source:{type:'dialogue',at:1}})]);f.put({...f.old,accountId:'other'},[f.item('other','“古早监控”是另一账号里的记录')]);
 assert.equal(f.service.recall(f.meta,'某人的私事').text,'');assert.equal(f.service.recall(f.meta,'古早监控').text,'');assert.equal(f.service.recall(f.meta,'你好呀').text,'');f.service.close();
});
test('deleting a learned item works across historical personas and a bad-feedback suspension is never bypassed by an exact name',()=>{
 const f=fixture();f.put(f.old,[f.item('one','“蓝杯法”是某个概念'),f.item('bad','“坏例法”是被停用的经验',{effects:{suspended:true}})]);
 assert.match(f.service.recall(f.meta,'蓝杯法').text,/蓝杯法/);f.service.edit(f.meta,{action:'delete',id:'one'});assert.equal(f.service.recall(f.meta,'蓝杯法').text,'');assert.equal(f.service.recall(f.meta,'坏例法').text,'');f.service.close();
});
test('calendar and learning management group source conversations, preserving original per-record ownership and files',()=>{
 const scopes=[{meta:{kind:'chat',key:'private:12345',personaId:'old'},days:[{id:'one',start:'2026-11-24'}],items:[{id:'lesson',kind:'knowledge',summary:'同一知识'}]},{meta:{kind:'chat',key:'private:12345',personaId:'new'},days:[{id:'two',start:'2026-11-25'}],items:[{id:'lesson',kind:'knowledge',summary:'同一知识'}]},{meta:{kind:'life',key:'',personaId:'old'}}],before=structuredClone(scopes),groups=groupMemoryScopes(scopes);
 assert.equal(groups.length,2);assert.equal(groups[0].members.length,2);assert.equal(groups[0].days.length,2);assert.equal(groups[0].items.length,1);assert.deepEqual(scopes,before);assert.equal(groups[0].meta.personaId,'');
});
test('new learned concept names and aliases must actually occur in their evidence',()=>{
 const source={id:'s1',type:'web',title:'资料',text:'蓝杯法又叫杯沿法，观察杯沿。',at:100};
 const r=groundedLearning([{kind:'knowledge',name:'蓝杯法',aliases:['杯沿法','编造别名'],summary:'蓝杯法观察杯沿',when:'观察杯沿时',avoid:'不能脱离资料泛化',quote:'观察杯沿',sourceId:'s1',confidence:.99}],[source],100);
 assert.equal(r.items[0].name,'蓝杯法');assert.deepEqual(r.items[0].aliases,['杯沿法']);
});
test('ordinary host input includes learned facts before selecting context topics, without a special learning keyword',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  async function prepareCalendarContext('),end=source.indexOf('\n  function calendarSnapshot',start),calls=[];
 const deps={currentRuntimeFacts:async()=>'',syncConversationState(){},learningMemory:{recall:(m,q)=>{calls.push(q);return {text:'这是已学过的具体含义',ids:['known'],sources:[{id:'known',scope:'old'}]};}},learningMeta:key=>({key}),settings:{memory:{maxChars:500}},contextTopicsFor:()=>[],operationContext:()=>[],expressionLearning:null};
 const run=Function(...Object.keys(deps),source.slice(start,end)+';return prepareCalendarContext;')(...Object.values(deps));
 const content=[];await run({key:'private:12345'},{},content,'只说概念名称');assert.equal(calls.length,1);assert.match(content[0].text,/具体含义/);assert.deepEqual(content.learningIds,['known']);
});
test('a review of yesterday uses the actual learning date, without inventing an answer or mixing in today',()=>{
 const f=fixture();f.put(f.old,[f.item('yesterday','已学的具体知识：古早监控用时间戳制造时空错位'),f.item('today','今天刚学的陶杯知识',{at:Date.parse('2026-11-25T21:00:00+08:00')})]);
 const r=f.service.recall(f.meta,'昨天学了什么',{intent:'review'});assert.match(r.text,/古早监控/);assert.match(r.text,/2026-11-24/);assert.doesNotMatch(r.text,/今天刚学/);f.service.close();
});
test('explicit picture meanings follow the plugin across personas, including legacy records, without crossing contacts',()=>{
 let disk;const storage={read:()=>disk&&structuredClone(disk),write:v=>{disk=structuredClone(v);}},old={accountId:'old',personaId:'old-persona',key:'private:12345'},image={type:'image',data:{md5:'a'.repeat(32)}};
 const first=createExpressionLearning({storage,allowed:()=>true,allowSticker:()=>true});assert(first.rememberStickerMeaning(old,image,'认栽',{messageId:'one',at:10}));
 const next=createExpressionLearning({storage,allowed:()=>true,allowSticker:()=>true,sharedPersonas:true,memoryAccounts:()=>['old','new'],memoryPersonas:()=>['old-persona','new-persona']});
 assert.equal(next.stickerMeaning({...old,accountId:'new',personaId:'new-persona'},image),'认栽');assert.equal(next.stickerMeaning({...old,key:'private:67890'},image),'');
 assert(next.rememberStickerMeaning({...old,personaId:'new-persona'},image,'服气',{messageId:'two',at:20}));assert.equal(next.stickerMeaning({...old,personaId:'third-persona'},image),'服气');
});
test('the merged learning page processes pending source queues rather than only the current persona queue',async()=>{
 const source=readFileSync(new URL('../ui/console-controller.js',import.meta.url),'utf8'),start=source.indexOf('    async function act(action,button,id)'),end=source.indexOf("    [['learnNow'",start),requests=[];
 const deps={learningChat:'private:12345',featureData:{learning:{scopes:[{meta:{key:'private:12345',personaId:'old'},pending:[{id:'one'}]},{meta:{key:'private:12345',personaId:'new'},pending:[{id:'two'}]},{meta:{key:'private:67890',personaId:'other'},pending:[{id:'private'}]}]}},api:async(_m,_p,b)=>{requests.push(b);return {result:{reason:'done'}};},load:async()=>{},toast(){},askConfirm:async()=>true};
 assert(start>=0&&end>start);const run=Function(...Object.keys(deps),source.slice(start,end)+';return act;')(...Object.values(deps));await run('process',{isConnected:true},'');assert.deepEqual(requests.map(r=>r.personaId),['old','new']);assert(requests.every(r=>r.key==='private:12345'));
});
test('cross-persona recall, actual delivery and feedback remain connected to the original learned record',()=>{
 const f=fixture();f.put(f.old,[f.item('old-lesson','“蓝杯法”是已学过的具体知识')]);
 for(let n=0;n<3;n++){
  const recalled=f.service.recall(f.meta,'蓝杯法');assert.equal(f.service.recordUsage(f.meta,{auditId:'turn-'+n,sources:recalled.sources}),true);
  assert.equal(f.service.recordOutcome(f.meta,{auditId:'turn-'+n,status:'delivered',reply:'用错的具体回复',messageIds:['message-'+n]}),true);
  assert.equal(f.service.feedback(f.meta,{id:'turn-'+n,rating:-1,note:'这个理解不对'}).changed,1);
 }
 assert.equal(f.service.snapshot(f.old).items[0].effects.negative,3);assert.equal(f.service.recall(f.meta,'蓝杯法').text,'');f.service.close();
});
