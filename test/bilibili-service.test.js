import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createBilibiliService,BILIBILI_TOOL_PARAMETERS,biliVideoId} from '../bilibili-service.js';
import {createQrDataUrl} from '../qr-renderer.js';

const BV='BV1xx411c7mD',context={accountId:'qq-a',personaId:'p-a',key:'private:owner'};
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'bilibili-')),calls=[];let time=Date.now(),allowed=true,writeMode='success',pollMode='success',beforeView=null,beforeNav=null;
  const image='https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',sub='https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png';
  const fetchImpl=async(url,options={})=>{
    const u=new URL(url);calls.push({url:u,options});
    if(u.hostname==='passport.biligame.com')return new Response(null,{status:302,headers:{location:'https://www.bilibili.com/','set-cookie':'SESSDATA=PRIVATE_SESSION; Path=/; Secure, bili_jct=PRIVATE_CSRF; Path=/; Secure, DedeUserID=42; Path=/; Secure'}});
    if(u.pathname.endsWith('/view')&&beforeView)await beforeView();
    if(u.pathname.endsWith('/nav')&&beforeNav)await beforeNav();
    if(u.hostname==='aisubtitle.hdslb.com')return Response.json({body:[{from:0,to:2,content:'实际字幕第一句'},{from:2,to:5,content:'实际字幕第二句'}]});
    let data={};
    if(u.pathname.endsWith('/qrcode/generate'))data={url:'https://passport.bilibili.com/qrcode/h5/login?key=qr-test',qrcode_key:'qr-test'};
    else if(u.pathname.endsWith('/qrcode/poll')){
      if(['waiting','scanned','expired'].includes(pollMode))return Response.json({code:0,data:{code:{waiting:86101,scanned:86090,expired:86038}[pollMode],url:''}});
      if(pollMode==='ticket')return Response.json({code:0,data:{code:0,url:'https://passport.biligame.com/x/passport-login/web/crossDomain?ticket=PRIVATE_TICKET'}});
      if(pollMode==='biligame')return Response.json({code:0,data:{code:0,url:'https://passport.biligame.com/crossDomain?DedeUserID=42&SESSDATA=PRIVATE_SESSION&bili_jct=PRIVATE_CSRF'}});
      if(pollMode==='incomplete')return Response.json({code:0,data:{code:0,url:'https://www.bilibili.com/?DedeUserID=42'}});
      return Response.json({code:0,data:{code:0,url:'https://www.bilibili.com/'}},{headers:{'set-cookie':'SESSDATA=PRIVATE_SESSION; Path=/; Secure, bili_jct=PRIVATE_CSRF; Path=/; Secure, DedeUserID=42; Path=/; Secure'}});
    }else if(u.pathname.endsWith('/nav'))data={isLogin:true,uname:'测试账号',mid:42,wbi_img:{img_url:image,sub_url:sub}};
    else if(u.pathname.endsWith('/view'))data={bvid:BV,title:'实际视频',aid:170001,cid:99,owner:{name:'测试 UP'},duration:5,pages:[{page:1,cid:99,part:'第一 P',duration:5}]};
    else if(u.pathname.endsWith('/v2/reply'))data={page:{count:1},replies:[{rpid:7,member:{uname:'用户甲'},content:{message:'真实评论'},like:2,replies:[]}]};
    else if(u.pathname.endsWith('/player/wbi/v2'))data={subtitle:{subtitles:[{lan:'zh-CN',subtitle_url:'https://aisubtitle.hdslb.com/bfs/subtitle/test.json'}]}};
    else if(u.pathname.endsWith('/reply/add')){
      if(writeMode==='unknown')throw Object.assign(Error('socket reset after write'),{code:'ECONNRESET'});
      data={rpid:12345};
    }else if(u.pathname.endsWith('/search/type'))data={result:[{bvid:BV,title:'<em>搜索</em>结果',author:'测试 UP'}]};
    else data={list:[{bvid:BV,title:'推荐视频',owner:{name:'测试 UP'}}]};
    return Response.json({code:0,data});
  };
  const options={directory,fetchImpl,makeQr:createQrDataUrl,now:()=>time+=1000,authorize:()=>allowed};
  let service=createBilibiliService(options);
  return {directory,calls,get service(){return service;},setBeforeView:value=>beforeView=value,setBeforeNav:value=>beforeNav=value,setAllowed:value=>allowed=value,setWriteMode:value=>writeMode=value,setPollMode:value=>pollMode=value,restart:()=>{service.close();service=createBilibiliService(options);},close:()=>{service.close();rmSync(directory,{recursive:true,force:true});}};
}
async function login(f){await f.service.act({action:'login'},context);return f.service.act({action:'login-status'},context);}

test('QR login validates fresh credentials, scopes accounts and never returns secrets',async()=>{
  const f=fixture();try{
    const qr=await f.service.act({action:'login'},context);assert.match(qr.qrImage,/^data:image\/gif;base64,/);assert.match(qr.qrFile,/\.gif$/);
    const result=await f.service.act({action:'login-status'},context);assert.equal(result.account.name,'测试账号');assert.equal(result.account.loggedIn,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SESSION|PRIVATE_CSRF/);
    const other=await f.service.act({action:'status'},{...context,personaId:'p-b'});assert.equal(other.account.loggedIn,false);
    const otherAccount=await f.service.act({action:'status'},{...context,accountId:'qq-b'});assert.equal(otherAccount.account.loggedIn,false);
    f.restart();assert.equal((await f.service.act({action:'status'},context)).account.loggedIn,true);
  }finally{f.close();}
});

test('default QQ connection with an empty account id logs in and remains isolated from named accounts',async()=>{
  const f=fixture();try{
    const defaultContext={...context,accountId:''};
    const qr=await f.service.act({action:'login'},defaultContext);
    assert.match(qr.qrImage,/^data:image\/gif;base64,/);
    assert.equal((await f.service.act({action:'login-status'},defaultContext)).account.loggedIn,true);
    assert.equal((await f.service.act({action:'status'},context)).account.loggedIn,false);
    assert.equal((await f.service.act({action:'status'},{...defaultContext,personaId:'other'})).account.loggedIn,false);
    f.restart();assert.equal((await f.service.act({action:'status'},defaultContext)).account.loggedIn,true);
    await assert.rejects(f.service.act({action:'login'},{personaId:'p-a'}),/隔离上下文/);
    await assert.rejects(f.service.act({action:'login'},{accountId:null,personaId:'p-a'}),/隔离上下文/);
  }finally{f.close();}
});

test('QR generation failures report the failed stage instead of silently returning an empty image',async()=>{
  const f=fixture();try{
    for(const data of [{}, {url:'bad',qrcode_key:'x'}, {url:'https://passport.bilibili.com/login'}]){
      const service=createBilibiliService({directory:f.directory,makeQr:createQrDataUrl,fetchImpl:async()=>Response.json({code:0,data})});
      try{await assert.rejects(service.act({action:'login'},context),/二维码|扫码地址/);}finally{service.close();}
    }
    const noRenderer=createBilibiliService({directory:f.directory,fetchImpl:async()=>Response.json({code:0,data:{url:'https://passport.bilibili.com/login',qrcode_key:'x'}})});
    try{await assert.rejects(noRenderer.act({action:'login'},context),/二维码组件/);}finally{noRenderer.close();}
    const offline=createBilibiliService({directory:f.directory,makeQr:createQrDataUrl,fetchImpl:async()=>{throw TypeError('fetch failed');}});
    try{await assert.rejects(offline.act({action:'login'},context),/暂时没连上 B站登录服务/);}finally{offline.close();}
  }finally{f.close();}
});
test('incomplete replacement login preserves the existing verified login',async()=>{
  const f=fixture();try{
    await login(f);f.setPollMode('incomplete');await f.service.act({action:'login',force:true},context);
    await assert.rejects(f.service.act({action:'login-status'},context),/完整登录/);
    assert.equal((await f.service.act({action:'status'},context)).account.name,'测试账号');
  }finally{f.close();}
});
test('read stores real subtitles and comments, signs requests and keeps cookies off subtitle CDN',async()=>{
  const f=fixture();try{
    await login(f);const result=await f.service.act({action:'read',bvid:BV},context);
    assert.equal(result.segments[0].text,'实际字幕第一句');assert.equal(result.comments[0].text,'真实评论');assert.match(result.coverage,/未分析画面/);
    const subtitleRequest=f.calls.find(c=>c.url.hostname==='aisubtitle.hdslb.com');assert.equal(subtitleRequest.options.headers,undefined);
    const signed=f.calls.find(c=>c.url.pathname.endsWith('/player/wbi/v2'));assert.match(signed.url.searchParams.get('w_rid'),/^[0-9a-f]{32}$/);
    const history=(await f.service.act({action:'status'},context)).history;assert.equal(history.length,1);assert.equal(history[0].subtitleSegments,2);
    f.setAllowed(false);await assert.rejects(f.service.act({action:'read',bvid:BV},context),/任务已变化/);
  }finally{f.close();}
});
test('drafts do not post; explicit publish is single use and concurrent duplicates cannot double post',async()=>{
  const f=fixture();try{
    await login(f);await f.service.act({action:'set-publish-enabled',enabled:true},context);await f.service.act({action:'read',bvid:BV},context);
    const a=await f.service.act({action:'draft',bvid:BV,text:'这是根据实际内容写的评论。'},context),b=await f.service.act({action:'draft',bvid:BV,text:a.draft.text},context);
    assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
    await assert.rejects(f.service.act({action:'publish',draftId:a.draft.id},context),/面板核对/);
    const results=await Promise.allSettled([a,b].map(r=>f.service.act({action:'publish',draftId:r.draft.id,confirm:true},context)));
    assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.posted).length,1);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
    await assert.rejects(f.service.act({action:'publish',draftId:a.draft.id,confirm:true},context),/已经|重复|提交/);
    assert.ok(!BILIBILI_TOOL_PARAMETERS.properties.action.enum.includes('publish'));
  }finally{f.close();}
});
test('uncertain publish is persisted and never automatically retried after restart',async()=>{
  const f=fixture();try{
    await login(f);await f.service.act({action:'set-publish-enabled',enabled:true},context);await f.service.act({action:'read',bvid:BV},context);const draft=(await f.service.act({action:'draft',bvid:BV,text:'结果未知测试。'},context)).draft;
    f.setWriteMode('unknown');const result=await f.service.act({action:'publish',draftId:draft.id,confirm:true},context);assert.equal(result.uncertain,true);
    f.restart();assert.equal((await f.service.act({action:'status'},context)).drafts[0].status,'unknown');
    await assert.rejects(f.service.act({action:'publish',draftId:draft.id,confirm:true},context),/待核对/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);
  }finally{f.close();}
});

test('logout prevents publishing or presenting old-account drafts as current',async()=>{
  const f=fixture();try{
    await login(f);await f.service.act({action:'set-publish-enabled',enabled:true},context);await f.service.act({action:'read',bvid:BV},context);const draft=(await f.service.act({action:'draft',bvid:BV,text:'账号隔离测试。'},context)).draft;
    await f.service.act({action:'logout'},context);const state=await f.service.act({action:'status'},context);assert.equal(state.drafts[0].accountMismatch,true);
    await assert.rejects(f.service.act({action:'publish',draftId:draft.id,confirm:true},context),/登录/);assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
  }finally{f.close();}
});
test('video targets accept only exact Bilibili URLs or IDs',()=>{
  assert.equal(biliVideoId('https://www.bilibili.com/video/'+BV),BV);
  assert.throws(()=>biliVideoId('https://example.com/'+BV),/BV/);
  assert.throws(()=>biliVideoId('https://www.bilibili.com@evil.example/video/'+BV),/BV/);
});

test('comment publishing is independently off by default, persistent and scoped',async()=>{
  const f=fixture();try{
    assert.equal((await f.service.act({action:'status'},context)).settings.commentPublishEnabled,false);
    await login(f);await f.service.act({action:'read',bvid:BV},context);
    const draft=(await f.service.act({action:'draft',bvid:BV,text:'关闭发布时仍可保存草稿。'},context)).draft;
    await assert.rejects(f.service.act({action:'publish',draftId:draft.id,confirm:true},context),/评论发布已关闭/);
    assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);
    await f.service.act({action:'set-publish-enabled',enabled:true},context);f.restart();
    assert.equal((await f.service.act({action:'status'},context)).settings.commentPublishEnabled,true);
    assert.equal((await f.service.act({action:'status'},{...context,personaId:'other'})).settings.commentPublishEnabled,false);
    assert.equal((await f.service.act({action:'status'},{...context,accountId:'other'})).settings.commentPublishEnabled,false);
    await f.service.act({action:'set-publish-enabled',enabled:false},context);f.restart();
    assert.equal((await f.service.act({action:'status'},context)).settings.commentPublishEnabled,false);
    assert.equal((await f.service.act({action:'status'},context)).drafts[0].status,'draft');
    await assert.rejects(f.service.act({action:'publish',draftId:draft.id,confirm:true},context),/评论发布已关闭/);
    assert.ok(!BILIBILI_TOOL_PARAMETERS.properties.action.enum.includes('set-publish-enabled'));
    await assert.rejects(f.service.act({action:'set-publish-enabled',enabled:'true'},context),/布尔/);
  }finally{f.close();}
});

test('closing the switch during preflight prevents the pending draft from posting',async()=>{
  const f=fixture();try{
    await login(f);await f.service.act({action:'set-publish-enabled',enabled:true},context);await f.service.act({action:'read',bvid:BV},context);
    const draft=(await f.service.act({action:'draft',bvid:BV,text:'提交前关闭开关。'},context)).draft;
    let release,started;const ready=new Promise(resolve=>started=resolve),wait=new Promise(resolve=>release=resolve);
    f.setBeforeView(async()=>{started();await wait;});
    const publishing=f.service.act({action:'publish',draftId:draft.id,confirm:true},context);
    const rejected=assert.rejects(publishing,/评论发布已关闭/);await ready;
    await f.service.act({action:'set-publish-enabled',enabled:false},context);release();await rejected;
    assert.equal(f.calls.filter(c=>c.options.method==='POST').length,0);assert.equal((await f.service.act({action:'status'},context)).drafts[0].status,'draft');
  }finally{f.close();}
});

test('real Biligame legacy and modern ticket callbacks finish login and persist a validated session',async()=>{
  for(const mode of ['biligame','ticket']){
    const f=fixture();try{
      f.setPollMode(mode);const result=await login(f);assert.equal(result.status,'logged-in');assert.equal(result.account.uid,'42');
      assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SESSION|PRIVATE_CSRF|PRIVATE_TICKET/);
      const callbacks=f.calls.filter(c=>c.url.hostname==='passport.biligame.com');assert.equal(callbacks.length,mode==='ticket'?1:0);
      f.restart();assert.equal((await f.service.act({action:'status'},context)).account.loggedIn,true);
    }finally{f.close();}
  }
});

test('waiting QR survives a status refresh without exposing poll keys or credentials',async()=>{
  const f=fixture();try{
    f.setPollMode('waiting');const first=await f.service.act({action:'login'},context);
    const state=await f.service.act({action:'status'},context);assert.equal(state.login.qrImage,first.qrImage);assert.equal(state.login.status,'waiting');
    assert.doesNotMatch(JSON.stringify(state),/qrcode_key|qr-test|PRIVATE_SESSION/);
    assert.equal((await f.service.act({action:'login-status'},context)).status,'waiting');
    f.setPollMode('scanned');assert.equal((await f.service.act({action:'login-status'},context)).status,'scanned');
    f.setPollMode('expired');assert.equal((await f.service.act({action:'login-status'},context)).status,'expired');
    const count=f.calls.filter(c=>c.url.pathname.endsWith('/generate')).length;await f.service.act({action:'login'},context);
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/generate')).length,count+1);
  }finally{f.close();}
});

test('transient verification failure retries the captured credential without polling a consumed key',async()=>{
  const f=fixture();try{
    f.setPollMode('ticket');await f.service.act({action:'login'},context);let attempts=0;
    f.setBeforeNav(async()=>{if(++attempts===1)throw Error('temporary network failure');});
    await assert.rejects(f.service.act({action:'login-status'},context),/temporary network failure/);
    const result=await f.service.act({action:'login-status'},context);assert.equal(result.status,'logged-in');
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/qrcode/poll')).length,1);
    assert.equal(f.calls.filter(c=>c.url.hostname==='passport.biligame.com').length,1);
  }finally{f.close();}
});

test('concurrent poll requests use a single successful QR exchange',async()=>{
  const f=fixture();try{
    f.setPollMode('ticket');await f.service.act({action:'login'},context);
    const result=await Promise.all([f.service.act({action:'login-status'},context),f.service.act({action:'login-status'},context)]);
    assert.ok(result.every(row=>row.status==='logged-in'));assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/qrcode/poll')).length,1);
  }finally{f.close();}
});

test('logout during verification cannot be undone by a late successful QR response',async()=>{
  const f=fixture();try{
    await f.service.act({action:'login'},context);
    let release,ready;const started=new Promise(resolve=>ready=resolve),wait=new Promise(resolve=>release=resolve);
    f.setBeforeNav(async()=>{ready();await wait;});
    const result=f.service.act({action:'login-status'},context),rejected=assert.rejects(result,/扫码已取消/);await started;
    await f.service.act({action:'logout'},context);release();await rejected;
    assert.equal((await f.service.act({action:'status'},context)).account.loggedIn,false);
  }finally{f.close();}
});
