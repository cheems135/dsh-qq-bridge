import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
import {signatureAvailable,claimSignature,claimSpaceComment,proactiveDenial,reserveProactive,PROACTIVE_GAP_MS} from '../social-pacing.js';import {claimSpaceOffer} from '../qzone-policy.js';import {createQzoneService} from '../qzone-service.js';import {initiativePolicy,selectInitiative} from '../api-initiative.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');function extract(name,deps={}){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return fn(...Object.values(deps));}throw Error(name);}
test('automatic signature shares one Shanghai-day attempt across personas and restarts, despite unrestricted config',()=>{
 const rows=[],now=Date.parse('2026-11-06T15:59:00Z');claimSignature(rows,'a',now);const restored=structuredClone(rows);assert.equal(signatureAvailable(restored,'a',now),false);assert.throws(()=>claimSignature(restored,'a',now),/今天已尝试/);assert(signatureAvailable(restored,'a',now+120000));assert(signatureAvailable(restored,'b',now));
 assert.equal(selectInitiative([{action:'signature'}],{counts:{signature:1}},initiativePolicy({},true),{now}),null);assert(selectInitiative([{action:'signature'}],{counts:{signature:1}},initiativePolicy({},true),{now,manual:true}));
});
test('proactive contact requires both global 30min gap and a new message in the target, while one multipart episode stays intact',()=>{
 const rows=[],at=Date.now(),job={initiative:true,accountId:'a',chat:'private:1',proactiveEpisode:'one'};reserveProactive(job,rows,at-100,at);
 assert.equal(proactiveDenial(job,rows,at-100,at+10),'');assert.match(proactiveDenial({...job,proactiveEpisode:'two'},rows,at-100,at+PROACTIVE_GAP_MS+1),/新消息/);
 assert.match(proactiveDenial({...job,proactiveEpisode:'two'},rows,at+100,at+1000),/30分钟/);assert.equal(proactiveDenial({...job,proactiveEpisode:'two'},rows,at+100,at+PROACTIVE_GAP_MS+1),'');
 assert.match(proactiveDenial({...job,chat:'group:2'},rows,at+100,at+1000),/30分钟/);assert.equal(proactiveDenial({...job,initiative:false},rows,0,at+1),'');assert.equal(proactiveDenial({...job,manualInitiative:true},rows,0,at+1),'');assert.equal(proactiveDenial({...job,accountId:'b'},rows,0,at+1),'');
});
test('actual space writer permits only one proactive comment/reply attempt per visit, retains dedup, and leaves explicit requests available',async()=>{
 const offers=[],c={accountId:'a',personaId:'p',meta:{kind:'proactive',qzoneVisitToken:'t'}},scope=JSON.stringify(['a','p']);claimSpaceOffer(offers,{accountId:'a',personaId:'p',token:'t'});let posts=0,saved;
 const state={entries:[],comments:[],posts:[{scope,uin:'12345678',tid:'postABC'}]};
 const service=createQzoneService({storage:{read:()=>state,write:v=>saved=structuredClone(v)},getAuth:async()=>({uin:'12345678',gtk:123,cookie:'uin=12345678; skey=MOCK'}),beforeWrite:(row,c)=>claimSpaceComment(offers,c,row),fetchImpl:async()=>{posts++;return Response.json({code:0,data:{commentid:'commentABC'}});}});
 const first=await service.publish({text:'这一点挺有意思',target:{uin:'12345678',tid:'postABC'},comment:true},c);assert(first.ok);assert.equal(posts,1);
 const duplicate=await service.publish({text:'这一点挺有意思',target:{uin:'12345678',tid:'postABC'},comment:true},c);assert.equal(duplicate.duplicate,true);assert.equal(posts,1);
 await assert.rejects(service.publish({text:'另一条不同的评论',target:{uin:'12345678',tid:'postABC'},comment:true},c),/已尝试一条/);assert.equal(posts,1);
 assert.throws(()=>claimSpaceComment(structuredClone(offers),c,{id:'another',kind:'reply'}),/已尝试一条/);
 const manual=await service.publish({text:'本人明确要求回复',target:{uin:'12345678',tid:'postABC'},comment:true},{...c,meta:{kind:'user'}});assert(manual.ok);assert.equal(posts,2);assert(saved.entries.length>=2);
});
test('actual signature path records before dispatch and blocks a second automatic write but allows explicit user change',async()=>{
 const featureState={},settings={activeAccountId:'a'};let calls=0,saves=0;const fn=extract('setSignature',{featureState,settings,autonomyState:()=>({counts:{signature:0}}),claimSignature,saveFeatures:()=>{saves++;return true;},socialOperation:async()=>({exec:{},context:{}}),beginQqAction:()=>({}),lastSelfId:'12345',textHash:v=>v,request:async name=>{calls++;assert(saves>=1);return name==='get_stranger_info'?{signature:'hello'}:{};},log:()=>{},finishQqAction:(_e,r)=>r,executionRuntime:{finish:()=>{}},calendarSafeText:v=>v});
 await fn('hello');assert.equal(calls,2);await assert.rejects(fn('other'),/今天已尝试/);assert.equal(calls,2);await fn('user asks',{context:{meta:{kind:'user'}}});assert.equal(calls,4);
});
test('actual QQ queue preserves image/caption parts, blocks a new proactive episode, and never throttles normal requested replies',()=>{
 const featureState={outbox:[],proactiveContacts:[]},settings={activeAccountId:'a'},time=Date.now();let incoming=time-1000;
 const fn=extract('queueOutgoing',{featureState,settings,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),deliveryScopeCurrent:()=>true,personaContextIdentity:()=> 'p',cleanOutgoingText:v=>v,calendarSafeText:v=>v,groupStopped:()=>false,auditById:()=>null,noteDeliveryIssue:()=>{},recipientDenial:()=>'',recordsAllowed:()=>true,wrongOwnerAddress:()=>false,privateInitiativeAllowed:()=>true,randomUUID,deliveryFingerprint:s=>JSON.stringify(s),stopped:false,accountPaused:false,existingDelivery:()=>null,proactiveCheck:j=>proactiveDenial(j,featureState.proactiveContacts,incoming),reserveProactive,proactiveIncoming:()=>incoming,log:()=>{},saveFeatures:()=>true,logDelivery:()=>{},flushOutbox:()=>{}});
 const chat={key:'private:12345',kind:'private',chatId:'12345',turnKind:'proactive',contactEpisode:'one'};
 assert(fn(chat,[{type:'image',data:{file:'test.png'}}]));assert(fn(chat,[{type:'text',data:{text:'看这个细节'}}]));assert.equal(fn({...chat,contactEpisode:'two'},[{type:'text',data:{text:'再来一条'}}]),null);assert(fn({...chat,turnKind:'user',contactEpisode:'user'},[{type:'text',data:{text:'正常回复'}}]));assert.equal(featureState.outbox.length,3);assert(featureState.outbox[1].notBefore-featureState.outbox[0].notBefore>=3000);
});
