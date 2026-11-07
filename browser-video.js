import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {browserUrl,sameBrowserDestination} from './browser-controller.js';

// Desktop watching always opens the configured browser through the common
// controller. There is deliberately no decoder or alternate-browser fallback.
export async function readBrowserVideo({browser,args={},context={},scope='',previous,authorize=()=>true,readFile=readFileSync,sleep=ms=>delay(ms,undefined,{signal:context.signal})}={}){
 const check=()=>{context.signal?.throwIfAborted();if(!authorize(context))throw Error('视频观察期间会话或浏览器权限已改变');};
 check();const url=browserUrl(args.url);
 const before=await browser.peekVideo(context);
 const continuing=before&&previous?.mode==='browser'&&previous.scope===scope&&
  (sameBrowserDestination(before.url,url)||sameBrowserDestination(previous.url,url)&&sameBrowserDestination(before.url,previous.finalUrl||previous.url));
 const opened=await browser.act({action:'navigate',url},context);check();
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
 if(!continuing||args.action==='start'){
  await browser.act({action:'play'},context);check();player=await browser.peekVideo(context);
 }
 const frames=[];let state=player;
 for(let i=0;i<3;i++){
  check();state=await browser.peekVideo(context);
  if(!state||!sameBrowserDestination(state.url,pageUrl))throw Error('浏览器已切换视频，本轮停止旧视频观察');
  const at=Number(state.currentTime);
  if(!Number.isFinite(at)||at<0)throw Error('浏览器没有返回有效播放位置');
  if(i&&at===frames.at(-1).at)break;
  const shot=await browser.act({action:'screenshot'},context);check();
  if(shot.url&&!sameBrowserDestination(shot.url,pageUrl))throw Error('截图时浏览器已切换视频，未采用旧视频画面');
  const bytes=readFile(shot.file);
  if(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('浏览器未返回有效视频截图');
  frames.push({at,part:{type:'image',mediaType:'image/png',name:'live-player-'+i,data:bytes.toString('base64')}});
  if(state.paused||state.ended)break;
  if(i<2)await sleep(500);
 }
 check();if(!frames.length)throw Error('指定浏览器没有返回实际画面');
 const from=frames[0].at,to=frames.at(-1).at,status=state.ended?'ended':state.paused?'paused':'streaming';
 const sessionId='browser'+createHash('sha256').update(scope+'\n'+url).digest('hex').slice(0,32);
 const executable=browser.status?.().executablePath||'';
 return {ok:true,url,finalUrl:pageUrl,status,mode:'browser',backend:'configured-browser',browserExecutable:executable,sessionId,continuous:true,substantive:true,cursor:to,duration:state.duration,
  coverage:'通过设置中的浏览器观察真实播放器，当前画面 '+from.toFixed(1)+'–'+to.toFixed(1)+' 秒；不代表看过未观察的时间段或已听音轨。',
  observed:{deliveredFrom:from,deliveredTo:to,gap:!!previous&&previous.scope===scope&&Number(previous.at)<from-2,complete:false},
  position:{at:to,source:'configured-browser'},window:{start:from,end:to,requested:true},frames,audioDecoded:false,next:status==='ended'?null:{action:'next',url,sessionId}};
}
