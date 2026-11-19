(function(global){
 'use strict';
 let active=null;
 function info(){return active?{key:active.key,id:active.id,label:active.label,paused:active.paused,audio:active.stream.getAudioTracks().length>0}:null;}
 async function stop(notify=true){const state=active;if(!state)return;active=null;state.stopped=true;clearTimeout(state.timer);state.stopCapture?.();state.stream.getTracks().forEach(t=>t.stop());state.video.srcObject=null;if(notify)try{await state.api('POST','/im-bridge/visual-session',{key:state.key,action:'stop',id:state.id});}catch{}}
 async function start({api,key,mode='watch',audio=true,onStatus=()=>{}}){
  if(!global.navigator.mediaDevices?.getDisplayMedia)throw Error('当前窗口不支持系统共享选择器，请在 Edge 中打开这个本地面板再选择屏幕或窗口');
  // Must run directly from the click handler, before any network await.
  let stream;
  try{stream=await global.navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:2,max:5}},audio:audio,systemAudio:audio?'include':'exclude',selfBrowserSurface:'exclude',surfaceSwitching:'include'});}catch(error){throw Error(error.name==='NotAllowedError'?'没有开始共享：选择已取消，或系统未允许捕获':error.name==='NotReadableError'?'系统暂时无法读取所选画面，请确认窗口可用且没有受保护播放限制':'屏幕共享没有开始：'+error.message);}
  await stop(true);
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;
  const track=stream.getVideoTracks()[0];
  const state={stream,video,key,api,label:track.label||'所选画面',stopped:false,paused:false,latestAudio:null};active=state;
  try{
   const response=await api('POST','/im-bridge/visual-session',{key,action:'start',target:'shared',mode,control:false,audio,sourceLabel:state.label});
   state.id=response.session.id;state.token=response.shareToken;state.budget=response.session.budget;
   await video.play();
   if(!state.token)throw Error('后台未提供共享接收凭据，请重新加载新版插件');
   track.addEventListener('ended',()=>{if(active===state){void stop(true);onStatus('共享已结束，陪伴已停止');}},{once:true});
   if(stream.getAudioTracks().length&&global.MediaRecorder){
    const audioStream=new MediaStream(stream.getAudioTracks());
    const {installCompanionAudioCapture}=await import('./companion-audio-capture.js');
    if(state.stopped)return;installCompanionAudioCapture();
    state.stopCapture=global.DSHRecordCompanionTrack(audioStream,state.budget.inferMs,chunk=>{if(!state.latestAudio||chunk.at>state.latestAudio.at)state.latestAudio=chunk;},()=>onStatus('共享音轨无法读取，画面仍在继续'));
   }
   const canvas=document.createElement('canvas'),thumb=document.createElement('canvas');thumb.width=16;thumb.height=9;
   const capture=async()=>{
    if(state.stopped||active!==state)return;
    try{
     if(video.videoWidth&&video.videoHeight){
      const ratio=Math.min(1,state.budget.maxEdge/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.max(1,Math.round(video.videoWidth*ratio));canvas.height=Math.max(1,Math.round(video.videoHeight*ratio));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
      const c=thumb.getContext('2d',{willReadFrequently:true});c.drawImage(video,0,0,16,9);const pixels=c.getImageData(0,0,16,9).data;
      const frame={data:canvas.toDataURL('image/jpeg',state.budget.quality/100).split(',')[1],capturedAt:Date.now(),signature:Array.from({length:144},(_,i)=>Math.round((pixels[i*4]+pixels[i*4+1]+pixels[i*4+2])/3)),displaySurface:track.getSettings?.().displaySurface||'monitor',audioState:state.latestAudio?'captured':'not-captured',...(state.latestAudio?{audioChunk:state.latestAudio}:{})};state.latestAudio=null;
      await api('POST','/im-bridge/visual-session',{action:'frame',key,token:state.token,sessionId:state.id,frame});
     }
    }catch(error){onStatus('共享传输已停止：'+error.message);await stop(false);return;}
    if(!state.stopped)state.timer=setTimeout(capture,state.budget.sampleMs);
   };
   void capture();onStatus('正在共享：'+state.label+(stream.getAudioTracks().length?' · 已取得共享音轨':' · 当前没有共享音轨'));return info();
  }catch(error){await stop(true);throw error;}
 }
 global.addEventListener?.('pagehide',()=>{const state=active;if(state){void stop(false);global.fetch('/im-bridge/visual-session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:state.key,action:'stop',id:state.id}),keepalive:true}).catch(()=>{});}});
 global.DSHVisualShare={start,stop,info};
})(globalThis);
