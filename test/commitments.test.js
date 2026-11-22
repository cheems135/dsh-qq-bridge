import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommitments,deliveryCommitmentId} from '../commitments.js';

const plan=(trigger={kind:'now'})=>({action:'plan',goal:'把答应的资料发出去',doneWhen:'目标会话能读回完整资料',next:'整理资料并核对发送',trigger});
const privateContext=(personaId='p',accountId='a')=>({key:'private:123',accountId,personaId,chat:{kind:'private',isOwner:true,userId:'123'},meta:{kind:'user',speakerId:'123',userWords:'请稍后把资料发出去'}});
const groupContext=(speakerId='123')=>({key:'group:456',accountId:'a',personaId:'p',chat:{kind:'group',isOwner:false},meta:{kind:'user',speakerId,userWords:'请稍后把资料发出去'}});
function harness(initial={version:1,jobs:[],sleep:{}}){
 let state=structuredClone(initial),clock=1000;const calls=[];
 const ledger=createCommitments({read:()=>structuredClone(state),write:value=>{state=structuredClone(value);},now:()=>clock,dispatch:async job=>{calls.push(job);return true;},isOwner:c=>c.chat?.kind==='group'?c.meta?.speakerId==='123':c.chat?.isOwner===true});
 return {ledger,calls,state:()=>structuredClone(state),advance:ms=>{clock+=ms;}};
}

test('a promise acknowledgement cannot masquerade as the promised QQ operation',()=>{
 assert.equal(deliveryCommitmentId({key:'private:123'}),'');
 assert.equal(deliveryCommitmentId({key:'private:123',commitmentId:'job-1'}),'job-1');
});

test('ordinary dialogue carries only relevant open commitments from a visible source',()=>{
 const h=harness(),owner=privateContext(),group=groupContext();
 assert.equal(h.ledger.hint(owner,{words:'我选红茶，你呢？'}),'');
 const content=plan({kind:'message',phrases:['雨停了']});
 h.ledger.command(content,owner);
 assert.equal(h.ledger.hint(owner,{words:'哈哈哈'}),'');
 assert.match(h.ledger.hint(owner,{words:'约定的进度呢？'}),/把答应的资料发出去/);
 assert.equal(h.ledger.hint(group,{words:'约定的进度呢？'}),'');
 h.ledger.event(owner,{kind:'message',id:'rain',text:'雨停了',trusted:true,at:1001});
 assert.match(h.ledger.hint(owner,{words:'雨停了',messageId:'rain'}),/把答应的资料发出去/);
 assert.equal(h.ledger.hint(owner,{words:'雨停了',messageId:'another'}),'');
});

test('owner promise in a group is persisted for the same owner private chat, without leaking to other actors or personae',async()=>{
 const h=harness(),group=groupContext(),owner=privateContext();
 const saved=h.ledger.command(plan({kind:'message',phrases:['资料准备好了']}),group).job;
 assert.equal(saved.key,'private:123');
 assert.equal(saved.sourceKey,'group:456');
 assert.equal(h.ledger.list(owner)[0].id,saved.id);
 assert.equal(h.ledger.list(groupContext('999')).length,0);
 assert.equal(h.ledger.list(privateContext('other-persona')).length,0);
 assert.equal(h.ledger.list(privateContext('p','other-account')).length,0);
 assert.throws(()=>h.ledger.command(plan(),groupContext('999')),/只有|号主|当前/);
 assert.equal(h.ledger.command(plan({kind:'message',phrases:['资料准备好了']}),group).reused,true);
 h.ledger.event(owner,{kind:'message',id:'incoming-1',text:'资料准备好了',trusted:true,at:1001});
 await h.ledger.tick();
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].id,saved.id);
 assert.equal(h.state().jobs[0].status,'running');
});

test('queued QQ operation cannot become a checkpoint or completion until the same delivery is verified',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 await h.ledger.tick();
 h.ledger.receipt(job.id,c,{id:'call-1',tool:'bridge_life_qq',ok:true,reference:'delivery-1',status:'queued'});
 assert.throws(()=>h.ledger.command({action:'checkpoint',id:job.id,summary:'已经发了',next:'继续'},c),/尚无新的已确认结果/);
 assert.throws(()=>h.ledger.command({action:'complete',id:job.id,summary:'完成'},c),/没有已确认的实际结果/);
 h.ledger.ended(job.id,c);
 assert.equal(h.state().jobs[0].status,'needs_reconcile');
 h.ledger.receipt(job.id,c,{id:'call-1',tool:'bridge_life_qq',ok:true,reference:'delivery-1',status:'sent',verified:true});
 assert.equal(h.state().jobs[0].status,'ready');
 h.ledger.command({action:'checkpoint',id:job.id,summary:'目标会话已读回资料',next:'核对是否完整'},c);
 // The final verified receipt may support both the last checkpoint and closeout.
 h.ledger.command({action:'complete',id:job.id,summary:'资料完整送达且读回'},c);
 assert.equal(h.state().jobs[0].status,'completed');
});

test('an unknown operation is never replayed; matching verified result unblocks the next step',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 await h.ledger.tick();
 h.ledger.receipt(job.id,c,{id:'call-1',tool:'bridge_life_qq',ok:false,unknown:true,reference:'delivery-1',status:'unknown'});
 h.ledger.ended(job.id,c);
 h.advance(60000);await h.ledger.tick();
 assert.equal(h.calls.length,1);
 h.ledger.receipt(job.id,c,{id:'verify-1',tool:'qq.message.verify',ok:true,verified:true,reference:'delivery-1',status:'sent'});
 assert.equal(h.state().jobs[0].status,'ready');
 h.advance(15000);await h.ledger.tick();
 assert.equal(h.calls.length,2);
});

test('a known failed send releases reconciliation for a different next action, without claiming success',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 await h.ledger.tick();
 h.ledger.receipt(job.id,c,{id:'send-1',tool:'bridge_life_qq',ok:true,reference:'delivery-1',status:'queued'});
 h.ledger.ended(job.id,c);
 assert.equal(h.state().jobs[0].status,'needs_reconcile');
 h.ledger.receipt(job.id,c,{id:'send-1',tool:'bridge_life_qq',ok:false,reference:'delivery-1',status:'failed'});
 assert.equal(h.state().jobs[0].status,'ready');
 assert.throws(()=>h.ledger.command({action:'complete',id:job.id,summary:'完成'},c),/没有已确认的实际结果/);
});

test('an earlier successful read cannot close a task after its latest QQ send failed',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 await h.ledger.tick();
 h.ledger.receipt(job.id,c,{id:'read-1',tool:'bridge_qq_read',ok:true,status:'read',verified:true});
 h.ledger.receipt(job.id,c,{id:'send-1',tool:'bridge_life_qq',ok:true,reference:'delivery-1',status:'queued'});
 h.ledger.ended(job.id,c);assert.equal(h.state().jobs[0].status,'needs_reconcile');
 h.ledger.receipt(job.id,c,{id:'send-1',tool:'bridge_life_qq',ok:false,reference:'delivery-1',status:'failed'});
 assert.throws(()=>h.ledger.command({action:'complete',id:job.id,summary:'已经送达'},c),/最后一次实际操作尚未成功确认/);
});

test('a separately verified non-submission clears the old unknown receipt but does not count as completion',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 await h.ledger.tick();
 h.ledger.receipt(job.id,c,{id:'send-1',tool:'bridge_life_qq',ok:false,unknown:true,reference:'delivery-1',status:'unknown'});
 h.ledger.ended(job.id,c);
 h.ledger.receipt(job.id,c,{id:'verify-1',tool:'qq.message.verify',ok:false,verified:true,reference:'delivery-1',status:'failed'});
 assert.equal(h.state().jobs[0].status,'ready');
 assert.throws(()=>h.ledger.command({action:'complete',id:job.id,summary:'完成'},c),/没有已确认的实际结果/);
});

test('interrupted active work retries with bounded backoff; repeated no-progress turns stop',async()=>{
 const h=harness(),c=privateContext(),job=h.ledger.command(plan(),c).job;
 for(let attempt=0;attempt<3;attempt++){
  await h.ledger.tick();
  assert.equal(h.calls.length,attempt+1);
  h.ledger.ended(job.id,c,{error:true});
  if(attempt<2){assert.equal(h.state().jobs[0].status,'ready');h.advance(120000);}
 }
 assert.equal(h.state().jobs[0].status,'blocked');
 h.advance(120000);await h.ledger.tick();
 assert.equal(h.calls.length,3);
});

test('self-chosen proactive promise survives restart and wake event; ordinary quoted text cannot create one',async()=>{
 const h=harness(),c=privateContext();
 c.meta={kind:'proactive',speakerId:'123',userWords:''};
 const job=h.ledger.command(plan({kind:'wake'}),c).job;
 assert.match(job.source,/自主决定/);
 const fake={...c,meta:{kind:'user',speakerId:'123',userWords:''}};
 assert.throws(()=>h.ledger.command(plan({kind:'time',at:'2026-11-18T09:00:00+08:00'}),fake),/当前请求/);
 h.ledger.sleep(c,true);
 const restored=harness(h.state()),r=restored.ledger;
 r.sleep(c,false);
 assert.equal(restored.state().jobs[0].status,'ready');
 await r.tick();
 assert.equal(restored.calls.length,1);
 assert.equal(restored.calls[0].id,job.id);
});

test('a verified group proactive turn may make an owner-private promise; ordinary group actors cannot',()=>{
 const h=harness(),group=groupContext('bot');
 group.meta={kind:'proactive',speakerId:'bot',userWords:'',ownerId:'123'};
 assert.throws(()=>h.ledger.command(plan(),group),/号主|当前/);
 group.meta.ownerAuthorized=true;
 const job=h.ledger.command(plan({kind:'time',at:'2026-11-18T09:00:00+08:00'}),group).job;
 assert.equal(job.ownerId,'123');
 assert.equal(job.key,'private:123');
 assert.equal(job.sourceKey,'group:456');
 assert.equal(h.ledger.list(privateContext()).length,1);
 const outsider=groupContext('999');outsider.meta.ownerId='123';outsider.meta.ownerAuthorized=true;
 assert.throws(()=>h.ledger.command(plan(),outsider),/当前请求|号主/);
});

test('legacy sleep scope migrates to owner scope so wake commitments still fire after update',()=>{
 const old={'["a","p","private:123"]':true};
 const h=harness({version:1,jobs:[],sleep:old}),c=privateContext();
 assert.equal(h.state().sleep['["a","p","123"]'],true);
 h.ledger.sleep(c,false);
 assert.equal(h.state().sleep['["a","p","123"]'],false);
});
