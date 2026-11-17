import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createMemoryHub,hubScope} from '../memory-hub.js';
const meta={accountId:'test',key:'private:12345',personaId:'p',personaVersion:'v'};
function fixture(){let clock=Date.parse('2026-11-07T12:00:00+08:00'),finish,fail,submitted;const entered=new Promise(r=>submitted=r),answer=new Promise((r,j)=>{finish=r;fail=j;});const files=new Map(),storage={list:()=>[...files.keys()],read:f=>{if(!files.has(f))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(f));},write:(f,v)=>files.set(f,structuredClone(v))};const options={storage,allowed:()=>true,now:()=>clock,ask:async(_system,input)=>{submitted(JSON.parse(input));return answer;}};const hub=createMemoryHub(options);hub.record(meta,{id:'old',text:'今天画了一只蓝鲸',at:clock});return {hub,files,options,entered,finish,fail,setNow:n=>clock=n,doc:hubScope(meta)+'.json'};}
test('P1 B03 actual sync reload retains imported clear and suppressions after new records',async()=>{
 const f=fixture(),peer=createMemoryHub(f.options);try{
  f.setNow(Date.parse('2026-11-08T12:00:00+08:00'));peer.clear(meta);const expected=f.files.get(f.doc).cutoff;
  const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('    reload:async()=>{',source.indexOf('deviceSync=createDeviceSync(')),end=source.indexOf('\n    credential:',start),code=source.slice(start,end).trim().replace(/^reload:/,'').replace(/,$/,'');
  const c={profilesReloading:false,loadSettings:()=>({toggles:{},accounts:[]}),settings:{},saveSettings:()=>{},usage:{},loadUsage:()=>({}),stickerNotes:{},loadStickerNotes:()=>({}),personaImages:{},personaImageManifest:'fixture',readFileSync:()=> '{}',cfg:{},defaults:{},wallet:null,messages:[],messagesFile:'fixture',existsSync:()=>false,state:{},loadState:()=>({}),log:()=>{},chats:new Map(),panelChats:new Map(),saveState:()=>{},featureState:{},featureFile:'fixture',saveFeatures:()=>{},lifeMemory:null,learningMemory:null,websiteReader:null,personaGrowth:null,configuredModels:new Map(),deviceProfiles:null,memoryHub:f.hub};vm.createContext(c);await vm.runInContext('('+code+')()',c);
  assert.deepEqual(f.hub.recent(meta),[]);f.setNow(expected+1000);f.hub.record(meta,{id:'new',text:'同步后的新消息'});assert.equal(f.files.get(f.doc).cutoff,expected);assert.deepEqual(f.hub.recent(meta).map(r=>r.text),['同步后的新消息']);
 }finally{f.hub.close();peer.close();}
});
for(const rejection of [false,true])test('P1 B03 in-flight maintenance '+(rejection?'error':'success')+' cannot overwrite same-boundary synced state',async()=>{
 const f=fixture();try{
  const running=f.hub.maintain(meta,{force:true});const input=await f.entered;
  const imported=f.files.get(f.doc);imported.sourceVersion=777;imported.maintenance={state:'imported'};f.files.set(f.doc,structuredClone(imported));f.hub.reload();
  if(rejection)f.fail(Error('fixture model failure after reload'));else f.finish(JSON.stringify({reflection:{text:'真实的反思',sourceIds:[input.sources[0].id]}}));
  assert.equal((await running).stale,true);assert.deepEqual(f.files.get(f.doc),imported);assert.equal(f.hub.snapshot(meta).maintenance.state,'imported');
 }finally{f.hub.close();}
});
test('P1 B03 in-flight daily journal cannot replace imported state after reload',async()=>{
 const f=fixture();try{f.setNow(Date.parse('2026-11-08T12:00:00+08:00'));const running=f.hub.writeDailyJournal(meta,{force:true});const input=await f.entered;const imported=f.files.get(f.doc);imported.sourceVersion=777;f.files.set(f.doc,structuredClone(imported));f.hub.reload();f.finish(JSON.stringify({title:'小记',text:'今天画了一只蓝色的鲸鱼，留下一点小小的快乐。',sourceIds:[input.sources[0].id]}));assert.equal((await running).stale,true);assert.deepEqual(f.files.get(f.doc),imported);}finally{f.hub.close();}
});
test('P1 B03 in-flight retrieval cannot overwrite synced state after reload',async()=>{
 const f=fixture();try{const running=f.hub.recall(meta,'还记得 unicorn 绘画经历吗',{expand:true});await f.entered;const imported=f.files.get(f.doc);imported.sourceVersion=777;f.files.set(f.doc,structuredClone(imported));f.hub.reload();f.finish('{"queries":["蓝鲸"]}');assert.equal((await running).stale,true);assert.deepEqual(f.files.get(f.doc),imported);}finally{f.hub.close();}
});
test('P1 B03 reloaded source catalog discovers new records without leaking another persona',()=>{
 const f=fixture(),peer=createMemoryHub(f.options);try{peer.record(meta,{id:'synced',text:'另一端的实际记录'});peer.record({...meta,personaId:'other'},{id:'other',text:'另一人设的内容'});assert.equal(f.hub.recent(meta).length,1);f.hub.reload();assert.deepEqual(f.hub.recent(meta).map(r=>r.text).sort(),['今天画了一只蓝鲸','另一端的实际记录'].sort());}finally{f.hub.close();peer.close();}
});
