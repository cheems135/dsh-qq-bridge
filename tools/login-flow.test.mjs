import assert from 'node:assert/strict';
import { explicitLoginInstruction } from '../login-workflow.js';
import { createOperationPolicy } from '../operation-policy.js';

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('ok   ' + name); }
  catch (e) { fail++; console.log('FAIL ' + name + ' :: ' + e.message); }
}

// ---- 1. 识别范围 ----
const yes = ['登录我的账号', '帮我登一下', '你登我的B站', '同意登录', '用我的账号和密码登录 platform.deepseek.com',
  '麻烦你帮我登进去', '登一下我的号', '登录一下', '允许登录我的QQ', '替我登录抖音'];
const no = ['不要登录', '怎么登录？', '登录页面打不开', '别登我账号', '她说登录我的账号', '"用我的账号登录"',
  '如果登录失败就重试', '不用登了', ''];
for (const s of yes) t('accept: ' + s, () => assert.equal(explicitLoginInstruction(s), true));
for (const s of no) t('reject: ' + JSON.stringify(s), () => assert.equal(explicitLoginInstruction(s), false));

// Ordinary sign-in uses the configured operation policy.
const policy = createOperationPolicy({storage:{read:()=>undefined,write:()=>{}}});
const meta = {accountId:'test',personaId:'test',ownerId:'10001',chat:'private:10001'};
t('ordinary sign-in does not create a payment decision',()=>{
 const receipt=policy.check(meta,{toolName:'bridge_browser',action:'click',ref:'e1'},{loginPage:true,url:'https://example.org/login'});
 assert.equal(receipt.ordinary,true);
});
console.log(pass+' passed, '+fail+' failed');
process.exitCode=fail?1:0;
