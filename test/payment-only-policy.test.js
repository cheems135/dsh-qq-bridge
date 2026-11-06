import test from 'node:test';
import assert from 'node:assert/strict';
import {
  approvalAnswer,
  createOperationPolicy,
  describeOperation,
} from '../operation-policy.js';
import {assertLifeOperation,lifeRisk,operationRisk} from '../life-permissions.js';

const meta={
  accountId:'account-1',
  personaId:'persona-1',
  ownerId:'owner-1',
  chat:'private:owner-1',
};

function paymentArgs(extra={}){
  return {
    toolName:'bridge_native',
    name:'checkout',
    arguments:{
      action:'submit-order',
      target:'https://shop.example/checkout/order-42',
      merchant:'示例商店',
      amount:88.5,
      currency:'CNY',
      cart:{sku:'book-1',quantity:1},
    },
    ...extra,
  };
}

function memoryStorage(initial=null){
  let value=initial;
  return {
    read(){return value;},
    write(next){value=next;},
    get value(){return value;},
  };
}

test('effect is the full classification while kind gates only payment',()=>{
  const login=describeOperation({
    toolName:'bridge_browser',
    action:'fill',
    url:'https://example.com/login',
    text:'owner@example.com',
    intent:'login',
  });
  assert.equal(login.effect,'login');
  assert.equal(login.kind,'');
  assert.equal(login.requiresDecision,false);

  const publish=describeOperation({
    toolName:'qq.qzone.publish',
    target:'qq:self:10001',
    text:'今天读到一段很有意思的文字。',
  });
  assert.equal(publish.effect,'publish');
  assert.equal(publish.kind,'');
  assert.equal(publish.requiresDecision,false);

  const password=describeOperation({
    toolName:'bridge_browser',
    action:'fill',
    intent:'login',
    text:'not-a-real-password',
  },{password:true,fullTrust:true});
  assert.equal(password.effect,'privacy');
  assert.equal(password.kind,'');
  assert.equal(password.requiresDecision,false);

  const comment=describeOperation({
    toolName:'bilibili',
    action:'publish',
    intent:'comment',
    target:'BV1-policy-test',
    text:'这条评论由 B 站自己的草稿与人工确认流程处理。',
  });
  assert.equal(comment.effect,'comment');
  assert.equal(comment.kind,'');
  assert.equal(comment.requiresDecision,false);

  assert.equal(operationRisk({intent:'privacy'}),'privacy');
  assert.equal(operationRisk({intent:'login'}),'login');
  assert.equal(operationRisk({intent:'publish'}),'publish');
  assert.equal(lifeRisk({intent:'privacy'}),'');
  assert.equal(lifeRisk({intent:'login'}),'');
  assert.equal(lifeRisk({intent:'payment'}),'payment');
});

test('nested payment observation wins over password, privacy, and every legacy bypass',()=>{
  const args=paymentArgs();
  const trusted={
    risk:'privacy',
    password:true,
    containsCredentials:true,
    fullTrust:true,
    loginGranted:true,
    ownArtifact:true,
    mediaControl:true,
    label:'登录后继续',
  };
  assert.equal(operationRisk(args,trusted),'payment');
  assert.equal(operationRisk({intent:'login'},{
    effect:'payment',
    password:true,
    loginPage:true,
    loginControl:'credential',
  }),'payment');

  const described=describeOperation(args,trusted);
  assert.equal(described.effect,'payment');
  assert.equal(described.kind,'payment');
  assert.equal(described.requiresDecision,true);
  assert.equal(described.operation.merchant,'示例商店');
  assert.equal(described.operation.amount,'88.5');
  assert.equal(described.operation.currency,'CNY');
});

test('nonpayment proposals stay ordinary even with expired login workflow state',()=>{
  const storage=memoryStorage({
    version:1,
    decisions:[],
    events:[],
    grants:[{
      scope:'account-1\0persona-1\0owner-1',
      tool:'bridge_browser',
      kind:'permission',
      expiresAt:Number.MAX_SAFE_INTEGER,
    }],
    loginWorkflows:[{
      id:'expired-login',
      scope:'account-1\0persona-1\0owner-1',
      origin:'https://example.com',
      status:'active',
      expiresAt:0,
      steps:[],
    }],
  });
  const policy=createOperationPolicy({storage,now:()=>1_000_000});
  const loginArgs={
    toolName:'bridge_browser',
    action:'fill',
    url:'https://example.com/login',
    text:'owner@example.com',
    intent:'login',
  };
  const trusted={
    loginPage:true,
    loginControl:'credential',
    password:false,
    fullTrust:false,
    loginGranted:false,
  };

  const proposed=policy.propose(meta,loginArgs,trusted,'要登录吗？');
  assert.deepEqual(proposed,{
    ok:true,
    ordinary:true,
    requiresDecision:false,
    operation:describeOperation(loginArgs,trusted).operation,
  });
  assert.equal('waiting' in proposed,false);
  assert.equal('question' in proposed,false);

  const checked=policy.check(meta,loginArgs,trusted);
  assert.equal(checked.ok,true);
  assert.equal(checked.ordinary,true);
  assert.equal(checked.requiresDecision,false);
  assert.equal(policy.recordUserInstruction(meta,{text:'帮我登录'}),null);
  assert.equal(policy.snapshot(meta).pending.length,0);

  const oauth=policy.check(meta,{
    toolName:'bridge_browser',
    action:'click',
    url:'https://other.example/login',
    intent:'login',
  },{...trusted,oauthConsent:true});
  assert.equal(oauth.ordinary,true);
});

test('old pending and approved nonpayment decisions migrate to cancelled',()=>{
  const sharedScope='account-1\0persona-1\0owner-1';
  const storage=memoryStorage({
    version:1,
    events:[],
    grants:[{scope:sharedScope,tool:'bridge_browser',expiresAt:Number.MAX_SAFE_INTEGER}],
    loginWorkflows:[{id:'old-login',scope:sharedScope,status:'active',expiresAt:Number.MAX_SAFE_INTEGER}],
    decisions:[
      {id:'login-pending',scope:sharedScope,kind:'login',status:'pending',expiresAt:Number.MAX_SAFE_INTEGER},
      {id:'privacy-approved',scope:sharedScope,kind:'privacy',status:'approved',expiresAt:Number.MAX_SAFE_INTEGER},
      {id:'publish-approved',scope:sharedScope,kind:'publish',status:'approved',expiresAt:Number.MAX_SAFE_INTEGER},
      {id:'payment-pending',scope:sharedScope,kind:'payment',status:'pending',expiresAt:Number.MAX_SAFE_INTEGER},
      {id:'payment-approved',scope:sharedScope,kind:'payment',status:'approved',expiresAt:Number.MAX_SAFE_INTEGER},
    ],
  });
  const policy=createOperationPolicy({storage,now:()=>2_000_000});
  const byId=Object.fromEntries(storage.value.decisions.map(item=>[item.id,item]));
  assert.equal(byId['login-pending'].status,'cancelled');
  assert.equal(byId['privacy-approved'].status,'cancelled');
  assert.equal(byId['publish-approved'].status,'cancelled');
  assert.equal(byId['payment-pending'].status,'pending');
  assert.equal(byId['payment-approved'].status,'approved');
  assert.deepEqual(storage.value.grants,[]);
  assert.equal(storage.value.loginWorkflows[0].status,'cancelled');
  assert.deepEqual(policy.snapshot(meta).pending.map(item=>item.id),['payment-pending']);
});

test('payment approval is amount, target, scope, content, and use bound',()=>{
  let clock=3_000_000;
  const storage=memoryStorage();
  const policy=createOperationPolicy({storage,now:()=>clock,ttlMs:60_000});
  const original=paymentArgs();
  const proposal=policy.propose(meta,original,{},'确认这笔付款吗？');
  assert.equal(proposal.kind,'payment');
  assert.equal(proposal.status,'pending');
  assert.deepEqual(policy.snapshot(meta).pending.map(item=>item.id),[proposal.id]);

  assert.throws(
    ()=>policy.check(meta,paymentArgs({decisionId:proposal.id}),{},),
    error=>error.code==='DECISION_REQUIRED',
  );
  assert.throws(
    ()=>policy.answer(proposal.id,{...meta,chat:'group:not-owner'},'同意'),
    /本人的这一个待决定问题/,
  );
  assert.throws(
    ()=>policy.answer(proposal.id,meta,'同意',{source:'model'}),
    /本人的这一个待决定问题/,
  );
  assert.equal(approvalAnswer('同意'),'approve');
  assert.equal(policy.answer(proposal.id,meta,'同意').status,'approved');

  assert.throws(
    ()=>policy.check({...meta,accountId:'account-2'},paymentArgs({decisionId:proposal.id})),
    error=>error.code==='DECISION_REQUIRED',
  );

  const changedAmount=paymentArgs();
  changedAmount.arguments.amount=88.51;
  assert.throws(
    ()=>policy.check(meta,{...changedAmount,decisionId:proposal.id}),
    error=>error.code==='DECISION_REQUIRED',
  );

  const changedTarget=paymentArgs();
  changedTarget.arguments.target='https://shop.example/checkout/order-43';
  assert.throws(
    ()=>policy.check(meta,{...changedTarget,decisionId:proposal.id}),
    error=>error.code==='DECISION_REQUIRED',
  );

  const changedContents=paymentArgs();
  changedContents.arguments.cart.quantity=2;
  assert.throws(
    ()=>policy.check(meta,{...changedContents,decisionId:proposal.id}),
    error=>error.code==='DECISION_REQUIRED',
  );

  const checked=policy.check(meta,paymentArgs({decisionId:proposal.id}));
  assert.equal(checked.ok,true);
  assert.equal(checked.ordinary,false);
  assert.equal(checked.requiresDecision,true);
  policy.consume(checked);
  assert.throws(()=>policy.consume(checked),/已使用|状态变化/);
  assert.throws(
    ()=>policy.check(meta,paymentArgs({decisionId:proposal.id})),
    error=>error.code==='DECISION_REQUIRED',
  );
});

test('payment proposal and check require complete exact details',()=>{
  const storage=memoryStorage();
  const policy=createOperationPolicy({storage,now:()=>4_000_000});
  assert.throws(
    ()=>policy.propose(meta,{
      toolName:'checkout',
      target:'https://shop.example/checkout',
      amount:10,
      currency:'CNY',
    },{}),
    /商家、金额和币种/,
  );
  assert.throws(
    ()=>policy.check(meta,{
      toolName:'checkout',
      target:'https://shop.example/checkout',
      merchant:'商店',
      amount:10,
      currency:'',
    }),
    error=>error.code==='DECISION_REQUIRED',
  );
});

test('password inputs remain redacted while payment classification is retained',()=>{
  const base={
    toolName:'bridge_browser',
    action:'fill',
    intent:'payment',
    target:'https://shop.example/checkout',
    merchant:'示例商店',
    amount:12,
    currency:'CNY',
    text:'secret-password',
    arguments:{credential:'nested-secret'},
  };
  const first=describeOperation(base,{password:true,fullTrust:true});
  const second=describeOperation({...base,text:'another-password'},{password:true,fullTrust:true});
  assert.equal(first.effect,'payment');
  assert.equal(first.kind,'payment');
  assert.equal(typeof first.operation.privateInputDigest,'string');
  assert.equal(JSON.stringify(first.operation).includes('secret-password'),false);
  assert.equal(JSON.stringify(first.operation).includes('nested-secret'),false);
  assert.notEqual(first.fingerprint,second.fingerprint);
});

test('legacy waiting_user blocks payments but not ordinary nonpayment work',()=>{
  assert.doesNotThrow(()=>assertLifeOperation(
    {status:'waiting_user',question:{id:'legacy-login',kind:'login'}},
    {toolName:'bridge_browser',intent:'login',url:'https://other.example/login'},
  ));
  assert.throws(
    ()=>assertLifeOperation(
      {status:'waiting_user',question:{id:'legacy-login',kind:'login'}},
      {toolName:'checkout',intent:'payment'},
    ),
    /付款操作暂停/,
  );
  assert.throws(
    ()=>assertLifeOperation({status:'completed'},{toolName:'bridge_browser',intent:'login'}),
    /任务已结束/,
  );
});
