import test from 'node:test';
import assert from 'node:assert/strict';
import {initiativeOptions,initiativePolicy,initiativeCadence} from '../api-initiative.js';
test('private initiative offers eligible alternatives for the same recipient only',()=>{
 const pick={action:'chat',target:'11111'},explore={action:'explore',target:'11111'},phone={action:'phone',target:'11111'};
 const all=[pick,explore,phone,{action:'chat',target:'22222'},{action:'qzone'},{action:'group',key:'group:33333'},{action:'share',target:'11111',kind:'image'}];
 assert.deepEqual(initiativeOptions(all,{},initiativePolicy({},true),pick),[pick,explore,phone]);
 assert.deepEqual(initiativeOptions(all,{},initiativePolicy({},true),all[4]),[all[4]]);
});
test('declined alternative cannot enter through the option list',()=>{
 const now=10000000,pick={action:'chat',target:'11111'},phone={action:'phone',target:'11111'},config=initiativePolicy({minGapMinutes:45});
 assert.deepEqual(initiativeOptions([pick,phone],{actions:{phone:{consideredAt:now-1000}}},config,pick,{now}),[pick]);
});
test('cadence checks do not spend opportunities until inference actually begins',()=>{
 const base=1000,now=base+15*60000;let state;
 for(let i=0;i<100;i++){const gate=initiativeCadence(state,base,now);assert.equal(gate.ok,true);assert.deepEqual(gate.record.fired,[]);}
 state=initiativeCadence(state,base,now,{commit:true}).record;
 assert.equal(state.fired.length,1);
 assert.equal(initiativeCadence(state,base,now+1000).ok,false);
 state=initiativeCadence(state,base,base+30*60000,{commit:true}).record;
 assert.equal(state.fired.length,2);
 assert.equal(initiativeCadence(state,base,base+31*60000).ok,false);
 assert.equal(initiativeCadence(state,base,base+150*60000).ok,true);
 assert.equal(initiativeCadence(state,now,now+15*60000).record.fired.length,0);
});
test('runtime reserves cadence immediately before model call',async()=>{
 const {readFile}=await import('node:fs/promises');
 const code=await readFile(new URL('../index.js',import.meta.url),'utf8');
 assert.match(code,/for\(const pick of offered\)/);
 assert.match(code,/offered\.find\(c=>c.action===decision.action\)/);
 const start=code.indexOf('async function runAutonomyTick'),end=code.indexOf('/** Names of the files',start),part=code.slice(start,end);
 assert(part.indexOf("initiativeCadenceGate(true,contextKey.startsWith('private:')?contextKey:'')")>part.indexOf('if (candidates.length === 0)'));
 assert(part.indexOf("initiativeCadenceGate(true,contextKey.startsWith('private:')?contextKey:'')")<part.indexOf('await decideInitiative'));
});
