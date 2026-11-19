import {visualObservationPolicy} from './visual-observation.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {browserUrl,sameBrowserDestination} from './browser-controller.js';

const recentByBrowser=new WeakMap();
const soundByBrowser=new WeakMap();
// Desktop watching always opens the configured browser through the common
// controller. There is deliberately no decoder or alternate-browser fallback.
export async function readBrowserVideo({browser,args={},context={},scope='',previous,authorize=()=>true,listenWindow,readFile=readFileSync,sleep=ms=>delay(ms,undefined,{signal:context.signal})}={}){
 const check=()=>{context.signal?.throwIfAborted();if(!authorize(context))throw Error('视频观察期间会话或浏览器权限已改变');};
 const policy=visualObservationPolicy(context);
 check();const url=browserUrl(args.url);
 const before=await browser.peekVideo(context);
 const continuing=before&&previous?.mode==='browser'&&previous.scope===scope&&
  (sameBrowserDestination(before.url,url)||sameBrowserDestination(previous.url,url)&&sameBrowserDestination(before.url,previous.finalUrl||previous.url));
 const samePage=before&&sameBrowserDestination(before.url,url);
 const opened=samePage?{url:before.url}:await browser.act({action:'navigate',url},context);check();
 let player=null;
 for(let i=0;i<9;i++){
  check();player=await browser.peekVideo(context);
  if(player&&Number.isFinite(Number(player.currentTime))&&(Number(player.duration)>0||Number(player.currentTime)>0))break;
  if(i<8)await sleep(500);
 }
 if(!player||!(Number(player.duration)>0||Number(player.currentTime)>0))throw Error('指定浏览器已打开，但未取得可播放的视频；可能仍在加载、需要登录，或页面没有视频播放器。');
 const pageUrl=opened.url||player.url;
 if(!sameBrowserDestination(player.url,pageUrl))throw Error('浏览器已切换页面，本轮停止旧视频观察');
 if(args.at!==undefined){await browser.act({action:'seek',at:args.at},context);check();}
 if(player.paused&&(!continuing||args.action==='start')){
  await browser.act({action:'play'},context);check();player=await browser.peekVideo(context);
 }
 const frames=[];let state=player,subtitle='';
 {
  check();state=await browser.peekVideo(context);
  if(!state||!sameBrowserDestination(state.url,pageUrl))throw Error('浏览器已切换视频，本轮停止旧视频观察');
  const at=Number(state.currentTime);
  if(!Number.isFinite(at)||at<0)throw Error('浏览器没有返回有效播放位置');
  const shot=browser.captureVideo?await browser.captureVideo(context):await browser.act({action:'screenshot'},context);check();
  if(shot.url&&!sameBrowserDestination(shot.url,pageUrl))throw Error('截图时浏览器已切换视频，未采用旧视频画面');
  subtitle=shot.subtitle||'';
  const bytes=shot.data?Buffer.from(shot.data,'base64'):readFile(shot.file);
  const png=bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpeg=bytes[0]===255&&bytes[1]===216;
  if(!png&&!jpeg)throw Error('浏览器未返回有效视频截图');
  if(bytes.length>policy.maxBytes)throw Error('当前视频画面超过本轮图像预算');
  frames.push({at:shot.at??at,capturedAt:shot.capturedAt??Date.now(),part:{type:'image',mediaType:png?'image/png':'image/jpeg',name:'live-player-current',data:bytes.toString('base64')}});

 }
 check();if(!frames.length)throw Error('指定浏览器没有返回实际画面');
 // A model can take seconds to answer. Capture NOW on every request; an older
 // frame is optional motion context, never a queued task to catch up with.
 let cache=recentByBrowser.get(browser);if(!cache){cache=new Map();recentByBrowser.set(browser,cache);}
 const identity=JSON.stringify([scope,context.accountId,context.personaId,context.key,context.generation,policy.backend]);
 const fresh=frames[0],old=cache.get(identity),now=Date.now();
 for(const [key,row] of cache)if(now-row.savedAt>2500)cache.delete(key);
 if(policy.maxFrames>1&&args.at===undefined&&args.action!=='start'&&old&&sameBrowserDestination(old.url,pageUrl)&&now-old.savedAt<=2500&&fresh.at>old.frame.at&&fresh.at-old.frame.at<=2.5&&fresh.part.data!==old.frame.part.data)frames.unshift(old.frame);
 cache.delete(identity);cache.set(identity,{url:pageUrl,frame:fresh,savedAt:now});
 while(cache.size>8)cache.delete(cache.keys().next().value);

 const from=frames[0].at,to=frames.at(-1).at,status=state.ended?'ended':state.paused?'paused':'streaming';
 const sessionId='browser'+createHash('sha256').update(scope+'\n'+url).digest('hex').slice(0,32);
 const executable=browser.status?.().executablePath||'';
 let audio=null;
 if(listenWindow&&browser.captureVideoAudio&&status==='streaming'){
  let sounds=soundByBrowser.get(browser);if(!sounds){sounds=new Map();soundByBrowser.set(browser,sounds);}
  const latest=sounds.get(identity);
  const same=latest&&latest.url===pageUrl&&args.at===undefined&&args.action!=='start'&&to>=latest.at&&to-latest.at<(policy.backend==='local'?12:8);
  if(same)audio=latest.audio;
  else{
   const slot={url:pageUrl,at:to,audio:null};sounds.delete(identity);sounds.set(identity,slot);
   if(sounds.size>8)sounds.delete(sounds.keys().next().value);
   try{
    const clip=await browser.captureVideoAudio(context,pageUrl,to);check();
    if(clip?.data&&sounds.get(identity)===slot)audio=await listenWindow({clip:Buffer.from(clip.data,'base64'),start:clip.start,end:clip.end},scope,context.signal);
    if(sounds.get(identity)===slot)slot.audio=audio;
   }catch{check();}
   check();
   if(sounds.get(identity)!==slot)throw Error('视频观察已被新片段替换');
   if(audio){
    const current=await browser.peekVideo(context);check();
    if(!current||!sameBrowserDestination(current.url,pageUrl)||current.currentTime<to-.5)throw Error('播放器已切换或回看，旧音轨未提交');
   }
  }
 }
 const heard=audio?'；音轨实测 '+audio.start.toFixed(1)+'–'+audio.end.toFixed(1)+' 秒':'；这次未取得音轨';
 return {ok:true,observationMode:'latest-frame',visualRevision:'20261111-latest-on-demand-v1',visualBudget:policy,url,finalUrl:pageUrl,status,mode:'browser',backend:'configured-browser',browserExecutable:executable,sessionId,continuous:false,realtimeCapture:true,requiresNext:status!=='ended',reactionMode:'on-demand',substantive:true,cursor:to,duration:state.duration,
  coverage:'通过设置中的浏览器观察真实播放器，当前画面 '+from.toFixed(1)+'–'+to.toFixed(1)+' 秒'+heard,
  observed:{deliveredFrom:from,deliveredTo:to,gap:!!previous&&previous.scope===scope&&Number(previous.at)<from-2,complete:false},
  position:{at:to,source:'configured-browser'},window:{start:from,end:to,requested:true},frames,subtitle,audio,audioDecoded:!!audio,next:status==='ended'?null:{action:'next',url,sessionId}};
}
