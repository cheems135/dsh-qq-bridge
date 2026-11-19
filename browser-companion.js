import {installCompanionAudioCapture} from './ui/companion-audio-capture.js';
// Browser-owned recent audio and current visual state. No microphone or desktop
// audio is opened. Unsupported/cross-origin media reports missing audio honestly.
export async function captureBrowserCompanion(page,context,budget,{audio=false}={}){
 if(audio)await page.evaluate(installCompanionAudioCapture);
 const state=await page.evaluate(({id,audio,windowMs})=>{
  const videos=[...document.querySelectorAll('video')].filter(v=>v.getBoundingClientRect().width>0),video=videos[0];
  let signature=null;
  const source=video||document.querySelector('canvas');
  if(source)try{const canvas=document.createElement('canvas');canvas.width=16;canvas.height=9;const c=canvas.getContext('2d');c.drawImage(source,0,0,16,9);const pixels=c.getImageData(0,0,16,9).data;signature=Array.from({length:144},(_,i)=>Math.round((pixels[i*4]+pixels[i*4+1]+pixels[i*4+2])/3));}catch{}
  const subtitle=video?Array.from(video.textTracks||[]).flatMap(track=>Array.from(track.activeCues||[]).map(cue=>cue.text||'')).join('\n').slice(0,2000):'';
  let audioState='not-requested',audioChunk=null;
  const old=globalThis.__bridgeCompanionAudio;
  if(old&&(old.id!==id||old.video!==video||!audio)){old.stop();delete globalThis.__bridgeCompanionAudio;}
  if(audio&&video){
   let current=globalThis.__bridgeCompanionAudio;
   if(!current){
    current={id,video,status:'starting',stopped:false,latest:null,stop(){this.stopped=true;this.stopCapture?.();this.stream?.getTracks().forEach(t=>t.stop());this.latest=null;}};
    globalThis.__bridgeCompanionAudio=current;
    try{
     const source=video.captureStream?.()||video.mozCaptureStream?.(),tracks=source?.getAudioTracks()||[];
     if(!tracks.length)throw Error('no-player-audio-track');
     current.stream=new MediaStream(tracks);current.status='buffering';
     current.stopCapture=globalThis.DSHRecordCompanionTrack(current.stream,windowMs,chunk=>{if(!current.latest||chunk.at>current.latest.at)current.latest=chunk;current.status='captured';},()=>{current.status='unavailable';current.stop();});
    }catch{current.status='unavailable';current.stop();}
   }
   audioState=current.status;audioChunk=current.latest;current.latest=null;
  }else if(audio)audioState='no-player';
  document.querySelectorAll('canvas').forEach(canvas=>{if(!canvas.hasAttribute('tabindex'))canvas.tabIndex=0;});
  const refs=Array.from(document.querySelectorAll('canvas[data-qqbridge-ref]')).map(e=>({type:'canvas',ref:e.getAttribute('data-qqbridge-ref')}));
  return {url:location.href,title:document.title,signature,subtitle,at:video?Number(video.currentTime)||0:null,ended:video?.ended===true,audioState,audioChunk,elements:refs};
 },{id:context.visualSessionId,audio,windowMs:budget.inferMs});
 const cdp=await page.context().newCDPSession(page);
 try{
  const {width,height}=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));
  const result=await cdp.send('Page.captureScreenshot',{format:'jpeg',quality:budget.quality,clip:{x:0,y:0,width,height,scale:Math.min(1,budget.maxEdge/Math.max(width,height))},captureBeyondViewport:false});
  if(page.url()!==state.url)throw Error('截图期间页面已变化');
  if(Buffer.byteLength(result.data,'base64')>768*1024)throw Error('当前画面超过视听预算');
  return {...state,data:result.data,mediaType:'image/jpeg',capturedAt:Date.now(),coverage:'当前浏览器画面'+(state.subtitle?'及播放器实际字幕':'；未取得播放器字幕')+'；音轨状态：'+state.audioState};
 }finally{await cdp.detach();}
}
export async function stopBrowserCompanion(page,id){await page.evaluate(id=>{const state=globalThis.__bridgeCompanionAudio;if(state?.id===id){state.stop();delete globalThis.__bridgeCompanionAudio;}},id).catch(()=>{});}
