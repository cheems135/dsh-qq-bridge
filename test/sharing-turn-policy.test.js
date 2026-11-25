import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');

test('existing owner autonomy permits an independent sharing choice without treating quoted instructions as authority',()=>{
  const line=source.match(/    content\.autonomousSharingAllowed = [^\n]+;/)[0];
  const run=Function('content','chatKey','settings','payload',line);
  const settings={owners:['12345'],agency:{enabled:true,autonomous:true},autonomy:{enabled:true}},payload={user_id:12345};
  const content={allowSideEffects:false};run(content,'private:12345',settings,payload);
  assert.equal(content.autonomousSharingAllowed,true);assert.equal(content.allowSideEffects,false);
  for(const change of [{_sleepReview:true},{_bridgePoke:true},{_bridgeApiTaskDone:true},{user_id:67890}]){const c={allowSideEffects:false};run(c,'private:12345',settings,{...payload,...change});assert.equal(c.autonomousSharingAllowed,false);}
  const group={};run(group,'group:12345',settings,payload);assert.equal(group.autonomousSharingAllowed,false);
});

test('sharing permission remains scoped to the original account, persona and dialogue and cannot authorize other operations',()=>{
  const origin={autonomousSharingAllowed:true,accountId:'a',persona:'p',chat:'private:12345',userWords:'这篇文章有意思'},settings={activeAccountId:'a',agency:{enabled:true,autonomous:true},autonomy:{enabled:true}};
  const deps={auditById:()=>origin,settings,activePersona:()=>({id:'p'}),mediaShareScope:()=>true,mediaLedger:()=>({}),autonomyConfig:()=>({shareMedia:{}}),lifeMemory:null,calendarRole:()=>({}),reserveShare:(_c,_l,args)=>({id:'share',...args}),saveState:()=>{},featureState:{generation:0}};
  const start=source.indexOf('  function beginMediaShare('),end=source.indexOf('  function mediaShareCurrent(',start);
  const begin=Function(...Object.keys(deps),source.slice(start,end)+';return beginMediaShare;')(...Object.values(deps));
  const chat={key:'private:12345',turnKind:'user',allowSideEffects:false,auditId:'turn'};
  assert(begin('image',chat,'自己的一个想法'));assert.equal(chat.allowSideEffects,false);
  for(const key of ['accountId','persona','chat']){const original=origin[key];origin[key]='other';assert.equal(begin('image',chat,'想分享'),null);origin[key]=original;}
  origin.autonomousSharingAllowed=false;assert.equal(begin('image',chat,'想分享'),null);
});
