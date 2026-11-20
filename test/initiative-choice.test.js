import test from 'node:test';
import assert from 'node:assert/strict';
import {initiativeOptions,initiativeChoiceId,initiativeDecisionRealm,initiativePolicy,initiativeCadence,parseInitiativeDecision} from '../api-initiative.js';
test('one initiative decision sees every eligible action and recipient',()=>{
 const pick={action:'chat',target:'11111'},explore={action:'explore',target:'11111'},phone={action:'phone',target:'11111'};
 const all=[pick,explore,phone,{action:'chat',target:'22222'},{action:'qzone'},{action:'group',key:'group:33333'},{action:'share',target:'11111',kind:'image'}];
 assert.deepEqual(initiativeOptions(all,{},initiativePolicy({},true),pick),all);
 assert.deepEqual(initiativeOptions(all,{},initiativePolicy({},true),all[4]),[all[4],...all.filter(c=>c!==all[4])]);
 assert.equal(new Set(all.map(initiativeChoiceId)).size,all.length);
 assert.notEqual(initiativeChoiceId(pick),initiativeChoiceId(all[3]));
 assert.notEqual(initiativeChoiceId(phone),initiativeChoiceId(all[5]));
});
test('same action can select the intended recipient without switching to another chat',()=>{
 const first={action:'chat',target:'11111'},second={action:'chat',target:'22222'};
 const offered=initiativeOptions([first,second],{},initiativePolicy({},true),first);
 const selected=parseInitiativeDecision(JSON.stringify({action:initiativeChoiceId(second),text:'想找你聊聊'}),offered.map(initiativeChoiceId));
 assert.equal(offered.find(c=>initiativeChoiceId(c)===selected.action),second);
 assert.throws(()=>parseInitiativeDecision(JSON.stringify({action:'chat@private:33333',text:'误投'}),offered.map(initiativeChoiceId)),/未开放动作/);
});
test('one decision compares actions within one conversation and never mixes group, private, or public context',()=>{
 const chat={action:'chat',target:'11111'},explore={action:'explore',target:'11111'},share={action:'share',target:'11111',kind:'image'},other={action:'chat',target:'22222'},group={action:'group',key:'group:33333'},space={action:'qzone'},reply={action:'qzoneReply',comment:{id:'c1'}};
 const all=[chat,explore,share,other,group,space,reply];
 const offered=initiativeOptions(all,{},initiativePolicy({},true),chat).filter(c=>initiativeDecisionRealm(c)===initiativeDecisionRealm(chat));
 assert.deepEqual(offered,[chat,explore,share]);
 assert.notEqual(initiativeDecisionRealm(group),initiativeDecisionRealm(chat));
 assert.notEqual(initiativeDecisionRealm(space),initiativeDecisionRealm(reply));
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
 assert.match(code,/candidateDetails=offered\.map/);
 assert.match(code,/filter\(c=>initiativeDecisionRealm\(c,/);
 assert.match(code,/actions:offered\.map\(initiativeChoiceId\)/);
 assert.match(code,/offered\.find\(c=>initiativeChoiceId\(c\)===decision.action\)/);
 const start=code.indexOf('async function runAutonomyTick'),end=code.indexOf('/** Names of the files',start),part=code.slice(start,end);
 assert(part.indexOf("initiativeCadenceGate(true,freshOpportunity.key||'')")>part.indexOf('if (candidates.length === 0)'));
 assert(part.indexOf("initiativeCadenceGate(true,freshOpportunity.key||'')")<part.indexOf('await decideInitiative'));
 assert(part.indexOf('pick=chosen')<part.indexOf('const switchedOn'));
 assert.match(part,/if \(!switchedOn\)/);
 assert.match(part,/if\(!manual&&!selectInitiative\(\[pick\],auto,config\)\)/);
 assert.match(part,/effectiveGroups\(\)\.includes\(String\(pick.groupId\)\)/);
});
test('one private proactive decision can select image or voice for the same contact',async()=>{
 const {decideInitiative}=await import('../api-initiative.js');
 const target='12345',chat={action:'chat',target},voice={action:'share',kind:'voice',target},image={action:'share',kind:'image',target};
 const offered=initiativeOptions([chat,voice,image],{},initiativePolicy({},true),chat);
 const choices=offered.map(initiativeChoiceId);
 for(const [medium,event] of [[voice,'一句有必要亲口说的话'],[image,'刚聊到一处具体画面']]){
  let calls=0;
  const picked=await decideInitiative({system:'按语境择一，没合适的就保持安静',input:event,actions:choices,ask:async(system,input)=>{
   calls++;
   assert.equal(input,event);
   assert.ok(system.includes(initiativeChoiceId(voice))&&system.includes(initiativeChoiceId(image)));
   return JSON.stringify({action:initiativeChoiceId(medium),text:event});
  }});
  assert.equal(calls,1);
  assert.equal(offered.find(item=>initiativeChoiceId(item)===picked.decision.action),medium);
 }
});
