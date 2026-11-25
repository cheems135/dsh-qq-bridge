import test from 'node:test';
import assert from 'node:assert/strict';
import {createPluginMemoryStorage,libraryFile,PLUGIN_MEMORY_OWNER} from '../plugin-memory-library.js';
import {createMemoryHub} from '../memory-hub.js';
import {createLifeMemory} from '../life-memory.js';
import {createLearningMemory} from '../learning-memory.js';
import {createPersonaGrowth} from '../persona-growth.js';

const meta={accountId:'old',kind:'chat',key:'private:12345',personaId:'p',personaVersion:'old-v1'};
function fixture(kind){
 const files=new Map();let account='old';
 const storage={list:()=>[...files.keys()],read:f=>{if(!files.has(f))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(f));},write:(f,v)=>files.set(f,structuredClone(v))};
 const options={storage,location:()=>'/memory/'+kind,activeAccount:()=>account,
  personaVersion:(_m,v,dest)=>['old-v1','new-v1',PLUGIN_MEMORY_OWNER+'-v1'].includes(v)?dest+'-v1':v};
 const make=()=>createPluginMemoryStorage(kind,options);
 return {files,storage,make,switch:v=>account=v};
}
for(const kind of ['calendar','learning','growth'])test(kind+' legacy documents become one plugin-owned document across account switches',()=>{
 const f=fixture(kind),old=libraryFile(kind,meta),other=libraryFile(kind,{...meta,accountId:'second'});
 f.storage.write(old,{version:1,meta,items:[{id:'old',at:10,text:'earlier'}]});
 f.storage.write(other,{version:1,meta:{...meta,accountId:'second'},items:[{id:'other',at:20,text:'later'}]});
 const original=structuredClone(f.files);
 f.switch('new');const store=f.make(),current={...meta,accountId:'new'},name=libraryFile(kind,current);
 store.prepare(current);const doc=store.read(name);assert.equal(doc.meta.accountId,'new');
 assert.deepEqual(doc.items.map(i=>i.id),['old','other']);doc.items.push({id:'new',at:30});store.write(name,doc);
 assert(f.files.has(libraryFile(kind,current,PLUGIN_MEMORY_OWNER)));
 assert.deepEqual(f.files.get(old),original.get(old));assert.deepEqual(f.files.get(other),original.get(other));
 f.switch('third');const next=f.make(),latest={...current,accountId:'third'};next.prepare(latest);
 assert.deepEqual(next.read(libraryFile(kind,latest)).items.map(i=>i.id),['old','other','new']);
 assert.throws(()=>next.write(name,doc),/范围已改变/);
 const separate={...latest,personaId:'other'};next.prepare(separate);assert.throws(()=>next.read(libraryFile(kind,separate)),/does not exist/);
 const contact={...latest,key:'private:67890'};next.prepare(contact);assert.throws(()=>next.read(libraryFile(kind,contact)),/does not exist/);
 next.remove(libraryFile(kind,latest));f.switch('fourth');assert(!f.make().list().includes(libraryFile(kind,{...latest,accountId:'fourth'})));
});

test('actual memory hub preserves original speaker and account provenance while QQ identity changes',()=>{
 const f=fixture('hub');let time=100;
 const options={allowed:()=>true,now:()=>time,ask:()=>assert.fail('no model call required')};
 const old=createMemoryHub({...options,storage:f.storage});old.record(meta,{id:'before',text:'以前教过的蓝鲸',at:time,speakerId:'12345'});old.close();
 const original=structuredClone(f.files);f.switch('new');
 const current={...meta,accountId:'new',personaVersion:'new-v1'};
 const storage=f.make(),hub=createMemoryHub({...options,storage});
 assert.deepEqual(hub.recent(current).map(r=>r.text),['以前教过的蓝鲸']);
 const row=storage.read(storage.list().find(n=>n.startsWith('source-')));assert.equal(row.speakerId,'12345');assert.equal(row.sourceAccountId,'old');
 assert.deepEqual(hub.recent({...current,personaId:'different'}),[]);
 assert.deepEqual(hub.recent({...current,key:'private:67890'}),[]);
 time=200;hub.record(current,{id:'after',text:'换号后继续聊',at:time,speakerId:'12345'});hub.close();
 f.switch('third');const latest={...current,accountId:'third',personaVersion:'third-v1'};
 const next=createMemoryHub({...options,storage:f.make()});
 assert.deepEqual(next.recent(latest).map(r=>r.text),['以前教过的蓝鲸','换号后继续聊']);
 for(const [name,value]of original)assert.deepEqual(f.files.get(name),value,'legacy originals are never rewritten');
 time=300;next.clear(latest);time=400;next.record(latest,{id:'post-reset',text:'清除后新的话',at:time});next.close();
 const restarted=createMemoryHub({...options,storage:f.make()});
 assert.deepEqual(restarted.recent(latest).map(r=>r.text),['清除后新的话']);restarted.close();
});

test('a corrupt canonical document cannot silently resurrect legacy memory',()=>{
 const f=fixture('learning');f.storage.write(libraryFile('learning',meta),{meta,items:[{id:'old'}]});
 const canonical=libraryFile('learning',meta,PLUGIN_MEMORY_OWNER);
 const store=createPluginMemoryStorage('learning',{storage:{...f.storage,read:name=>{if(name===canonical)throw Error('corrupt');return f.storage.read(name);}},location:()=>'/memory',activeAccount:()=>meta.accountId});
 f.files.set(canonical,{});
 assert.throws(()=>store.read(libraryFile('learning',meta)),/corrupt/);
});

test('calendar engine reads and appends legacy dialogue after an account switch',()=>{
 const f=fixture('calendar'),now=()=>Date.parse('2026-11-25T10:00:00+08:00');
 const make=storage=>createLifeMemory({storage,now,allowed:()=>true,config:()=>({life:{enabled:true},memory:{enabled:true,schedule:'daily'}}),roles:()=>[],signature:()=>'',ask:()=>assert.fail('no model call')});
 const old=make(f.storage);old.record(meta,{dir:'in',time:now(),userText:'以前聊过的画册',messageId:'one'});old.close();
 f.switch('new');const current={...meta,accountId:'new'},next=make(f.make());
 assert.equal(next.snapshot(current).pendingDays[0].rows,1);
 next.record(current,{dir:'in',time:now()+1,userText:'继续聊那本画册',messageId:'two'});next.close();
 f.switch('third');const last=make(f.make());assert.equal(last.snapshot({...meta,accountId:'third'}).pendingDays[0].rows,2);last.close();
});

test('learning engine retains pending knowledge and accepts new input after switching accounts',()=>{
 const f=fixture('learning'),options={allowed:()=>true,config:()=>({enabled:true,passive:true}),roles:()=>[],signature:()=>'',ask:()=>assert.fail('no model call'),research:async()=>[]};
 const old=createLearningMemory({...options,storage:f.storage});old.observe(meta,{id:'one',userWords:'讲解时先说具体原因。'});old.close();
 f.switch('new');const current={...meta,accountId:'new'},next=createLearningMemory({...options,storage:f.make()});
 assert.equal(next.snapshot(current).pending.length,1);next.observe(current,{id:'two',userWords:'再给一个具体的例子。'});next.close();
 f.switch('third');const last=createLearningMemory({...options,storage:f.make()});assert.equal(last.snapshot({...meta,accountId:'third'}).pending.length,2);last.close();
});

test('persona growth engine retains its queued day after switching accounts',()=>{
 const f=fixture('growth'),options={allowed:()=>true,now:()=>Date.parse('2026-11-25T10:00:00+08:00'),config:()=>({enabled:true,daily:true,dailyMinUser:1}),sources:()=>[],signature:()=>'',basePersona:()=>'',ask:()=>assert.fail('no model call')};
 const old=createPersonaGrowth({...options,storage:f.storage});
 assert(old.observe(meta,{id:'day-1',level:'day',start:'2026-11-24',end:'2026-11-24',events:[{text:'和朋友聊过画册'}],stats:{user:3}}));old.close();
 f.switch('new');const next=createPersonaGrowth({...options,storage:f.make()}),current={...meta,accountId:'new'};
 assert.equal(next.observe(current,{id:'day-1',level:'day',start:'2026-11-24',end:'2026-11-24',events:[{text:'和朋友聊过画册'}],stats:{user:3}}),false,'the old queued day is already known');
 next.close();
});
