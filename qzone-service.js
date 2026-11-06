const {feedsComments,feedsPost,feedsTimeline}=await import(new URL('./qzone-feeds.js'+new URL(import.meta.url).search,import.meta.url));
import {qzoneJson} from './qzone-protocol.js';
export {qzoneJson} from './qzone-protocol.js';
import {createHash,randomUUID} from 'node:crypto';
import {parseQzoneResponse} from './qq-reliability.js';
import {safeImageList} from './social-images.js';
const user='https://user.qzone.qq.com',api=user+'/proxy/domain/taotao.qzone.qq.com/cgi-bin/';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clean=(v,n=2000)=>String(v??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,n);
const normalizedText=v=>String(v??'').replace(/\s+/g,' ').trim();
// QQ may remove line separators from posted comments in its HTML rendering.
const renderedReplyText=v=>String(v??'').replace(/\s+/g,'');
const commentIdPattern=/^\d{1,30}$/,uinPattern=/^\d{5,20}$/,tidPattern=/^[\w-]{1,200}$/;

const commentListKeys=['commentlist','comment_list','commentList','comments'];
const rootReplyListKeys=['replyList','reply_list','replylist'];
const nestedReplyKeys=['replies','replyList','reply_list','replylist','reply','replyComments','reply_comments','comments','children','subComments','sub_comments','subcomments'];
const isObject=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validCommentId=v=>commentIdPattern.test(String(v??''));
const validUin=v=>uinPattern.test(String(v??''));
const safeText=(v,n=2000)=>{
 if(isObject(v))v=v.text??v.content??v.message??'';
 return clean(v,n);
};
function commentSources(node){
 const values=[node];
 for(const key of ['comment','reply','item','data'])if(isObject(node?.[key]))values.push(node[key]);
 return values;
}
function pickField(node,keys){
 for(const source of commentSources(node))for(const key of keys){
  const value=source?.[key];
  if(value!==undefined&&value!==null&&value!=='')return value;
 }
 return undefined;
}
function pickAuthor(node,keys){
 for(const source of commentSources(node)){
  const candidates=[source?.user,source?.author,source?.poster,source?.userinfo].filter(isObject);
  for(const key of keys){
   const value=source?.[key];
   if(validUin(value))return value;
   for(const author of candidates)if(validUin(author?.[key]))return author[key];
  }
 }
 return undefined;
}
function pickName(node){
 const sources=commentSources(node),candidates=sources.flatMap(source=>[source,source?.user,source?.author,source?.poster,source?.userinfo]).filter(isObject);
 for(const source of candidates)for(const key of ['name','nickname'])if(source?.[key])return source[key];
 return '';
}
function childLists(node){
 const lists=[];
 for(const source of commentSources(node))for(const key of nestedReplyKeys){
  const value=source?.[key];
  if(Array.isArray(value))lists.push(value);
  else if(isObject(value))lists.push([value]);
 }
 return lists;
}
function rootCommentLists(value){
 const lists=[],visited=new Set();
 function visit(container,depth){
  if(!isObject(container)||depth>3||visited.has(container))return;visited.add(container);
  for(const key of [...commentListKeys,...rootReplyListKeys]){
   const value=container[key];
   if(Array.isArray(value))lists.push(value);
   else if(isObject(value))lists.push([value]);
  }
  for(const key of ['data','main','detail','feed','result'])if(isObject(container[key]))visit(container[key],depth+1);
 }
 visit(value,0);return lists;
}
export function parseQzoneComments(value,{tid,uin}={}){
 const rows=[],byKey=new Map();
 const postTid=String(tid??''),postUin=String(uin??'');
 if(!tidPattern.test(postTid)||!validUin(postUin))return [];
 function add(node,parent=null,depth=0){
  if(!isObject(node))return;
  const id=pickField(node,['commentid','commentId','comment_id','commentID','cid','id']);
  const author=pickAuthor(node,['uin','uid']);
  if(!validCommentId(id)||!validUin(author))return;
  const ownId=String(id),ownUin=String(author);
  const sources=commentSources(node),parentObject=sources.map(source=>source?.parent??source?.replyTo).find(isObject),rootObject=sources.map(source=>source?.root).find(isObject);
  const explicitParentId=pickField(node,['parent_commentid','parent_comment_id','parentCommentId','parent_id','parentId','reply_commentid','reply_comment_id','replyCommentId','replyToCommentId','to_commentid','toCommentId','t2_tid'])??pickField(parentObject,['commentid','commentId','id']);
  const explicitParentUin=pickField(node,['parent_uin','parentUin','reply_uin','replyUin','replyToUin','to_uin','toUin','t2_uin'])??pickField(parentObject,['uin','uid']);
  const explicitRootId=pickField(node,['root_commentid','root_comment_id','rootCommentId','root_id','rootId'])??pickField(rootObject,['commentid','commentId','id']);
  const explicitRootUin=pickField(node,['root_uin','rootUin'])??pickField(rootObject,['uin','uid']);
  const hasExplicitParent=validCommentId(explicitParentId);
  let parentId=parent?.id??'',parentUin=parent?.uin??'';
  if(hasExplicitParent){
   const nextParentId=String(explicitParentId);
   parentId=nextParentId;
   if(validUin(explicitParentUin))parentUin=String(explicitParentUin);
   else if(!parent||nextParentId!==parent.id)parentUin='';
  }
  let rootId=parent?.rootId??(parent||hasExplicitParent?null:ownId),rootUin=parent?.rootUin??(parent||hasExplicitParent?null:ownUin);
  if(validCommentId(explicitRootId)){
   const nextRootId=String(explicitRootId);
   rootId=nextRootId;
   if(validUin(explicitRootUin))rootUin=String(explicitRootUin);
   else if(!parent||nextRootId!==parent.rootId)rootUin='';
  }else if(validUin(explicitRootUin))rootUin=String(explicitRootUin);
  if(!parentId)parentUin='';
  const rowDepth=parent?Math.max(Number(depth)||0,parent.depth+1):hasExplicitParent?Math.max(1,Number(depth)||0):Math.max(0,Number(depth)||0);
  const name=clean(pickName(node),80);
  const row={id:ownId,uin:ownUin,name,text:safeText(pickField(node,['content','text','message']),1500),at:Number(pickField(node,['create_time','createtime','createTime','time']))||0,owner:postUin,tid:postTid,parentId:parentId||null,parentUin:parentId&&validUin(parentUin)?String(parentUin):null,rootId:validCommentId(rootId)?String(rootId):null,rootUin:validUin(rootUin)?String(rootUin):null,depth:rowDepth};
  const key=ownId+'\0'+ownUin,existing=byKey.get(key);
  if(existing){for(const field of ['name','text','at','parentId','parentUin','rootId','rootUin','depth'])if(!existing[field]&&row[field])existing[field]=row[field];}
  else{byKey.set(key,row);rows.push(row);}
  for(const list of childLists(node))for(const child of list)add(child,{id:row.id,uin:row.uin,rootId:row.rootId,rootUin:row.rootUin,depth:row.depth},row.depth+1);
 }
 for(const list of rootCommentLists(value))for(const item of list)add(item);
 return rows;
}
export function qzoneUploadResult(value){
 const data=value.data||value,read=(...keys)=>keys.map(k=>data[k]??value[k]).find(v=>v!==undefined&&v!=='');
 const album=clean(read('albumid','album_id'),200),lloc=clean(read('lloc'),300),sloc=clean(read('sloc'),300),type=String(read('type','phototype')||1),height=Number(read('height')),width=Number(read('width'));
 let bo=clean(read('pic_bo','picbo','bo'),1000);if(!bo)try{bo=new URL(String(read('pre','url','origin_url'))).searchParams.get('bo')||'';}catch{}
 if(!album||!lloc||!sloc||!bo||!Number.isInteger(height)||!Number.isInteger(width)||height<1||width<1||/[\t\r\n,]/.test(album+lloc+sloc+type))throw Error('空间图片上传回执不完整，未发布纯文字代替');
 return {richval:`,${album},${lloc},${sloc},${type},${height},${width},,${height},${width}`,picBo:bo,width,height};
}
export function createQzoneService({storage,getAuth,loadImage,fetchImpl=fetch,authorize=()=>true,onRecord=()=>{},onAuthFailure=()=>{},beforeWrite=()=>{},allowTarget=()=>true,now=Date.now}={}){
 let state;try{state=storage.read();}catch(e){if(e.code!=='ENOENT')throw e;}state||={version:1,entries:[],comments:[]};state.entries||=[];state.comments||=[];state.posts||=[];
 for(const row of state.entries)if(['uploading','sending'].includes(row.status))row.status='unknown';
 const save=()=>storage.write(state),scope=c=>JSON.stringify([c.accountId||'',c.personaId]),check=c=>{if(!authorize(c))throw Error('账号、人设或任务已变化，空间操作停止');c.signal?.throwIfAborted();};
 function parsed(raw,c){try{return qzoneJson(raw);}catch(error){if(error.code==='QZONE_AUTH_REQUIRED')try{onAuthFailure(error,c);}catch{}throw error;}}
 function safe(row){const {scope:_,fingerprint,...result}=row;return result;}
 async function transport(url,params,auth,c,{post=true}={}){
  check(c);const u=new URL(url);u.searchParams.set('g_tk',String(auth.gtk));const headers={'user-agent':'Mozilla/5.0','referer':user+'/'+auth.uin,'cookie':auth.cookie};let body;if(post){headers['content-type']='application/x-www-form-urlencoded;charset=UTF-8';body=new URLSearchParams(params).toString();}else for(const [k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  const response=await fetchImpl(u.href,{method:post?'POST':'GET',headers,body,redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(60000),...(c.signal?[c.signal]:[])])});check(c);if(!response.ok){const error=Object.assign(Error('空间请求失败（HTTP '+response.status+'）'),{code:response.status===401?'QZONE_AUTH_REQUIRED':'QZONE_NETWORK'});if(error.code==='QZONE_AUTH_REQUIRED')try{onAuthFailure(error,c);}catch{}throw error;}const raw=await response.text();check(c);return raw;
 }
 async function upload(image,auth,c){
  const tokens=Object.fromEntries(auth.cookie.split(';').map(p=>{const i=p.indexOf('=');return[p.slice(0,i).trim(),p.slice(i+1)];}));
  const raw=await transport('https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image',{uin:auth.uin,p_uin:auth.uin,zzpaneluin:auth.uin,skey:tokens.skey||'',p_skey:tokens.p_skey||'',filename:'filename',uploadtype:1,albumtype:7,exttype:0,refer:'shuoshuo',output_type:'jsonhtml',charset:'utf-8',output_charset:'utf-8',upload_hd:1,hd_width:2048,hd_height:10000,hd_quality:96,base64:1,picfile:image.bytes.toString('base64'),qzreferrer:user+'/'+auth.uin},auth,c);
  return {...qzoneUploadResult(parsed(raw,c)),hash:image.hash,file:image.file};
 }
 async function publish({text,images=[],target,commentId,commentUin,comment=false},c){
  check(c);if(String(text??'').trim().length>2000)throw Error('空间正文最多2000字，请完整调整后再发布');text=clean(text);if(!text)throw Error('请先提供完整正文');safeImageList(images);
  const isComment=!!target&&comment===true,isReply=!!target&&!isComment,isThread=isReply||isComment;if(isThread&&images.length)throw Error('当前空间评论接口尚未验证带图回复，未丢掉配图改发纯文字');
  const replyPost=isThread?{uin:String(target.uin??''),tid:String(target.tid??'')}:null,actualComment=isReply?state.comments.find(r=>r.scope===scope(c)&&r.tid===replyPost.tid&&r.owner===replyPost.uin&&r.id===String(commentId)&&r.uin===String(commentUin)):null;
  if(isReply&&(!tidPattern.test(replyPost.tid)||!validUin(replyPost.uin)||!validCommentId(commentId)||!validUin(commentUin)))throw Error('回复需要已读取的动态及评论准确标识');
  if(isReply&&!actualComment)throw Error('请先实际读取目标动态的评论，不能猜评论 ID');
  if(isThread&&!allowTarget(replyPost.uin,c))throw Error('空间目标不在当前允许范围');
  if(isComment&&(!tidPattern.test(replyPost.tid)||!validUin(replyPost.uin)||!state.posts.some(p=>p.scope===scope(c)&&p.uin===replyPost.uin&&p.tid===replyPost.tid)))throw Error('请先实际浏览这条动态，不能猜测评论目标');
  const actualCommentId=isReply?actualComment.id:'',actualCommentUin=isReply?actualComment.uin:'';
  const prepared=[];for(const source of images){check(c);prepared.push(await loadImage(source,c));}check(c);
  const fingerprint=hash([scope(c),isReply?'reply':isComment?'comment':'publish',text,prepared.map(i=>i.hash),replyPost,actualCommentId,actualCommentUin]);const existing=state.entries.find(r=>r.fingerprint===fingerprint&&['uploading','sending','accepted','unknown'].includes(r.status));
  if(existing)return {ok:existing.status==='accepted',duplicate:true,...safe(existing),coverage:'本次内容已提交或结果待核对，未重复发布'};
  const row={id:randomUUID(),scope:scope(c),fingerprint,kind:isReply?'reply':isComment?'comment':'publish',text,imageCount:prepared.length,images:prepared.map(i=>({file:i.file,hash:i.hash,source:i.source||'generated-or-uploaded',provenance:i.provenance||null})),...(isThread?{target:replyPost,...(isReply?{commentId:actualCommentId,commentUin:actualCommentUin,parentId:actualComment.parentId,parentUin:actualComment.parentUin}:{})}:{}),at:now(),status:'uploading'};state.entries.push(row);state.entries=state.entries.slice(-300);save();onRecord({...safe(row),stage:'start'},c);
  let writeStarted=false;
  try{
   const auth=await getAuth(c);check(c);if(!auth.cookie||!auth.gtk||!/^\d{5,20}$/.test(String(auth.uin)))throw Error('空间登录状态不可用');
   const uploaded=[];for(const image of prepared){uploaded.push(await upload(image,auth,c));row.uploaded=uploaded.map(({hash,width,height,file})=>({hash,width,height,file}));save();onRecord({...safe(row),stage:'image-upload'},c);}
   check(c);const fresh=await getAuth(c);check(c);if(fresh.uin!==auth.uin||fresh.cookie!==auth.cookie||fresh.gtk!==auth.gtk)throw Error('空间登录状态已变化，请重新核对后发布');const params=isThread?{topicId:`${replyPost.uin}_${replyPost.tid}__1`,hostUin:replyPost.uin,uin:auth.uin,content:text,paramstr:isReply?2:1,t1_uin:replyPost.uin,t1_tid:replyPost.tid,...(isReply?{commentId:actualCommentId,commentUin:actualCommentUin,t2_uin:actualCommentUin,t2_tid:actualCommentId}:{}),format:'json',qzreferrer:user+'/'+replyPost.uin}:{syn_tweet_verson:1,paramstr:1,who:1,con:text,feedversion:1,ver:1,ugc_right:1,to_sign:0,hostuin:auth.uin,code_version:1,format:'json',qzreferrer:user+'/'+auth.uin,...(uploaded.length?{richtype:1,subrichtype:1,richval:uploaded.map(i=>i.richval).join('\t'),pic_bo:uploaded.map(i=>i.picBo).join(','),pic_template:''}:{})};
   await beforeWrite(row,c);check(c);row.status='sending';save();writeStarted=true;
   const raw=await transport((isThread?'https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/':api)+(isThread?'emotion_cgi_re_feeds':'emotion_cgi_publish_v6'),params,auth,c);
   const value=parsed(raw,c),receipt=isThread?{ok:true,status:'accepted',verified:false,itemId:String(value.data?.commentid||value.commentid||''),coverage:'平台已接收评论；尚未读回核对'}:parseQzoneResponse(raw);
   const verification={state:'pending',recipient:'unknown',read:'unknown'};
   Object.assign(row,{status:'accepted',itemId:receipt.itemId,updatedAt:now(),owner:String(auth.uin),verification});save();onRecord({...safe(row),stage:'receipt',result:receipt},c);return {...receipt,id:row.id,imageCount:row.imageCount,verification:{...verification}};
  }catch(error){row.status=writeStarted&&error.apiCode===undefined?'unknown':'failed';row.updatedAt=now();row.error=row.status==='unknown'?'空间提交结果待核对，未自动重试':'空间'+(writeStarted?'发布':'图片准备或上传')+'未完成：'+String(error.message).replace(/https?:\/\/\S+/g,'[接口]').slice(0,180);save();onRecord({...safe(row),stage:'failed'},c);throw Object.assign(Error(row.error),{deliveryUnknown:row.status==='unknown'});}
 }
 const feedCache=new Map();
 async function feedPreview(auth,c,{fresh=false,targetUin=auth.uin}={}){
  const key=scope(c)+'\0'+hash([auth.uin,auth.cookie,c.connectionRevision,String(targetUin)]),old=fresh?null:feedCache.get(key);if(old&&now()-old.at<(old.error?15000:30000)){if(old.error)throw old.error;return old.value;}
  try{
  const raw=await transport(user+'/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',{uin:auth.uin,scope:String(targetUin)===String(auth.uin)?1:0,view:1,daylist:'',uinlist:String(targetUin)===String(auth.uin)?'':String(targetUin),gid:'',flag:1,filter:'all',applist:'all',refresh:1,pagenum:0,begintime:0,dayspac:7,sidomain:'qzonestyle.gtimg.cn',useutf8:1,outputhtmlfeed:1,format:'json'},auth,c,{post:false});
  const value=parsed(raw,c);check(c);feedCache.set(key,{at:now(),value});return value;
  }catch(error){check(c);feedCache.set(key,{at:now(),error});throw error;}
 }
 async function feed({uin,limit=20}={},c){
  check(c);const auth=await getAuth(c);check(c);const target=String(uin||auth.uin);
  if(!validUin(target)||!allowTarget(target,c))throw Error('空间作者不在当前允许范围');
  const value=await feedPreview(auth,c,{fresh:true,targetUin:target}),posts=feedsTimeline(value,{uin:target,limit:Math.max(1,Math.min(40,Number(limit)||20))});check(c);
  state.posts=state.posts.filter(p=>p.scope!==scope(c)||p.uin!==target).concat(posts.map(p=>({...p,scope:scope(c),readAt:now()}))).slice(-400);
  // Only previews actually in this visit are retained. No other post is fetched.
  for(const post of posts){const preview=feedsComments(value,{tid:post.tid,uin:target,includeReplies:true});if(preview.matched){const rows=preview.rows.map(row=>({...row,scope:scope(c),owner:target,tid:post.tid}));state.comments=state.comments.filter(row=>!rows.some(p=>p.scope===row.scope&&p.owner===row.owner&&p.tid===row.tid&&p.id===row.id&&p.uin===row.uin)).concat(rows).slice(-500);}}
  save();return {ok:true,posts,comments:state.comments.filter(p=>p.scope===scope(c)&&posts.some(post=>post.tid===p.tid&&post.uin===p.owner)).map(safe),coverage:'本次主动访问实际取得的动态和内嵌评论预览，可能不完整；图片仅有数量，未取得视觉画面；未返回不等于没有动态。可自行选择评论、回复或保持安静，不另行定时轮询。'};
 }
 async function comments({tid,uin},c){
  check(c);const postTid=String(tid??''),postUin=String(uin??'');if(!tidPattern.test(postTid)||!validUin(postUin)||!allowTarget(postUin,c))throw Error('请提供允许范围内的准确动态 ID 和作者账号');
  const auth=await getAuth(c);let rows=[],detailError=null,source='detail',coverage='仅取得接口实际返回并校验通过的评论与楼中楼；没有结果不等于没有评论';
  try{const raw=await transport(api+'emotion_cgi_getdetailv6',{uin:postUin,tid:postTid,hostuin:auth.uin,format:'json',replynum:100},auth,c,{post:false});rows=parseQzoneComments(parsed(raw,c),{tid:postTid,uin:postUin});}
  catch(error){check(c);if(error.code==='QZONE_AUTH_REQUIRED')throw error;detailError=error;}
  if(!rows.length){
   try{const preview=feedsComments(await feedPreview(auth,c,{targetUin:postUin}),{tid:postTid,uin:postUin,includeReplies:true});if(preview.matched){rows=preview.rows.map(row=>({...row,owner:postUin,tid:postTid}));source='feeds3-preview';coverage=preview.coverage;}else if(detailError)throw Object.assign(Error('当前动态未出现在空间实际返回的列表中'),{code:'QZONE_POST_NOT_OBSERVED'});}
   catch(error){check(c);if(detailError||error.code==='QZONE_AUTH_REQUIRED')throw error;coverage+='；动态流备用读取暂不可用';}
  }else if(detailError)throw detailError;
  rows=rows.map(row=>({...row,scope:scope(c)}));
  // A preview must not erase previously observed detailed replies.
  const same=r=>r.scope===scope(c)&&r.owner===postUin&&r.tid===postTid;
  state.comments=state.comments.filter(r=>!same(r)||source==='feeds3-preview'&&!rows.some(n=>n.id===r.id&&n.uin===r.uin)).concat(rows).slice(-500);save();return {ok:true,source,comments:rows.map(safe),coverage};
 }
 function verificationOutcome(state,method,checkedAt,reason,matchedChildId){
  const result={state,method,checkedAt,reason,recipient:'unknown',read:'unknown'};
  if(validCommentId(matchedChildId))result.matchedChildId=String(matchedChildId);
  return result;
 }
 function readFailureReason(error){
  const code=String(error?.code||'');
  if(code==='QZONE_AUTH_REQUIRED')return'空间登录状态不可用，未读回核对';
  if(code==='QZONE_THROTTLED')return'空间读回请求被限流，未读回核对';
  if(code==='QZONE_RESPONSE_INVALID')return'空间读回内容无法验证，未读回核对';
  if(code==='QZONE_NETWORK')return'空间读回网络请求失败，未读回核对';
  if(code==='QZONE_ABORTED'||code==='ABORT_ERR')return'空间读回已取消，未读回核对';
  if(code==='QZONE_API_ERROR'&&Number.isFinite(Number(error?.apiCode)))return`空间接口拒绝读回（code=${Number(error.apiCode)}）`;
  return'空间读回失败，未读回核对';
 }
 async function verifyEntry(id,c){
  check(c);
  const key=scope(c),row=state.entries.find(item=>item.scope===key&&item.id===String(id));
  if(!row)throw Error('空间发布记录不存在或不属于当前账号人设');
  const method=row.kind==='reply'?'feeds3-reply':row.kind==='comment'?'feeds3-comment':'feeds3-post';
  const remember=result=>{row.verification={...result};save();try{onRecord({...safe(row),stage:'verification',verification:{...result},result:{...result}},c);}catch{}return{...result};};
  const unavailable=reason=>remember(verificationOutcome('unconfirmed',method,now(),reason));
  if(!['accepted','unknown'].includes(row.status))return unavailable('仅平台已接收或结果待核对的发布记录可读回');
  if(row.kind==='publish'){
   if(!tidPattern.test(String(row.itemId??''))||!validUin(row.owner))return unavailable('缺少可核对的动态 ID 或发布账号，未猜测补全');
  }else if(row.kind==='reply'){
   const targetUin=String(row.target?.uin??''),targetTid=String(row.target?.tid??''),commentId=String(row.commentId??''),commentUin=String(row.commentUin??'');
   if(!validUin(targetUin)||!tidPattern.test(targetTid)||!validCommentId(commentId)||!validUin(commentUin))return unavailable('缺少可核对的评论回复标识，未猜测补全');
   if(row.status==='unknown'&&!state.comments.some(item=>item.scope===key&&item.owner===targetUin&&item.tid===targetTid&&item.id===commentId&&item.uin===commentUin))return unavailable('未知结果回复的目标评论尚未实际读取，暂不读回');
  }else if(row.kind==='comment'){if(!validUin(row.target?.uin)||!tidPattern.test(String(row.target?.tid||''))||!validCommentId(row.itemId))return unavailable('一级评论缺少可核对的真实回执ID，暂不判定完成');}else return unavailable('未知的空间发布类型，无法读回');
  let auth;try{auth=await getAuth(c);}catch(error){check(c);return unavailable(readFailureReason(error));}
  check(c);
  if(!auth?.cookie||auth.gtk===undefined||auth.gtk===null||!validUin(auth.uin))return unavailable('空间登录状态不可用，未读回核对');
  const storedOwner=String(row.owner||row.target?.uin||'');
  if(!validUin(storedOwner)||storedOwner!==String(auth.uin))return unavailable('当前空间登录账号与发布账号不一致，未读回核对');
  if(row.target&&!allowTarget(String(row.target.uin),c))return unavailable('评论目标已不在允许范围');
  try{
   const value=await feedPreview(auth,c,{fresh:true,targetUin:row.target?.uin||auth.uin});check(c);
   if(row.kind==='publish'){
    const observed=feedsPost(value,{tid:row.itemId,uin:auth.uin});
    if(!observed.matched)return unavailable(observed.coverage||'当前空间列表尚未覆盖目标动态');
    if(normalizedText(observed.text)!==normalizedText(row.text))return unavailable('已找到同一动态，但当前预览未返回匹配的完整正文；不能据此判定发布失败');
    const expectedImages=Number.isInteger(row.imageCount)&&row.imageCount>=0?row.imageCount:Array.isArray(row.images)?row.images.length:null;
    if(expectedImages>0){
     if(!Number.isInteger(observed.imageCount)||observed.imageCount<0)return unavailable('已找到同一动态且正文一致，但无法确认实际配图数量');
     if(observed.imageCount!==expectedImages)return unavailable(`已找到同一动态且正文一致，但实际配图数量不一致（预期${expectedImages}，实际${observed.imageCount}）`);
    }
    return remember(verificationOutcome('observed',method,now(),'已在当前账号动态流读回完整正文'));
   }
   const observed=feedsComments(value,{tid:row.target.tid,uin:row.target.uin,includeReplies:true});
   if(!observed.matched)return unavailable(observed.coverage||'当前空间列表尚未覆盖目标动态');
   if(row.kind==='comment'){const root=observed.rows.find(item=>Number(item.depth||0)===0&&String(item.id)===String(row.itemId)&&String(item.uin)===String(auth.uin)&&renderedReplyText(item.text)===renderedReplyText(row.text));return root?remember(verificationOutcome('observed',method,now(),'已读回作者、评论ID和完整正文一致的一级评论',root.id)):unavailable('尚未读回本次一级评论，不重复提交');}
   const child=observed.rows.find(item=>Number(item.depth)===1&&String(item.parentId??'')===String(row.commentId)&&String(item.parentUin??'')===String(row.commentUin)&&String(item.uin??'')===String(auth.uin)&&renderedReplyText(item.text)===renderedReplyText(row.text)&&validCommentId(item.id));
   if(!child)return unavailable('动态已读回，但未找到作者、父评论和完整正文都匹配的楼中楼');
   return remember(verificationOutcome('observed',method,now(),'已读回当前账号在该评论下的完整回复',child.id));
  }catch(error){check(c);return unavailable(readFailureReason(error));}
 }
 const POLL_LOOKBACK_MS=7*86400000,POLL_POST_LIMIT=20;
 const pollSnapshot=()=>({state:'on_visit',checking:false,intervalMs:0,nextPollAt:null,coverage:'只在主动访问时读取，不定时轮询评论'});
 async function nextReply(c){
  check(c);const key=scope(c),posts=state.entries.filter(r=>r.scope===key&&r.kind==='publish'&&r.status==='accepted'&&r.itemId&&r.owner&&now()-r.at<POLL_LOOKBACK_MS).slice(-POLL_POST_LIMIT);
  if(!posts.length)return null;
  const postByThread=new Map(posts.map(post=>[post.owner+'\0'+post.itemId,post]));
  const target=state.comments.filter(r=>r.scope===key&&postByThread.has(r.owner+'\0'+r.tid)&&validCommentId(r.id)&&validUin(r.uin)&&r.uin!==r.owner&&r.text&&!state.entries.some(e=>e.scope===key&&e.kind==='reply'&&e.target?.uin===r.owner&&e.target?.tid===r.tid&&e.commentId===r.id&&(!e.commentUin||e.commentUin===r.uin)&&['uploading','sending','accepted','unknown'].includes(e.status))).at(-1);
  return target?{...safe(target),postText:posts.find(p=>p.itemId===target.tid)?.text}:null;
 }
 return {publish,feed,comments,nextReply,verifyEntry,status:c=>{const key=scope(c);return{posts:state.posts.filter(r=>r.scope===key).slice(-40).map(safe),entries:state.entries.filter(r=>r.scope===key).slice(-30).reverse().map(safe),comments:state.comments.filter(r=>r.scope===key).slice(-60).map(safe),poll:pollSnapshot(key)};}};
}
