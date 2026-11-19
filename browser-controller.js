import {captureBrowserCompanion,stopBrowserCompanion} from './browser-companion.js';
import {visualObservationPolicy} from './visual-observation.js';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readBrowserSubtitles} from './video-subtitles.js';
import {checkedWebsiteUrl} from './website-mcp-http.js';
const require=createRequire(import.meta.url);
export function browserUrl(value){const u=new URL(String(value));if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('浏览器仅打开不含账号密码的HTTP/HTTPS地址');return u.href;}
export function sameBrowserDestination(current,target,previous){
 const clean=value=>{const u=new URL(value);for(const key of [...u.searchParams.keys()])if(/^(?:utm_.+|spm_id_from|vd_source|share_source|share_medium|share_plat|share_session_id|from_spmid)$/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;};
 try{
  if(clean(current)===clean(target))return true;
  if(previous&&clean(previous.requested)===clean(target)&&clean(previous.landed)===clean(current))return true;
  const a=new URL(current),b=new URL(target);
  if(/(^|\.)bilibili\.com$/.test(a.hostname)&&/(^|\.)bilibili\.com$/.test(b.hostname)&&/^\/video\/(?:BV[\w]+|av\d+)\/?$/i.test(a.pathname)&&a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')){
   return (a.searchParams.get('p')||'1')===(b.searchParams.get('p')||'1')&&(!b.searchParams.has('t')||a.searchParams.get('t')===b.searchParams.get('t'));
  }
 }catch{}
 return false;
}
// Retry observations after a document redirect, never replay the action that led there.
export async function stablePageRead(page,read){
 for(let attempt=0;;attempt++){
  try{return await read();}catch(error){
   if(attempt>=2||!/Execution context was destroyed|Cannot find context with specified id|most likely because of a navigation/i.test(String(error?.message||error)))throw error;
   try{await page.waitForLoadState?.('domcontentloaded',{timeout:5000});}catch{}
   await page.waitForTimeout?.(250);
  }
 }
}
export function createBrowserController({getDataDir,getCacheDir,authorize=()=>true,beforeAction=()=>{},chromium:injected,executablePath,getExecutablePath,getEngine,headless=true,getHeadless,now=()=>Date.now()}={}){
 const sessions=new Map(),acquiring=new Map();let closed=false;const hidden=c=>getHeadless?getHeadless(c):headless;
 const selectedEngine=()=>getEngine?getEngine()==='dsh'?'dsh':'edge':process.platform==='win32'?'edge':'dsh';
 const configuredPath=()=>selectedEngine()==='dsh'?'':String(getExecutablePath?getExecutablePath():executablePath||process.env.QQ_BRIDGE_BROWSER_PATH||'').trim();
 const identityKey=c=>c.accountId&&c.personaId?JSON.stringify([c.accountId,c.personaId,'desktop-browser']):String(c.scope||c.sessionId||'');
 const sessionKey=c=>identityKey(c)+(hidden(c)?'':':desktop');
 const check=context=>{if(closed||!authorize(context))throw Error('设备操作权限、账号或人设已变化，浏览器任务停止');context.signal?.throwIfAborted();};
 function engine(){return injected||require('./vendor/playwright-core').chromium;}
 async function acquire(context){
  const key=sessionKey(context);if(acquiring.has(key)){const session=await acquiring.get(key);check(context);return session;}
  const task=launch(context);acquiring.set(key,task);try{return await task;}finally{acquiring.delete(key);}
 }
 async function launch(context){
  check(context);const key=sessionKey(context),identity=identityKey(context);if(!identity)throw Error('缺少浏览器会话身份');
  // Only one managed context per identity is active across visibility modes.
  // Persist cookies before the handoff; never touch manually opened browsers.
  for(const [other,value]of sessions)if(other!==key&&value.identity===identity){await persist(value);await value.context.close();sessions.delete(other);}
  let session=sessions.get(key);if(session){if(session.page.isClosed?.()){sessions.delete(key);session=null;}else if(session.configuredPath!==configuredPath()||session.engine!==selectedEngine()){await persist(session);await session.context.close();sessions.delete(key);session=null;}else{session.used=now();return session;}}
  if(sessions.size>=3){const oldest=[...sessions.entries()].sort((a,b)=>a[1].used-b[1].used)[0];await persist(oldest[1]);await oldest[1].context.close();sessions.delete(oldest[0]);}
  const dir=join(getDataDir(),'browser-profiles',createHash('sha256').update(key).digest('hex').slice(0,24));mkdirSync(dir,{recursive:true});
  const runtime=join(getCacheDir(),'browser','runtime');mkdirSync(runtime,{recursive:true});const browser=engine(),launch={headless:hidden(context),viewport:{width:1280,height:900},acceptDownloads:false,env:{...process.env,TEMP:runtime,TMP:runtime},artifactsDir:runtime,args:['--disable-background-networking','--autoplay-policy=no-user-gesture-required','--disk-cache-dir='+join(runtime,'disk-cache')]};
  if(process.platform!=='win32'){launch.args.push('--disable-dev-shm-usage');if(process.getuid?.()===0)launch.args.push('--no-sandbox');}
  let ctx,error;
  const selected=configuredPath();
  if(selected&&!existsSync(selected))throw Error('指定的浏览器程序不存在，请在设备设置修正路径：'+selected);
  if(selected&&!/(?:^|[\\/])(?:msedge(?:\.exe)?|microsoft-edge(?:-stable)?)$/i.test(selected))throw Error('仅支持 Edge 程序路径；使用内置浏览器请切换到 DSH 引擎');
  const edgePaths=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Microsoft/Edge/Application/msedge.exe'):'','/usr/bin/microsoft-edge','/usr/bin/microsoft-edge-stable'].filter(p=>p&&existsSync(p));
  const paths=selectedEngine()==='edge'?(selected?[selected]:edgePaths):[];
  for(const options of [...paths.map(p=>({...launch,executablePath:p})),...(selectedEngine()==='dsh'?[launch]:[])])try{ctx=await browser.launchPersistentContext(dir,options);break;}catch(e){error=e;}
  if(!ctx)throw Error('所选浏览器不可用；仅支持 DSH 内置浏览器和 Edge，请在设备设置检查；'+String(error?.message||'').split('\n')[0].slice(0,100));
  try{check(context);}catch(e){await ctx.close();throw e;}
  const stateDir=join(getDataDir(),'browser-profiles',createHash('sha256').update(identity).digest('hex').slice(0,24));mkdirSync(stateDir,{recursive:true});
  const profileState=join(stateDir,'bridge-session.json'),legacyState=join(dir,'bridge-session.json'),savedState=existsSync(profileState)?profileState:legacyState;
  if(existsSync(savedState))try{const saved=JSON.parse(readFileSync(savedState,'utf8'));if(Array.isArray(saved.cookies))await ctx.addCookies(saved.cookies);}catch{}
  const page=ctx.pages().find(p=>p.url()!=='about:blank')||ctx.pages()[0]||await ctx.newPage();session={context:ctx,page,identity,profileState,configuredPath:selected,engine:selectedEngine(),headless:launch.headless,used:now(),observations:0,captionResponses:[],requestPages:new WeakMap(),navigation:new WeakMap()};sessions.set(key,session);ctx.on?.('close',()=>{if(sessions.get(key)===session)sessions.delete(key);});page.on?.('framenavigated',()=>{void persist(session);});
  ctx.on?.('request',r=>session.requestPages.set(r,session.page.url()));
  ctx.on?.('response',r=>{void(async()=>{try{const url=new URL(r.url());if(!/subtitle|caption|\.vtt$|\.srt$|\.bcc$/i.test(url.pathname)||Number(r.headers()['content-length'])>2*1024*1024)return;const bytes=await r.body();if(bytes.length>2*1024*1024)return;session.captionResponses.push({page:session.requestPages.get(r.request())||'',source:url.origin+url.pathname,text:bytes.toString('utf8')});session.captionResponses=session.captionResponses.slice(-6);}catch{}})();});return session;
 }
 async function persist(session){try{const state=await session.context.storageState();writeFileSync(session.profileState,JSON.stringify({cookies:state.cookies}));}catch{}}
 async function snapshot(page){
  const nonce=randomUUID().slice(0,8);
  const value=await stablePageRead(page,()=>page.evaluate(({nonce})=>{
   const visible=e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>0&&r.height>0&&s.display!=='none'&&s.visibility!=='hidden';};
   const refs=globalThis.__qqBridgeRefs||(globalThis.__qqBridgeRefs={nonce,next:0,map:new WeakMap()});
   const elements=[],links=[];let n=0;
   for(const e of document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"],video,img,canvas,[role="img"]')){
    if(!visible(e))continue;if(n>=180)break;
    n++;let ref=refs.map.get(e);if(!ref){ref=refs.nonce+'-'+(++refs.next);refs.map.set(e,ref);}const type=e.tagName.toLowerCase(),password=e.getAttribute('type')==='password',label=(e.getAttribute('aria-label')||e.getAttribute('title')||e.getAttribute('placeholder')||e.innerText||e.getAttribute('alt')||((type==='canvas'||type==='img')?'页面图像 '+e.clientWidth+'×'+e.clientHeight:'')).trim().replace(/\s+/g,' ').slice(0,180);
    if(e.getAttribute('data-qqbridge-ref')!==ref)e.setAttribute('data-qqbridge-ref',ref);
    const row={ref,type,label,...(type==='input'?{inputType:e.getAttribute('type')||'text'}:{}),...(type==='video'?{paused:e.paused,currentTime:Number(e.currentTime)||0,duration:Number.isFinite(e.duration)?e.duration:null,muted:e.muted}:{}),...(password?{sensitive:true}:{})};
    const loginPage=!!(e.closest('form')||document).querySelector('input[type="password"]'),inputType=e.getAttribute('type')||'text';
    if(loginPage){row.loginPage=true;row.loginControl=type==='input'&&['password','text','email','tel'].includes(inputType)&&!/captcha|验证码|一次性|one.time|search|搜索/i.test([e.name,e.autocomplete,e.placeholder,label].join(' '))?'credential':['button','input'].includes(type)&&(/登录|登入|sign.?in|log.?in/i.test(label)||inputType==='submit')?'submit':'';row.oauthConsent=/授权|authorize|allow access/i.test(label);}
    if(type==='a'){try{row.url=new URL(e.getAttribute('href'),location.href).href;if(/^https?:/.test(row.url)&&label)links.push({url:row.url,title:label});}catch{}}
    elements.push(row);
   }
   const text=String(document.body?.innerText||'').replace(/[ \t]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,14000);
   const players=[...document.querySelectorAll('video')].filter(visible).slice(0,6).map(v=>({paused:v.paused,currentTime:Number(v.currentTime)||0,duration:Number.isFinite(v.duration)?v.duration:null}));
   return {url:location.href,title:document.title,text,elements,players,links:links.slice(0,100),coverage:players.length?'已取得页面文字和播放器状态；视频画面、音频未分析':'已取得当前页面文字',observedAt:Date.now()};
  },{nonce}));return value;
 }
 async function act(args={},context={}){
  check(context);const session=await acquire(context),page=session.page,action=String(args.action||'snapshot');
  const target=()=>{const ref=String(args.ref||'');if(!/^[a-f\d-]{8}-\d{1,8}$/.test(ref))throw Error('请使用最近一次页面快照中的ref');return page.locator('[data-qqbridge-ref="'+ref+'"]').first();};
  try{
   let label='',password=false,contentText;
   if(args.ref&&['click','fill','press'].includes(action)){if(await target().count()!==1)throw Error('页面已改变，请重新snapshot后再点击');label=await target().evaluate(e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.getAttribute('placeholder')||e.innerText||e.getAttribute('alt')||'').trim().replace(/\s+/g,' ').slice(0,180));password=await target().getAttribute('type')==='password';}
   if(action==='click'||action==='press'&&/Enter/i.test(String(args.key||''))){try{contentText=await page.evaluate(()=>[...document.querySelectorAll('textarea,[contenteditable="true"],input:not([type="password"]):not([type="hidden"])')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;}).map(e=>e.value??e.innerText??'').filter(Boolean).join('\n').slice(0,8000));}catch{}}
   let loginProof={};
   if(['click','fill','press'].includes(action))try{const inspect=e=>{if(!e)return {};const form=e.closest('form')||document,hasPassword=!!form.querySelector('input[type="password"]'),tag=e.tagName.toLowerCase(),type=e.getAttribute('type')||'text',name=[e.getAttribute('name'),e.getAttribute('autocomplete'),e.getAttribute('placeholder'),e.getAttribute('aria-label')].join(' '),label=(e.getAttribute('aria-label')||e.innerText||'').trim();return {loginPage:hasPassword,loginControl:hasPassword&&tag==='input'&&['password','text','email','tel'].includes(type)&&!/captcha|验证码|一次性|one.time|search|搜索/i.test(name)?'credential':hasPassword&&['button','input'].includes(tag)&&(/登录|登入|sign.?in|log.?in/i.test(label)||type==='submit')?'submit':'',password:type==='password',oauthConsent:/授权|授权访问|authorize|allow access/i.test(label),mediaControl:['video','audio'].includes(tag)||tag==='button'&&(!e.closest('form')||e.getAttribute('type')==='button')&&/^(?:播放|暂停|继续播放|静音|取消静音|play|pause|mute|unmute)(?:视频|video)?$/i.test(label)};};loginProof=args.ref?await target().evaluate(inspect):await page.evaluate('('+inspect.toString()+')(document.activeElement)');}catch{}
   if(action==='press'&&/Enter/i.test(String(args.key||''))&&loginProof.loginPage&&loginProof.loginControl==='credential')loginProof.loginControl='submit';
   const mediaControl=['play','pause','seek'].includes(action)||loginProof.mediaControl===true&&action==='click';
   await beforeAction(args,context,{...loginProof,url:action==='navigate'?args.url:page.url(),label,password:password||loginProof.password===true,containsCredentials:loginProof.loginPage&&loginProof.loginControl==='submit',mediaControl,loginView:(['navigate','snapshot','screenshot','subtitles','wait','tabs','show','scroll','back','switch','close','play','pause'].includes(action)||action==='click'&&/登录|登入|sign.?in|log.?in/i.test(label)&&!contentText&&!loginProof.loginControl),contentText:contentText||undefined,observationId:args.ref||undefined});
   if(action==='navigate'||action==='open'){
    const url=browserUrl(args.url),previous=session.navigation.get(page);
    if(!sameBrowserDestination(page.url(),url,previous)){await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});session.navigation.set(page,{requested:url,landed:page.url(),at:now()});}
   }
   else if(action==='click'){const node=target();if(await node.count()!==1)throw Error('页面已改变，请重新snapshot后再点击');await node.click({timeout:12000});}
   else if(action==='fill'){const node=target();await node.fill(String(args.text||'').slice(0,8000),{timeout:12000});if(args.submit===true)await node.press('Enter');}
   else if(action==='press'){
    const key=String(args.key||'');if(!/^[\w+ -]{1,60}$/.test(key))throw Error('无效的浏览器按键');
    const refresh=/^(?:(?:Control|Ctrl|Meta|ControlOrMeta)\+(?:Shift\+)?r|(?:Control|Ctrl|Shift)\+F5|F5)$/i.test(key);
    const explicit=context.meta?.kind==='user'&&/刷新|重新加载|reload|refresh/i.test(String(context.meta.userWords||''));
    if(refresh&&!explicit){const media=await page.evaluate(()=>!!document.querySelector('video'));const previous=session.navigation.get(page);if(media&&previous&&now()-previous.at<60000)return {ok:true,skipped:true,reason:'保留当前视频播放进度，刚加载过的页面不重复刷新；可继续观察、播放或滚动。',...await snapshot(page)};}
    if(args.ref)await target().press(key);else await page.keyboard.press(key);
    if(refresh)session.navigation.set(page,{requested:page.url(),landed:page.url(),at:now()});
   }
   else if(action==='play'||action==='pause'){const node=args.ref?target():page.locator('video,audio').first();if(await node.count()!==1)throw Error('当前页没有可操作的音视频播放器');await node.evaluate(async(e,a)=>{if(!['VIDEO','AUDIO'].includes(e.tagName))throw Error('目标不是实际音视频播放器');if(a==='play')await e.play();else e.pause();},action);}
   else if(action==='seek'){const at=Number(args.at);if(!Number.isFinite(at)||at<0)throw Error('视频定位需要有效秒数');const node=page.locator('video').first();if(await node.count()!==1)throw Error('当前页没有可定位的视频播放器');await node.evaluate((e,t)=>{e.currentTime=Number.isFinite(e.duration)?Math.min(t,e.duration):t;},at);}
   else if(action==='scroll')await page.mouse.wheel(0,Math.max(-4000,Math.min(4000,Number(args.amount)||650)));
   else if(action==='wait')await new Promise(resolve=>setTimeout(resolve,Math.min(8000,Math.max(100,Number(args.milliseconds)||1200))));
   else if(action==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:20000});
   else if(action==='tabs')return {ok:true,tabs:await Promise.all(session.context.pages().map(async(p,index)=>({index,url:p.url(),title:await p.title()})))};
   else if(action==='subtitles'){const subtitles=await readBrowserSubtitles(page,session);check(context);return {ok:true,environment:session.headless?'internal-browser':'desktop-browser',url:page.url(),subtitles,substantive:subtitles.status==='available'||subtitles.status==='partial',coverage:subtitles.coverage};}
   else if(action==='switch'){const p=session.context.pages()[Number(args.index)];if(!p)throw Error('标签页不存在');session.page=p;}
   else if(action==='screenshot'){const dir=join(getCacheDir(),'browser');mkdirSync(dir,{recursive:true});const file=join(dir,'browser-'+randomUUID()+'.png');if(args.ref){const node=target();if(await node.count()!==1)throw Error('截图目标已经变化，请重新观察');await node.screenshot({path:file});}else await page.screenshot({path:file,fullPage:false});check(context);const observed=await snapshot(page),played=(observed.players||[]).some(e=>e.currentTime>0),specific=/\/video\/|\/watch\b|\/detail\b|\/bangumi\/play\//.test(page.url());return {ok:true,environment:session.headless?'internal-browser':'desktop-browser',file,url:page.url(),snapshot:observed,substantive:played&&specific,coverage:played&&specific?'具体视频页面的真实播放状态与当前截图；仅当前画面，不代表听过音频或完整观看':observed.coverage};}
   else if(action==='show'){if(session.headless)throw Error('现在使用内部运行窗口；只有本人要求桌面窗口时才可切换，不自动抢占桌面');await session.page.bringToFront();}
   else if(action==='close'){await persist(session);await session.context.close();sessions.delete(sessionKey(context));return {ok:true,closed:true};}
   else if(action!=='snapshot')throw Error('不支持的浏览器动作');
   await session.page.waitForTimeout(250);check(context);session.observations++;return {ok:true,environment:session.headless?'internal-browser':'desktop-browser',...await snapshot(session.page)};
  }catch(error){check(context);throw Error(String(error.message).split('\n')[0].slice(0,300));}finally{await persist(session);}
 }
 async function peekVideo(context={}){
 try{const key=sessionKey(context);const session=sessions.get(key);if(!session||session.page.isClosed?.())return null;return await session.page.evaluate(()=>{const videos=[...document.querySelectorAll("video")].filter(v=>{const r=v.getBoundingClientRect();return r.width>0&&r.height>0&&(v.readyState>0||v.currentTime>0||v.duration>0);}).sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;});const v=videos[0];if(!v)return null;return {url:location.href,title:document.title,currentTime:Number(v.currentTime)||0,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused===true,ended:v.ended===true,at:Date.now()};});}catch{return null;}
}
async function captureVideo(context={}){
  check(context);const session=await acquire(context),page=session.page,policy=visualObservationPolicy(context);
  await beforeAction({action:'screenshot'},context,{url:page.url(),label:'当前播放器即时画面'});
  const observed=await stablePageRead(page,()=>page.evaluate(()=>{
    const videos=[...document.querySelectorAll('video')].map(v=>({v,r:v.getBoundingClientRect()})).filter(({v,r})=>r.width>0&&r.height>0&&v.readyState>=2).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height);
    const item=videos[0];if(!item)return null;const {v,r}=item,x=Math.max(0,r.left),y=Math.max(0,r.top);
    const subtitle=Array.from(v.textTracks||[]).flatMap(t=>Array.from(t.activeCues||[],c=>String(c.text||''))).join('\n').slice(0,600);
    return {url:location.href,at:Number(v.currentTime)||0,subtitle,x,y,width:Math.min(innerWidth,r.right)-x,height:Math.min(innerHeight,r.bottom)-y};
  }));
  if(!observed||observed.width<=0||observed.height<=0)throw Error('当前可见区域没有已就绪的视频画面，请先打开播放器');
  if(session.videoCapture?.page!==page){try{await session.videoCapture?.cdp.detach();}catch{}session.videoCapture={page,cdp:await page.context().newCDPSession(page)};}
  const cdp=session.videoCapture.cdp;
  try{
    const scale=Math.min(1,policy.maxEdge/Math.max(observed.width,observed.height));
    const captured=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:policy.quality,fromSurface:true,captureBeyondViewport:false,clip:{x:observed.x,y:observed.y,width:observed.width,height:observed.height,scale}});
    check(context);if(page.url()!==observed.url)throw Error('获取画面期间页面已切换，已丢弃旧画面');
    if(Buffer.byteLength(captured.data,'base64')>policy.maxBytes)throw Error('当前画面超过图像预算，请缩小播放器后重试');
    return {ok:true,url:observed.url,at:observed.at,subtitle:observed.subtitle,capturedAt:Date.now(),data:captured.data,mediaType:'image/jpeg',width:Math.round(observed.width*scale),height:Math.round(observed.height*scale)};
  }catch(error){session.videoCapture=null;try{await cdp.detach();}catch{}throw error;}
 }
 async function captureVideoAudio(context,url,at){
  check(context);const session=sessions.get(sessionKey(context)),page=session?.page;
  if(!page||page.url()!==url)return null;
  const clip=await page.evaluate(async({url,at})=>{
   const area=v=>{const r=v.getBoundingClientRect();return r.width*r.height;};
   const video=[...document.querySelectorAll('video')].filter(v=>area(v)>0&&v.readyState>=2).sort((a,b)=>area(b)-area(a))[0];
   if(location.href!==url||!video||video.paused||video.playbackRate!==1||Math.abs(video.currentTime-at)>1.5)return null;
   const stream=video.captureStream?.()||video.mozCaptureStream?.();
   if(!stream)return null;
   let recorder,timer,deadline,invalid=false;
   const changed=()=>{invalid=true;};
   try{
    const tracks=stream.getAudioTracks();if(!tracks.length)return null;
    recorder=new MediaRecorder(new MediaStream(tracks),{mimeType:'audio/webm'});
    const chunks=[],source=video.currentSrc,start=video.currentTime;
    video.addEventListener('seeking',changed);video.addEventListener('ratechange',changed);
    await new Promise((resolve,reject)=>{
     recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
     recorder.onstop=resolve;recorder.onerror=reject;recorder.start();
     timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},5000);
     deadline=setTimeout(()=>reject(Error('音轨超时')),6800);
    });
    const end=video.currentTime,blob=new Blob(chunks);
    if(invalid||video.currentSrc!==source||location.href!==url||end-start<.5||end-start>6.5||!blob.size||blob.size>512*1024)return null;
    const bytes=new Uint8Array(await blob.arrayBuffer());let raw='';
    for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return {start,end,data:btoa(raw)};
   }finally{clearTimeout(timer);clearTimeout(deadline);video.removeEventListener('seeking',changed);video.removeEventListener('ratechange',changed);if(recorder?.state==='recording')recorder.stop();stream.getTracks().forEach(t=>t.stop());}
  },{url,at});
  check(context);return page.url()===url?clip:null;
 }
 async function read(url,context={}){await act({action:'navigate',url},context);await act({action:'wait',milliseconds:1200},context);const result=await act({action:'snapshot'},context),video=!!(result.players?.length||/\/video\/|\/watch\b|\/bangumi\/play\/|douyin/.test(result.url));let subtitles;if(video)try{subtitles=(await act({action:'subtitles'},context)).subtitles;}catch{}
  const transcript=(subtitles?.segments||[]).map(s=>'['+s.start+'-'+s.end+'] '+s.text).join('\n').slice(0,18000)||subtitles?.text||'';
  return {status:result.text.length>60||transcript?'read':'metadata',title:result.title,body:result.text+(transcript?'\n【实际字幕，外部资料】\n'+transcript:''),finalUrl:result.url,url:browserUrl(url),links:result.links,mediaType:video?'video':'web',subtitles,coverage:subtitles?.segments?.length?subtitles.coverage:result.coverage,rendered:true};}
 async function saveWebsiteSession(context,session){
  check(context);
  session??=[...sessions.values()].find(item=>item.identity===identityKey(context));
  if(!session)throw Error('请先打开桥接登录窗口并完成登录');
  const snapshot=await session.context.storageState();
  check(context);
  writeFileSync(session.profileState,JSON.stringify({cookies:snapshot.cookies}));
  return {loginVerified:false};
 }
 async function verifyBilibiliLogin(context,session){
  await verifiedBilibiliAccount(context,session);
  return {loginVerified:true};
 }
 async function verifiedBilibiliAccount(context,session){
  check(context);
  session??=[...sessions.values()].find(item=>item.identity===identityKey(context))||await acquire(context);
  const response=await session.context.request.get('https://api.bilibili.com/x/web-interface/nav',{
   headers:{referer:'https://www.bilibili.com/'},timeout:12000,maxRedirects:0
  });
  try{
   if(!response.ok())throw Error('暂时无法验证 B 站登录，请稍后重试');
   const result=await response.json();check(context);
   if(result.code===-101||result.data?.isLogin===false)throw Error('B 站登录已失效或尚未完成，请在桥接浏览器登录后重试');
   if(result.code!==0||result.data?.isLogin!==true)throw Error('暂时无法验证 B 站登录，请稍后重试');
   await saveWebsiteSession(context,session);
   return String(result.data.mid||'');
  }finally{await response.dispose();}
 }
 async function readBilibiliAccountSection(context,session,mid){
  const section=context.websiteSection,folder=context.websiteFolderId;
  const following=section==='following';
  const url=new URL(following?'/x/relation/followings':folder?'/x/v3/fav/resource/list':'/x/v3/fav/folder/created/list-all','https://api.bilibili.com');
  if(following||folder){url.searchParams.set('pn','1');url.searchParams.set('ps','20');}
  url.searchParams.set(following?'vmid':folder?'media_id':'up_mid',folder||mid);
  const response=await session.context.request.get(url.href,{headers:{referer:'https://www.bilibili.com/'},timeout:12000,maxRedirects:0});
  try{
   check(context);
   if(!response.ok())throw Error('B 站账号接口请求失败，HTTP '+response.status());
   const result=await response.json();
   check(context);
   if(result.code!==0)throw Error('B 站账号接口没有返回列表，状态码 '+Number(result.code));
   const items=folder?result.data?.medias:result.data?.list;
   if(!Array.isArray(items)&&items!==null)throw Error('B 站账号接口返回格式已变化');
   const rows=(items||[]).slice(0,20).map(item=>following?{name:item.uname}:folder?{title:item.title,bvid:item.bvid}:{title:item.title,folderId:String(item.id),videoCount:item.media_count});
   const text=JSON.stringify({items:rows,returned:rows.length,total:result.data.total??result.data.count,hasMore:result.data.has_more??((result.data.total??result.data.count??rows.length)>rows.length)});
   return {status:200,url:'https://api.bilibili.com'+url.pathname,text};
  }finally{await response.dispose();}
 }
 async function readWebsiteSession(url,context={}){
  const session=await acquire(context),page=await session.context.newPage();
  const abort=()=>{void page.close().catch(()=>{});};
  context.signal?.addEventListener('abort',abort,{once:true});
  try{
   check(context);
   if(context.requireWebsiteLogin){
    const mid=await verifiedBilibiliAccount(context,session);
    if(context.websiteSection==='following'||context.websiteSection==='favorites'){
     if(!/^\d+$/.test(mid))throw Error('B 站登录已验证，但未返回账号空间编号');
     return await readBilibiliAccountSection(context,session,mid);
    }
   }
   const origin=checkedWebsiteUrl(url).origin;
   const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
   if(!response)throw Error('桥接浏览器未收到网页响应');
   await page.waitForTimeout(1200);
   check(context);
   const observed=await page.evaluate(expectedOrigin=>{
    if(location.origin!==expectedOrigin)return {url:location.href};
    const loginRequired=!!document.querySelector('input[type="password"]')||/(?:^|\/)(?:login|sign-in|signin)(?:\/|$)/i.test(location.pathname);
    return {url:location.href,loginRequired,text:loginRequired?'':String(document.body?.innerText||'').trim().slice(0,20000)};
   },origin);
   checkedWebsiteUrl(observed.url,origin);
   check(context);
   const status=response.status();
   if(status===401||status===403)return {url:observed.url,status:200,text:'',loginRequired:true};
   return {...observed,status};
  }catch(error){
   check(context);
   if(context.requireWebsiteLogin&&/^B 站(?:登录|账号接口)/.test(error.message))throw error;
   if(error.message.includes('同一站点'))throw Error('页面跳转到其他站点，请先在桥接浏览器内完成登录');
   throw Error('桥接浏览器暂时无法读取该页面');
  }finally{
   context.signal?.removeEventListener('abort',abort);
   await page.close().catch(()=>{});
   await persist(session);
  }
 }
 async function close(){closed=true;await Promise.allSettled([...sessions.values()].map(async s=>{await persist(s);await s.context.close();}));sessions.clear();}
 function engines(){let bundled=false;try{bundled=!!injected||existsSync(engine().executablePath());}catch{}const selected=configuredPath(),edge=selected?/(?:^|[\\/])msedge(?:\.exe)?$/i.test(selected)&&existsSync(selected):['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe',process.env.LOCALAPPDATA?join(process.env.LOCALAPPDATA,'Microsoft/Edge/Application/msedge.exe'):'','/usr/bin/microsoft-edge','/usr/bin/microsoft-edge-stable'].some(p=>p&&existsSync(p));return [{id:'dsh',name:'DSH 内置浏览器',available:bundled},{id:'edge',name:'Microsoft Edge',available:edge}];}
 function available(){return engines().find(e=>e.id===selectedEngine())?.available===true;}

return {act,read,readWebsiteSession,verifyBilibiliLogin,saveWebsiteSession,peekVideo,captureVideo,captureVideoAudio,async captureCompanion(context,options,budget){check(context);const session=await acquire(context);await snapshot(session.page);const result=await captureBrowserCompanion(session.page,context,budget,options);check(context);return result;},async stopCompanion(context){const session=sessions.get(sessionKey(context));if(session)await stopBrowserCompanion(session.page,context.visualSessionId);},close,status:()=>({available:available(),engine:selectedEngine(),engines:engines(),executablePath:configuredPath(),fixedExecutable:!!configuredPath(),backend:'bundled-playwright',environment:getHeadless&&!getHeadless({})?'desktop-default':'internal-default',visible:[...sessions.values()].some(s=>!s.headless),persistentIdentity:true,sessions:sessions.size,actions:['navigate','snapshot','click','fill','press','play','pause','scroll','wait','back','tabs','switch','screenshot','subtitles','show','close']})};
}
