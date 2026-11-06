import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalRunStatus} from '../local-run-status.js';
test('simultaneous requests keep independent phases and expose only execution metadata',()=>{
 let now=1000;const tracker=createLocalRunStatus({now:()=>now,limit:2});const a=tracker.start('turn','qq'),b=tracker.start('turn','preview');
 tracker.update(a,{phase:'repair',tool:'bridge_bilibili',prompt:'PRIVATE_PROMPT',arguments:{cookie:'PRIVATE_COOKIE'}});tracker.update(b,{phase:'context',context:{limit:4096,inputEstimate:3000,reset:true,promptCompacted:true,personaCompacted:true,compactedSections:['memory','persona','PRIVATE_PROMPT'],originalPrompt:'PRIVATE_PROMPT'}});now+=500;
 const state=tracker.snapshot();assert.equal(state.active[0].phase,'repair');assert.equal(state.active[1].phase,'context');assert.equal(state.active[0].elapsedMs,500);assert.doesNotMatch(JSON.stringify(state),/PRIVATE_/);
 assert.equal(state.active[1].context.personaCompacted,true);assert.deepEqual(state.active[1].context.compactedSections,['memory','persona']);
 tracker.finish(a,{result:{text:'PRIVATE_REPLY',attachments:[{kind:'image',file:'PRIVATE_FILE'}],receipts:[]}});assert.equal(tracker.snapshot().recent[0].result.images,1);assert.doesNotMatch(JSON.stringify(tracker.snapshot()),/PRIVATE_/);
 tracker.finish(b,{error:Error('network unavailable')});const c=tracker.start();tracker.finish(c,{cancelled:true});assert.equal(tracker.snapshot().recent.length,2);assert.deepEqual(tracker.snapshot().recent.map(r=>r.status),['cancelled','failed']);
});
