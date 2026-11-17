import test from 'node:test';
import assert from 'node:assert/strict';
import {groupPrivateOpportunity,eventInitiativeCadence} from '../initiative-events.js';
import {selectInitiative} from '../api-initiative.js';
import {readFileSync} from 'node:fs';
import {initiativeEvent} from '../initiative-events.js';
const now=1800000000000,statement='鲸鲸也没意思了，那我就去找我爸撒娇，你自己玩去吧';
const sent={accountId:'a',personaId:'p',chat:'group:99',dir:'out',delivery:'sent',time:now-1000,messageId:'42',text:statement};
const input={messages:[{...sent,dir:'in',text:'群里正在聊鲸鱼'},sent],accountId:'a',personaId:'p',ownerId:'123',ownerIds:['123'],groups:['99'],now};
test('real group statement becomes scoped private opportunity with conversational context',()=>{
 const event=groupPrivateOpportunity(input);assert.equal(event.kind,'social-followup');assert.equal(event.summary.said,statement);assert.equal(event.summary.sourceChat,'group:99');assert.equal(event.summary.context.length,2);
 const gate=eventInitiativeCadence({},now-2000,now,{event});assert.equal(gate.ok,true);assert.equal(gate.event.id,event.id);
 const chosen=selectInitiative([{action:'group'},{action:'chat',target:'123',event:true}],{},{unrestricted:true});assert.equal(chosen.action,'chat');
 const committed=eventInitiativeCadence({},now-2000,now,{event,commit:true}).record;assert.equal(eventInitiativeCadence(committed,now-2000,now+1000,{event}).event,null);
});
test('incoming text, drafts, failed sends and other identities cannot trigger a private followup',()=>{
 for(const patch of [{dir:'in'},{delivery:'queued'},{delivery:'failed'},{delivery:'unknown'},{accountId:'b'},{personaId:'other'},{chat:'group:other'}])assert.equal(groupPrivateOpportunity({...input,messages:[{...sent,...patch}]}),null);
 assert.equal(groupPrivateOpportunity({...input,ownerIds:['123','456']}),null);
});
test('quotes, hypotheticals, refusals and completed past actions are not fresh intentions',()=>{
 for(const text of ['她说“我就去找我爸撒娇”','如果没意思我就去找我爸撒娇','我不去找我爸撒娇了','我刚才去找我爸撒娇了','鲸鱼真有意思'])assert.equal(groupPrivateOpportunity({...input,messages:[{...sent,text}]}),null,text);
});
test('a later real private exchange resolves opportunity but drafts do not',()=>{
 for(const message of [{dir:'in'},{dir:'out',delivery:'sent'}])assert.equal(groupPrivateOpportunity({...input,messages:[sent,{...sent,chat:'private:123',time:now,...message}]}),null);
 assert.ok(groupPrivateOpportunity({...input,messages:[sent,{...sent,chat:'private:123',time:now,delivery:'queued'}]}));
});

test('actual host event provider exposes group context to shared API and local initiative input',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=source.indexOf('  function initiativeEventFor(key)'),end=source.indexOf('  function initiativeCadenceGate(',start);
 const get=new Function('calendarRole','activePersona','groupPrivateOpportunity','messages','settings','effectiveGroups','initiativeEvent','lifeMemory','lifeExecution','soulFor',source.slice(start,end)+';return initiativeEventFor;')(
  ()=>({meta:{}}),()=>({id:'p'}),groupPrivateOpportunity,input.messages.map(m=>({...m,time:Date.now()-1000})),{activeAccountId:'a',owners:['123'],mood:{enabled:true}},()=>['99'],initiativeEvent,null,null,()=>({mood:{timeline:[]}}));
 const event=get('private:123');assert.equal(event.kind,'social-followup');assert.equal(event.summary.said,statement);
 assert.equal(get('group:99'),null);
});
