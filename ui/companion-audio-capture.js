// Also installed in the observed browser page via Playwright. Keep this
// function self-contained and use only the audio tracks selected by the user.
export function installCompanionAudioCapture(){
 if(globalThis.DSHRecordCompanionTrack)return;
 globalThis.DSHRecordCompanionTrack=function(stream,windowMs,onClip,onError){
  let closed=false,timer,recorder,meter,context,source;
  try{
   context=new AudioContext();
   source=context.createMediaStreamSource(stream);
   meter=context.createAnalyser();meter.fftSize=2048;source.connect(meter);
   void context.resume().catch(()=>{});
  }catch{}
  const samples=new Float32Array(2048);
  function stop(){
   closed=true;clearInterval(timer);
   if(recorder?.state==='recording')recorder.stop();
   source?.disconnect();void context?.close().catch(()=>{});
  }
  function fail(){if(!closed){stop();onError();}}
  function record(){
   if(closed)return;
   try{
    const parts=[],start=Date.now();
    let lastSound=0,measured=0,end;
    recorder=new MediaRecorder(stream,{mimeType:'audio/webm'});
    recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
    recorder.onerror=fail;
    recorder.onstop=async()=>{
     clearInterval(timer);if(closed)return;
     const finish=end||Date.now(),blob=new Blob(parts,{type:'audio/webm'});
     // If the meter could not observe the clip, retain the recorder fallback.
     const usable=lastSound||measured<(finish-start)/160;
     record();
     if(!usable||!blob.size||blob.size>512*1024)return;
     try{
      const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      if(!closed)onClip({data:btoa(binary),at:finish,startedAt:start,mediaType:'audio/webm'});
     }catch{fail();}
    };
    recorder.start();
    timer=setInterval(()=>{
     const at=Date.now();
     if(meter&&context.state==='running'){
      meter.getFloatTimeDomainData(samples);let energy=0;
      for(const value of samples)energy+=value*value;
      measured++;if(energy/samples.length>0.000009)lastSound=at;
     }
     if(at-start>=windowMs||(lastSound&&at-lastSound>=650)){
      clearInterval(timer);end=at;if(recorder.state==='recording')recorder.stop();
     }
    },60);
   }catch{fail();}
  }
  record();return stop;
 };
}
