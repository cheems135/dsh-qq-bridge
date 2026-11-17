import test from 'node:test';import assert from 'node:assert/strict';import {createSleepInbox} from '../sleep-inbox.js';
import {readFileSync} from 'node:fs';
const scope={accountId:'a',personaId:'p',personaVersion:'v',key:'private:11111'};
const payload=id=>({post_type:'message',message_type:'private',user_id:'11111',self_id:'22222',message_id:id,time:1794050000,sender:{nickname:'甲'},message:[{type:'text',data:{text:'睡醒再看看这个 '+id}},{type:'image',data:{file:'image-'+id}}]});
test('sleep capture persists, deduplicates and merges only the current scope; media and original message identity survive restart',()=>{
 let rows=[],saves=0;const options={getRows:()=>rows,setRows:v=>rows=structuredClone(v),save:()=>saves++,now:()=>1794060000000};let box=createSleepInbox(options);
 assert.equal(box.capture(payload('1'),scope),true);assert.equal(box.capture(payload('1'),scope),false);box.capture(payload('2'),scope);box.capture(payload('3'),{...scope,personaId:'other'});assert.equal(saves,3);
 box=createSleepInbox(options);assert.equal(box.batches(()=>false).length,0);const batches=box.batches(s=>s.personaId==='p');assert.equal(batches.length,1);const b=batches[0];assert.deepEqual(b.payload._bridgeReceivedIds,['1','2']);assert.equal(b.payload.message.filter(s=>s.type==='image').length,2);assert.match(b.payload.message[1].data.text,/甲（11111）/);assert.equal(b.payload._sleepReview,true);assert.equal(box.batches(s=>s.personaId==='p')[0].messageId,b.messageId);box.acknowledge(b.rows.map(r=>r.id));assert.equal(box.batches(s=>s.personaId==='p').length,0);assert.equal(rows.find(r=>r.id===b.rows[0].id).payload,undefined);assert.equal(rows.find(r=>r.scope.personaId==='other').status,'pending');
});
test('conversations and sender identities remain separate; queued backlog is not sent again after restart',()=>{
 let rows=[];const opts={getRows:()=>rows,setRows:v=>rows=v,save:()=>{}};let box=createSleepInbox(opts);box.capture(payload('1'),scope);box.capture({...payload('2'),message_type:'group',group_id:'55555',user_id:'33333'}, {...scope,key:'group:55555'});const batches=box.batches(()=>true);assert.equal(batches.length,2);assert.notEqual(batches[0].messageId,batches[1].messageId);box.acknowledge(batches[0].rows.map(r=>r.id));box=createSleepInbox(opts);assert.equal(box.batches(()=>true).length,1);
});
test('actual host waking hands off only after wake and acknowledges only durable inbox admission; interrupted handoff is deduplicated',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  function reviewSleepInbox(){'),end=source.indexOf('  const sleepInboxTimer=',start),code=source.slice(start,end);let rows=[],awake=false,accept=false,calls=0;
 const featureState={inbox:[]};Object.defineProperty(featureState,'sleepInbox',{get:()=>rows});const box=createSleepInbox({getRows:()=>rows,setRows:v=>rows=v,save:()=>{}});box.capture(payload('1'),scope);
 const review=Function('lifeExecution','sleepInbox','sleepInboxCurrent','featureState','handlePayload',code+';return reviewSleepInbox;')({},box,()=>awake,featureState,p=>{calls++;if(accept)featureState.inbox.push({id:p.self_id+':'+scope.key+':'+p.message_id,payload:p});});
 review();assert.equal(calls,0);awake=true;review();assert.equal(rows[0].status,'pending');accept=true;review();assert.equal(rows[0].status,'queued');review();assert.equal(calls,2);assert.equal(featureState.inbox.length,1);
 box.capture(payload('2'),scope);featureState.inbox.push({id:'22222:private:11111:2'});review();assert.equal(rows[1].status,'queued');assert.equal(calls,2);
 assert.match(source,/toolsEnabled:!payload\._sleepReview/);assert.match(readFileSync(new URL('../incoming-batch.js',import.meta.url),'utf8'),/return !payload\._sleepReview/);
});
