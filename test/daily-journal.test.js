import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryHub} from '../memory-hub.js';
import {diaryToday,validDiaryDay,selectDiarySources} from '../daily-journal.js';

const meta=(key='private:12345',extra={})=>({accountId:'a',key,personaId:'p',personaVersion:'v1',personaName:'角色',...extra});
function fixture(){
 let clock=Date.parse('2026-11-04T12:00:00+08:00'),release=null,bad=false,personaStamp='same';
 const files=new Map(),calls=[];
 const storage={list:()=>[...files.keys()],read:f=>{if(!files.has(f))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(f));},write:(f,v)=>files.set(f,structuredClone(v))};
 const options={storage,now:()=>clock,allowed:()=>true,signature:()=>personaStamp,persona:()=> '嘴上有点别扭，关心人时不直说',ask:async(system,input)=>{
  const data=JSON.parse(input);calls.push({system,data});
  if(!system.includes('一天一篇的私人日记'))return JSON.stringify({reflection:{text:'',sourceIds:[]}});
  if(release)await release;
  return JSON.stringify({title:'那句话还记着',text:'聊到那句小玩笑时，我还是没忍住。\n\n嘴上不想承认，回头想想，今天最想留下的偏偏是这件小事。',sourceIds:bad?['invented']:data.sources.slice(0,2).map(s=>s.id),doodle:'none',kaomoji:''});
 }};
 const hub=createMemoryHub(options);
 return {hub,options,calls,files,setNow:v=>clock=Date.parse(v),setBad:v=>bad=v,setPause:p=>release=p,setStamp:v=>personaStamp=v,record:(m=meta(),text='今天聊了种花时发生的小事',at=clock)=>hub.record(m,{id:String(at)+m.personaId+text,at,role:'user',text,actual:true})};
}

test('diary dates use Shanghai midnight regardless of the process time zone',()=>{
 assert.equal(diaryToday(Date.parse('2026-11-04T16:00:00Z')),'2026-11-05');
 assert.equal(diaryToday(Date.parse('2026-11-04T15:59:59Z')),'2026-11-04');
 assert.equal(validDiaryDay('2026-02-30'),false);assert.equal(validDiaryDay('2026-11-04'),true);
});

test('today is collected without writing, including manual force and the retired rewrite action',async()=>{
 const f=fixture();try{f.record();assert.equal((await f.hub.writeDailyJournal(meta(),{day:'2026-11-04',force:true})).waiting,true);await f.hub.compactJournal(meta(),'2026-11-04');assert.equal(f.calls.length,0);assert.equal(f.hub.journals(meta(),{localOwner:true}).days.length,0);}finally{f.hub.close();}
});

test('one completed-day entry is durable across reload, other conversations, late sources and persona version changes',async()=>{
 const f=fixture();try{
  f.record();f.record(meta('group:67890'),'群里聊到一件好笑的小事');f.setNow('2026-11-05T00:01:00+08:00');
  assert.equal((await f.hub.writeDailyJournal(meta())).changed,1);
  const first=f.hub.journals(meta(),{localOwner:true}).days[0];assert.equal(first.day,'2026-11-04');assert.equal(first.finalized,true);assert.match(first.text,/\n\n/);
  await f.hub.writeDailyJournal(meta('group:67890'),{day:'2026-11-04',force:true});
  f.record(meta(),'补到的晚些时候的原话',Date.parse('2026-11-04T23:40:00+08:00'));
  await f.hub.compactJournal(meta(),'2026-11-04');
  await f.hub.writeDailyJournal(meta('private:12345',{personaVersion:'v2'}),{day:'2026-11-04'});
  const reloaded=createMemoryHub(f.options);try{await reloaded.writeDailyJournal(meta(),{day:'2026-11-04',force:true});assert.equal(reloaded.journals(meta(),{localOwner:true}).days[0].text,first.text);}finally{reloaded.close();}
  assert.equal(f.calls.filter(c=>c.system.includes('一天一篇')).length,1);
 }finally{f.hub.close();}
});

test('concurrent requests cannot write the same day twice',async()=>{
 const f=fixture();let release;try{f.record();f.setNow('2026-11-05T01:00:00+08:00');f.setPause(new Promise(r=>release=r));const first=f.hub.writeDailyJournal(meta());const second=await f.hub.writeDailyJournal(meta());assert.equal(second.busy,true);release();await first;assert.equal(f.calls.length,1);}finally{release?.();f.hub.close();}
});

test('daily writing keeps accounts and separate personas isolated',async()=>{
 const f=fixture();try{const a=meta(),b=meta('private:12345',{accountId:'b'}),c=meta('private:12345',{personaId:'other'});f.record(a);f.record(b);f.record(c);f.setNow('2026-11-05T02:00:00+08:00');for(const m of [a,b,c])assert.equal((await f.hub.writeDailyJournal(m)).changed,1);assert.equal(f.calls.length,3);for(const m of [a,b,c])assert.equal(f.hub.journals(m,{localOwner:true}).days.length,1);}finally{f.hub.close();}
});

test('background diary runs after memory batches are already processed',async()=>{
 const f=fixture();try{f.record();await f.hub.maintain(meta(),{force:true});assert.equal(f.hub.snapshot(meta()).pending,0);f.setNow('2026-11-05T00:20:00+08:00');await f.hub.tick([meta()],{force:true});assert.equal(f.hub.journals(meta(),{localOwner:true}).days.length,1);await f.hub.tick([meta()],{force:true});assert.equal(f.calls.filter(c=>c.system.includes('一天一篇')).length,1);}finally{f.hub.close();}
});

test('invalid citations do not publish a fake diary and automatic failures have a cooldown',async()=>{
 const f=fixture();try{f.record();f.setNow('2026-11-05T00:10:00+08:00');f.setBad(true);await assert.rejects(f.hub.writeDailyJournal(meta()),/有效来源/);assert.equal(f.hub.journals(meta(),{localOwner:true}).days.length,0);assert.equal((await f.hub.writeDailyJournal(meta())).deferred,true);assert.equal(f.calls.length,1);f.setBad(false);assert.equal((await f.hub.writeDailyJournal(meta(),{force:true})).changed,1);}finally{f.hub.close();}
});

test('mode or persona changes while writing cannot save an obsolete diary',async()=>{
 const f=fixture();let release;try{f.record();f.setNow('2026-11-05T00:10:00+08:00');f.setPause(new Promise(r=>release=r));const pending=f.hub.writeDailyJournal(meta());f.setStamp('changed');release();assert.equal((await pending).stale,true);assert.equal(f.hub.journals(meta(),{localOwner:true}).days.length,0);}finally{release?.();f.hub.close();}
});

test('forgotten sources hide the associated diary without regenerating it or exposing it remotely',async()=>{
 const f=fixture();try{f.record();f.setNow('2026-11-05T00:10:00+08:00');await f.hub.writeDailyJournal(meta());assert.throws(()=>f.hub.journals(meta()),/仅限号主/);const diary=f.hub.journals(meta(),{localOwner:true}).days[0];f.hub.forget(meta(),diary.sourceIds[0]);assert.equal(f.hub.journals(meta(),{localOwner:true}).days.length,0);assert.equal((await f.hub.writeDailyJournal(meta(),{day:'2026-11-04',force:true})).alreadyWritten,true);assert.equal(f.calls.length,1);}finally{f.hub.close();}
});

test('bounded evidence covers early and late events with real action status and no changed originals',()=>{
 const rows=Array.from({length:200},(_,i)=>({id:String(i),at:Date.parse('2026-11-04T00:00:00+08:00')+i*60000,text:'真实原话'.repeat(100),role:'user',actual:i===199,status:i===199?'failed':''}));
 const before=JSON.stringify(rows),sources=selectDiarySources(rows);assert.equal(sources[0].sourceId,'0');assert.equal(sources.at(-1).sourceId,'199');assert.equal(sources.at(-1).status,'failed');assert.ok(sources.reduce((n,r)=>n+r.text.length,0)<=3600);assert.equal(JSON.stringify(rows),before);
});
