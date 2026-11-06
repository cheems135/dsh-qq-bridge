import test from 'node:test';
import assert from 'node:assert/strict';
import {createQzoneService} from '../qzone-service.js';

const context={accountId:'account-a',personaId:'persona-a'};
const auth={uin:'12345678',gtk:123,cookie:'uin=o12345678; p_skey=RAW-COOKIE-SECRET'};
const otherAuthor='87654321';
const scope=JSON.stringify([context.accountId,context.personaId]);
const base=1700000000000;

function memory(entries=[],comments=[]){
 const value={entries,comments};
 return{
  value,
  storage:{
   read:()=>structuredClone(value),
   write:next=>Object.assign(value,structuredClone(next)),
  },
 };
}

function postEntry(overrides={}){
 return{
  id:'post-entry',
  scope,
  kind:'publish',
  status:'accepted',
  itemId:'post-1',
  owner:auth.uin,
  text:'完整动态\n正文',
  at:base,
  verification:{state:'pending',recipient:'unknown',read:'unknown'},
  ...overrides,
 };
}

function replyEntry(overrides={}){
 return{
  id:'reply-entry',
  scope,
  kind:'reply',
  status:'accepted',
  target:{uin:auth.uin,tid:'post-1'},
  commentId:'900',
  commentUin:otherAuthor,
  parentId:null,
  parentUin:null,
  owner:auth.uin,
  text:'回复\n正文',
  at:base,
  verification:{state:'pending',recipient:'unknown',read:'unknown'},
  ...overrides,
 };
}

function marker(tid='post-1',uin=auth.uin){
 return`<i name="feed_data" data-tid="${tid}" data-uin="${uin}"></i>`;
}

function postHtml(tid,text,uin=auth.uin){
 return marker(tid,uin)+`<div class="f-info">${text}</div>`;
}

function imageBox(count,{broken=false}={}){
 return`<div class="img-box">${Array.from({length:count},()=>broken?'<a class="img-item">broken</a>':'<a class="img-item"><img src="image"></a>').join('')}</div>`;
}

function rootHtml(id='900',uin=otherAuthor,text='根评论'){
 return`<li data-type="commentroot" data-tid="${id}" data-uin="${uin}" data-nick="读者"><div class="comments-content"><a>读者</a>: ${text}</div></li>`;
}

function replyHtml({id='1001',uin=auth.uin,text='回复 正文'}={}){
 return`<li data-type="replyroot" data-tid="${id}" data-uin="${uin}" data-nick="我"><div class="comments-content"><a>我</a>: ${text}</div></li>`;
}

function feed(html){
 return{code:0,data:{data:html?[{html}]:[]}};
}

function fixture({entries=[],comments=[],feeds,respond,getAuth=async()=>auth,authorize=()=>true,onRecord=()=>{}}={}){
 const state=memory(entries,comments),calls=[],records=[];
 const service=createQzoneService({
  storage:state.storage,
  getAuth,
  loadImage:()=>{throw Error('verification must not load images');},
  fetchImpl:async(url,options)=>{
   const target=new URL(url),params=options.body?new URLSearchParams(options.body):new URL(url).searchParams;
   const call={url,target,options,params},write=/publish_v6|re_feeds|upload_image/.test(target.pathname);
   calls.push(call);
   if(respond)return respond(call);
   if(target.pathname.includes('feeds3_html_more'))return Response.json(feed(typeof feeds==='function'?feeds(call):feeds));
   throw Error('unexpected verification request');
  },
  now:()=>base,
  authorize,
  onRecord:(row,c)=>{records.push({row,c});onRecord(row,c);},
 });
 return{service,state,calls,records};
}

test('successful publish stores and returns pending verification without readback',async()=>{
 const {service,state,calls,records}=fixture({
  respond:call=>{
   assert.match(call.target.pathname,/publish_v6/);
   return Response.json({code:0,data:{tid:'post-1'}});
  },
 });
 const result=await service.publish({text:'完整动态\n正文'},context);
 assert.equal(result.status,'accepted');
 assert.equal(result.verified,false);
 assert.deepEqual(result.verification,{state:'pending',recipient:'unknown',read:'unknown'});
 assert.deepEqual(state.value.entries[0].verification,result.verification);
 assert.equal(calls.length,1);
 assert.equal(calls.some(call=>call.target.pathname.includes('feeds3_html_more')),false);
 assert.equal(records.at(-1).row.stage,'receipt');
});

test('own post verification requires the exact post id and the full normalized body',async t=>{
 const scenarios=[
  ['falsepost',postHtml('post-other','完整动态 正文'),'unconfirmed'],
  ['wrongtext',postHtml('post-1','完整动态 正文 但多了一段'),'unconfirmed'],
  ['missingcoverage',null,'unconfirmed'],
  ['correct',postHtml('post-1',' 完整动态   正文 '),'observed'],
 ];
 for(const [name,html,expected]of scenarios){
  await t.test(name,async()=>{
   const {service,state,calls,records}=fixture({entries:[postEntry()],feeds:html});
   const result=await service.verifyEntry('post-entry',context);
   assert.equal(result.state,expected);
   assert.equal(result.method,'feeds3-post');
   assert.equal(result.checkedAt,base);
   assert.equal(result.recipient,'unknown');
   assert.equal(result.read,'unknown');
   assert.equal(state.value.entries[0].status,'accepted');
   assert.deepEqual(state.value.entries[0].verification,result);
   assert.equal(calls.filter(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)).length,0);
   assert.equal(calls.every(call=>call.options.method==='GET'),true);
   assert.equal(records.at(-1).row.stage,'verification');
   assert.deepEqual(records.at(-1).c,context);
   assert.equal(JSON.stringify(records).includes(auth.cookie),false);
  });
 }
});

test('own image post verification requires an exact conservative image count and never resends',async t=>{
 const scenarios=[
  ['matching count',2,false,'observed'],
  ['mismatched count',1,false,'unconfirmed'],
  ['unknown count',1,true,'unconfirmed'],
 ];
 for(const [name,actual,broken,expected]of scenarios){
  await t.test(name,async()=>{
   const own='<a class="user-avatar"><img src="avatar"></a>'+marker()+
    '<div class="f-info">带图动态</div>'+imageBox(actual,{broken})+
    `<div class="f-single-foot"><div class="comments-list">${imageBox(3)}</div></div>`;
   const other=marker('other-post')+'<div class="f-info">另一条</div>'+imageBox(4);
   const feedsValue={code:0,data:{data:[{html:other},null,{html:own},null]}};
   const entry=postEntry({text:'带图动态',imageCount:2,images:[{hash:'one'},{hash:'two'}]});
   const {service,state,calls,records}=fixture({
    entries:[entry],
    respond:call=>{
     assert.match(call.target.pathname,/feeds3_html_more/);
     return Response.json(feedsValue);
    },
   });
   const result=await service.verifyEntry('post-entry',context);
   assert.equal(result.state,expected);
   assert.equal(result.method,'feeds3-post');
   if(expected==='unconfirmed')assert.match(result.reason,/配图数量|无法确认/);
   assert.equal(state.value.entries[0].status,'accepted');
   assert.deepEqual(state.value.entries[0].verification,result);
   assert.equal(records.at(-1).row.stage,'verification');
   assert.equal(calls.filter(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)).length,0);
   assert.equal(calls.every(call=>call.options.method==='GET'),true);
  });
 }
});

test('own root reply readback matches depth, parent, author and full text and returns the exact child id',async()=>{
 const html=marker()+rootHtml()+replyHtml({id:'1001',text:'回复   正文'});
 const {service,state,calls}=fixture({entries:[replyEntry()],feeds:html});
 const result=await service.verifyEntry('reply-entry',context);
 assert.deepEqual(result,{
  state:'observed',
  method:'feeds3-reply',
  checkedAt:base,
  reason:'已读回当前账号在该评论下的完整回复',
  recipient:'unknown',
  read:'unknown',
  matchedChildId:'1001',
 });
 assert.equal(state.value.entries[0].status,'accepted');
 assert.deepEqual(state.value.entries[0].verification,result);
 assert.equal(calls.some(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)),false);
});

test('reply verification rejects a wrong parent, author, or full text even when the root exists',async t=>{
 const scenarios=[
  ['wrongparent',marker()+rootHtml('901')+replyHtml()],
  ['wrongauthor',marker()+rootHtml()+replyHtml({uin:'87654322'})],
  ['wrongtext',marker()+rootHtml()+replyHtml({text:'回复 正文 多写了一段'})],
  ['prefixonly',marker()+rootHtml()+replyHtml({text:'回复'})],
 ];
 for(const [name,html]of scenarios){
  await t.test(name,async()=>{
   const {service,state,calls}=fixture({entries:[replyEntry()],feeds:html});
   const result=await service.verifyEntry('reply-entry',context);
   assert.equal(result.state,'unconfirmed');
   assert.equal(result.method,'feeds3-reply');
   assert.equal('matchedChildId'in result,false);
   assert.equal(state.value.entries[0].status,'accepted');
   assert.equal(calls.some(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)),false);
  });
 }
});

test('code zero reply receipt is not proof when the actual child is absent',async()=>{
 const knownComment={id:'900',uin:otherAuthor,owner:auth.uin,tid:'post-1',scope,text:'根评论',parentId:null,parentUin:null};
 let replyReceipts=0,feedReads=0;
 const {service,state,calls}=fixture({
  comments:[knownComment],
  respond:call=>{
   if(call.target.pathname.includes('re_feeds')){
    replyReceipts+=1;
    return Response.json({code:0,data:{commentid:'1001'}});
   }
   if(call.target.pathname.includes('feeds3_html_more')){
    feedReads+=1;
    return Response.json(feed(marker()+rootHtml()));
   }
   throw Error('unexpected request');
  },
 });
 const published=await service.publish({
  text:'回复\n正文',
  target:{uin:auth.uin,tid:'post-1'},
  commentId:'900',
  commentUin:otherAuthor,
 },context);
 assert.equal(published.status,'accepted');
 assert.equal(published.verification.state,'pending');
 const callsAfterPublish=calls.length;
 const result=await service.verifyEntry(published.id,context);
 assert.equal(result.state,'unconfirmed');
 assert.equal(result.method,'feeds3-reply');
 assert.equal(state.value.entries[0].status,'accepted');
 assert.equal(replyReceipts,1);
 assert.equal(feedReads,1);
 assert.equal(calls.slice(callsAfterPublish).some(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)),false);
});

test('read failure is sanitized and never changes an accepted write status',async()=>{
 const secretUrl='https://private.test/read?token=RAW-COOKIE-SECRET';
 const {service,state,calls,records}=fixture({
  entries:[postEntry()],
  respond:()=>{throw Error(`${auth.cookie} ${secretUrl}`);},
 });
 const result=await service.verifyEntry('post-entry',context);
 assert.equal(result.state,'unconfirmed');
 assert.equal(result.recipient,'unknown');
 assert.equal(result.read,'unknown');
 assert.match(result.reason,/读回/);
 assert.equal(result.reason.includes('RAW-COOKIE-SECRET'),false);
 assert.equal(result.reason.includes(secretUrl),false);
 assert.equal(state.value.entries[0].status,'accepted');
 assert.equal(JSON.stringify(state.value).includes('RAW-COOKIE-SECRET'),false);
 assert.equal(JSON.stringify(records).includes('RAW-COOKIE-SECRET'),false);
 assert.equal(calls.length,1);
});

test('auth and scope changes block verification before or after readback without mutation',async t=>{
 await t.test('changed account performs no network read',async()=>{
  const changed={...auth,uin:'99999999'};
  const {service,state,calls}=fixture({entries:[postEntry()],getAuth:async()=>changed,feeds:postHtml('post-1','完整动态 正文')});
  const result=await service.verifyEntry('post-entry',context);
  assert.equal(result.state,'unconfirmed');
  assert.match(result.reason,/账号/);
  assert.equal(calls.length,0);
  assert.equal(state.value.entries[0].status,'accepted');
 });
 await t.test('foreign scope cannot address another scope entry',async()=>{
  const {service,calls}=fixture({entries:[postEntry()],feeds:postHtml('post-1','完整动态 正文')});
  await assert.rejects(service.verifyEntry('post-entry',{...context,personaId:'other'}),/不属于当前/);
  assert.equal(calls.length,0);
 });
 await t.test('authorization is checked again after network',async()=>{
  let allowed=true;
  const {service,state,calls}=fixture({
   entries:[postEntry()],
   authorize:()=>allowed,
   respond:()=>{
    allowed=false;
    return Response.json(feed(postHtml('post-1','完整动态 正文')));
   },
  });
  await assert.rejects(service.verifyEntry('post-entry',context),/停止/);
  assert.equal(calls.length,1);
  assert.equal(state.value.entries[0].status,'accepted');
  assert.deepEqual(state.value.entries[0].verification,{state:'pending',recipient:'unknown',read:'unknown'});
 });
});

test('unknown entries verify only with known readback targets and never retry writes',async t=>{
 await t.test('unknown post with missing ids performs no read or write',async()=>{
  const {service,state,calls}=fixture({entries:[postEntry({status:'unknown',itemId:'',owner:''})]});
  const result=await service.verifyEntry('post-entry',context);
  assert.equal(result.state,'unconfirmed');
  assert.equal(calls.length,0);
  assert.equal(state.value.entries[0].status,'unknown');
 });
 await t.test('unknown reply without a previously read target performs no network read',async()=>{
  const {service,state,calls}=fixture({entries:[replyEntry({status:'unknown'})]});
  const result=await service.verifyEntry('reply-entry',context);
  assert.equal(result.state,'unconfirmed');
  assert.equal(calls.length,0);
  assert.equal(state.value.entries[0].status,'unknown');
 });
 await t.test('unknown reply with a known target can be observed read-only',async()=>{
  const knownComment={id:'900',uin:otherAuthor,owner:auth.uin,tid:'post-1',scope,text:'根评论',parentId:null,parentUin:null};
  const {service,state,calls}=fixture({
   entries:[replyEntry({status:'unknown'})],
   comments:[knownComment],
   feeds:marker()+rootHtml()+replyHtml(),
  });
  const result=await service.verifyEntry('reply-entry',context);
  assert.equal(result.state,'observed');
  assert.equal(state.value.entries[0].status,'unknown');
  assert.equal(calls.filter(call=>/publish_v6|re_feeds|upload_image/.test(call.target.pathname)).length,0);
 });
 await t.test('failed entries never use the read path',async()=>{
  const {service,state,calls}=fixture({entries:[postEntry({status:'failed'})]});
  const result=await service.verifyEntry('post-entry',context);
  assert.equal(result.state,'unconfirmed');
  assert.equal(calls.length,0);
  assert.equal(state.value.entries[0].status,'failed');
 });
});
