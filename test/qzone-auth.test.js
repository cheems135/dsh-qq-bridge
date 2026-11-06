import test from 'node:test';
import assert from 'node:assert/strict';
import {qzoneCredentials,loadQzoneCredentials,probeQzoneCredentials} from '../qzone-auth.js';
import {qzoneJson} from '../qzone-protocol.js';
import {createQzoneSession} from '../qzone-session.js';
import {createQzoneService} from '../qzone-service.js';
const uin='12345678',cookie='uin=o12345678; p_uin=o12345678; skey=MOCK; p_skey=MOCK-PROTECTED';
const credentials=()=>qzoneCredentials(cookie,uin);
test('NapCat credentials are checked against the current QQ and gtk uses p_skey',()=>{
 const auth=credentials();let gtk=5381;for(const c of 'MOCK-PROTECTED')gtk=(gtk*33+c.charCodeAt(0))|0;assert.equal(auth.gtk,gtk&0x7fffffff);
 assert.throws(()=>qzoneCredentials(cookie,'87654321'),e=>e.code==='QZONE_AUTH_REQUIRED');
 assert.throws(()=>qzoneCredentials(cookie,uin,'87654321'),e=>e.code==='QZONE_AUTH_REQUIRED');
 assert.throws(()=>qzoneCredentials('uin=o'+uin,uin),e=>e.code==='QZONE_AUTH_REQUIRED');
 assert.throws(()=>qzoneCredentials(cookie+'\r\nheader:value',uin),e=>e.code==='QZONE_AUTH_REQUIRED');
});
test('NapCat combined credentials have a read-only fallback and no csrf endpoint is required',async()=>{
 for(const fallback of [false,true]){const calls=[];const request=async action=>{calls.push(action);if(action==='get_login_info')return {user_id:uin};if(action==='get_credentials'){if(fallback)throw Error('unsupported');return {cookies:cookie};}return {cookies:cookie};};
  assert.equal((await loadQzoneCredentials(request)).cookie,cookie);assert.deepEqual(calls,fallback?['get_login_info','get_credentials','get_cookies']:['get_login_info','get_credentials']);
 }
});
test('aborted login reads do not continue loading cookies',async()=>{
 const controller=new AbortController(),calls=[];await assert.rejects(loadQzoneCredentials(async action=>{calls.push(action);controller.abort();return {user_id:uin};},{signal:controller.signal}));assert.deepEqual(calls,['get_login_info']);
});
test('health check is one authenticated GET to the current QQ own feed and discards content',async()=>{
 const calls=[];const result=await probeQzoneCredentials(credentials(),{fetchImpl:async(url,options)=>{calls.push({u:new URL(url),options});return Response.json({code:0,data:{main:{},data:[{html:'PRIVATE CONTENT'}]}});}});
 assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE CONTENT/);assert.equal(calls.length,1);assert.equal(calls[0].u.hostname,'user.qzone.qq.com');assert.equal(calls[0].u.searchParams.get('uin'),uin);assert.equal(calls[0].u.searchParams.get('scope'),'1');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'manual');
});
test('auth expiry, throttling, unsupported replies and HTML cannot masquerade as a ready session',async()=>{
 const variants=[
  [()=>Response.json({code:-3000}),'QZONE_AUTH_REQUIRED'],
  [()=>Response.json({code:-10000}),'QZONE_THROTTLED'],
  [()=>new Response('<html>请先登录</html>'),'QZONE_AUTH_REQUIRED'],
  [()=>new Response(null,{status:302,headers:{location:'https://untrusted.test/'}}),'QZONE_AUTH_REQUIRED'],
  [()=>new Response(null,{status:429}),'QZONE_THROTTLED'],
  [()=>new Response(null,{status:404}),'QZONE_UNSUPPORTED'],
  [()=>Response.json({code:0,data:{}}),'QZONE_RESPONSE_INVALID'],
  [()=>Response.json({data:{main:{}}}),'QZONE_RESPONSE_INVALID'],
 ];for(const [response,code]of variants){let calls=0;await assert.rejects(probeQzoneCredentials(credentials(),{fetchImpl:async()=>{calls++;return response();}}),error=>error.code===code);assert.equal(calls,1);}
});
test('probe response limit is enforced and JSONP hex escapes require no script evaluation',async()=>{
 await assert.rejects(probeQzoneCredentials(credentials(),{fetchImpl:async()=>new Response('{}',{headers:{'content-length':String(3*1024*1024)}})}),e=>e.code==='QZONE_RESPONSE_INVALID');
 assert.equal(qzoneJson('_Callback({"code":0,"data":{"main":{},"data":["\\x3Cdiv\\x3E"]}});').data.data[0],'<div>');
});

test('real feed-style single quotes and unquoted property names pass the read-only login probe',async()=>{
 const raw=String.raw`_Callback({"code":0,"data":{main:{externparam:'',hasMoreFeeds:0,},data:[{html:'\x3Cdiv class="test"\x3E\\x3C\x3C/div\x3E',}],}});`;
 const result=await probeQzoneCredentials(credentials(),{fetchImpl:async()=>new Response(raw,{headers:{'content-type':'application/x-javascript'}})});
 assert.equal(result.ok,true);assert.equal(result.readOnly,true);assert.equal(qzoneJson(raw).data.data[0].html,'<div class="test">\\x3C</div>');
 assert.throws(()=>qzoneJson(`_Callback({code:0,data:{main:(()=>{globalThis.qzoneInjected=true})()}});`),e=>e.code==='QZONE_RESPONSE_INVALID');assert.equal(globalThis.qzoneInjected,undefined);
});
test('default empty account works and UI status reflects a changed connection without leaking cached readiness',async()=>{
 let connection={accountId:'',revision:1,connected:true},time=1000;const session=createQzoneSession({getConnection:()=>connection,loadAuth:async()=>credentials(),probeAuth:async()=>({ok:true}),now:()=>time,ttlMs:1000});
 assert.equal(session.status(connection).qqConnected,true);await session.getAuth();assert.equal(session.status().state,'ready');time+=1001;assert.equal(session.status(connection).state,'unverified');
 connection={...connection,connected:false};assert.equal(session.status(connection).state,'offline');connection={accountId:'other',revision:2,connected:true};assert.equal(session.status(connection).state,'unverified');assert.equal(session.status().lastSuccessAt,null);session.close();
});
test('an explicit publish authentication failure invalidates login state without replaying the write',async()=>{
 let state={entries:[],comments:[]},requests=0,invalidations=0;
 const service=createQzoneService({storage:{read:()=>state,write:value=>state=value},getAuth:async()=>credentials(),loadImage:()=>{throw Error('unused');},onAuthFailure:()=>invalidations++,fetchImpl:async()=>{requests++;return Response.json({code:-3000});}});
 await assert.rejects(service.publish({text:'原始动态'},{accountId:'',personaId:'p'}),e=>e.code===undefined||/未完成/.test(e.message));assert.equal(requests,1);assert.equal(invalidations,1);assert.equal(state.entries[0].status,'failed');
});
test('rate limiting never requests login refresh or automatically resubmits a post',async()=>{
 let state={entries:[],comments:[]},requests=0,invalidations=0;const service=createQzoneService({storage:{read:()=>state,write:value=>state=value},getAuth:async()=>credentials(),onAuthFailure:()=>invalidations++,fetchImpl:async()=>{requests++;return Response.json({code:-10000});}});
 await assert.rejects(service.publish({text:'原始动态'},{accountId:'a',personaId:'p'}));assert.equal(requests,1);assert.equal(invalidations,0);
});

test('a stale HTTP authentication reply cannot invalidate the newly connected account',async()=>{
 let state={entries:[],comments:[]},allowed=true,invalidations=0;
 const service=createQzoneService({storage:{read:()=>state,write:value=>state=value},getAuth:async()=>credentials(),authorize:()=>allowed,onAuthFailure:()=>invalidations++,fetchImpl:async()=>{allowed=false;return new Response(null,{status:401});}});
 await assert.rejects(service.publish({text:'旧连接的动态'},{accountId:'a',personaId:'p'}));
 assert.equal(invalidations,0);assert.equal(state.entries[0].status,'unknown');
});
