// Bounded phone-app learning through the DSHBox Pilot accessibility tree.
// It reads what is actually on screen, never invents a watched video, and never
// captures pixels (screen capture needs a separate system consent and is not
// needed to read titles, descriptions and comments).
const APPS={
  bilibili:{label:'哔哩哔哩',package:'tv.danmaku.bili',searchUrl:q=>'https://search.bilibili.com/all?keyword='+encodeURIComponent(q)},
  douyin:{label:'抖音',package:'com.ss.android.ugc.aweme',searchUrl:q=>'https://www.douyin.com/search/'+encodeURIComponent(q)},
  heybox:{label:'小黑盒',package:'com.max.xiaoheihe',searchUrl:q=>'https://www.xiaoheihe.cn/search?q='+encodeURIComponent(q)},
};
const CHROME=[
  /^(?:首页|推荐|热门|关注|直播|游戏|会员|消息|我的|搜索|取消|发送|回复|点赞|收藏|分享|投币|关注|粉丝|评论|全部评论|展开|收起|广告|下载|打开APP|登录|返回|更多|举报|不感兴趣|影视|动画|番剧|国创|音乐|舞蹈|娱乐|科技|数码|生活|美食|动物|汽车|时尚|资讯|财经|运动|教育|纪录片|电影|电视剧|综艺|VLOG|UP主|动态|频道)$/i,
  /^(?:\d+(?:\.\d+)?[万亿]?)$/,
  /^(?:\d{1,2}:\d{2}(?::\d{2})?)$/,
  /^(?:刚刚|\d+分钟前|\d+小时前|\d+天前)$/,
  /^(?:点赞|评论|收藏|分享|投币)\s*\d*$/,
];
const clean=value=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ').replace(/\s+/g,' ').trim();
const visible=node=>node&&node.offscreen!==true&&['left','top','right','bottom'].every(key=>Number.isFinite(Number(node[key])))&&Number(node.right)>Number(node.left)&&Number(node.bottom)>Number(node.top);
const labelOf=node=>clean(node?.text||node?.desc||'');
const areaOf=node=>Math.max(0,Number(node.right)-Number(node.left))*Math.max(0,Number(node.bottom)-Number(node.top));
const centerOf=node=>({x:Math.round((Number(node.left)+Number(node.right))/2),y:Math.round((Number(node.top)+Number(node.bottom))/2)});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function normalizedApp(value){const key=String(value??'').trim().toLowerCase();return APPS[key]?key:/bilibili|哔哩|B站/i.test(key)?'bilibili':/douyin|抖音/i.test(key)?'douyin':/heybox|小黑盒/i.test(key)?'heybox':'';}
function failure(code,text,hint=''){return {ok:false,code,text,hint};}
function pilotFailure(error){
  const code=String(error?.code||'PHONE_FAILED'),text=String(error?.message||error?.text||'手机操作未完成');
  if(code==='E_AWAITING_CONSENT')return failure(code,'手机上的批准卡还在等待答复，本次没有继续操作。','请在通知栏或助手页点“允许”（可选择本会话允许），然后重新发起学习。');
  if(code==='UNEXPECTED_PACKAGE')return failure(code,text,'请先解锁手机并停在目标应用首页，处理掉登录/更新/系统弹窗后再试。');
  if(code==='E_LAUNCH_NOT_LANDED')return failure(code,'应用启动被接受，但前台仍然不是目标应用。','请先手动点开一次目标应用（或把它从最近任务里关掉重开），再让她学习。');
  if(code==='E_TASK_SUSPENDED_BY_HOST')return failure(code,'DSH 界面挡在最前面，手机点击被暂停了。','请先把手机切到桌面或目标应用（或锁屏后再解锁），再重新发起学习；读操作不受影响，但点按需要 DSH 不在前台。');
  if(/E_GATE_NO_FOREGROUND|E_NO_EDITABLE_TARGET|E_SURFACE|E_BACKEND|E_TRANSPORT|E_QUEUE_FULL/i.test(code))return failure(code,text,'请确认手机已解锁，并在 DSHBox 的 Pilot 里开启无障碍与相应能力。');
  return failure(code,text);
}
function chromeLine(text){
  if(!text||text.length<4)return true;
  if(text.length>500)return true;
  return CHROME.some(pattern=>pattern.test(text));
}
function harvest(snapshot,{query='',limit=6000}={}){
  const lines=[],seen=new Set();
  for(const node of snapshot?.nodes||[]){
    if(!visible(node)||node.password===true||node.isPassword===true)continue;
    const text=labelOf(node);
    if(chromeLine(text)||text===query)continue;
    if(seen.has(text))continue;
    seen.add(text);lines.push(text);
    if(lines.join('\n').length>=limit)break;
  }
  return lines;
}
function extractLinks(text,{app,query,title}){
  const links=[],seen=new Set(),add=(url,kind,exact,label)=>{if(!url||seen.has(url))return;seen.add(url);links.push({url,kind,exact:exact===true,title:clean(label||title||query).slice(0,180)});};
  const bv=[...String(text).matchAll(/\bBV[0-9A-Za-z]{10}\b/g)].map(m=>m[0]);
  for(const id of bv.slice(0,2))add('https://www.bilibili.com/video/'+id,'video',true,title||id);
  for(const match of String(text).matchAll(/https?:\/\/[^\s<>"']{8,240}/g)){
    const url=match[0].replace(/[),，。！？；;]+$/,'');
    if(/^https?:\/\//i.test(url))add(url,/douyin|iesdouyin/i.test(url)?'video':/bilibili|b23\.tv/i.test(url)?'video':'link',false,title);
  }
  if(app!=='bilibili'||!links.some(link=>link.exact&&/bilibili\.com\/video\/BV/.test(link.url))){
    const q=clean(query||title||'').slice(0,80);
    if(q)add(APPS[app].searchUrl(q),'search',false,title||q);
  }
  return links;
}
async function runSearch({call,check,app,query,log}){
  const meta=APPS[app],allowed=new RegExp([meta.package,'bilibili','aweme','xiaoheihe','heybox'].join('|'),'i');
  const assertPackage=value=>{if(value?.package&&!allowed.test(value.package))throw Object.assign(Error('屏幕已经离开 '+meta.label+'（当前 '+value.package+'），本次不继续读取'),{code:'UNEXPECTED_PACKAGE'});};
  let snapshot=await call('ui.snapshot',{});check?.();
  if(!snapshot?.ok)throw Object.assign(Error(snapshot?.text||'无法读取手机屏幕'),{code:snapshot?.code});
  snapshot=snapshot.data||snapshot;assertPackage(snapshot);
  const all=()=>Array.isArray(snapshot?.nodes)?snapshot.nodes:[];
  const find=(pattern,{editable=false,actionableOnly=false}={})=>all().find(node=>visible(node)&&pattern.test(labelOf(node))&&(!editable||node.editable===true)&&(!actionableOnly||node.clickable===true||node.editable===true));
  const tap=async node=>{const wanted=labelOf(node);try{await snap();const fresh=wanted?all().find(item=>visible(item)&&labelOf(item)===wanted):null;if(wanted&&!fresh)return false;if(fresh)node=fresh;assertPackage(snapshot);}catch(error){if(error?.code)throw error;}const point=centerOf(node);await call('ui.tap',{x:point.x,y:point.y});check?.();await sleep(700);return true;};
  const snap=async()=>{snapshot=await call('ui.snapshot',{});check?.();if(!snapshot?.ok)throw Object.assign(Error(snapshot?.text||'无法读取手机屏幕'),{code:snapshot?.code});snapshot=snapshot.data||snapshot;if(snapshot.package==='com.android.systemui'){await call('ui.key',{key:'back'});check?.();await sleep(700);const again=await call('ui.snapshot',{});check?.();if(again?.ok)snapshot=again.data||again;}assertPackage(snapshot);return snapshot;};
  // The home page usually has a tappable search box or a magnifier with a hint.
  let entry=find(/(?:搜索|搜一搜|搜一下|search)/i);
  const screenHeight=Number(snapshot?.screen?.height)||1920;
  let editable=all().find(node=>visible(node)&&node.editable===true&&Number(node.top)<screenHeight*0.4);
  if(!editable&&entry&&entry.editable===true)editable=entry;
  if(!editable&&entry){await tap(entry);await sleep(800);await snap();editable=all().find(node=>visible(node)&&node.editable===true&&Number(node.top)<screenHeight*0.4);}
  if(!editable){
    // Some builds expose the search field without the word "search" in its text.
    editable=all().find(node=>visible(node)&&node.editable===true&&Number(node.top)<screenHeight*0.4);
  }
  if(!editable)return {ok:false,code:'NO_SEARCH_FIELD',text:'没有在 '+APPS[app].label+' 里找到搜索框。可能停在登录/推荐页，或当前版本改版。',hint:'请先手动登录并停在首页，再让她学习。'};
  try{await call('ui.setValue',{nodeId:editable.nodeId,text:query});check?.();}
  catch{await tap(editable);await call('ui.text',{text:query});check?.();}
  await sleep(500);await snap();
  editable=all().find(node=>visible(node)&&node.editable===true&&Number(node.top)<screenHeight*0.4)||editable;
  let submit=all().find(node=>visible(node)&&node.nodeId!==editable.nodeId&&/^(?:搜索|搜一下|搜索视频|搜索用户|搜索内容|搜)$/.test(labelOf(node))&&(node.clickable===true||node.editable!==true));
  if(submit){await tap(submit);}
  else{
    // Search buttons are sometimes an unlabeled icon at the right edge of the field.
    const point={x:Math.round(Number(editable.right)-18),y:Math.round((Number(editable.top)+Number(editable.bottom))/2)};
    await call('ui.tap',point);check?.();
  }
  await sleep(3200);await snap();
  return {ok:true,snapshot,all,snap,tap};
}
/**
 * @param {{app?:string,query?:string,limit?:number,comments?:boolean,share?:boolean}} request
 * @param {{call:Function,check?:Function,log?:Function}} io
 */
export async function runPhoneLearning(request={},io={}){
  const {call,check,log=()=>{}}=io;
  const app=normalizedApp(request.app)||'bilibili',meta=APPS[app];
  if(typeof call!=='function')return failure('NO_CHANNEL','手机通道未就绪');
  const query=clean(request.query).slice(0,80),limit=Math.min(3,Math.max(1,Number(request.limit)||1)),readComments=request.comments!==false;
  const allowedPackage=new RegExp([meta.package,'bilibili','aweme','xiaoheihe','heybox'].join('|'),'i'),startedAt=Date.now(),steps=[];
  const assertPackage=value=>{if(value?.package&&!allowedPackage.test(value.package))throw Object.assign(Error('屏幕已经离开 '+meta.label+'（当前 '+value.package+'），本次不继续读取'),{code:'UNEXPECTED_PACKAGE'});};
  try{
    let snapshot=null,launchError=null;
    try{const current=await call('ui.snapshot',{});check?.();if(current?.ok){const data=current.data||current;if(data.package&&allowedPackage.test(data.package))snapshot=data;}}catch(error){if(error.code!=='E_TASK_SUSPENDED_BY_HOST')throw error;}
    for(let attempt=0;!snapshot&&attempt<3;attempt++){
      try{await call('app.launch',{package:meta.package});check?.();}catch(error){if(error.code!=='E_LAUNCH_NOT_LANDED')throw error;launchError=error;}
      await sleep(1800);
      const read=await call('ui.snapshot',{});check?.();
      if(read?.ok){const data=read.data||read;if(!data.package||allowedPackage.test(data.package)){snapshot=data;break;}}
    }
    if(!snapshot){const failed=pilotFailure({code:'E_LAUNCH_NOT_LANDED',message:launchError?.message||'应用没有来到前台'});return {...failed,app,query,steps};}
    steps.push('launch');assertPackage(snapshot);
    const all=()=>Array.isArray(snapshot?.nodes)?snapshot.nodes:[];
    const snap=async()=>{snapshot=await call('ui.snapshot',{});check?.();if(!snapshot?.ok)throw Object.assign(Error(snapshot?.text||'无法读取手机屏幕'),{code:snapshot?.code});snapshot=snapshot.data||snapshot;if(snapshot.package==='com.android.systemui'){await call('ui.key',{key:'back'});check?.();await sleep(700);const again=await call('ui.snapshot',{});check?.();if(again?.ok)snapshot=again.data||again;}assertPackage(snapshot);return snapshot;};
    const tap=async node=>{const wanted=labelOf(node);try{await snap();const fresh=wanted?all().find(item=>visible(item)&&labelOf(item)===wanted):null;if(wanted&&!fresh)return false;if(fresh)node=fresh;assertPackage(snapshot);}catch(error){if(error?.code)throw error;}const point=centerOf(node);await call('ui.tap',{x:point.x,y:point.y});check?.();await sleep(800);return true;};
    const screen=()=>snapshot?.screen||{width:1080,height:1920};
    const skipSplash=async()=>{
      for(let attempt=0;attempt<5;attempt++){
        const skip=all().find(node=>visible(node)&&/(?:跳过|skip)/i.test(labelOf(node)));
        if(skip){const point=centerOf(skip);await call('ui.tap',{x:point.x,y:point.y});check?.();await sleep(1200);await snap();continue;}
        if(all().some(node=>visible(node)&&/(?:搜索|推荐|热门|首页|关注|直播)/.test(labelOf(node))))return;
        await sleep(1200);await snap();
      }
    };
    await skipSplash();
    const goHome=async()=>{
      for(let attempt=0;attempt<3;attempt++){
        await snap();
        if(all().some(node=>visible(node)&&/(?:搜索栏|搜索|搜一搜|search)/i.test(labelOf(node))))return true;
        const homeTab=all().find(node=>visible(node)&&/(?:^|,)首页(?:,|$)/.test(labelOf(node)));
        if(homeTab){await tap(homeTab);await sleep(1000);continue;}
        const s=screen();await call('ui.tap',{x:Math.round(s.width/2),y:Math.round(s.height/2)});check?.();await sleep(700);await snap();
        const backButton=all().find(node=>visible(node)&&/(?:返回|back|关闭|close)/i.test(labelOf(node))&&(node.clickable===true||node.editable!==true));
        if(backButton){await tap(backButton);await sleep(900);continue;}
        await call('ui.key',{key:'back'});check?.();await sleep(900);await snap();
        if(snapshot.package&&!allowedPackage.test(snapshot.package)){await call('app.launch',{package:meta.package});check?.();await sleep(1600);}
      }
      return false;
    };
    await goHome();
    const swipeUp=async()=>{const s=screen();await call('ui.swipe',{fromX:Math.round(s.width*0.5),fromY:Math.round(s.height*0.78),toX:Math.round(s.width*0.5),toY:Math.round(s.height*0.28),durationMs:520});check?.();await sleep(900);};
    const scroll=async times=>{
      await snap();const scrollable=all().filter(node=>visible(node)&&node.scrollable===true).sort((a,b)=>areaOf(b)-areaOf(a))[0];
      if(scrollable){try{await call('ui.scroll',{nodeId:scrollable.nodeId,direction:'forward',times});check?.();}catch{await swipeUp();}}
      else await swipeUp();
      await sleep(900);return snap();
    };
    let searchState=null;
    if(query){
      searchState=await runSearch({call,check,app,query,log});
      if(!searchState.ok)return {...searchState,app,query,steps};
      snapshot=searchState.snapshot;steps.push('search');
    }
    const collect={lines:[],raw:[],title:''};
    const addPageText=snapshot=>{const lines=harvest(snapshot,{query});for(const line of lines){if(!collect.lines.includes(line))collect.lines.push(line);collect.raw.push(line);}if(!collect.title){const first=lines.find(line=>line.length>=8&&line.length<=120);if(first)collect.title=first;}};
    addPageText(snapshot);
    // Open a result: on a search page pick long, lower text nodes; on a home feed use the first large card.
    const resultCandidates=()=>{
      const s=screen(),minY=s.height*0.16;
      return all().filter(node=>visible(node)&&Number(node.top)>=minY&&labelOf(node).length>=8&&labelOf(node).length<=140&&!chromeLine(labelOf(node))&&labelOf(node)!==query).sort((a,b)=>Number(a.top)-Number(b.top)||Number(a.left)-Number(b.left));
    };
    let opened=0;
    const visited=new Set();
    while(opened<limit){
      const candidates=resultCandidates().filter(node=>!visited.has(labelOf(node)));
      const candidate=candidates[Math.min(opened,candidates.length-1)]||candidates[0];
      if(!candidate)break;
      visited.add(labelOf(candidate));
      await tap(candidate);steps.push('open');await sleep(2400);await snap();
      addPageText(snapshot);
      // Scroll the page so descriptions and early comments are included.
      for(let i=0;i<3;i++){await scroll(1);addPageText(snapshot);}
      if(readComments){
        const commentEntry=all().find(node=>visible(node)&&/(?:评论|全部评论|查看.{0,4}评论)/.test(labelOf(node))&&(node.clickable===true||/评论/.test(labelOf(node))));
        if(commentEntry){await tap(commentEntry);steps.push('comments');await sleep(1400);await snap();addPageText(snapshot);for(let i=0;i<2;i++){await scroll(1);addPageText(snapshot);}await call('ui.key',{key:'back'});check?.();await sleep(700);await snap();}
      }
      opened++;
      // Return to the result list for the next item, then re-read its current nodes.
      await call('ui.key',{key:'back'});check?.();await sleep(900);await snap();
    }
    const rawText=[...new Set(collect.raw)].join('\n').slice(0,8000);
    const links=extractLinks(rawText,{app,query,title:collect.title});
    const pageText=collect.lines.join('\n').slice(0,6500);
    if(!pageText){
      return {ok:false,code:'NO_TEXT',text:'已打开 '+meta.label+'，但没有读到可用的标题、简介或评论。可能页面被登录/验证码/广告挡住。',hint:'请先在手机上完成登录并关闭遮挡页面，再试一次。',app,query,steps,elapsedMs:Date.now()-startedAt};
    }
    const summary=[meta.label+(query?' · 搜索：'+query:' · 首页推荐'),collect.title?'标题：'+collect.title:'',pageText].filter(Boolean).join('\n');
    return {ok:true,app,query,title:collect.title||query||meta.label,text:summary.slice(0,7000),pageText,links,steps,opened,elapsedMs:Date.now()-startedAt,note:'只读取当前屏幕可访问的标题、简介和评论文字；没有截图，也不代表完整观看或听过视频。'};
  }catch(error){
    const failed=pilotFailure(error);return {...failed,app,query,steps,elapsedMs:Date.now()-startedAt};
  }
}
