import test from 'node:test';
import assert from 'node:assert/strict';
import {createVideoTasks} from '../video-tasks.js';
function fixture(overrides={}){
 const rows=[],counts={prepare:0,generate:0,deliver:0},records=[];
 const service=createVideoTasks({jobs:()=>rows,save:()=>{},authorize:c=>{if(c.denied)throw Error('scope changed');},prepare:async()=>{counts.prepare++;return {prompt:'same base + motion',seconds:8};},generate:async(_p,o)=>{counts.generate++;await o.onJob({id:'remote-job',status:'completed'});return {file:'result.mp4'};},deliver:()=>{counts.deliver++;return 'delivery-one';},record:(j,p)=>records.push(p),...overrides});
 return {service,rows,counts,records,c:{scope:'current-account/persona/chat',stamp:'same',currentStamp:()=> 'same',auditId:'turn-one'}};
}
test('ordinary QQ video request actually prepares, generates, enqueues once and repeated tool call reuses file/receipt',async()=>{
 const f=fixture(),args={action:'generate',prompt:'给我拍一段挥手的视频'};
 const result=await f.service.run(args,f.c);assert.equal(result.file,'result.mp4');assert.equal(result.deliveryId,'delivery-one');await f.service.run(args,f.c);assert.deepEqual(f.counts,{prepare:1,generate:1,deliver:1});
 assert.deepEqual(f.records.slice(0,4),['prepared','progress','generated','queued']);
 assert.equal((await f.service.run({action:'status'},{...f.c,scope:'other-chat'})).jobs.length,0);
 await assert.rejects(f.service.run({action:'resume',id:result.id},{...f.c,scope:'other-chat'}),/没有/);
});
test('download error resumes existing remote job; missing QQ enqueue retries delivery only',async()=>{
 let n=0,d=0;const f=fixture({generate:async(_p,o)=>{n++;if(n===1){await o.onJob({id:'saved-id',status:'completed'});throw Error('download temporarily unavailable');}assert.equal(o.job.id,'saved-id');return {file:'result.mp4'};},deliver:()=>++d===1?null:'delivered'});
 await assert.rejects(f.service.run({action:'generate',prompt:'挥手'},f.c),/download/);const id=f.rows[0].id;
 await assert.rejects(f.service.run({action:'resume',id},f.c),/没有进入QQ/);
 const r=await f.service.run({action:'resume',id},f.c);assert.equal(n,2);assert.equal(d,2);assert.equal(r.deliveryId,'delivered');assert.equal(f.counts.prepare,1);
});
test('changed account/persona/config and cancelled tasks cannot send a finished old video',async()=>{
 let current='same';const f=fixture({generate:async()=>{current='changed';return {file:'old.mp4'};}});f.c.currentStamp=()=>current;
 await assert.rejects(f.service.run({action:'generate',prompt:'hello'},f.c),/已改变/);assert.equal(f.counts.deliver,0);
 await assert.rejects(f.service.run({action:'resume',id:f.rows[0].id},{...f.c,stamp:'different'}),/已改变/);
});
test('uncertain submission marker persists so retry must resume and never silently submit a second job',async()=>{
 const f=fixture({generate:async(_p,o)=>{if(o.job){assert.equal(o.job.status,'submitting');throw Error('uncertain, no repeat');}await o.onJob({id:'',status:'submitting'});throw Error('fetch failed');}});
 await assert.rejects(f.service.run({action:'generate',prompt:'hello'},f.c),/fetch failed/);assert.equal(f.rows[0].remote.status,'submitting');await assert.rejects(f.service.run({action:'resume',id:f.rows[0].id},f.c),/no repeat/);
});
