import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {API_CONNECTION_TYPES, deviceCapabilities, openPermissionControls} from '../settings-contract.js';
import {applyNonpaymentPolicy} from '../nonpayment-policy.js';
import {apiOnlySettings,apiOnlyConnections,assertMobileConnection} from '../mobile-api-policy.js';
import {createFormState} from '../ui/form-state.js';
import {createMediaTaskLifecycle} from '../media-task-lifecycle.js';
import {CONSOLE_ASSETS} from '../console-assets.js';

test('open policy preserves user safety choices and local model settings without mutating inputs',()=>{
  const original={permissionsMode:'open-nonpayment',socialPacingRevision:'20261106-natural-rest-v1',groupRequireAt:false,
    life:{sleep:false,actualTasks:false},localChat:{enabled:true,initiativeEnabled:false},
    agency:{enabled:false,browser:false},autonomy:{enabled:false,shareMedia:{schedule:false}},
    qzone:{enabled:false},bilibili:{publishEnabled:false},allowGroups:['allowed'],phone:{paymentMode:'confirm'}};
  const snapshot=structuredClone(original),result=applyNonpaymentPolicy(original);
  assert.deepEqual(original,snapshot);
  assert.equal(result.autonomy.enabled,true);assert.equal(result.autonomy.shareMedia.schedule,false);
  for(const key of ['localChat','qzone','bilibili','allowGroups'])assert.deepEqual(result[key],original[key]);
  assert.equal(result.life.sleep,false);assert.equal(result.life.actualTasks,false);assert.equal(result.phone.paymentMode,'confirm');
  assert.equal(result.agency.enabled,false);assert.equal(result.agency.browser,false);
  assert(openPermissionControls(result).ids.includes('autoMaster'));
  assert(!openPermissionControls(result).ids.includes('shSchedule'));
  const configured={...original,permissionsMode:'configured'};
  assert.deepEqual(applyNonpaymentPolicy(configured),configured);
  assert.deepEqual(openPermissionControls(configured),{ids:[],selectors:[]});
});

test('phone capability and accepted API types agree with backend routing, desktop stays local-capable',()=>{
  for(const type of API_CONNECTION_TYPES){
    assert.doesNotThrow(()=>assertMobileConnection(type,true));
    const routes=apiOnlyConnections({profiles:[{id:'a',type}],routes:{chat:'profile:a',image:'profile:a'}}).routes;
    assert.equal(routes.chat,'profile:a');assert.equal(routes.image,'profile:a');
  }
  for(const edition of ['mobile','phone']){
    assert.equal(deviceCapabilities(edition).apiOnly,true);
    const settings=apiOnlySettings({localChat:{enabled:true},agency:{desktop:true}},deviceCapabilities(edition).apiOnly);
    assert.equal(settings.localChat.enabled,false);assert.equal(settings.agency.desktop,false);
  }
  assert.equal(deviceCapabilities('desktop').apiOnly,false);
  assert.equal(apiOnlySettings({localChat:{enabled:true}},false).localChat.enabled,true);
  assert.throws(()=>assertMobileConnection('comfyui',true));
  assert.equal(apiOnlyConnections({routes:{chat:'local',image:'local'}}).routes.chat,'host');
});

test('late acknowledgement after leaving page retains edits newer than submitted values',()=>{
  const state=createFormState();state.begin('model',{model:'original',temperature:'0.7'});
  state.capture('model',{model:'submitted',temperature:'0.8'});
  const submitted={model:'submitted',temperature:'0.8'};
  state.capture('model',{model:'typed after submit',temperature:'0.9'});
  state.begin('other',{title:'another page'});
  state.acknowledge('model',submitted,['model'],null);
  assert.deepEqual(state.drafts.model,{model:'typed after submit',temperature:'0.9'});
  assert.deepEqual(state.baselines.model,{model:'submitted',temperature:'0.7'});
  const restored=state.begin('model',{model:'submitted',temperature:'0.7'});
  assert.equal(restored.model,'typed after submit');
  state.acknowledge('model',{model:'typed after submit'},['model'],null);
  assert.deepEqual(state.drafts.model,{temperature:'0.9'});
});

test('a file draft survives navigation and unrelated saves until its own upload is acknowledged',()=>{
  const state=createFormState(),empty={type:'file',signature:'',files:[]},chosen={type:'file',signature:'portrait:123',files:['portrait']};
  state.begin('image',{file:empty,name:'old'});state.capture('image',{file:chosen,name:'new'});
  state.acknowledge('image',{name:'new'},['name']);assert.equal(state.drafts.image.file,chosen);
  state.acknowledge('image',{file:chosen},['file']);assert.equal(state.drafts.image,undefined);
  state.discard('image');assert.equal(state.baselines.image,undefined);
});

function mediaFixture(){
  const state={mediaTasks:[],outbox:[]},events=[],audit={accountId:'account',persona:'persona'};
  let account='account',persona='persona',source='local',serial=0;
  const tasks=createMediaTaskLifecycle({state:()=>state,account:()=>account,persona:()=>persona,source:()=>source,audit:()=>audit,
    record:(event,context)=>events.push({event,context}),persist(){},now:()=>100,id:()=>String(++serial)});
  return {tasks,state,events,audit,setAccount:value=>account=value,setPersona:value=>persona=value,setSource:value=>source=value};
}

test('waiting retries and unknown delivery cannot resubmit the same media; failed history does not hide active retry',()=>{
  const f=mediaFixture(),chat={key:'private:1',auditId:'turn'};
  const failed=f.tasks.begin(chat,'voice').task;f.tasks.finish(failed,'failed');
  const retry=f.tasks.begin(chat,'voice').task;assert.notEqual(retry.id,failed.id);
  f.tasks.finish(retry,'waiting_service');assert.equal(f.tasks.begin(chat,'voice').task.id,retry.id);
  f.tasks.finish(retry,'unknown');assert.equal(f.tasks.begin(chat,'voice').duplicate,true);
  assert.equal(f.state.mediaTasks.length,2);
  assert.equal(f.tasks.begin({...chat,auditId:'next-turn'},'voice').duplicate,false);
});

test('media lifecycle separates account/persona/chat/kind and does not claim recipient read after QQ acceptance',()=>{
  const f=mediaFixture(),chat={key:'group:1',auditId:'turn'},image=f.tasks.begin(chat,'image').task;
  assert.equal(f.tasks.begin(chat,'voice').duplicate,false);
  assert.equal(f.tasks.begin({...chat,key:'private:1'},'image').duplicate,false);
  f.setAccount('another');assert.equal(f.tasks.begin(chat,'image').duplicate,false);f.setAccount('account');
  f.setPersona('another');assert.equal(f.tasks.begin(chat,'image').duplicate,false);f.setPersona('persona');
  f.setSource('api');f.tasks.finish(image,'generated',{file:'image.png'});
  f.state.outbox.push({id:'delivery',mediaTaskId:image.id,status:'sent',messageId:'123'});
  f.tasks.finish(image,'sent',{deliveryId:'delivery'});
  assert.equal(f.events.at(-1).context.backend,'local');
  assert.equal(f.events.at(-1).event.mediaExecution.state,'accepted');
  assert.equal(f.events.at(-1).event.mediaExecution.recipient,'unknown');
});

test('every console stylesheet, script and module dependency is explicitly served and packaged',()=>{
  const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))),byName=new Map(CONSOLE_ASSETS.map(a=>[a.name,a]));
  assert.equal(byName.size,CONSOLE_ASSETS.length);
  const html=fs.readFileSync(new URL('../console.html',import.meta.url),'utf8');
  for(const m of html.matchAll(/(?:src|href)="\/im-bridge\/ui\/([^?"/]+)(?:\?[^"\s]*)?"/g))assert(byName.has(m[1]),m[1]);
  for(const asset of CONSOLE_ASSETS){
    assert.match(asset.name,/^[a-z0-9-]+\.(?:js|css)$/);
    assert(fs.existsSync(new URL('../'+asset.source,import.meta.url)),asset.source);
    if(!asset.source.startsWith('./ui/'))assert(pkg.files.includes(asset.source.slice(2)),asset.source+' packaged');
    if(!asset.name.endsWith('.js'))continue;
    const text=fs.readFileSync(new URL('../'+asset.source,import.meta.url),'utf8');
    for(const m of text.matchAll(/^import .+ from '\.\/([^']+)'/gm))assert(byName.has(m[1]),m[1]+' import route');
  }
});
