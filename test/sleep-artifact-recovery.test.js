import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {registerDigitalArtifact} from '../digital-artifacts.js';
import {createExecutionRuntime} from '../execution-runtime.js';
import {reconcileArtifactRejections,createLifeExecution} from '../life-execution.js';
import {createSleepInbox,privateConversationBoundary} from '../sleep-inbox.js';
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');

test('a late-synced unread survives an advanced scan watermark and an unrelated later reply; overlap scans admit it once',async()=>{
 const start=source.indexOf('  async function catchUpMissedMessages() {'),end=source.indexOf('  async function sharedContext(',start),now=Date.now(),key='private:12345',captured=new Set(),calls=[];
 const deps={socket:{ready:true},stopped:false,accountPaused:false,settings:{activeAccountId:'a'},featureState:{generation:0,inbox:[],audits:[]},lastSelfId:'99999',effectiveUsers:()=>['12345'],effectiveGroups:()=>[],state:{historyScanAt:{[JSON.stringify(['a','99999','p',key])]:now-1000}},activePersona:()=>({id:'p'}),recordsAllowed:()=>true,pausedConversation:()=>false,groupStopped:()=>false,messages:[{chat:key,accountId:'a',personaId:'p',dir:'in',messageId:'newer',time:now-30000},{chat:key,accountId:'a',personaId:'p',dir:'out',delivery:'sent',replyToInboundIds:['newer'],time:now-20000}],request:async(action,params)=>{calls.push(params);return {messages:[{message_id:'missed',message_seq:123,time:Math.floor(now/1000)-7200,user_id:'12345',sender:{user_id:'12345'},message:[{type:'text',data:{text:'离线时漏掉的闲聊'}}]}]};},sleepInboxScope:()=>({accountId:'a',personaId:'p',key}),sleepInbox:{capture:p=>{if(captured.has(p.message_id))return false;captured.add(p.message_id);return true;}},reviewSleepInbox:()=>{},saveState:()=>{},log:()=>{}};
 const run=Function(...Object.keys(deps),source.slice(start,end)+';return catchUpMissedMessages;')(...Object.values(deps));
 assert.equal((await run()).queued,1);assert.equal((await run()).queued,0);assert.deepEqual([...captured],['missed']);assert.equal(calls[0].message_seq,0);
});
test('artifact refusal explains exact destination, relative import verifies checksum and preserves original',t=>{
 const dir=fs.mkdtempSync(path.join(process.cwd(),'test-artifact-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const root=path.join(dir,'persona'),workspace=path.join(dir,'task');fs.mkdirSync(root);fs.mkdirSync(workspace);fs.mkdirSync(path.join(workspace,'notes'));const original=path.join(workspace,'notes','完成.md');fs.writeFileSync(original,'已完成的真实作品');
 const options={workspace,since:Date.now()-10000};const rejected=registerDigitalArtifact(root,'notes/完成.md',options);
 assert.equal(rejected.status,'not_applied');assert.equal(rejected.submitted,false);assert.equal(rejected.artifactDir,fs.realpathSync(root));assert.match(rejected.nextStep,/action=import/);assert.equal(fs.readdirSync(root).length,0);
 const imported=registerDigitalArtifact(root,'notes/完成.md',{...options,action:'import'});assert.equal(imported.ok,true);assert.equal(imported.originalPreserved,true);assert.equal(fs.readFileSync(imported.file,'utf8'),fs.readFileSync(original,'utf8'));
 assert.equal(registerDigitalArtifact(root,original,{...options,action:'import'}).sha256,imported.sha256);assert.equal(fs.readdirSync(root).length,1);
 const outside=path.join(dir,'outside.md');fs.writeFileSync(outside,'其他文件');assert.equal(registerDigitalArtifact(root,outside,{...options,action:'import'}).status,'not_applied');
 const missing=registerDigitalArtifact(root,'不存在.md',options);assert.equal(missing.code,'ENOENT');assert.equal(missing.workspaceDir,workspace);
});
test('read-only failures cannot deadlock task, unknown native writes and sends still require reconciliation',()=>{
 for(const [name,args,result,opts,expected] of [
  ['bridge_life_artifact',{file:'missing'},{ok:false,status:'not_applied',submitted:false,queued:false},{},'not_applied'],
  ['bridge_life_artifact',{file:'missing'},undefined,{error:'ENOENT'},'failed'],
  ['write_file',{file:'a'},undefined,{error:'timeout'},'unknown'],
  ['bridge_life_qq',{action:'send',target:'private:12345'},undefined,{error:'timeout'},'unknown']
 ]){
  const settled=[],begun=[];const rt=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>({beginStep:(_i,_m,v)=>{begun.push(v);return {step:{id:'s'}};},settleStep:(_i,_m,_s,r)=>settled.push(r)})});
  const exec={name,arguments:args},c={accountId:'a',personaId:'p',meta:{lifeJobId:'j'}};rt.begin(exec,c);rt.finish(exec,c,result,opts);assert.equal(settled[0].status,expected);if(name==='bridge_life_artifact')assert.equal(begun[0].idempotent,true);
 }
});
test('legacy recovery requires exact host journal and scope, never clears other unknown operations or checkpoints',()=>{
 const meta={accountId:'a',personaId:'p'},step=()=>({id:'s',status:'unknown',effect:'local',idempotent:false,evidence:{operationId:'op'}}),make=()=>({id:'j',meta,status:'needs_reconcile',at:1,checkpoint:{next:'保留实际进度'},steps:[step()]});
 const op={id:'op',tool:'bridge_life_artifact',...meta,error:'只登记当前角色自己的数字作品目录中的文件'},data={jobs:[make()]};
 assert.equal(reconcileArtifactRejections(data,[{...op,personaId:'wrong'}]),0);assert.equal(reconcileArtifactRejections(data,[op]),1);assert.equal(data.jobs[0].status,'paused');assert.equal(data.jobs[0].steps[0].status,'not_applied');assert.equal(data.jobs[0].checkpoint.next,'保留实际进度');assert.equal(reconcileArtifactRejections(data,[op]),0);
 const mixed={jobs:[make()]};mixed.jobs[0].steps.push({status:'unknown',effect:'send',idempotent:false});reconcileArtifactRejections(mixed,[op]);assert.equal(mixed.jobs[0].status,'needs_reconcile');
 let saved;const engine=createLifeExecution({storage:{read:()=>({jobs:[make()]}),write:x=>saved=structuredClone(x)},config:()=>({}),roles:()=>[],operationJournal:()=>[op]});assert.equal(saved.jobs[0].steps[0].status,'not_applied');engine.close();
});
test('API mode retains sleeping message and original image just like local mode; unmentioned groups stay untouched',()=>{
 const start=source.indexOf('    if(sleepingPayload(payload)){',source.indexOf('  function handlePayload(')),end=source.indexOf("      const segments=segmentsOf(payload.message),key='private:'",start);assert(end>start);
 for(const enabled of [false,true]){
  const captured=[];const deps={settings:{localChat:{enabled}},sleepingPayload:()=>true,sleepInboxScope:()=>({key:'private:12345'}),stopped:false,accountPaused:false,recordsAllowed:()=>true,pausedConversation:()=>false,groupStopped:()=>false,mentionsSelf:()=>false,sleepInbox:{capture:p=>{captured.push(p);return false;}},memoryHub:null};
  const handle=Function(...Object.keys(deps),'payload',source.slice(start,end)+'}') .bind(null,...Object.values(deps));
  const p={message_type:'private',user_id:'12345',self_id:'99999',message_id:'m',message:[{type:'image',data:{file:'original'}}]};handle(p);assert.equal(captured.length,1);assert.equal(captured[0].message[0].data.file,'original');handle({...p,message_type:'group'});assert.equal(captured.length,1);
 }
});
test('failed unread admission is retried from retained originals, while ambiguous sends are never replayed',()=>{
 let rows=[],clock=1000;const scope={accountId:'a',personaId:'p',key:'private:12345'},box=createSleepInbox({getRows:()=>rows,setRows:r=>rows=r,save:()=>{},now:()=>clock});const p={self_id:'9',message_id:'m',message_type:'private',user_id:'12345',time:1,message:[{type:'text',data:{text:'睡醒看看'}}]};box.capture(p,scope);const first=box.batches(()=>true)[0];box.acknowledge(first.rows.map(r=>r.id),first.messageId);assert(rows[0].recoveryPayload);clock+=61000;
 const job={id:'9:private:12345:'+first.messageId,status:'admitted'},audit={id:'audit',accountId:'a',persona:'p',chat:scope.key,at:1100,inboundIds:['m'],status:'failed'};
 box.reconcile([job],[audit],[{auditId:'audit',status:'unknown'}]);assert.equal(rows[0].status,'queued');box.reconcile([job],[audit],[]);assert.equal(rows[0].status,'pending');assert.notEqual(box.batches(()=>true)[0].messageId,first.messageId);assert.equal(rows[0].payload.message[0].data.text,'睡醒看看');
});
test('sleep review status reflects observed delivery rather than mere queue admission',()=>{
 let rows=[];const box=createSleepInbox({getRows:()=>rows,setRows:r=>rows=r,save:()=>{},now:()=>100});box.capture({self_id:'9',message_id:'m',time:1,message:[]},{accountId:'a',personaId:'p',key:'private:12345'});const b=box.batches(()=>true)[0];box.acknowledge(b.rows.map(r=>r.id),b.messageId);box.reconcile([],[],[]);assert.equal(rows[0].status,'queued');box.reconcile([],[{id:'a',accountId:'a',persona:'p',chat:'private:12345',at:100,inboundIds:['m'],status:'completed',deliveryState:'sent'}],[]);assert.equal(rows[0].status,'reviewed');assert.equal(rows[0].recoveryPayload,undefined);
});
test('real reconnect history path captures sleeping messages without fresh command execution, rejects stale account results',async()=>{
 const start=source.indexOf('  async function catchUpMissedMessages() {'),end=source.indexOf('  async function sharedContext(',start);assert(end>start);
 for(const stale of [false,'profile','receiver']){
  const captured=[],settings={activeAccountId:'a'},featureState={generation:0,inbox:[]};let reviews=0;
  const deps={stopped:false,accountPaused:false,socket:{ready:true},settings,featureState,saveState:()=>{},lastSelfId:'99999',cfg:{napcat:{}},effectiveUsers:()=>['12345'],effectiveGroups:()=>[],messages:[],state:{},activePersona:()=>({id:'p'}),request:async()=>{if(stale)settings.activeAccountId='changed';return {messages:[{message_id:1,time:Math.floor(Date.now()/1000),user_id:'12345',sender:{user_id:'12345'},message:[{type:'text',data:{text:'睡着时收到的消息'}}]}]};},sleepInboxScope:()=>({accountId:'a',personaId:'p',key:'private:12345'}),recordsAllowed:()=>true,pausedConversation:()=>false,groupStopped:()=>false,mentionsSelf:()=>false,sleepInbox:{capture:(p,s)=>captured.push({p,s})},reviewSleepInbox:()=>reviews++,log:()=>{}};
  if(stale==='receiver'){
    const readHistory=deps.request;
    deps.request=async()=>{const result=await readHistory();settings.activeAccountId='a';deps.socket.qqReceiverRevision=2;return result;};
  }
  deps.privateConversationBoundary=privateConversationBoundary;
  const run=Function(...Object.keys(deps),'let catchUpRunning=false,lastCatchUpAt=0;const catchUpUnavailable=new Set();'+source.slice(start,end)+';return catchUpMissedMessages;')(...Object.values(deps));await run();assert.equal(captured.length,stale?0:1);assert.equal(reviews,stale?0:1);if(!stale)assert.equal(captured[0].p._bridgeCatchUp,true);
 }
});

test('interleaved private messages use actual inbound references and a legacy wait delivery stays in its account',()=>{
 const scope={accountId:'a',personaId:'p',chat:'private:12345'};
 const history=[
  {...scope,dir:'in',time:10,messageId:'first'},
  {...scope,dir:'in',time:20,messageId:'second'},
  {...scope,dir:'out',time:30,localId:'delayed',delivery:'sent'},
 ];
 const job={...scope,id:'delayed',status:'sent',messageId:'out',replyToInboundIds:['first']};
 assert.equal(privateConversationBoundary(history,[job]),10);
 assert.equal(privateConversationBoundary(history,[{...job,deliveryKey:'local:turn:wait:part:1'}]),0);
 assert.equal(privateConversationBoundary(history,[{...job,messageId:''}]),0);
 assert.equal(privateConversationBoundary(history,[{...job,accountId:'b',deliveryRole:'progress'}]),20);
});

test('the ordinary missed-private check never follows up a different account, withdrawn message, archived gap, or deliberately silent turn',async()=>{
 const start=source.indexOf('  async function checkMissedReplies()'),end=source.indexOf('  let lastSpaceTidy=',start);
 const time=Date.now()-20*60_000,key='private:12345';
 const last={dir:'in',chat:key,accountId:'a',personaId:'p',messageId:'M',time,text:'这本小说推荐先看哪一章？'};
 const audit={chat:key,accountId:'a',persona:'p',inboundIds:['M'],status:'silent'};
 for(const [row,audits,expected] of [
  [last,[],1],[{...last,retracted:true},[],0],[{...last,source:'offline-history'},[],0],
  [{...last,accountId:'b'},[],0],[{...last,personaId:'q'},[],0],[last,[audit],0],
  [last,[{...audit,status:'completed',deliveryState:'withheld'}],0],[last,[{...audit,accountId:'b'}],1],
 ]){
   const cues=[];
   const deps={featureState:{audits},settings:{activeAccountId:'a'},effectiveUsers:()=>['12345'],state:{chats:{[key]:{sessionId:'s'}}},chats:new Map([['s',{}]]),
     activePersona:()=>({id:'p'}),messages:[row],nudge:async(_chat,cue)=>cues.push(cue),noteEvent:()=>{},saveFeatures:()=>{}};
   const run=Function(...Object.keys(deps),'let lastMissedCheck=0;'+source.slice(start,end)+';return checkMissedReplies;')(...Object.values(deps));
   await run();assert.equal(cues.length,expected);
 }
});

for (const [label, deliveryRow, archivesOlder] of [
 ['legacy conversation', {}, true], ['sent reply', {delivery:'sent'}, true],
 ...['queued','sending','failed','cancelled','unknown'].map(delivery => [delivery, {delivery}, false]),
 ['withdrawn reply', {delivery:'sent',retracted:true}, false],
 ['automatic outreach', {delivery:'sent',automaticPrivate:true}, false],
 ['manual outreach', {delivery:'sent',initiative:true}, false],
 ['wait notice', {delivery:'sent',deliveryRole:'progress'}, false],
 ['legacy wait notice', {delivery:'sent',deliveryKey:'local:queue:abc:part:1'}, false],
 ['reply to unrelated request', {delivery:'sent',replyToInboundIds:['another']}, false],
 ['reply to merged message', {delivery:'sent',replyToInboundIds:['merged']}, true],
]) test('reconnect recovers private gaps once and admits only an explicit group mention: '+label,async()=>{
 const start=source.indexOf('  async function catchUpMissedMessages() {'),end=source.indexOf('  async function sharedContext(',start);
 const sec=Math.floor(Date.now()/1000),messages=[],captured=[],archived=[],state={},calls=[];
 const row=(id,time,user,msg=[])=>({message_id:id,time,user_id:user,sender:{user_id:user},message:msg});
 messages.push({chat:'private:12345',dir:'in',time:(sec-30)*1000,messageId:'live',sourceMessageIds:['live','merged']},{chat:'private:12345',dir:'out',time:(sec-20)*1000,...deliveryRow});
 const recent=Array.from({length:100},(_,i)=>row(i+100,sec-100+i,'99999'));
 const group=[row(6,sec-5,'98765'),row(7,sec-4,'98765',[{type:'at',data:{qq:'99999'}}])];
 const deps={stopped:false,accountPaused:false,socket:{ready:true},settings:{activeAccountId:'a'},featureState:{inbox:[],audits:[{chat:'private:12345',inboundIds:['audited']}]},lastSelfId:'99999',cfg:{napcat:{}},effectiveUsers:()=>['12345'],effectiveGroups:()=>['54321'],state,messages,activePersona:()=>({id:'p'}),
 request:async(name,params)=>{calls.push(params);return {messages:name==='get_group_msg_history'?group:params.reverseOrder===true&&params.message_seq?[row(1,sec-3600,'12345'),row('merged',sec-300,'12345'),row('audited',sec-290,'12345')]:recent};},
 sleepInboxScope:()=>({}),recordsAllowed:()=>true,pausedConversation:()=>false,groupStopped:()=>false,mentionsSelf:(msg,id)=>msg.some(s=>s.type==='at'&&s.data.qq===id),sleepInbox:{capture:p=>{if(captured.includes(p.message_id))return false;captured.push(p.message_id);return true;}},reviewSleepInbox:()=>{},saveState:()=>{},qqHumanWords:()=>'',segmentsOf:m=>m,logMessage:m=>{messages.push(m);archived.push(m.messageId);},log:()=>{}};
 deps.privateConversationBoundary=privateConversationBoundary;
 const run=Function(...Object.keys(deps),source.slice(start,end)+';return catchUpMissedMessages;')(...Object.values(deps));await run();await run();
 assert.deepEqual(archived,[]);assert.deepEqual(captured,[1,7]);assert.equal(calls[1].message_seq,100);assert.equal(Object.keys(state.historyScanAt).length,2);
});
