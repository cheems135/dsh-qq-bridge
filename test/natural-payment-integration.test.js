import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeExecution,lifeQuestionText} from '../life-execution.js';
import {createOperationPolicy,describeOperation,approvalAnswer} from '../operation-policy.js';
import {createExecutionRuntime} from '../execution-runtime.js';
import {createGameSessions} from '../game-session.js';
import {paymentQuestionInput,paymentQuestionText,SOCIAL_SPEECH_RULES} from '../social-voice.js';
import {phoneOperationObservation} from '../phone-operation.js';

const meta={accountId:'a',personaId:'p',ownerId:'12345678',chat:'private:12345678'},scope=JSON.stringify(['a','p']);
const memory=value=>({read:()=>structuredClone(value),write:next=>{value=structuredClone(next);},get value(){return value;}});
test('reading checkout and payment-login pages is ordinary; submitting money is still gated',()=>{
 for(const action of ['navigate','snapshot','read','status'])assert.equal(describeOperation({toolName:'bridge_browser',action,url:'https://shop.test/checkout'},{label:'支付登录'}).requiresDecision,false);
 assert.equal(describeOperation({toolName:'bridge_native',action:'call',arguments:{action:'navigate',url:'https://shop.test/payment'}}).requiresDecision,false);
 for(const trusted of [{label:'确认付款',password:true},{effect:'payment',mediaControl:true,fullTrust:true},{risk:'payment',loginPage:true,containsCredentials:true}])assert.equal(describeOperation({toolName:'bridge_browser',action:'click'},trusted).requiresDecision,true);
});
test('ordinary login consent cannot approve a payment; natural payment answers work',()=>{
 for(const text of ['允许登录','同意你用账号登录','允许你切换桌面','你看着办','如果便宜就买','不要付款','可以登录了'])assert.notEqual(approvalAnswer(text),'approve',text);
 for(const text of ['买吧','付款吧','这笔可以付','同意这笔付款','可以','同意你支付这笔'])assert.equal(approvalAnswer(text),'approve',text);
 assert.equal(approvalAnswer('别付了'),'unrelated');assert.equal(approvalAnswer('先别付款'),'deny');
});
test('payment speech keeps exact facts and excludes operation cards even if the model rewrite fails',()=>{
 const question={kind:'payment',question:'我想买那本画册',details:{merchant:'画册店',amount:'18.50',currency:'CNY',target:'https://shop.test/pay',operation:'bridge_browser'}};
 const spoken=paymentQuestionText(question,{lead:'那页配色我还是有点惦记。',ask:'这次让我把它带回来，好不好？'});
 assert.match(spoken,/那页配色/);assert.match(spoken,/18\.50 元/);assert.match(spoken,/画册店/);assert.doesNotMatch(spoken,/bridge_|https:|操作：|目标：|审批/);
 const fallback=paymentQuestionText(question,{lead:'已支付99元',ask:'审批通过'});assert.doesNotMatch(fallback,/99|已支付|审批/);assert.match(fallback,/18\.50/);
 const input=paymentQuestionInput(question,{persona:'说话有点俏皮',tone:'今天心情不错',recent:[{role:'user',text:'刚才那本画册'}]});assert.match(input.system,/俏皮/);assert.match(input.system,/今天心情不错/);assert.match(input.user,/刚才那本画册/);assert.match(SOCIAL_SPEECH_RULES,/长短由意思决定/);
 assert.doesNotMatch(lifeQuestionText({kind:'login',question:'还得你扫一下码',details:{target:'tool-name',url:'https://test'}}),/tool-name|http/);
});
test('legacy nonpayment waiting jobs resume safely without approving unresolved effects or payments',()=>{
 const job=(id,kind,steps=[])=>({id,meta:{accountId:'a',personaId:'p'},status:'waiting_user',at:1,scene:{},steps,question:{id:'q-'+id,kind,question:'旧问题'}});
 const storage=memory({version:2,jobs:[job('login','login'),job('payment','payment'),job('unknown','privacy',[{status:'unknown',idempotent:false,effect:'send'}])],wake:{},sleep:{}});
 const life=createLifeExecution({storage,config:()=>({}),roles:()=>[],allowed:()=>true,sceneFor:()=>null});
 const jobs=life.snapshot(meta).jobs;
 assert.equal(jobs.find(j=>j.id==='login').status,'paused');assert.equal(jobs.find(j=>j.id==='login').resume,true);assert.equal(jobs.find(j=>j.id==='login').question,undefined);
 assert.equal(jobs.find(j=>j.id==='unknown').status,'needs_reconcile');assert.equal(jobs.find(j=>j.id==='payment').status,'waiting_user');
 assert.equal(life.snapshot(meta).waiting.length,1);life.close();
});
test('ordinary life requests neither notify nor stop the task; payment requests still wait',async()=>{
 const storage=memory({version:2,jobs:[{id:'j',at:1,meta:{accountId:'a',personaId:'p'},status:'running',scene:{},steps:[]}],wake:{},sleep:{}});let notices=0;
 const life=createLifeExecution({storage,config:()=>({}),roles:()=>[],allowed:()=>true,sceneFor:()=>null,notify:async()=>notices++});
 // Constructor deliberately pauses interrupted work; this fixture starts a fresh task after that audit.
 storage.value.jobs[0].status='running';life.reload();
 const ordinary=await life.request('j',meta,{kind:'login',question:'可以登录吗'});assert.equal(ordinary.waiting,false);assert.equal(notices,0);assert.equal(life.job('j',meta).status,'running');
 const payment=await life.request('j',meta,{kind:'payment',question:'我想买这本',details:{merchant:'书店',amount:'10',currency:'CNY'}});assert.equal(payment.waiting,true);assert.equal(notices,1);assert.equal(life.job('j',meta).status,'waiting_user');await life.close();
});
test('runtime distinguishes unrestricted login from unverified public posts and still stops unapproved payments',()=>{
 const policy=createOperationPolicy({storage:memory({decisions:[],events:[]})}),rows=[],context={...meta,key:meta.chat,sessionId:'s',meta:{}};
 const runtime=createExecutionRuntime({policy,metaFor:()=>meta,journal:row=>rows.push(row)});
 const exec={name:'bridge_browser',arguments:{action:'fill',text:'private-password',url:'https://site.test/login'}};runtime.begin(exec,context,undefined,{password:true,loginPage:true,loginControl:'credential'});runtime.finish(exec,context,{ok:true});assert.equal(rows.at(-1).status,'confirmed');assert.doesNotMatch(JSON.stringify(rows),/private-password/);
 const post={name:'qq.qzone.publish',arguments:{text:'我的想法',target:'qq:self:12345678'}};runtime.begin(post,context,undefined,{effect:'publish'});runtime.finish(post,context,{ok:true,verified:false});assert.equal(rows.at(-1).status,'accepted');assert.equal(rows.at(-1).verified,false);
 const pay={name:'checkout',arguments:{action:'pay',target:'https://shop.test/pay',merchant:'商店',amount:'10',currency:'CNY'}};assert.throws(()=>runtime.begin(pay,context),e=>e.code==='DECISION_REQUIRED');
});
test('game flow does not ask redundant permission and does not open during a compatibility request',async()=>{
 let requests=0,opened=0;const policy=createOperationPolicy({storage:memory({decisions:[],events:[]})});const games=createGameSessions({policy,metaFor:()=>meta,request:()=>requests++,open:async()=>{opened++;return {ok:true};}}),context={...meta,key:meta.chat,generation:1},args={name:'拼图',url:'https://game.test/puzzle'};
 assert.equal((await games.act({...args,action:'request'},context)).waiting,false);assert.equal(opened,0);assert.equal(requests,0);
 await games.act({...args,action:'play'},context);await games.act({...args,action:'play'},context);assert.equal(opened,1);
});
test('phone login controls run normally while real payment controls and payment PIN input stay gated',()=>{
 const observation={ui:JSON.stringify({nodes:[{id:'login',text:'登录',bounds:[0,0,200,80]},{id:'pay',text:'确认付款',bounds:[0,90,200,170]}]})};
 const login={toolName:'bridge_device',action:'tap',target:'phone',x:10,y:20};assert.equal(describeOperation(login,phoneOperationObservation(login,observation)).requiresDecision,false);
 const pay={...login,y:100};assert.equal(describeOperation(pay,phoneOperationObservation(pay,observation)).requiresDecision,true);
 const pilot={toolName:'bridge_device',action:'pilot',target:'phone',capability:'ui.tap',arguments:{nodeId:'pay'}};assert.equal(describeOperation(pilot,phoneOperationObservation(pilot,observation)).requiresDecision,true);
 const input={toolName:'bridge_device',target:'phone',action:'input',text:'mock-pin'};const xml={ui:'<hierarchy><node text="请输入支付密码" bounds="[0,0][200,80]"/><node text="" password="true" focused="true" bounds="[0,90][200,170]"/></hierarchy>'};assert.equal(describeOperation(input,phoneOperationObservation(input,xml)).requiresDecision,true);
 assert.equal(describeOperation({...input,action:'payment-input',text:undefined}).requiresDecision,true);assert.equal(describeOperation({...input,action:'prepare-payment',text:undefined}).requiresDecision,false);
});
