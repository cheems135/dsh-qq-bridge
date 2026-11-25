import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recoverInterruptedAdmissions,restoreInboxPayload,reconcileUncertainInbox,settleInterruptedAdmissions} from '../inbox-recovery.js';
import {createSleepInbox} from '../sleep-inbox.js';
const job=()=>({id:'99999:private:12345:1',key:'private:12345',accountId:'a',status:'admitted',at:100,receivedIds:['1','2']});
const audit=(extra={})=>({id:'audit',accountId:'a',chat:'private:12345',at:110,inboundIds:['1','2'],persona:'p',status:'cancelled',recoveredAt:150,durationUnknown:true,...extra});
const options={accountId:'a',personaFor:()=> 'p',now:200};
const message=id=>({message_id:id,message_type:'private',user_id:'12345',sender:{user_id:'12345'},message:[{type:'text',data:{text:'原消息 '+id}}]});

test('a submitted input interrupted by reload becomes visible and requires confirmation, never automatic replay',()=>{
 const j=job();assert.equal(recoverInterruptedAdmissions([j],[audit()],options),1);
 assert.equal(j.status,'failed');assert.equal(j.interruptedAuditId,'audit');assert.equal(j.recoveryRequiresConfirmation,true);
 assert.equal(recoverInterruptedAdmissions([j],[audit()],options),0);
 reconcileUncertainInbox([j],{activeAccountId:'a',selfId:'99999',now:200});assert.equal(j.status,'failed');
});
test('only the exact latest account, contact, persona and full batch can be marked interrupted',()=>{
 for(const a of [audit({accountId:'b'}),audit({chat:'private:67890'}),audit({persona:'other'}),audit({inboundIds:['1']}),audit({recoveredAt:undefined}),audit({deliveryState:'sent'})]){
  const j=job();assert.equal(recoverInterruptedAdmissions([j],[a],options),0);assert.equal(j.status,'admitted');
 }
 assert.equal(recoverInterruptedAdmissions([job()],[audit(),audit({at:120,status:'completed'})],options),0);
});
test('legacy inputs are restored only from all verified original QQ messages, preserving their IDs and order',async()=>{
 const j=job(),reads=[];const p=await restoreInboxPayload(j,async id=>{reads.push(id);return message(id);},{selfId:'99999'});
 assert.deepEqual(reads,['1','2']);assert.deepEqual(p._bridgeReceivedIds,['1','2']);
 assert.equal(p.message.filter(s=>s.type==='text').map(s=>s.data.text).join(''),'原消息 1\n原消息 2');
 assert.equal(p.self_id,'99999');assert.equal(p.post_type,'message');assert.equal(p._bridgeReceivedAt,100);
 assert.equal(j.payload,undefined,'a partially restored payload is never attached by the reader');
});
test('missing, foreign or changed QQ messages cannot be reconstructed as this input',async()=>{
 for(const modify of [m=>({...m,message_id:'wrong'}),m=>({...m,user_id:'67890'}),m=>({...m,self_id:'88888'}),m=>({...m,message_type:'group'}),m=>({...m,message:undefined})])
  await assert.rejects(restoreInboxPayload(job(),async id=>modify(message(id)),{selfId:'99999'}),/不一致/);
 await assert.rejects(restoreInboxPayload(job(),async()=>{throw Error('QQ read failed');},{selfId:'99999'}),/read failed/);
 let current=true;await assert.rejects(restoreInboxPayload(job(),async id=>{current=false;return message(id);},{selfId:'99999',current:()=>current}),/会话已改变/);
});
test('the real retry route confirms uncertain work, restores a legacy payload and persists before admission',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const scopeSource=source.match(/^  function inboxRowForAccount\([\s\S]*?^  \}/m)[0];
 const routeSource=source.match(/^  async function featureAction\([\s\S]*?^  \}/m)[0];
 for(const failedSave of [false,true]){
  const j=job();recoverInterruptedAdmissions([j],[audit()],options);const before=structuredClone(j),events=[];
  const deps={featureState:{inbox:[j]},settings:{activeAccountId:'a'},lastSelfId:'99999',isDesktop:true,restoreInboxPayload,settleInterruptedAdmissions,conversationScope:()=> 'same',bridgeQQReady:()=>true,
   request:async(name,args)=>{assert.equal(name,'get_msg');events.push('read');return message(String(args.message_id));},saveFeatures:()=>{events.push('save');return !failedSave;},drainInbox:()=>events.push('admit')};
  const action=Function(...Object.keys(deps),scopeSource+'\n'+routeSource+'\nreturn featureAction;')(...Object.values(deps));
  await assert.rejects(action('inbox-retry',{id:j.id}),/先核对/);assert.deepEqual(events,[]);
  if(failedSave){await assert.rejects(action('inbox-retry',{id:j.id,confirmUncertain:true}),/未保存/);assert.deepEqual(j,before);assert(!events.includes('admit'));}
  else{
   assert.deepEqual(await action('inbox-retry',{id:j.id,confirmUncertain:true}),{ok:true});assert.equal(j.status,'queued');assert(j.payload);assert.deepEqual(events,['read','read','save','admit']);
   for(const key of Object.keys(j))delete j[key];Object.assign(j,structuredClone(before));
   deps.featureState.audits=[audit(),audit({id:'later',at:120,status:'completed',deliveryState:'sent'})];
   const start=events.length;assert.deepEqual(await action('inbox-retry',{id:j.id}),{ok:true,alreadyReplied:true});
   assert.deepEqual(events.slice(start),['save'],'already delivered inputs do not read, infer or enqueue again');
  }
 }
});

test('a queued offline review cannot bypass the confirmation required by an interrupted admission',()=>{
 const j=job();recoverInterruptedAdmissions([j],[audit()],options);
 const original={...message('1'),self_id:'99999'},scope={accountId:'a',personaId:'p',key:j.key};
 const rows=[{id:'sleep',scope,at:90,status:'queued',queuedAt:100,reviewMessageId:'1',recoveryPayload:original}];
 const sleep=createSleepInbox({getRows:()=>rows,setRows:()=>assert.fail('must not schedule automatic retry'),save:()=>assert.fail('no mutation'),now:()=>100000});
 assert.equal(sleep.reconcile([j],[audit()],[]),false);assert.equal(rows[0].status,'queued');
});

test('a verified later reply settles the old interrupted input without replaying it',()=>{
 const j=job(),original=audit();recoverInterruptedAdmissions([j],[original],options);
 for(const a of [audit({id:'new',at:120,status:'completed',deliveryState:'queued'}),audit({id:'new',at:120,status:'completed',deliveryState:'sent',inboundIds:['1']}),audit({id:'new',at:120,status:'completed',deliveryState:'sent',persona:'other'})])
  assert.equal(settleInterruptedAdmissions([j],[original,a],{accountId:'a'}),0);
 const complete=audit({id:'new',at:120,status:'completed',deliveryState:'sent'});
 assert.equal(settleInterruptedAdmissions([j],[original,complete],{accountId:'a'}),1);
 assert.equal(j.status,'admitted');assert.equal(j.recoveryRequiresConfirmation,undefined);assert.equal(j.interruptedAuditId,undefined);
 assert.equal(settleInterruptedAdmissions([j],[original,complete],{accountId:'a'}),0);
});
