import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createMessageHistory,historyCursor,messageKey,readRecentIndex,writeRecentIndex} from '../message-history.js';
import {openBridgeStorage,storageUsage,transferableStorageKey} from '../bridge-storage.js';
import {saveCheckpoint,verifySyncCheckpoint,rotateSyncCheckpoints} from '../backup-retention.js';
import {mergeSyncJson} from '../sync-union.js';
import {cleanManagedMedia} from '../managed-media.js';

const plain = path => JSON.parse(fs.readFileSync(path,'utf8'));
const temp = t => { const dir=fs.mkdtempSync(join(tmpdir(),'qq-storage-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; };
const write=(file,bytes)=>{fs.mkdirSync(join(file,'..'),{recursive:true});fs.writeFileSync(file,bytes);};
const user='private:10000001',group='group:10000002',base=Date.UTC(2026,1,28,23,59,59);
const rows=Array.from({length:722},(_,i)=>({accountId:'a',chat:i%5===0?group:user,time:base+Math.floor(i/3)*1000,dir:'in',messageId:String(i+1),text:'对话 '+i}));

test('archive survives index eviction, filters accounts and conversations, and pages through equal timestamps',t=>{
  const root=temp(t),store=createMessageHistory(()=>root);
  store.putMany([...rows,{...rows[0],accountId:'b',text:'其他账号'}]);
  const all=()=>store.exportRows(()=>true,'a');
  assert.equal(all().length,722);
  store.putMany(rows);assert.equal(all().length,722);
  let before='',got=[];
  do{const result=store.page({account:'a',allowed:()=>true,before,limit:73});before=result.next;got.push(...result.rows);}while(before);
  assert.equal(new Set(got.map(messageKey)).size,722);assert.equal(got.length,722);
  assert.equal(got[0].time,rows.at(-1).time);assert.equal(got.at(-1).time,rows[0].time);
  assert.deepEqual(store.chats('a').sort(),[user,group].sort());
  assert.ok(store.page({account:'a',allowed:k=>k===user,limit:700}).rows.every(r=>r.chat===user));
  assert.equal(store.page({account:'b',allowed:()=>true}).rows[0].text,'其他账号');
  assert.throws(()=>store.page({account:'a',allowed:()=>true,before:'../../bad'}),/分页/);
  const recent=got.slice(0,600);writeRecentIndex(join(root,'recent.json'),recent);
  assert.equal(store.page({account:'a',allowed:()=>true,before:historyCursor(recent.at(-1))}).rows.length,100);
});

test('archive updates receipts, remembers withdrawn images, preserves identical legacy occurrences and supports explicit local clear',t=>{
  const root=temp(t),store=createMessageHistory(()=>root);
  const old={time:base,dir:'in',accountId:'a',chat:user,text:'同一毫秒'};
  const copy=()=>[{...old},{...old}];
  store.putMany(copy());store.putMany(copy());
  const row={...old,localId:'receipt',dir:'out',delivery:'queued',file:'img.png'};
  store.putMany([row]);store.putMany([{...row,messageId:'777',delivery:'sent'}]);
  assert.equal(store.exportRows(()=>true,'a').length,3);
  assert.equal(store.findImage('a',user,base,messageKey(row)).delivery,'sent');
  assert.equal(store.findImage('b',user,base,messageKey(row)),null);
  store.recall('a',user,'777');store.putMany([row]);
  assert.equal(store.findImage('a',user,base,messageKey(row)),undefined);
  store.putMany([{...row,accountId:'b'}]);
  const rollback=store.putMany([{...old,messageId:'rollback'}],{transactional:true});rollback();
  assert.equal(store.exportRows(()=>true,'a').length,3);
  store.clear('a');assert.deepEqual(store.chats('a'),[]);assert.equal(store.exportRows(()=>true,'a').length,0);assert.equal(store.exportRows(()=>true,'b').length,1);
});

test('unreadable and corrupt recent indexes are distinguishable and exact corrupt bytes survive repair',t=>{
  const root=temp(t),file=join(root,'messages.json');
  assert.equal(readRecentIndex(file).missing,true);
  write(file,'[truncated');
  const result=readRecentIndex(file);assert.equal(result.damaged,true);assert.equal(fs.readFileSync(result.preserved,'utf8'),'[truncated');
  writeRecentIndex(file,rows.slice(0,3));assert.equal(readRecentIndex(file).rows.length,3);
  assert.equal(fs.readFileSync(result.preserved,'utf8'),'[truncated');
  assert.throws(()=>readRecentIndex(root));
});

function fixture(t){
  const root=temp(t),data=join(root,'host','im-bridge'),cache=join(root,'user-cache'),memory=join(root,'user-memory'),workspace=join(root,'host','im-bridge-chats');
  const cfg={dataDir:data,stateFile:join(data,'state.json'),logFile:join(data,'bridge.log'),stickerDir:join(data,'stickers')};
  const bits=Buffer.from('a test original');
  write(join(cache,'qq-profile-backgrounds','photo.image'),bits);
  write(join(cache,'saved-covers','song.mp3'),bits);
  write(join(cache,'messages','attachment.png'),bits);
  write(join(cache,'chat-history','history.json'),bits);
  write(join(cache,'private-unrelated','personal.txt'),'outside the bridge');
  write(join(cache,'bridge.log'),'log');
  write(join(memory,'memory-hub','record.json'),'{"ok":true}');
  write(join(workspace,'scope','notes.txt'),'notes');
  write(join(data,'device-sync','backups','older','manifest.json'),'[]');
  write(join(data,'settings.json'),JSON.stringify({cacheDir:cache,memoryDir:memory,mediaRef:join(cache,'saved-covers','song.mp3'),basePersona:'不改变这一句话'}));
  write(cfg.stateFile,JSON.stringify({entry:join(workspace,'scope'),text:join(cache,'user prose')}));
  return {root,data,cache,memory,workspace,cfg,bits};
}

test('scheduled cold-start migration includes account background, archive, backup, memory and works, and rebinds paths',async t=>{
  const f=fixture(t), old=openBridgeStorage(f.cfg);
  const before=await storageUsage(old.paths(),join(f.root,'absent-host'));
  assert.ok(before.bytes.chats>0&&before.bytes.memory>0&&before.bytes.backups>0&&before.bytes.temporary>0&&before.bytes.assets>0);
  const target=join(f.cache,'QQ桥接资料库');
  assert.equal(old.plan(target),target);assert.equal(old.active,null);
  const moved=openBridgeStorage(f.cfg);
  assert.equal(moved.info().root,target);assert.ok(!moved.info().pending);
  const p=moved.paths();
  assert.deepEqual(fs.readFileSync(join(p.cache,'qq-profile-backgrounds','photo.image')),f.bits);
  assert.deepEqual(fs.readFileSync(join(p.cache,'saved-covers','song.mp3')),f.bits);
  assert.ok(fs.existsSync(join(p.cache,'chat-history','history.json')));
  assert.ok(fs.existsSync(join(p.data,'device-sync','backups','older','manifest.json')));
  assert.equal(fs.readFileSync(join(p.workspace,'scope','notes.txt'),'utf8'),'notes');
  assert.equal(plain(join(p.memory,'memory-hub','record.json')).ok,true);
  assert.equal(plain(join(p.data,'settings.json')).mediaRef,join(p.cache,'saved-covers','song.mp3'));
  assert.equal(plain(join(p.data,'state.json')).entry,join(p.workspace,'scope'));
  assert.equal(plain(join(p.data,'state.json')).text,join(f.cache,'user prose'));
  assert.equal(plain(join(f.data,'settings.json')).cacheDir,f.cache);
  assert.ok(!fs.existsSync(join(p.cache,'private-unrelated')));
  assert.equal(openBridgeStorage(f.cfg).info().root,target);
  assert.throws(()=>moved.plan(f.cache));
  const side=join(f.root,'other');moved.plan(side);moved.cancel();assert.equal(openBridgeStorage(f.cfg).info().root,target);
  assert.ok(!fs.existsSync(side));
});

test('occupied destinations, old roots and protected files survive failed migration, history never becomes temporary',t=>{
  const f=fixture(t),old=openBridgeStorage(f.cfg),target=join(f.root,'new-data');
  assert.throws(()=>old.plan(f.cache));assert.throws(()=>old.plan(join(f.cache,'saved-covers','wrong')));
  old.plan(target);write(join(target,'mine'),'keep');
  const back=openBridgeStorage(f.cfg);assert.equal(back.active,null);assert.ok(back.info().error);
  assert.equal(fs.readFileSync(join(target,'mine'),'utf8'),'keep');assert.ok(fs.existsSync(f.cfg.stateFile));
  const now=Date.now()+10*86400000;
  cleanManagedMedia(f.cache,{now,config:{days:1}});
  assert.ok(fs.existsSync(join(f.cache,'chat-history','history.json')));assert.ok(fs.existsSync(join(f.cache,'qq-profile-backgrounds','photo.image')));
  assert.ok(!fs.existsSync(join(f.cache,'messages','attachment.png')));
  assert.equal(transferableStorageKey('cache','qq-bridge-data/im-bridge/device-sync/pairing.json'),false);
  assert.equal(transferableStorageKey('cache','chat-history/account/date.json'),true);
});

test('five recoverable checkpoints per kind are kept, invalid replacements do not evict and other files survive',t=>{
  const dir=temp(t);
  const valid=v=>{assert.equal(v.format,'test');};
  for(let i=0;i<7;i++)saveCheckpoint(dir,'restore',{format:'test',i},valid);
  saveCheckpoint(dir,'full-sync',{format:'test'},valid);
  write(join(dir,'user.json'),'mine');const count=fs.readdirSync(dir).length;
  assert.throws(()=>saveCheckpoint(dir,'restore',{format:'broken'},valid));assert.equal(fs.readdirSync(dir).length,count);
  assert.equal(fs.readdirSync(dir).filter(f=>f.startsWith('before-restore-')).length,5);
  assert.equal(fs.readFileSync(join(dir,'user.json'),'utf8'),'mine');
  const backups=join(dir,'device-sync','backups'), old=Buffer.from('existing'),key='data/settings.json',filename=createHash('sha256').update(key).digest('hex');
  let folder;
  for(let i=0;i<7;i++){
    folder=join(backups,randomUUID());write(join(folder,filename),old);write(join(folder,'manifest.json'),JSON.stringify([{key,existed:true}]));
    verifySyncCheckpoint(folder,[{item:{key},old}]);rotateSyncCheckpoints(folder);
  }
  assert.equal(fs.readdirSync(backups).length,5);
  fs.writeFileSync(join(folder,filename),'changed');assert.throws(()=>verifySyncCheckpoint(folder,[{item:{key},old}]),/校验失败/);
});


test('archive device union keeps one local delivery and honors a recall from either device',()=>{
  const queued={localId:'q1',dir:'out',accountId:'a',chat:user,time:base,text:'稍后发'};
  const confirmed={...queued,messageId:'456',retracted:true};
  const merged=mergeSyncJson([queued],[confirmed],{key:'cache/chat-history/a/private-x/2026-02/28-0.json'});
  assert.equal(merged.length,1);assert.equal(merged[0].messageId,'456');assert.equal(merged[0].retracted,true);
  assert.equal(mergeSyncJson([{...confirmed,retracted:false}],[confirmed])[0].retracted,true);
});

test('migration preserves the legacy vocal-sample junction across two moves and rejects unrelated links',async t=>{
  const f=fixture(t),original=join(f.cache,'singing-samples'),link=join(f.memory,'singing','samples');
  write(join(original,'voice.wav'),'sample');fs.mkdirSync(join(f.memory,'singing'),{recursive:true});
  fs.symlinkSync(original,link,process.platform==='win32'?'junction':'dir');
  const previous=openBridgeStorage(f.cfg),first=join(f.root,'unified');
  const usage=await storageUsage(previous.paths());assert.equal(usage.skipped,0);
  previous.plan(first);const moved=openBridgeStorage(f.cfg);
  assert.equal(moved.info().root,first,moved.info().error);
  moved.plan(join(f.root,'second'));const next=openBridgeStorage(f.cfg),paths=next.paths();
  assert.equal(next.info().root,join(f.root,'second'),next.info().error);
  assert.equal(fs.realpathSync(join(paths.memory,'singing','samples')),fs.realpathSync(join(paths.cache,'singing-samples')));
  assert.equal(fs.readFileSync(join(paths.memory,'singing','samples','voice.wav'),'utf8'),'sample');
  fs.symlinkSync(f.cache,join(paths.memory,'singing','external'),process.platform==='win32'?'junction':'dir');
  next.plan(join(f.root,'third'));const stopped=openBridgeStorage(f.cfg);assert.equal(stopped.info().root,paths.root);assert.match(stopped.info().error,/链接/);
});
