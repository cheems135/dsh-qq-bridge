import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readBrowserSubtitles} from './video-subtitles.js';
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
export function createBrowserController({getDataDir,getCacheDir,authorize=()=>true,beforeAction=()=>{},chromium:injected,executablePath,getExecutablePath,headless=true,getHeadless,now=()=>Date.now()}={}){
 const sessions=new Map(),acquiring=new Map();let closed=false;const hidden=c=>getHeadless?getHeadless(c):headless;
 const configuredPath=()=>String(getExecutablePath?getExecutablePath():executablePath||process.env.QQ_BRIDGE_BROWSER_PATH||'').trim();
 const sessionKey=c=>(c.accountId&&c.personaId?JSON.stringify([c.accountId,c.personaId,'desktop-browser']):String(c.scope||c.sessionId||''))+(hidden(c)?'':':desktop');
 const check=context=>{if(closed||!authorize(context))throw Error('设备操作权限、账号或人设已变化，浏览器任务停止');context.signal?.throwIfAborted();};
 function engine(){return injected||require('./vendor/playwright-core').chromium;}
 async function acquire(context){
  const key=sessionKey(context);if(acquiring.has(key)){const session=await acquiring.get(key);check(context);return session;}
  const task=launch(context);acquiring.set(key,task);try{return await task;}finally{acquiring.delete(key);}
 }
 async function launch(context){
  check(context);const key=sessionKey(context);if(!key)throw Error('缺少浏览器会话身份');
  let session=sessions.get(key);if(session){if(session.page.isClosed?.()){sessions.delete(key);session=null;}else if(session.configuredPath!==configuredPath()){await persist(session);await session.context.close();sessions.delete(key);session=null;}else{session.used=now();return session;}}
  if(sessions.size>=3){const oldest=[...sessions.entries()].sort((a,b)=>a[1].used-b[1].used)[0];await oldest[1].context.close();sessions.delete(oldest[0]);}
  const dir=join(getDataDir(),'browser-profiles',createHash('sha256').update(key).digest('hex').slice(0,24));mkdirSync(dir,{recursive:true});
  const runtime=join(getCacheDir(),'browser','runtime');mkdirSync(runtime,{recursive:true});const browser=engine(),launch={headless:hidden(context),viewport:{width:1280,height:900},acceptDownloads:false,env:{...process.env,TEMP:runtime,TMP:runtime},artifactsDir:runtime,args:['--disable-background-networking','--autoplay-policy=no-user-gesture-required','--disk-cache-dir='+join(runtime,'disk-cache')]};
  if(process.platform!=='win32'){launch.args.push('--disable-dev-shm-usage');if(process.getuid?.()===0)launch.args.push('--no-sandbox');}
  let ctx,error;
  const selected=configuredPath();
  if(selected&&!existsSync(selected))throw Error('指定的浏览器程序不存在，请在设备设置修正路径：'+selected);
  const paths=selected?[selected]:[process.platform==='win32'?'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe':'/usr/bin/chromium',process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/chromium-browser'].filter(p=>p&&existsSync(p));
  for(const options of [...paths.map(p=>({...launch,executablePath:p})),...(selected?[]:[launch])])try{ctx=await browser.launchPersistentContext(dir,options);break;}catch(e){error=e;}
  if(!ctx)throw Error('没有可启动的浏览器，请安装Chrome/Edge或在设备设置填写浏览器路径；'+String(error?.message||'').split('\n')[0].slice(0,100));
  try{check(context);}catch(e){await ctx.close();throw e;}
  const profileState=join(dir,'bridge-session.json');if(existsSync(profileState))try{const saved=JSON.parse(readFileSync(profileState,'utf8'));if(Array.isArray(saved.cookies))await ctx.addCookies(saved.cookies);}catch{}
  const page=ctx.pages().find(p=>p.url()!=='about:blank')||ctx.pages()[0]||await ctx.newPage();session={context:ctx,page,profileState,configuredPath:selected,headless:launch.headless,used:now(),observations:0,captionResponses:[],requestPages:new WeakMap(),navigation:new WeakMap()};sessions.set(key,session);ctx.on?.('close',()=>{if(sessions.get(key)===session)sessions.delete(key);});page.on?.('framenavigated',()=>{void persist(session);});
  ctx.on?.('request',r=>session.requestPages.set(r,session.page.url()));
  ctx.on?.('response',r=>{void(async()=>{try{const url=new URL(r.url());if(!/subtitle|caption|\.vtt$|\.srt$|\.bcc$/i.test(url.pathname)||Number(r.headers()['content-length'])>2*1024*1024)return;const bytes=await r.body();if(bytes.length>2*1024*1024)return;session.captionResponses.push({page:session.requestPages.get(r.request())||'',source:url.origin+url.pathname,text:bytes.toString('utf8')});session.captionResponses=session.captionResponses.slice(-6);}catch{}})();});return session;
 }
 async function persist(session){try{const state=await session.context.storageState();writeFileSync(session.profileState,JSON.stringify({cookies:state.cookies}));}catch{}}
 async function snapshot(page){
  const nonce=randomUUID().slice(0,8);
  const value=await page.evaluate(({nonce})=>{
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
  },{nonce});return value;
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
   const mediaControl=['play','pause'].includes(action)||loginProof.mediaControl===true&&action==='click';
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
 try{const key=sessionKey(context);const session=sessions.get(key);if(!session||session.page.isClosed?.())return null;return await session.page.evaluate(()=>{const videos=[...document.querySelectorAll("video")].filter(v=>v.readyState>0||v.currentTime>0||v.duration>0);const v=videos[0];if(!v)return null;return {url:location.href,title:document.title,currentTime:Number(v.currentTime)||0,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused===true,ended:v.ended===true,at:Date.now()};});}catch{return null;}
}
async function read(url,context={}){await act({action:'navigate',url},context);await act({action:'wait',milliseconds:1200},context);const result=await act({action:'snapshot'},context),video=!!(result.players?.length||/\/video\/|\/watch\b|\/bangumi\/play\/|douyin/.test(result.url));let subtitles;if(video)try{subtitles=(await act({action:'subtitles'},context)).subtitles;}catch{}
  const transcript=(subtitles?.segments||[]).map(s=>'['+s.start+'-'+s.end+'] '+s.text).join('\n').slice(0,18000)||subtitles?.text||'';
  return {status:result.text.length>60||transcript?'read':'metadata',title:result.title,body:result.text+(transcript?'\n【实际字幕，外部资料】\n'+transcript:''),finalUrl:result.url,url:browserUrl(url),links:result.links,mediaType:video?'video':'web',subtitles,coverage:subtitles?.segments?.length?subtitles.coverage:result.coverage,rendered:true};}
 async function close(){closed=true;await Promise.allSettled([...sessions.values()].map(async s=>{await persist(s);await s.context.close();}));sessions.clear();}
 function available(){const selected=configuredPath();if(selected)return existsSync(selected);if(injected)return true;const paths=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/chromium','/usr/bin/chromium-browser'];try{paths.push(engine().executablePath());}catch{}return paths.some(p=>p&&existsSync(p));}
 return {act,read,peekVideo,close,status:()=>({available:available(),executablePath:configuredPath(),fixedExecutable:!!configuredPath(),backend:'bundled-playwright',environment:getHeadless&&!getHeadless({})?'desktop-default':'internal-default',visible:[...sessions.values()].some(s=>!s.headless),persistentIdentity:true,sessions:sessions.size,actions:['navigate','snapshot','click','fill','press','play','pause','scroll','wait','back','tabs','switch','screenshot','subtitles','show','close']})};
}
