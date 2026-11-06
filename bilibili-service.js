export const BILIBILI_MEDIA_REVISION='20261106-continuous-bilibili-v1';
import {safeImageList,imageBytes} from './social-images.js';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {BILI_BROWSER_UA,resolveBiliQrCredential} from './bilibili-login.js';

const API='https://api.bilibili.com',PASSPORT='https://passport.bilibili.com';
const mixin=[46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text=value=>String(value??'').replace(/<[^>]*>/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim();
const bound=(value,min,max,fallback)=>Number.isInteger(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
function biliMediaUrl(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port
      &&/(?:^|\.)(?:bilivideo\.com|bilivideo\.cn|hdslb\.com)$/.test(url.hostname)?url:null;
  }catch{return null;}
}
function biliMediaCandidates(candidate){
  const backup=candidate?.backup_url??candidate?.backupUrl;
  const values=[candidate?.url,candidate?.baseUrl,candidate?.base_url,...(Array.isArray(backup)?backup:backup?[backup]:[])];
  const seen=new Set(),result=[];
  for(const value of values){
    const url=biliMediaUrl(value);
    if(!url||seen.has(url.href))continue;
    seen.add(url.href);result.push(url);
    if(result.length===3)break;
  }
  return result;
}
function mediaAttempt(url,{status,code,ok}){
  const attempt={host:url.hostname,ok};
  if(Number.isInteger(status)&&status>0)attempt.status=status;
  if(typeof code==='string'&&/^[A-Z\d_]{1,64}$/.test(code))attempt.code=code;
  return attempt;
}
function mediaFailure(error,attempts){
  const statuses=[...new Set(attempts.map(item=>item.status).filter(Number.isInteger))];
  const summaries=[];
  if(statuses.includes(403))summaries.push('HTTP 403：站点拒绝下载，请核对请求标识、网络及账号观看权限');
  if(statuses.includes(404))summaries.push('HTTP 404 表示资源可能已过期，请重新解析视频');
  if(!statuses.length||statuses.some(status=>![403,404].includes(status)))summaries.push('网络连接未完成，请检查网络后重试');
  const summary='B站视频资源未取得：'+summaries.join('；');
  const failed=Error(summary);
  failed.code=typeof error?.code==='string'?error.code:'VIDEO_RESOURCE';
  const status=Number(error?.httpStatus);
  if(Number.isInteger(status)&&status>0)failed.httpStatus=status;
  failed.resourceAttempts=attempts.map(item=>({...item}));
  return failed;
}
function atomic(file,value){mkdirSync(join(file,'..'),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value,null,2),{mode:0o600});renameSync(temp,file);}
function load(file,fallback){if(!existsSync(file))return structuredClone(fallback);return JSON.parse(readFileSync(file,'utf8'));}
export function biliVideoId(value){
  const raw=String(value||'').trim();if(/^BV[0-9A-Za-z]{10}$/.test(raw))return raw;
  try{const u=new URL(raw),m=u.pathname.match(/^\/video\/(BV[0-9A-Za-z]{10})\/?$/);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['www.bilibili.com','bilibili.com'].includes(u.hostname)&&m)return m[1];}catch{}
  throw Error('请提供完整 BV 号或 B站视频地址');
}
export function biliWbi(params,images,seconds){
  const stem=url=>new URL(url).pathname.split('/').at(-1).split('.')[0];
  const key=stem(images?.img_url)+stem(images?.sub_url);if(key.length<64)throw Error('B站签名信息暂不可用');
  const salt=mixin.map(i=>key[i]).join('').slice(0,32);
  const values={...params,wts:seconds};
  const query=Object.keys(values).sort().map(k=>encodeURIComponent(k)+'='+encodeURIComponent(String(values[k]).replace(/[!'()*]/g,''))).join('&');
  return {...values,w_rid:createHash('md5').update(query+salt).digest('hex')};
}
const videoRow=row=>({bvid:String(row.bvid||''),title:text(row.title),author:text(row.owner?.name||row.author),duration:row.duration,picture:row.pic||row.cover||'',url:row.bvid?'https://www.bilibili.com/video/'+row.bvid:'',description:text(row.desc||row.description).slice(0,1200)});

export function createBilibiliService({directory,fetchImpl=fetch,makeQr,now=Date.now,authorize=()=>true,loadImage,readVideo}={}){
  const slots=new Map();let closed=false;
  function check(context){if(closed||!authorize(context))throw Error('账号、人设或任务已变化，B站操作停止');context.signal?.throwIfAborted();}
  function slot(context){
    // The original/default QQ connection uses an empty accountId. It is a
    // valid, isolated scope, distinct from any named connection.
    check(context);if(typeof context.accountId!=='string'||!context.personaId)throw Error('缺少 B站账号隔离上下文');
    const id=hash([context.accountId,context.personaId]),dir=join(directory,id);
    if(!slots.has(id)){
      const state=load(join(dir,'state.json'),{history:[],drafts:[]});
      for(const draft of state.drafts)if(draft.status==='sending'){draft.status='unknown';draft.error='上次提交被中断，结果待核对，不会自动重试';}
      slots.set(id,{id,dir,credential:load(join(dir,'credential.json'),{}),state,login:null,loginRevision:0,tail:Promise.resolve(),lastRequest:0,wbi:null});
    }
    return slots.get(id);
  }
  const save=s=>atomic(join(s.dir,'state.json'),s.state);
  const cookie=credential=>Object.entries(credential).filter(([key])=>['SESSDATA','bili_jct','DedeUserID','buvid3'].includes(key)).map(([key,value])=>{if(key==='SESSDATA'){try{value=encodeURIComponent(decodeURIComponent(value));}catch{value=encodeURIComponent(value);}}return key+'='+value;}).join('; ');
  async function network(s,context,origin,path,params={},options={}){
    check(context);
    const request=async()=>{
      check(context);
      const wait=Math.max(0,300-(now()-s.lastRequest));if(wait)await new Promise(resolve=>setTimeout(resolve,wait));check(context);s.lastRequest=now();
      let data={...params};
      if(options.signed){
        if(!s.wbi||now()-s.wbi.at>30*60000){const nav=await raw(API,'/x/web-interface/nav',{}, {allowLoggedOut:true});s.wbi={...nav.data?.wbi_img,at:now()};}
        data=biliWbi(data,s.wbi,Math.floor(now()/1000));
      }
      return raw(origin,path,data,options);
    };
    async function raw(origin,path,params,options){
      check(context);const url=new URL(path,origin),headers={'user-agent':BILI_BROWSER_UA,'referer':'https://www.bilibili.com/'};
      if(options.post&&['/x/v2/reply/add','/x/dynamic/feed/draw/upload_bfs'].includes(path)&&s.state.commentPublishEnabled!==true)throw Error('评论发布已关闭');
      if(options.post&&options.credential&&options.credential!==s.credential)throw Error('提交前 B站账号已切换');
      const credentials=options.credential||s.credential;
      if(!options.noCookies&&cookie(credentials))headers.cookie=cookie(credentials);
      let body;if(options.post){if(options.form){body=options.form;}else{headers['content-type']='application/x-www-form-urlencoded';body=new URLSearchParams(params).toString();}}else url.search=new URLSearchParams(params).toString();
      const signal=context.signal?AbortSignal.any([context.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000);
      const response=await fetchImpl(url.href,{method:options.post?'POST':'GET',headers,body,signal,redirect:'error'});
      if(!response.ok)throw Object.assign(Error('B站请求失败（HTTP '+response.status+'）'),{transport:true});
      const value=await response.json();check(context);
      if(value.code!==0&&!(options.allowLoggedOut&&value.code===-101))throw Object.assign(Error('B站接口返回 '+value.code+'：'+text(value.message||value.msg).slice(0,150)),{apiCode:value.code});
      if(options.response)return {value,response};return value;
    }
    const task=s.tail.then(request);s.tail=task.catch(()=>{});return task;
  }
  async function api(s,c,path,params,options){return network(s,c,API,path,params,options);}
  function publicLogin(s){return s.login?{status:s.login.status,expiresAt:s.login.at+180000,...(s.login.at+180000>now()?{qrImage:s.login.qrImage}: {})}:null;}
  function state(s){return {ok:true,settings:{commentPublishEnabled:s.state.commentPublishEnabled===true},account:{loggedIn:!!s.credential.SESSDATA,uid:s.credential.DedeUserID||'',name:s.state.accountName||'',validatedAt:s.state.validatedAt||0},history:s.state.history.slice(-30).reverse(),drafts:s.state.drafts.slice(-30).reverse().map(d=>({...d,images:(d.images||[]).map(({file,...image})=>image),accountMismatch:!!d.authorUid&&d.authorUid!==s.credential.DedeUserID})),login:publicLogin(s)};}
  async function info(s,c,bvid){const result=await api(s,c,'/x/web-interface/view',{bvid});return {...videoRow(result.data),aid:result.data.aid,cid:result.data.cid,pages:(result.data.pages||[]).map(p=>({page:p.page,cid:p.cid,title:text(p.part),duration:p.duration}))};}
  async function comments(s,c,bvid,page=1){
    const video=await info(s,c,bvid),result=await api(s,c,'/x/v2/reply',{type:1,oid:video.aid,pn:page,ps:10,sort:2});
    const observed=[];for(const row of result.data.replies||[]){observed.push({bvid,id:String(row.rpid),root:String(row.rpid),parent:String(row.rpid),author:text(row.member?.uname),text:text(row.content?.message)});for(const child of row.replies||[])observed.push({bvid,id:String(child.rpid),root:String(row.rpid),parent:String(child.rpid),author:text(child.member?.uname),text:text(child.content?.message)});}s.state.observedComments=(s.state.observedComments||[]).filter(r=>r.bvid!==bvid).concat(observed).slice(-300);save(s);
    return {video,page,comments:(result.data.replies||[]).slice(0,10).map(row=>({id:String(row.rpid),author:text(row.member?.uname),text:text(row.content?.message).slice(0,1000),likes:row.like,replies:(row.replies||[]).slice(0,3).map(r=>({id:String(r.rpid),root:String(row.rpid),author:text(r.member?.uname),text:text(r.content?.message).slice(0,600)}))})),total:result.data.page?.count||0};
  }
  async function subtitles(s,c,bvid,page=1){
    const video=await info(s,c,bvid),part=video.pages.find(p=>p.page===page);if(!part)throw Error('该视频没有这个分 P');
    const result=await api(s,c,'/x/player/wbi/v2',{bvid,cid:part.cid},{signed:true});
    const tracks=result.data?.subtitle?.subtitles||[],selected=tracks.find(t=>t.lan==='zh-CN')||tracks.find(t=>/zh/.test(t.lan))||tracks[0];
    if(!selected)return {video,page,segments:[],coverage:'没有取得可用字幕；未分析画面或音轨'};
    const url=new URL(selected.subtitle_url.startsWith('//')?'https:'+selected.subtitle_url:selected.subtitle_url);
    if(url.protocol!=='https:'||url.username||url.password||url.port||!/(?:^|\.)(?:hdslb\.com|bilibili\.com)$/.test(url.hostname))throw Error('B站返回的字幕地址不在允许范围');
    const response=await fetchImpl(url.href,{signal:c.signal?AbortSignal.any([c.signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw Error('字幕下载失败');if(Number(response.headers.get('content-length'))>2*1024*1024)throw Error('字幕过大');
    const raw=await response.text();if(Buffer.byteLength(raw)>2*1024*1024)throw Error('字幕过大');const data=JSON.parse(raw);check(c);
    const all=(data.body||[]).map(r=>({start:Number(r.from),end:Number(r.to),text:text(r.content)})).filter(r=>Number.isFinite(r.start)&&Number.isFinite(r.end)&&r.end>=r.start&&r.text);
    let size=0;const segments=[];for(const row of all){if(size+row.text.length>14000||segments.length>=200)break;segments.push(row);size+=row.text.length;}
    return {video,page,language:selected.lan,segments,totalSegments:all.length,partial:segments.length<all.length,coverage:'实际字幕'+(segments.length<all.length?'片段':'文字')+'；未分析画面或音轨，不代表完整观看'};
  }
  async function frames(s,c,bvid,page=1){
    if(typeof readVideo!=='function')throw Error('视频抽帧服务尚未接入');
    const video=await info(s,c,bvid),part=video.pages.find(p=>p.page===page);if(!part)throw Error('该视频没有这个分P');
    const response=await api(s,c,'/x/player/wbi/playurl',{bvid,cid:part.cid,qn:32,fnval:0,fnver:0,fourk:0},{signed:true});check(c);
    const data=response.data||{},streams=data.durl||[],dash=data.dash?.video||[];
    if(streams.length>1)throw Error('该视频返回了分段资源，暂不能把单段当成完整视频');
    const candidate=streams[0]||[...dash].sort((a,b)=>(Number(a.bandwidth)||0)-(Number(b.bandwidth)||0))[0];
    const candidates=biliMediaCandidates(candidate);
    if(!candidates.length)throw Error('没有取得可读取的视频资源；可能需要登录或平台未开放');
    const attempts=[];
    let lastError;
    for(const url of candidates){
      check(c);
      try{
        const sample=await readVideo({source:'bilibili',url:url.href,signal:c.signal,start:c.videoOptions?.start,window:c.videoOptions?.window,maxFrames:c.videoOptions?.maxFrames,restart:c.videoOptions?.restart,positionSource:c.videoOptions?.positionSource,mediaId:'bilibili:'+bvid+':'+part.cid},c);
        check(c);
        if(!sample?.frames?.length&&!['paused','ended'].includes(sample?.status))throw Error('没有取得实际视频画面');
        attempts.push(mediaAttempt(url,{ok:true}));
        return {ok:true,video,page,bvid,status:sample.status,sessionId:sample.sessionId,continuous:sample.continuous===true,cursor:sample.cursor,frameRate:sample.frameRate,observed:sample.coverage,duration:sample.duration,frames:sample.frames||[],audio:sample.audio||null,audioDecoded:sample.audioDecoded===true,window:sample.window||null,resourceAttempts:attempts,coverage:(sample.continuous?'按播放时间连续读取，当前窗口 '+(sample.window?.start??0)+'–'+(sample.window?.end??0)+' 秒；':'实际抽样 ')+sample.frames.length+' 张视频画面，时间点 '+sample.frames.map(f=>f.at+'秒').join('、')+'；'+(sample.audioDecoded?'音轨覆盖以音轨结果为准':'尚未读取音轨')+'，不代表完整观看'};
      }catch(error){
        check(c);
        const status=Number(error?.httpStatus);
        attempts.push(mediaAttempt(url,{status,code:error?.code,ok:false}));
        lastError=error;
        if(error?.name==='AbortError'||error?.code==='ABORT_ERR')throw error;
        if(!['VIDEO_RESOURCE','VIDEO_TIMEOUT'].includes(error?.code))throw error;
      }
    }
    throw mediaFailure(lastError,attempts);
  }
  async function read(s,c,bvid,page=1){
    const material={bvid,url:'https://www.bilibili.com/video/'+bvid,page,errors:[]};
    try{const result=await subtitles(s,c,bvid,page);Object.assign(material,result);}catch(error){check(c);material.errors.push(error.message);material.video=await info(s,c,bvid);material.segments=[];}
    try{material.comments=(await comments(s,c,bvid)).comments;}catch(error){check(c);material.errors.push(error.message);material.comments=[];}
    check(c);material.coverage=material.segments.length?'已取得实际字幕与可取得的评论；未分析画面、音轨或完整观看':material.comments.length?'仅视频信息与实际评论；没有取得视频内容':'仅视频信息；没有取得视频内容';
    if(typeof readVideo==='function')try{const visual=await frames(s,c,bvid,page);Object.assign(material,{frames:visual.frames,duration:visual.duration,audio:visual.audio,audioDecoded:visual.audioDecoded,window:visual.window,status:visual.status,sessionId:visual.sessionId,continuous:visual.continuous,cursor:visual.cursor,observed:visual.observed,resourceAttempts:visual.resourceAttempts});material.coverage=visual.coverage+(material.segments.length?'；另有实际字幕':'');}catch(error){check(c);if(Array.isArray(error.resourceAttempts))material.resourceAttempts=error.resourceAttempts.map(item=>({...item}));material.errors.push('画面未取得：'+String(error.message).slice(0,180));}
    if(material.continuous&&material.window){material.subtitleTotal=material.segments.length;material.segments=material.segments.filter(r=>r.start<=material.window.end&&r.end>=material.window.start);material.partial=true;}
    const prior=s.state.history.find(h=>h.bvid===bvid&&h.page===page);
    const row={id:prior?.id||randomUUID(),bvid,page,title:material.video?.title||bvid,url:material.url,at:now(),coverage:material.coverage,subtitleSegments:material.segments.length,comments:material.comments.length};
    s.state.history=s.state.history.filter(h=>h.id!==row.id).concat(row).slice(-100);save(s);return {ok:true,...material};
  }
  async function act(args,context){
    const s=slot(context),action=String(args.action||'status'),page=bound(args.page,1,100,1);
    if(action==='status')return state(s);
    if(action==='preview-image'){const draft=s.state.drafts.find(d=>d.id===args.draftId),image=draft?.images?.find(i=>i.id===args.imageId);if(!image)throw Error('找不到这条草稿的配图');const bytes=readFileSync(join(s.dir,'draft-images',image.file)),actual=imageBytes(bytes);if(actual.hash!==image.hash)throw Error('配图已改变，请重新保存草稿');return {ok:true,image:'data:'+actual.mime+';base64,'+bytes.toString('base64')};}
    if(action==='set-publish-enabled'){
      if(typeof args.enabled!=='boolean')throw Error('评论发布开关必须是布尔值');
      const previous=s.state.commentPublishEnabled;s.state.commentPublishEnabled=args.enabled;
      try{save(s);}catch(error){s.state.commentPublishEnabled=previous;throw error;}
      return state(s);
    }
    if(action==='logout'){s.credential={};s.login=null;s.loginRevision++;s.state.accountName='';s.state.validatedAt=0;atomic(join(s.dir,'credential.json'),{});save(s);return state(s);}
    if(action==='login'){
      if(s.login&&!['expired','failed'].includes(s.login.status)&&s.login.at+180000>now()&&args.force!==true)return {ok:true,status:s.login.status,qrImage:s.login.qrImage,qrFile:s.login.qrFile,expiresAt:s.login.at+180000};
      const revision=++s.loginRevision;s.login=null;
      let result;
      try{result=await network(s,context,PASSPORT,'/x/passport-login/web/qrcode/generate',{}, {noCookies:true});}
      catch(error){check(context);if(error.name==='TimeoutError'||error.message==='fetch failed')throw Error('暂时没连上 B站登录服务，请检查当前设备的网络后再点一次扫码登录；已有登录不会被清除。');throw error;}
      if(typeof result.data?.url!=='string'||typeof result.data?.qrcode_key!=='string'||!result.data.qrcode_key)throw Error('B站没有返回有效的登录二维码，请稍后重新申请。');
      let url;try{url=new URL(result.data.url);}catch{throw Error('B站返回的扫码地址无效，请重新申请二维码。');}
      if(revision!==s.loginRevision)throw Error('扫码请求已被更新或取消，请使用当前二维码');
      if(url.protocol!=='https:'||!/(?:^|\.)bilibili\.com$/.test(url.hostname))throw Error('扫码地址无效');
      const qrImage=makeQr?makeQr(url.href):'';
      if(!/^data:image\/gif;base64,[A-Za-z0-9+/=]+$/.test(qrImage))throw Error('本机二维码组件没有生成图片，请重新加载 QQ 桥接插件后再试。');
      let qrFile='';if(/^data:image\/gif;base64,/.test(qrImage)){const bytes=Buffer.from(qrImage.split(',')[1],'base64');if(bytes.length>100000)throw Error('二维码文件过大');mkdirSync(s.dir,{recursive:true});qrFile=join(s.dir,'login-'+randomUUID()+'.gif');writeFileSync(qrFile,bytes);}
      s.login={key:result.data.qrcode_key,qrImage,qrFile,at:now(),status:'waiting'};
      return {ok:true,status:'waiting',qrImage,qrFile,expiresAt:s.login.at+180000};
    }
    if(action==='login-status'){
      if(!s.login){
        if(!s.credential.SESSDATA)return {ok:true,status:'logged-out',...state(s)};
        try{const nav=await api(s,context,'/x/web-interface/nav');s.state.accountName=text(nav.data.uname);s.state.validatedAt=now();save(s);return {ok:true,status:'logged-in',...state(s)};}catch(error){if(error.apiCode===-101)return {...state(s),account:{loggedIn:false},status:'expired'};throw error;}
      }
      const login=s.login;
      if(login.pending)return login.pending;
      if(!login.credential&&now()-login.at>180000){s.login=null;return {ok:true,status:'expired'};}
      if(login.credential&&now()-(login.confirmedAt||login.at)>180000){login.status='failed';throw Error('扫码后的登录校验等待过久，请重新扫码；原登录已保留');}
      if(login.status==='failed')throw Error('这张二维码登录未完成，请点击扫码登录重新申请；原登录已保留');
      const current=()=>{check(context);if(s.login!==login)throw Error('扫码已取消或换码，未保存旧扫码结果');};
      const task=(async()=>{
        if(!login.credential){
          const {value,response}=await network(s,context,PASSPORT,'/x/passport-login/web/qrcode/poll',{qrcode_key:login.key},{noCookies:true,response:true});current();
          if(value.data?.code!==0){login.status=({86101:'waiting',86090:'scanned',86038:'expired'})[value.data?.code]||'failed';return {ok:true,status:login.status,expiresAt:login.at+180000};}
          login.status='verifying';login.confirmedAt=now();
          try{login.credential=await resolveBiliQrCredential({response,url:value.data.url,fetchImpl,signal:context.signal});current();}
          catch(error){login.status='failed';throw error;}
        }
        // A successful key is single-use. Retry a transient nav failure using
        // the captured credential, never by polling that consumed key again.
        const credential=login.credential;
        let nav;
        try{nav=await api(s,context,'/x/web-interface/nav',{}, {credential});}
        catch(error){current();if(error.apiCode===-101){login.status='failed';throw Error('扫码登录校验未通过，请重新扫码；原登录已保留');}throw error;}
        current();
        if(!nav.data?.isLogin)throw Error('新登录状态校验失败，原登录未覆盖');
        atomic(join(s.dir,'credential.json'),credential);s.credential=credential;s.login=null;s.state.accountName=text(nav.data.uname);s.state.validatedAt=now();save(s);return {...state(s),status:'logged-in'};
      })();
      login.pending=task;
      try{return await task;}finally{if(login.pending===task)delete login.pending;}
    }
    if(['popular','recommend','search'].includes(action)){
      let result,source=action;
      if(action==='search'){
        const keyword=text(args.query).slice(0,120);if(!keyword)throw Error('请输入搜索词');
        result=await api(s,context,'/x/web-interface/wbi/search/type',{search_type:'video',keyword,page,page_size:10,order:'totalrank'},{signed:true});
      }else if(action==='recommend'&&s.credential.SESSDATA){
        try{result=await api(s,context,'/x/web-interface/wbi/index/top/feed/rcmd',{ps:10,fresh_idx:page,fresh_type:3},{signed:true});}catch(error){check(context);result=await api(s,context,'/x/web-interface/popular',{pn:page,ps:10});source='popular-fallback';}
      }else{result=await api(s,context,'/x/web-interface/popular',{pn:page,ps:10});source='popular';}
      const rows=result.data.result||result.data.item||result.data.list||[];
      return {ok:true,source,page,items:rows.filter(r=>r.bvid).slice(0,10).map(r=>({...videoRow(r),read:s.state.history.some(h=>h.bvid===r.bvid)})),coverage:'仅候选视频信息，尚未读取视频内容'};
    }
    if(action==='browse'){
      const list=await act({action:args.query?'search':'recommend',query:args.query,page},context),limit=bound(args.limit,1,3,2),fresh=list.items.filter(item=>!item.read),chosen=(fresh.length?fresh:list.items).slice(0,limit),items=[];
      for(const item of chosen){try{items.push(await read(s,context,item.bvid));}catch(error){check(context);items.push({bvid:item.bvid,title:item.title,ok:false,error:error.message});}}
      return {ok:items.some(item=>item.ok),source:list.source,items:items.map(({frames,...item})=>({...item,frameTimes:(frames||[]).map(f=>f.at)})),frames:items.flatMap(item=>(item.frames||[]).map(frame=>({...frame,bvid:item.bvid}))).slice(0,8),coverage:'按顺序读取了所选视频的实际可用资料；未发布评论'};
    }
    if(action==='draft'){
      const bvid=biliVideoId(args.bvid),message=text(args.text);if(!message||message.length>1000)throw Error('评论正文需要 1～1000 字');
      const reading=s.state.history.find(h=>h.bvid===bvid);if(!reading)throw Error('请先实际读取这条视频的资料，再写评论');
      let root=String(args.root||''),parent=String(args.parent||root),replyTo=null;const replyId=String(args.replyId||parent||'');
      if(root&&!/^\d{1,30}$/.test(root)||parent&&!/^\d{1,30}$/.test(parent)||replyId&&!/^\d{1,30}$/.test(replyId))throw Error('回复楼层需要准确的数字评论 ID');
      if(replyId){replyTo=(s.state.observedComments||[]).find(r=>r.bvid===bvid&&r.id===replyId);if(!replyTo)throw Error('请先读取这条视频的目标评论，不猜楼层');root=replyTo.root;parent=replyTo.parent;}
      const images=[];for(const source of safeImageList(args.images,3)){check(context);if(typeof loadImage!=='function')throw Error('当前配图读取服务尚未加载');const image=await loadImage(source,context);check(context);const file=image.hash+'.'+image.extension;mkdirSync(join(s.dir,'draft-images'),{recursive:true});writeFileSync(join(s.dir,'draft-images',file),image.bytes,{mode:0o600});images.push({id:randomUUID(),file,hash:image.hash,mime:image.mime,size:image.bytes.length});}
      const draft={id:randomUUID(),bvid,title:reading.title,text:message,root,parent,replyTo:replyTo?{id:replyTo.id,author:replyTo.author,text:replyTo.text}:null,images,authorUid:s.credential.DedeUserID||'',status:'draft',at:now()};
      s.state.drafts=s.state.drafts.concat(draft).slice(-100);save(s);return {ok:true,draft,posted:false,coverage:'只保存草稿，尚未发布'};
    }
    if(action==='publish'){
      if(s.state.commentPublishEnabled!==true)throw Error('评论发布已关闭；可继续浏览和保存草稿，需先在面板开启才能发布');
      if(args.confirm!==true)throw Error('请在面板核对草稿的完整正文后点击发布');
      const draft=s.state.drafts.find(d=>d.id===args.draftId);if(!draft)throw Error('找不到这个草稿');
      if(draft.status!=='draft')throw Error('这个草稿已提交或结果待核对，不会重复发送');
      if(!s.credential.SESSDATA||!s.credential.bili_jct)throw Error('请先扫码登录 B站');
      if(draft.authorUid&&draft.authorUid!==s.credential.DedeUserID)throw Error('这个草稿属于另一个 B站账号，请切回原账号或重新保存草稿');
      const fingerprint=hash([draft.bvid,draft.text,draft.root,draft.parent||draft.root,(draft.images||[]).map(i=>i.hash)]);
      if(s.state.drafts.some(d=>d.id!==draft.id&&d.fingerprint===fingerprint&&['sending','sent','unknown'].includes(d.status)))throw Error('相同评论已提交或结果待核对，不会重复发送');
      const expectedCredential=s.credential,video=await info(s,context,draft.bvid);check(context);
      // Claim and persist before any write. Network failures are never retried.
      if(draft.status!=='draft')throw Error('这个草稿已经在提交');
      if(s.state.commentPublishEnabled!==true)throw Error('评论发布已关闭，尚未提交这条草稿');
      if(expectedCredential!==s.credential)throw Error('提交前 B站账号已切换，请重新核对');
      if(s.state.drafts.some(d=>d.id!==draft.id&&d.fingerprint===fingerprint&&['sending','sent','unknown'].includes(d.status)))throw Error('相同评论已提交或结果待核对，不会重复发送');
      draft.fingerprint=fingerprint;draft.status='sending';draft.submittedAt=now();save(s);
      try{
        const pictures=[];
        for(const image of draft.images||[]){
          check(context);if(s.state.commentPublishEnabled!==true)throw Error('评论发布已关闭');if(expectedCredential!==s.credential)throw Error('B站账号已切换');
          const actual=imageBytes(readFileSync(join(s.dir,'draft-images',image.file)));if(actual.hash!==image.hash)throw Error('配图已改变，未发布');
          const form=new FormData();form.append('csrf',expectedCredential.bili_jct);form.append('category','daily');form.append('biz','new_dyn');form.append('file_up',new Blob([actual.bytes],{type:actual.mime}),'comment.'+actual.extension);
          const upload=await api(s,context,'/x/dynamic/feed/draw/upload_bfs',{}, {post:true,form,credential:expectedCredential});const d=upload.data||{};let url;try{url=new URL(d.image_url);}catch{throw Error('B站配图上传回执不完整');}
          if(url.protocol!=='https:'||url.username||url.password||!/(?:^|\.)hdslb\.com$/.test(url.hostname)||!(Number(d.image_width)>0&&Number(d.image_height)>0))throw Error('B站配图上传回执不完整');
          pictures.push({img_src:url.href,img_width:Number(d.image_width),img_height:Number(d.image_height),img_size:Number(d.img_size)||actual.bytes.length/1024});draft.uploadedImages=pictures.slice();save(s);
        }
        check(context);if(s.state.commentPublishEnabled!==true)throw Error('评论发布已关闭');if(expectedCredential!==s.credential)throw Error('B站账号已切换，未提交评论');
        const params={type:1,oid:video.aid,message:draft.text,csrf:expectedCredential.bili_jct};if(draft.root){params.root=draft.root;params.parent=draft.parent||draft.root;}if(pictures.length)params.pictures=JSON.stringify(pictures);
        draft.publishStarted=true;save(s);
        const result=await api(s,context,'/x/v2/reply/add',params,{post:true,credential:expectedCredential});
        draft.rpid=String(result.data?.rpid||result.data?.reply?.rpid||'');draft.status=draft.rpid?'sent':'unknown';draft.updatedAt=now();save(s);
        return {ok:!!draft.rpid,draft:{...draft},posted:!!draft.rpid,coverage:draft.rpid?'B站已返回评论 ID；尚未核对公开可见性':'没有取得评论 ID，结果待核对，未重试'};
      }catch(error){draft.status=error.apiCode!==undefined||!draft.publishStarted?'failed':'unknown';draft.error=draft.status==='failed'?'评论准备、图片上传或发布未完成：'+String(error.message).slice(0,160):'连接中断，评论结果待核对，未重试';draft.updatedAt=now();save(s);return {ok:false,draft:{...draft},posted:false,uncertain:draft.status==='unknown',error:draft.error};}
    }
    const bvid=biliVideoId(args.bvid);
    if(action==='video')return {ok:true,video:await info(s,context,bvid)};
    if(action==='comments')return {ok:true,...await comments(s,context,bvid,page)};
    if(action==='subtitles')return {ok:true,...await subtitles(s,context,bvid,page)};
    if(action==='frames')return frames(s,context,bvid,page);
    if(action==='read')return read(s,context,bvid,page);
    throw Error('未知 B站操作');
  }
  return {act,close(){closed=true;slots.clear();}};
}

export const BILIBILI_TOOL_PARAMETERS={type:'object',properties:{action:{type:'string',enum:['status','login','login-status','popular','recommend','search','video','comments','subtitles','frames','read','browse','draft']},query:{type:'string',maxLength:120},bvid:{type:'string',maxLength:200},page:{type:'integer',minimum:1,maximum:100},limit:{type:'integer',minimum:1,maximum:3},text:{type:'string',maxLength:1000},root:{type:'string',maxLength:30},parent:{type:'string',maxLength:30},replyId:{type:'string',maxLength:30},images:{type:'array',maxItems:3,items:{type:'string',description:'当前角色已生成图片的路径'}}},required:['action'],additionalProperties:false};
