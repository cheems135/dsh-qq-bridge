import {createQzoneService} from '../qzone-service.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {qzoneEnabled,qzoneDay,dailySpaceOffer,claimSpaceOffer,spaceAccessAllowed,QZONE_DAILY_CUE} from '../qzone-policy.js';import {applyNonpaymentPolicy} from '../nonpayment-policy.js';
const text=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps={}){const start=text.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=text.indexOf('}',start);end>=0;end=text.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+text.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return fn(...Object.values(deps));}throw Error(name);}
test('space defaults off and explicit switches survive the open nonpayment policy',()=>{
 assert.equal(qzoneEnabled({}),false);const settings=applyNonpaymentPolicy({qzoneAccess:{enabled:false},autonomy:{qzone:false,qzoneReplies:false}});assert.equal(qzoneEnabled(settings),false);assert.equal(settings.autonomy.qzone,false);assert.equal(settings.autonomy.qzoneReplies,false);assert.equal(qzoneEnabled(applyNonpaymentPolicy({...settings,qzoneAccess:{enabled:true}})),true);
});
test('one persisted invitation per Shanghai day across restarts, chats and persona changes; refusal does not reset it',()=>{
 const rows=[],now=Date.parse('2026-11-06T15:59:00Z');assert.equal(qzoneDay(now),'2026-11-06');assert(claimSpaceOffer(rows,{accountId:'account',personaId:'p',token:'t',now}));const restored=JSON.parse(JSON.stringify(rows));assert.equal(claimSpaceOffer(restored,{accountId:'account',personaId:'p2',token:'other',now:now+1000}),null);assert(claimSpaceOffer(restored,{accountId:'account',personaId:'p2',token:'next',now:now+120000}));assert.equal(restored.length,2);
});
test('only the daily invitation can authorize proactive space operations; master disable wins over tokens and manual context',()=>{
 const now=Date.now(),rows=[];claimSpaceOffer(rows,{accountId:'a',personaId:'p',token:'valid',now});const c={accountId:'a',personaId:'p',meta:{kind:'proactive',qzoneVisitToken:'valid'}};
 assert(spaceAccessAllowed({qzoneAccess:{enabled:true}},rows,c,now));assert.equal(spaceAccessAllowed({qzoneAccess:{enabled:false}},rows,c,now),false);assert.equal(spaceAccessAllowed({qzoneAccess:{enabled:true}},rows,{...c,meta:{kind:'proactive'}},now),false);assert.equal(spaceAccessAllowed({qzoneAccess:{enabled:true}},rows,{...c,personaId:'other'},now),false);assert.equal(spaceAccessAllowed({qzoneAccess:{enabled:false}},rows,{panel:true},now),false);
});
test('disabled login maintenance does not even access credential/session services',async()=>{
 const maintain=extract('maintainQzoneSession',{qzoneEnabled,settings:{qzoneAccess:{enabled:false}},qzoneConnectionStatus:()=>({state:'disabled'}),qzoneSession:()=>{throw Error('must not load credentials');}});assert.equal((await maintain(true)).state,'disabled');assert.equal((await maintain(false)).state,'disabled');
});
test('daily reminder dispatch persists once before model work, including declines and enqueue failures',async()=>{
 const featureState={},chat={key:'private:12345',turns:new Map(),pendingTurns:[]},settings={qzoneAccess:{enabled:true},life:{enabled:true},localChat:{enabled:false},activeAccountId:'a',owners:['12345']};let calls=0,saved=0;
 const offer=extract('offerDailyQzone',{qzoneEnabled,settings,featureState,dailySpaceOffer,privateInitiativeAllowed:()=>true,pausedConversation:()=>false,activePersona:()=>({id:'p'}),lifeExecution:{asleep:()=>false},calendarMeta:()=>({}),ensureSession:async()=> 'id',chats:new Map([['id',chat]]),attachChat:()=>{},claimSpaceOffer,randomUUID:()=> 'token',saveFeatures:()=>{saved++;return true;},nudge:async(_c,cue,_k,opts)=>{calls++;assert.equal(saved,1);assert.equal(opts.qzoneVisitToken,'token');assert.match(cue,/唯一一次/);return false;},QZONE_DAILY_CUE});
 assert.equal(await offer(),true);assert.equal(await offer(),false);assert.equal(calls,1);assert.equal(featureState.qzoneDailyOffers[0].queued,false);
});

test('master off rejects real space service paths before credentials, upload or HTTP',async()=>{
 let calls=0;const settings={qzoneAccess:{enabled:false}},c={accountId:'a',personaId:'p'},service=createQzoneService({storage:{read:()=>({entries:[],comments:[],posts:[]}),write:()=>{}},authorize:context=>spaceAccessAllowed(settings,[],context),getAuth:()=>{calls++;throw Error('credential access forbidden');},loadImage:()=>{calls++;throw Error('upload forbidden');},fetchImpl:()=>{calls++;throw Error('network forbidden');}});
 for(const action of [()=>service.publish({text:'test',images:[]},c),()=>service.feed({},c),()=>service.comments({tid:'tid',uin:'12345'},c),()=>service.verifyEntry('id',c),()=>service.nextReply(c)])await assert.rejects(action(),/空间操作停止/);
 assert.equal(calls,0);
});
