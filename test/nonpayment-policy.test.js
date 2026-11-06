import test from 'node:test';
import assert from 'node:assert/strict';
import {applyNonpaymentPolicy,nonpaymentOpen} from '../nonpayment-policy.js';

function policyFixture(){
  return {
    permissionsMode:'open',
    whitelist:['10001','10002'],
    groups:['20001','20002'],
    disabledUsers:['10003'],
    disabledGroups:['20003'],
    owners:['10001'],
    ownerPerms:{send:false,broadcast:true,schedule:false},
    payment:{enabled:true,maxAmount:88},
    guard:{maxPerMinute:17,minGapMs:900},
    credentials:{apiKey:'keep-this-value'},
    bilibili:{comments:'manual',manualComments:true,publish:false},
    contactProfiles:{
      'private:10001':{id:'10001',personaId:'persona-a',disabled:true,proactive:false,voiceEnabled:false,bilibili:{comments:'manual'}},
      'group:20001':{id:'20001',personaId:'persona-b',disabled:true,proactive:false},
    },
    agency:{enabled:false,autonomous:false,browser:false,desktop:false,phone:false,workspace:'internal',extra:'agency'},
    phone:{enabled:false,autonomous:false,learningApps:['bilibili'],maxAmount:20,extra:'phone'},
    realism:{enabled:false,unlimitedProactive:false,safety:{phone:false,payment:false,privacy:true,coercion:true}},
    life:{enabled:false,sleep:true,schedule:true},
    dnd:{enabled:true,startHour:22,endHour:8},
    autonomy:{
      enabled:false,initiate:false,explore:false,qzone:false,qzoneImages:false,qzoneReplies:false,
      chatIdleMinutes:30,maxPerDay:{chats:1},minGapMinutes:45,
      shareMedia:{enabled:false,limits:true,voice:false,images:false,minGapMinutes:60},
    },
    companion:{enabled:false,expressionMode:'reserved',casualInitiative:false,respectPauses:true,continuity:true},
    voice:{enabled:false,engine:'none'},
    imagegen:{enabled:false,model:'keep-image-model'},
    localChat:{enabled:false,baseUrl:'http://127.0.0.1:8777'},
  };
}

test('nonpayment mode is open by default and only configured mode opts out',()=>{
  assert.equal(nonpaymentOpen({}),true);
  assert.equal(nonpaymentOpen({permissionsMode:'open'}),true);
  assert.equal(nonpaymentOpen({permissionsMode:'configured'}),false);
});

test('default policy normalizes nonpayment capabilities without mutating preserved authority',()=>{
  const input=policyFixture(),before=structuredClone(input),next=applyNonpaymentPolicy(input);
  assert.deepEqual(input,before);
  assert.notEqual(next,input);
  assert.notEqual(next.agency,input.agency);
  assert.notEqual(next.contactProfiles,input.contactProfiles);
  assert.deepEqual(next.agency,{enabled:true,autonomous:true,browser:true,desktop:true,phone:true,workspace:'desktop',extra:'agency'});
  assert.deepEqual(next.phone,{enabled:true,autonomous:true,learningApps:['bilibili'],maxAmount:20,extra:'phone',learning:true});
  assert.equal(next.realism.safety.phone,true);
  assert.equal(next.realism.safety.payment,false);
  assert.equal(next.realism.unlimitedProactive,true);
  assert.equal(next.life.sleep,true);
  assert.equal(next.life.enabled,false);
  assert.equal(next.dnd.enabled,false);
  assert.deepEqual({startHour:next.dnd.startHour,endHour:next.dnd.endHour},{startHour:22,endHour:8});
  assert.deepEqual(next.autonomy,{
    enabled:true,initiate:true,explore:true,qzone:true,qzoneImages:true,qzoneReplies:true,
    chatIdleMinutes:0,maxPerDay:{chats:1},minGapMinutes:45,
    shareMedia:{enabled:true,limits:false,voice:true,images:true,minGapMinutes:60,duringChat:true,idle:true},
  });
  assert.equal(next.companion.expressionMode,'free');
  assert.equal(next.companion.casualInitiative,true);
  assert.equal(next.companion.respectPauses,true);
  assert.equal(next.companion.enabled,false);
  assert.equal(next.contactProfiles['private:10001'].proactive,true);
  assert.equal(next.contactProfiles['group:20001'].proactive,true);
  assert.equal(next.contactProfiles['private:10001'].disabled,true);
  assert.equal(next.contactProfiles['group:20001'].disabled,true);
  assert.deepEqual(next.contactProfiles['private:10001'].bilibili,{comments:'manual'});

  for(const key of ['whitelist','groups','disabledUsers','disabledGroups','owners','ownerPerms','payment','guard','credentials','bilibili','voice','imagegen','localChat']){
    assert.deepEqual(next[key],before[key],key);
  }
  assert.deepEqual(applyNonpaymentPolicy(next),next);
});

test('mobile policy keeps phone access but disables desktop and selects the internal workspace',()=>{
  const next=applyNonpaymentPolicy({agency:{enabled:false,autonomous:false,browser:false,desktop:true,phone:false,workspace:'desktop'},phone:{enabled:false,autonomous:false}},{mobile:true});
  assert.equal(next.agency.enabled,true);
  assert.equal(next.agency.phone,true);
  assert.equal(next.agency.desktop,false);
  assert.equal(next.agency.workspace,'internal');
});

test('configured permissions are preserved while still returning a structural copy',()=>{
  const input={...policyFixture(),permissionsMode:'configured'},before=structuredClone(input),next=applyNonpaymentPolicy(input);
  assert.deepEqual(next,input);
  assert.notEqual(next,input);
  assert.notEqual(next.agency,input.agency);
  assert.deepEqual(input,before);
});

test('social availability migrates separately from unrestricted tool permission and preserves later user choices',()=>{const next=applyNonpaymentPolicy({permissionsMode:'open-nonpayment',groupRequireAt:false,life:{sleep:false}});assert.equal(next.groupRequireAt,true);assert.equal(next.life.sleep,true);assert.equal(next.agency.enabled,true);assert.equal(next.autonomy.enabled,true);assert.equal(next.realism.unlimitedProactive,true);const chosen=applyNonpaymentPolicy({...next,groupRequireAt:false,life:{...next.life,sleep:false}});assert.equal(chosen.groupRequireAt,false);assert.equal(chosen.life.sleep,false);});
