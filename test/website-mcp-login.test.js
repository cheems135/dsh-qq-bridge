import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebsiteMcp} from '../website-mcp.js';

test('Bilibili binding requires verification and only reuses credentials in the bound persona',async()=>{
  const origin='https://m.bilibili.com/';
  let state={sites:[]};
  const create=()=>createWebsiteMcp({
    storage:{read:()=>structuredClone(state),write:value=>{state=value;}},
    request:async url=>({status:200,url,text:url.includes('openapi')||url.includes('swagger')?'{}':'<p>公共页面</p>'}),
  });
  const owner={accountId:'owner',personaId:'p1'},alternate={...owner,personaId:'p2'};
  const first=create();
  const draft=await first.inspect(origin,owner),site=first.save(draft.previewId,owner);
  await assert.rejects(first.bindSession(site.id,owner,async()=>{throw Error('Not logged in');}),/Not logged in/);
  assert.equal(first.list(owner)[0].loginBound,false);
  await first.bindSession(site.id,owner,async()=>({loginVerified:true}));
  const second=create();
  assert.equal(second.list(owner)[0].loginBound,true);
  assert.equal(second.list(alternate)[0].loginBound,false);
  const name=site.id+'__read_page';
  const publicResult=await second.call(name,{},owner);
  assert.equal(publicResult.url,origin);
  const readSession=async(url,scope,{requireLogin})=>{
    if(scope.personaId==='p1')assert.equal(requireLogin,true);
    else assert.equal(requireLogin,false);
    return {status:200,url,text:'Bilibili'};
  };
  for(const scope of [owner,alternate])assert.equal((await second.call(name,{},scope,{useBrowserSession:true,readSession})).ok,true);
  const updated=await second.inspect(origin,owner);
  second.save(updated.previewId,owner);
  assert.equal(second.list(owner)[0].loginBound,true);
});
test('Bilibili private sections require the bound persona and limit the video destination',async()=>{
  let state={sites:[]};
  const manager=createWebsiteMcp({
    storage:{read:()=>structuredClone(state),write:value=>{state=value;}},
    request:async url=>({status:200,url,text:url.includes('openapi')||url.includes('swagger')?'{}':'<p>公共页面</p>'}),
  });
  const scope={accountId:'owner',personaId:'one'};
  const draft=await manager.inspect('https://m.bilibili.com/',scope),site=manager.save(draft.previewId,scope);
  const name=site.id+'__read_page';
  const readSession=async(url,_,{section,requireLogin})=>{
    assert.equal(requireLogin,true);
    const destination=section==='video'?url:'https://api.bilibili.com'+(section==='following'?'/x/relation/followings':'/x/v3/fav/folder/created/list-all');
    return {status:200,url:destination,text:'账号专属页面'};
  };
  const options={useBrowserSession:true,readSession};
  await assert.rejects(manager.call(name,{section:'favorites'},scope,options),/先在网站工具/);
  await manager.bindSession(site.id,scope,async()=>({loginVerified:true}));
  assert.deepEqual(manager.tools(scope)[0].inputSchema.properties.section.enum,['following','favorites','video']);
  for(const section of ['following','favorites']){
    assert.equal((await manager.call(name,{section},scope,options)).websiteEvidence.read,true);
  }
  await assert.rejects(manager.call(name,{section:'favorites'},scope),/先在网站工具/);
  await assert.rejects(manager.call(name,{section:'video',url:'https://evil.test/video/BV1234567890'},scope,options),/官方视频/);
  assert.equal((await manager.call(name,{section:'video',url:'https://www.bilibili.com/bangumi/play/ep123?share_source=copy'},scope,options)).url,'https://www.bilibili.com/bangumi/play/ep123');
});
test('unadapted website stores session opt-in while leaving login unverified and origins isolated',async()=>{
  let state={sites:[]};
  const origin='https://example.com';
  const manager=createWebsiteMcp({
    storage:{read:()=>structuredClone(state),write:value=>{state=value;}},
    request:async url=>({status:200,url,text:url.includes('openapi')||url.includes('swagger')?'{}':'<p>public page</p>'}),
  });
  const scope={accountId:'owner',personaId:'first'};
  const draft=await manager.inspect(origin,scope),site=manager.save(draft.previewId,scope);
  assert.deepEqual(await manager.bindSession(site.id,scope,async target=>{
    assert.equal(target.origin,origin);
    return {loginVerified:false};
  }),{loginBound:true,loginVerified:false});
  const name=site.id+'__read_page';
  const result=await manager.call(name,{},scope,{useBrowserSession:true,readSession:async(url,_,options)=>{
    assert.equal(options.requireLogin,false);
    return {status:200,url,text:'private page'};
  }});
  assert.equal(result.ok,true);
  await assert.rejects(manager.call(name,{url:'https://other.test/'},scope,{useBrowserSession:true}),/同一站点/);
});
