import test from 'node:test';
import assert from 'node:assert/strict';
import {createExpressionLearning} from '../expression-learning.js';
import {mergeSyncJson} from '../sync-union.js';

const meta={accountId:'old',key:'private:12345',personaId:'whale'};
const picture=n=>({type:'image',data:{md5:String(n).repeat(32),sub_type:1}});
function storage(initial){
  let disk=initial,writes=0;
  return {read:()=>disk&&structuredClone(disk),write:v=>{writes++;disk=structuredClone(v);},
    replace:v=>{disk=structuredClone(v);},get disk(){return disk;},get writes(){return writes;}};
}
function learner(store,options={}){
  return createExpressionLearning({storage:store,allowed:()=>true,allowSticker:()=>true,
    ask:()=>assert.fail('unexpected model call'),...options});
}

test('legacy image meanings follow the plugin across QQ accounts without merging contacts or personae',()=>{
  const store=storage(),old=learner(store);
  assert(old.rememberStickerMeaning(meta,picture(1),'认栽',{messageId:'one',at:10}));
  const current={...meta,accountId:'new'},next=learner(store,{memoryAccounts:()=>['old','new']});
  assert.equal(next.stickerMeaning(current,picture(1)),'认栽');
  assert.equal(next.stickerMeaning({...current,key:'private:67890'},picture(1)),'');
  assert.equal(next.stickerMeaning({...current,personaId:'other'},picture(1)),'');
  assert(next.rememberStickerMeaning(current,picture(1),'服气',{messageId:'correction',at:20}));
  const later=learner(store,{memoryAccounts:()=>['new']});
  assert.equal(later.stickerMeaning({...meta,accountId:'third'},picture(1)),'服气');
  assert.equal(Object.keys(store.disk.stickerMeanings).length,2,'legacy evidence remains intact');
});

test('a live expression learner reloads merged image meanings before any further save',()=>{
  const desktop=storage(),phone=storage(),active=learner(desktop),peer=learner(phone);
  active.rememberStickerMeaning(meta,picture(1),'认栽',{messageId:'desktop',at:10});
  peer.rememberStickerMeaning(meta,picture(2),'赢了',{messageId:'phone',at:20});
  desktop.replace(mergeSyncJson(desktop.disk,phone.disk,{key:'data/expression-learning.json'}));
  assert.equal(active.stickerMeaning(meta,picture(2)),'');
  active.reload();
  assert.equal(active.stickerMeaning(meta,picture(1)),'认栽');
  assert.equal(active.stickerMeaning(meta,picture(2)),'赢了');
  active.rememberStickerMeaning(meta,picture(3),'无语',{messageId:'after-sync',at:30});
  const restarted=learner(desktop);
  assert.deepEqual([1,2,3].map(n=>restarted.stickerMeaning(meta,picture(n))),['认栽','赢了','无语']);
});

test('learning started before reload cannot overwrite imported meanings or consume imported pending rows',async()=>{
  let finish,entered;
  const ready=new Promise(resolve=>entered=resolve),store=storage();
  const active=learner(store,{now:()=>1_000_000_000,ask:()=>{entered();return new Promise(resolve=>finish=resolve);}});
  active.observeBatch(meta,Array.from({length:6},(_,i)=>({role:'user',source:'qq',id:String(i),text:'今天看到一只猫蹲在窗边晒太阳，尾巴晃来晃去'+i,at:100+i})));
  const pending=active.learn(meta,{force:true});
  await ready;
  const peer=learner(store);
  peer.rememberStickerMeaning(meta,picture(2),'赢了',{messageId:'sync',at:20});
  active.reload();
  const imported=structuredClone(store.disk),writes=store.writes;
  finish('{"items":[]}');
  assert.equal((await pending).learned,0);
  assert.deepEqual(store.disk,imported);
  assert.equal(store.writes,writes);
  assert.equal(active.stickerMeaning(meta,picture(2)),'赢了');
});

test('an unreadable reload retains the usable in-memory meanings and never replaces the file',()=>{
  const store=storage(),active=learner(store);
  active.rememberStickerMeaning(meta,picture(1),'认栽',{messageId:'before',at:10});
  store.replace({version:1,stickerMeanings:{unknown:{meaning:'original'}}});
  const writes=store.writes;
  assert.throws(()=>active.reload(),/原文件保留/);
  assert.equal(active.stickerMeaning(meta,picture(1)),'认栽');
  assert.equal(store.writes,writes);
});

test('a false persistence result does not claim the new image meaning was saved',()=>{
  const store=storage(),active=learner({...store,read:store.read,write:()=>false});
  assert.throws(()=>active.rememberStickerMeaning(meta,picture(1),'认栽',{messageId:'failed',at:10}),/未保存/);
  assert.equal(active.stickerMeaning(meta,picture(1)),'');
});
