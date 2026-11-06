import test from 'node:test';
import assert from 'node:assert/strict';
import {loginCookies,resolveBiliQrCredential} from '../bilibili-login.js';

const cookie='SESSDATA=SESSION%2Ctest; Path=/; Secure, bili_jct=CSRF; Path=/; Secure, DedeUserID=42; Path=/; Secure';
const ticket='https://passport.biligame.com/x/passport-login/web/crossDomain?ticket=PRIVATE_TICKET&gourl=https%3A%2F%2Fwww.bilibili.com';

test('real Biligame callback is accepted when the poll response already contains valid cookies',async()=>{
  const credential=await resolveBiliQrCredential({response:new Response('',{headers:{'set-cookie':cookie}}),url:ticket,fetchImpl:()=>{throw Error('should not fetch');}});
  assert.equal(credential.DedeUserID,'42');assert.equal(credential.SESSDATA,'SESSION%2Ctest');
});

test('crossDomain ticket exchange captures cookies on the first redirect without following gourl',async()=>{
  const calls=[];
  const credential=await resolveBiliQrCredential({response:Response.json({}),url:ticket,fetchImpl:async(url,init)=>{
    calls.push(url);assert.equal(init.redirect,'manual');assert.equal(init.headers.cookie,undefined);assert.match(init.headers['user-agent'],/AppleWebKit/);
    return new Response(null,{status:302,headers:{location:'https://evil.example/', 'set-cookie':cookie}});
  }});
  assert.equal(credential.DedeUserID,'42');assert.equal(calls.length,1);
});

test('legacy Biligame query credentials remain compatible, including escaped session commas',async()=>{
  const credential=await resolveBiliQrCredential({response:Response.json({}),url:'https://passport.biligame.com/crossDomain?DedeUserID=42&SESSDATA=SESSION%2Ctest&bili_jct=CSRF',fetchImpl:()=>{throw Error('should not fetch');}});
  assert.equal(credential.SESSDATA,'SESSION,test');assert.equal(credential.bili_jct,'CSRF');
});

test('cookie parsing handles Expires commas and both Header APIs',()=>{
  const raw='SESSDATA=SESSION,test; Expires=Wed, 09 Jun 2027 10:18:14 GMT; Path=/, bili_jct=CSRF; Path=/, DedeUserID=42; Path=/';
  const old=loginCookies({get:()=>raw}),modern=loginCookies({getSetCookie:()=>raw.split('Path=/,')});
  assert.equal(old.SESSDATA,'SESSION,test');assert.equal(old.DedeUserID,'42');assert.equal(modern.bili_jct,'CSRF');
  assert.equal(loginCookies({getSetCookie:()=>[],get:()=>raw}).DedeUserID,'42');
});

test('untrusted hosts and non-login redirect paths are never requested',async()=>{
  let calls=0;
  await assert.rejects(resolveBiliQrCredential({response:Response.json({}),url:'https://passport.biligame.com.evil.example/crossDomain',fetchImpl:async()=>{calls++;}}),/允许范围/);
  await assert.rejects(resolveBiliQrCredential({response:Response.json({}),url:ticket,fetchImpl:async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://passport.bilibili.com/unrelated'}});}}),/完整登录凭据/);
  assert.equal(calls,1);
});

test('transport errors cannot echo a login ticket or cookie back into the model',async()=>{
  await assert.rejects(resolveBiliQrCredential({response:Response.json({}),url:ticket,fetchImpl:async()=>{throw Error(ticket+' SESSION');}}),error=>!error.message.includes('PRIVATE_TICKET')&&!error.message.includes('SESSION')&&/原登录已保留/.test(error.message));
});
