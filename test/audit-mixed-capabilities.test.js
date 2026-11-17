import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceConnections} from '../service-connections.js';
import {applyNonpaymentPolicy} from '../nonpayment-policy.js';
import {connectionModelGroups} from '../service-adapters.js';
import {createVideoTasks} from '../video-tasks.js';
test('device power switches survive unrestricted-mode save and reload',()=>{
 const agency={enabled:false,autonomous:false,browser:false,desktop:false,phone:false,workspace:'internal',browserEngine:'edge'};
 const next=applyNonpaymentPolicy({agency});assert.deepEqual(next.agency,agency);
 assert.equal(next.permissionsMode,'open-nonpayment');assert.deepEqual(applyNonpaymentPolicy(next).agency,agency);
 assert.equal(applyNonpaymentPolicy({}).agency.enabled,true);
});
test('video route is independent and preserved when a different source changes',()=>{
 let state=null;const c=createServiceConnections({storage:{read:()=>structuredClone(state),write:v=>{state=structuredClone(v);}}});
 const p=c.save({type:'openai',baseUrl:'https://example.com/v1',name:'Video',videoModel:'any-video',chatModel:'any-chat'});
 c.use(p.id,'video');assert.equal(c.route('video'),'profile:'+p.id);
 c.saveRoutes({...c.raw().routes,chat:'local',image:'local',speech:'legacy'});
 assert.equal(c.route('chat'),'local');assert.equal(c.route('video'),'profile:'+p.id);
 c.use(p.id,'chat');assert.equal(c.route('video'),'profile:'+p.id);
 assert.throws(()=>c.remove(p.id),/使用/);assert.throws(()=>c.save({...p,videoModel:''}),/切换来源/);assert.equal(c.profile(p.id).videoModel,'any-video');
 assert.deepEqual(connectionModelGroups([{...p,models:['voice-only','image-only','any-chat']}])[0].models.map(m=>m.id),['any-chat']);
});
test('video-only generation hands off one actual file without entering the API delivery queue',async()=>{
 const jobs=[],scope={scope:'local-turn',stamp:'s',auditId:'a',generationOnly:true};let generated=0,delivered=0;
 const tasks=createVideoTasks({jobs:()=>jobs,save(){},authorize(){},prepare:async()=>({seconds:3}),generate:async()=>{generated++;return {file:'actual.mp4'};},deliver:async()=>{delivered++;return 'unexpected';}});
 const first=await tasks.run({action:'generate',prompt:'天空云朵'},scope);const second=await tasks.run({action:'generate',prompt:'天空云朵'},scope);
 assert.equal(first.file,'actual.mp4');assert.equal(first.queued,false);assert.equal(second.id,first.id);assert.equal(generated,1);assert.equal(delivered,0);
});
