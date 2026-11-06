import test from 'node:test';
import assert from 'node:assert/strict';
import {createBilibiliTool} from '../bilibili-tool.js';
import {createAgentCapabilities} from '../agent-capabilities.js';

test('API and local tool calls use the same account service with backend-appropriate QR delivery',async()=>{
  const calls=[],sent=[];
  const tool=createBilibiliTool({service:{act:async(args,context)=>{calls.push(context);return {ok:true,status:'waiting',qrFile:'D:/login.gif',qrImage:'PRIVATE_QR_DATA',expiresAt:Date.now()+180000};}},sendQr:async(file,c,key)=>{sent.push({file,c,key});return 'delivery-1';}});
  const api={accountId:'qq',personaId:'p',key:'private:owner'};
  const [first,second]=await Promise.all([tool({action:'login'},api),tool({action:'login'},api)]);
  assert.equal(first.qrDelivery.status,'queued');assert.equal(second.qrDelivery.id,'delivery-1');assert.equal(sent.length,1);assert.doesNotMatch(JSON.stringify(first),/PRIVATE_QR_DATA|D:\/login/);
  const local=await tool({action:'login'},{...api,localTurn:true});assert.deepEqual(local.media,[{kind:'image',file:'D:/login.gif'}]);assert.equal(sent.length,1);
  assert.ok(calls.every(c=>c.accountId==='qq'&&c.personaId==='p'));
  const panel=await tool({action:'login'},{...api,panel:true});assert.equal(panel.loginPage,'/im-bridge/console#bilibili');assert.equal(sent.length,1);
});

test('Bilibili is registered for native API tools and discoverable through the local router',async()=>{
  const registered=new Map(),calls=[];
  const apiContext={accountId:'qq',personaId:'p',key:'private:owner'};
  const capability=createAgentCapabilities({ctx:{get:name=>name==='tools'?{register:definition=>{registered.set(definition.name,definition);return()=>{};}}:null},getConfig:()=>({enabled:true}),getContext:()=>apiContext,authorize:()=>true,browser:{status:()=>({}),close:async()=>{}},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:async()=>({})}),services:{bilibili:async(args,c)=>{calls.push(c);return {ok:true,account:{loggedIn:true,uid:'42'}};}}});
  try{
    assert.equal(capability.start(),true);assert.ok(registered.has('bridge_bilibili'));
    await registered.get('bridge_bilibili').execute({action:'status'},{name:'bridge_bilibili'});
    const router=capability.localTools({...apiContext,localTurn:true}).bridge_tools;
    assert.ok((await router.execute({action:'list'})).tools.some(t=>t.name==='bridge_bilibili'));
    await router.execute({action:'call',name:'bridge_bilibili',arguments:{action:'status'}});
    assert.equal(calls[0],apiContext);assert.equal(calls[1].localTurn,true);assert.equal(calls[1].accountId,apiContext.accountId);
  }finally{capability.close();}
});

test('tool status omits QR pixels and pending credentials',async()=>{
  const tool=createBilibiliTool({service:{act:async()=>({ok:true,login:{status:'waiting',expiresAt:123,qrImage:'PRIVATE_QR'}})}});
  assert.deepEqual(await tool({action:'status'},{}),{ok:true,login:{status:'waiting',expiresAt:123}});
});
