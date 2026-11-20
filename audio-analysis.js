import {mergeSoundEvents} from './hearing-evidence.js';
import {reconcileLocalAudioEvidence} from './local-audio-evidence.js';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveVideoRuntime} from './video-runtime.js';
export function createAudioAnalysis({getRuntime,getCacheDir,authorize=()=>true,spawnImpl=spawn,apiOnly=false}={}){
 let classifying=0;
 function runtime(){const configured=getRuntime()||{};return {...configured,...resolveVideoRuntime(configured)};}
 async function enrichHearing(bytes,evidence,{signal,live=false}={}){
  const r=runtime(),model=r.hearingModelPath||join(getCacheDir(),'hearing-models','yamnet.tflite');
  if(apiOnly||!bytes?.length||bytes.length>16*1024*1024||classifying>=(live?1:2)||!r.videoPlusPythonPath||!r.ffmpegPath||!existsSync(model))return evidence;
  signal?.throwIfAborted();classifying++;
  try{
   const result=await new Promise((resolve,reject)=>{
    const worker=spawnImpl(r.videoPlusPythonPath,[fileURLToPath(new URL('./tools/hearing-events.py',import.meta.url)),model,r.ffmpegPath],{windowsHide:true,stdio:['pipe','pipe','ignore'],signal});
    let out='';const timer=setTimeout(()=>worker.kill(),live?10000:25000);
    worker.stdout.on('data',data=>{out+=data;if(out.length>32000)worker.kill();});
    worker.once('error',error=>{clearTimeout(timer);reject(error);});
    worker.once('close',code=>{clearTimeout(timer);try{if(code!==0)throw Error('声音分类未完成');resolve(JSON.parse(out));}catch(error){reject(error);}});
    worker.stdin.on('error',()=>{});worker.stdin.end(bytes);
   });
   return mergeSoundEvents(evidence,result);
  }catch(error){signal?.throwIfAborted();return evidence;}finally{classifying--;}
 }
 function status(){const r=runtime();return {available:r.enhancedAvailable,transcription:!apiOnly&&r.enhancedAvailable&&!!r.whisperModelPath&&existsSync(join(r.whisperModelPath,'model.bin')),backend:'local-audio-evidence',uploadsAudio:false};}
 async function analyze(args={},context={}){
  if(!authorize(context))throw Error('没有当前音频操作权限');const r=runtime();if(!r.enhancedAvailable)throw Error('本地音频分析需要现有FFmpeg和Python环境');
  if(!existsSync(String(args.file||'')))throw Error('请先通过DSH工具取得真实的本地音频文件，不能把网页链接当作音频路径');
  const cacheDir=join(getCacheDir(),'audio-analysis');mkdirSync(cacheDir,{recursive:true});
  const value=await new Promise((resolve,reject)=>{let out='',done=false;
   const child=spawnImpl(r.videoPlusPythonPath,[fileURLToPath(new URL('./tools/audio-inspect.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
   const timer=setTimeout(()=>{if(done)return;done=true;child.kill();reject(Error('本地音频分析超时'));},args.transcribe?240000:args.music||args.charts?180000:45000);
   const abort=()=>child.kill();context.signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',b=>{out+=String(b);if(out.length>1000000)child.kill();});child.stderr.on('data',()=>{});
   child.on('error',()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('本地音频环境无法启动'));});
   child.on('close',()=>{context.signal?.removeEventListener('abort',abort);if(done)return;done=true;clearTimeout(timer);try{const v=JSON.parse(out);if(!v.ok)throw Error(v.error||'音频分析失败');resolve(v);}catch(e){reject(e);}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...args,transcribe:args.transcribe===true&&!apiOnly,runtime:{...r,allowSoundEvents:!apiOnly,...(apiOnly?{whisperModelPath:''}:{})},cacheDir}));
  });
  if(!authorize(context))throw Error('音频处理期间权限或账号已改变，旧结果未提交');if(apiOnly&&args.transcribe)value.transcription={status:'unavailable',segments:[],note:'手机版使用 API 语音识别；这里仅完成音频测量，没有运行本地听写模型。'};return reconcileLocalAudioEvidence(value);
 }
 let videoBusy=false;
 async function videoWindow({file,clip,start,end},context){
  if(videoBusy||!status().available||!authorize(context))return null;
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end-start>12)return null;
  const offset=clip?start:0;
  let temporary='';
  videoBusy=true;
  try{
   if(clip){
    if(!Buffer.isBuffer(clip)||!clip.length||clip.length>512*1024)return null;
    const dir=join(getCacheDir(),'audio-analysis');mkdirSync(dir,{recursive:true});
    temporary=join(dir,randomUUID()+'.webm');writeFileSync(temporary,clip);file=temporary;
   }
   const result=await analyze({file,start:start-offset,end:end-offset,videoSound:true,transcribe:!apiOnly},context);
   const actualStart=result.start+offset;
   const length=result.end-result.start;
   const absolute=rows=>rows.filter(r=>r.start<length&&r.end>r.start).map(row=>({...row,start:+(actualStart+row.start).toFixed(2),end:+(actualStart+Math.min(length,row.end)).toFixed(2)}));
   let segments=absolute(result.transcription?.segments||[]);
   const checked=mergeSoundEvents({text:segments.map(s=>s.text).join(' '),labels:[]},{labels:result.soundEvents||[],speechPeak:result.speechPeak,analyzedSeconds:result.end-result.start});
   if(checked.unconfirmedTranscript)segments=[];
   return {status:segments.length?'transcribed':'measured',start:actualStart,end:result.end+offset,coveredSeconds:result.end-result.start,
    partial:true,acoustic:result.acoustic,segments,events:absolute(result.soundEvents||[])};
  }finally{videoBusy=false;if(temporary)try{unlinkSync(temporary);}catch{}}
 }
 return {analyze,status,enrichHearing,videoWindow};
}
