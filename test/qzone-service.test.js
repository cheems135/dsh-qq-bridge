import test from 'node:test';
import assert from 'node:assert/strict';
import {createQzoneService,parseQzoneComments} from '../qzone-service.js';

const context={accountId:'account-a',personaId:'persona-a'};
const auth={uin:'12345678',gtk:123,cookie:'uin=o12345678; p_skey=RAW-COOKIE-SECRET'};
const scope=JSON.stringify([context.accountId,context.personaId]);
const base=1700000000000;

function post(itemId,at=base,owner=auth.uin,status='accepted'){
 return{id:'entry-'+itemId,scope,kind:'publish',status,itemId,owner,text:'动态 '+itemId,at};
}

function memory(entries=[],comments=[]){
 const value={entries,comments};
 return{value,storage:{read:()=>structuredClone(value),write:next=>Object.assign(value,structuredClone(next))}};
}

function commentResponse(tid){
 if(tid==='post-24')return{code:0,data:{commentlist:[
  {commentid:900,uin:Number(auth.uin),name:'自己',content:'自己的评论'},
  {commentid:901,uin:87654321,name:'读者',content:'这条要回'}
 ]}};
 return{code:0,data:{commentlist:[]}};
}

test('Qzone comment parsing validates root comments and nested replies while keeping actual parents',()=>{
 const rows=parseQzoneComments({code:0,data:{
  comments:[
   {
    comment:{commentid:101,user:{uin:87654321,nickname:'甲'},content:{text:'顶层'},create_time:10},
    replyList:{
     commentid:102,author:{uin:87654322,name:'乙'},content:'第一层',
     parent_commentid:101,parent_uin:87654321,
     replies:{
      id:103,uin:87654323,name:'丙',message:'第二层',
      parent_commentid:102,parent_uin:87654322,
      root_commentid:101,root_uin:87654321
     }
    }
   },
   {commentid:'not-an-id',uin:87654321,content:'伪造标识'},
   {commentid:104,uin:'123',content:'伪造账号'},
   {commentid:105,uin:Number(auth.uin),content:'自己的评论'}
  ],
  replyList:[{commentid:107,uin:87654325,name:'戊',content:'独立回复列表',parent_commentid:101,parent_uin:87654321,root_commentid:101,root_uin:87654321}],
  main:{comment_list:[
   {commentid:101,uin:87654321,name:'甲',content:'顶层'},
   {commentid:106,user:{uin:87654324,nickname:'丁'},content:'另一个顶层'}
  ]}
 }},{tid:'post-1',uin:auth.uin});

 assert.deepEqual(rows.map(row=>row.id),['101','102','103','105','107','106']);
 const root=rows[0],first=rows[1],second=rows[2];
 assert.equal(root.name,'甲');
 assert.equal(root.parentId,null);
 assert.equal(root.parentUin,null);
 assert.equal(root.rootId,'101');
 assert.equal(root.rootUin,'87654321');
 assert.equal(first.parentId,'101');
 assert.equal(first.parentUin,'87654321');
 assert.equal(first.depth,1);
 assert.equal(second.parentId,'102');
 assert.equal(second.parentUin,'87654322');
 assert.equal(second.rootId,'101');
 assert.equal(second.rootUin,'87654321');
 assert.equal(second.depth,2);
 assert.equal(rows[4].parentId,'101');
 assert.equal(rows[4].rootId,'101');
 assert.equal(rows[4].depth,1);
 assert.equal(rows.at(-1).name,'丁');
});

test('Qzone replies send the exact stored nested reply identifiers and parent audit fields',async()=>{
 const state=memory();
 let replyParams=null,replyWrites=0;
 const service=createQzoneService({
  storage:state.storage,
  getAuth:async()=>auth,
  loadImage:()=>{throw Error('unused');},
  now:()=>base,
  fetchImpl:async(url,options)=>{
   const target=new URL(url),params=new URLSearchParams(options.body);
   if(target.pathname.includes('getdetail'))return Response.json({code:0,data:{comments:[{
    commentid:101,uin:87654321,name:'甲',content:'根评论',
    replies:[{commentid:102,uin:87654322,name:'乙',content:'楼中楼',parent_commentid:101,parent_uin:87654321}]
   }]}});
   if(target.pathname.includes('re_feeds')){replyWrites+=1;replyParams=params;return Response.json({code:0,data:{commentid:'reply-1'}});}
   throw Error('unexpected fixture request');
  }
 });

 await service.comments({tid:'post-1',uin:auth.uin},context);
 const target={uin:auth.uin,tid:'post-1'};
 await assert.rejects(service.publish({text:'错账号',target,commentId:'102',commentUin:'87650000'},context),/实际读取/);
 assert.equal(replyWrites,0);
 const result=await service.publish({text:'回复楼中楼',target,commentId:102,commentUin:87654322},context);
 assert.equal(result.status,'accepted');
 assert.equal(replyWrites,1);
 assert.equal(replyParams.get('commentId'),'102');
 assert.equal(replyParams.get('commentUin'),'87654322');
 assert.equal(replyParams.get('t2_tid'),'102');
 assert.equal(replyParams.get('t2_uin'),'87654322');
 assert.equal(replyParams.get('t1_tid'),'post-1');
 assert.equal(replyParams.get('t1_uin'),auth.uin);
 assert.equal(replyParams.get('topicId'),auth.uin+'_post-1__1');
 const savedReply=state.value.entries.find(row=>row.kind==='reply');
 assert.equal(savedReply.commentId,'102');
 assert.equal(savedReply.commentUin,'87654322');
 assert.equal(savedReply.parentId,'101');
 assert.equal(savedReply.parentUin,'87654321');
});

test('Qzone discovery scans the latest 20 accepted own posts from seven days and polls successfully every 60 seconds',async()=>{
 const entries=[];
 for(let index=0;index<25;index+=1){
  const at=index===0?base-7*86400000-1:base+index;
  entries.push(post('post-'+String(index).padStart(2,'0'),at));
 }
 const state=memory(entries),requested=[];
 let clock=base+30000;
 const service=createQzoneService({
  storage:state.storage,
  getAuth:async()=>auth,
  now:()=>clock,
  fetchImpl:async(url,options)=>{
   const target=new URL(url),tid=target.searchParams.get('tid')||new URLSearchParams(options.body).get('tid');if(target.pathname.includes('getdetail'))requested.push(tid);
   return Response.json(commentResponse(tid));
  }
 });

 const first=await service.nextReply(context);
 assert.equal(first.id,'901');
 assert.equal(first.uin,'87654321');
 assert.equal(first.postText,'动态 post-24');
 assert.deepEqual(new Set(requested),new Set(Array.from({length:20},(_,index)=>'post-'+String(index+5).padStart(2,'0'))));

 clock+=59999;
 assert.equal((await service.nextReply(context)).id,'901');
 assert.equal(requested.length,20);
 clock+=1;
 assert.equal((await service.nextReply(context)).id,'901');
 assert.equal(requested.length,40);
 assert.equal(service.status(context).poll.nextPollAt,clock+60000);
 assert.equal(await service.nextReply({...context,accountId:'other'}),null);
});

test('Qzone reply discovery excludes own comments and deduplicates accepted and unknown attempts per scope',async()=>{
 for(const status of ['accepted','unknown']){
  const state=memory([post('post-24')],[
   {id:'901',uin:'87654321',name:'读者',text:'这条要回',owner:auth.uin,tid:'post-24',scope},
   {id:'900',uin:auth.uin,name:'自己',text:'自己的评论',owner:auth.uin,tid:'post-24',scope}
  ]);
  state.value.entries.push({id:'reply-'+status,scope,kind:'reply',status,target:{uin:auth.uin,tid:'post-24'},commentId:'901',commentUin:'87654321'});
  const service=createQzoneService({storage:state.storage,getAuth:async()=>auth,now:()=>base,fetchImpl:async()=>Response.json(commentResponse('post-24'))});
  assert.equal(await service.nextReply(context),null);
  assert.equal(await service.nextReply({...context,personaId:'persona-b'}),null);
 }
});

test('Qzone poll failures are visible without secrets or URLs and retry after short bounded backoff',async()=>{
 const state=memory([post('post-1')]),records=[];
 let clock=base,calls=0,fail=true;
 const service=createQzoneService({
  storage:state.storage,
  getAuth:async()=>auth,
  now:()=>clock,
  onRecord:(row,c)=>records.push({row,c}),
  fetchImpl:async(url)=>{
   if(new URL(url).pathname.includes('getdetail'))calls+=1;
   if(fail)throw Error(`network ${auth.cookie} https://private.test/path?token=RAW-COOKIE-SECRET`);
   return Response.json({code:0,data:{commentlist:[{commentid:700,uin:87654321,name:'读者',content:'恢复后的评论'}]}});
  }
 });

 assert.equal(await service.nextReply(context),null);
 assert.equal(calls,1);
 let status=service.status(context).poll;
 assert.equal(status.state,'retrying');
 assert.equal(status.failureCount,1);
 assert.equal(status.nextPollAt,base+15000);
 assert.equal(status.error.code,'QZONE_POLL_FAILED');
 assert.equal(records.length,1);
 assert.equal(records[0].row.stage,'comment-poll-failed');

 clock=base+14999;
 assert.equal(await service.nextReply(context),null);
 assert.equal(calls,1);
 clock=base+15000;
 assert.equal(await service.nextReply(context),null);
 assert.equal(calls,2);
 status=service.status(context).poll;
 assert.equal(status.failureCount,2);
 assert.equal(status.nextPollAt,clock+30000);

 fail=false;clock+=30000;
 const target=await service.nextReply(context);
 assert.equal(target.id,'700');
 status=service.status(context).poll;
 assert.equal(status.state,'scheduled');
 assert.equal(status.failureCount,0);
 assert.equal(status.error,null);
 assert.equal(status.nextPollAt,clock+60000);

 const visible=JSON.stringify({records,status});
 assert.equal(visible.includes('RAW-COOKIE-SECRET'),false);
 assert.equal(visible.includes('https://private.test'),false);
});


test('Qzone falls back to observed feed previews when detail GET fails, then replies to the exact root',async()=>{
 const state=memory([post('post-1')]),requests=[];
 const service=createQzoneService({storage:state.storage,getAuth:async()=>auth,now:()=>base,fetchImpl:async(url,options)=>{
  requests.push({url,method:options.method,body:options.body});
  if(url.includes('getdetail')){assert.equal(options.method,'GET');assert.equal(new URL(url).searchParams.get('tid'),'post-1');return new Response('',{status:500});}
  if(url.includes('feeds3_html_more'))return Response.json({code:0,data:{data:[{html:'<i name="feed_data" data-tid="post-1" data-uin="12345678"></i><li data-type="commentroot" data-tid="8" data-uin="87654321" data-nick="甲"><div class="comments-content"><a>甲</a>: 这个挺好</div></li>'}]}});
  return Response.json({code:0,commentid:'9'});
 }});
 const target=await service.nextReply(context);assert.equal(target.id,'8');assert.equal(target.text,'这个挺好');
 await service.publish({text:'对吧，我也是被这里戳中了',target:{uin:auth.uin,tid:'post-1'},commentId:target.id,commentUin:target.uin},context);
 const params=new URLSearchParams(requests.at(-1).body);assert.equal(params.get('commentId'),'8');assert.equal(params.get('commentUin'),'87654321');assert.equal(params.get('t1_tid'),'post-1');
 assert.equal(await service.nextReply(context),null);assert.equal(requests.filter(r=>r.url.includes('re_feeds')).length,1);
});
