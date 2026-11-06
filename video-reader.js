export const VIDEO_READER_REVISION='20261106-continuous-playback-v1';
// Bounded local FFmpeg sampling. The base path has no Python dependency; the
// optional video-watch-plus pass only adds audio analysis and cut detection.
import {readFileSync,writeFileSync,mkdirSync,statSync,unlinkSync,rmdirSync,existsSync,readdirSync,realpathSync} from 'node:fs';
import {join,basename,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {resolveVideoRuntime} from './video-runtime.js';
const {createVideoPlayback}=await import(new URL('./video-playback.js'+new URL(import.meta.url).search,import.meta.url));
import {BILI_BROWSER_UA} from './bilibili-login.js';

const MAX_BYTES=32*1024*1024;
const ENHANCED_MAX_BYTES=128*1024*1024;
const MAX_DURATION_SECONDS=4*60*60;
const MAX_FRAME_BYTES=3*1024*1024;
const BILIBILI_HOSTS=['bilivideo.com','bilivideo.cn','hdslb.com'];
const BILIBILI_REFERER='https://www.bilibili.com/';

function videoError(message,code,cause){
  const error=Error(message,{cause});
  error.code=code;
  return error;
}

function abortError(cause){
  const error=Error('视频读取已取消',{cause});
  error.name='AbortError';
  error.code='ABORT_ERR';
  return error;
}

function isAbort(error,signal){
  return signal?.aborted===true||error?.name==='AbortError'||error?.code==='ABORT_ERR';
}

function throwIfAborted(signal){
  if(signal?.aborted)throw abortError(signal.reason);
}

function isHost(hostname,domains){
  const host=String(hostname||'').toLowerCase().replace(/\.$/,'');
  return domains.some(domain=>host===domain||host.endsWith('.'+domain));
}

function sourceHost(value){
  try{return new URL(value).hostname.toLowerCase().replace(/\.$/,'');}catch{return '';}
}

function trustedMedia(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&!parsed.username&&!parsed.password
      &&isHost(parsed.hostname,['qq.com','qpic.cn','qq.net']);
  }catch{return false;}
}

function bilibiliMedia(url){
  try{
    const parsed=new URL(url);
    return parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.port
      &&isHost(parsed.hostname,BILIBILI_HOSTS);
  }catch{return false;}
}

function timeoutScope(signal,timeout){
  const controller=new AbortController();
  let timedOut=false;
  const abort=()=>controller.abort(signal?.reason);
  if(signal?.aborted)abort();
  else signal?.addEventListener('abort',abort,{once:true});
  const timer=Number.isFinite(timeout)&&timeout>0
    ?setTimeout(()=>{timedOut=true;controller.abort();},timeout)
    :null;
  return{
    signal:controller.signal,
    timedOut:()=>timedOut,
    cleanup:()=>{
      if(timer)clearTimeout(timer);
      signal?.removeEventListener('abort',abort);
    },
  };
}

function run(exe,args,{timeout=10000,allowFailure=false,spawnImpl=spawn,signal,input,maxOutputBytes=2*1024*1024}={}){
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='',done=false,timer=null,child=null;
    const finish=(fn,value)=>{
      if(done)return;
      done=true;
      if(timer)clearTimeout(timer);
      signal?.removeEventListener('abort',onAbort);
      fn(value);
    };
    const onAbort=()=>{
      if(done)return;
      try{child?.kill();}catch{}
      finish(reject,abortError(signal?.reason));
    };
    try{
      child=spawnImpl(exe,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    }catch(error){
      finish(reject,videoError('视频处理工具未能启动','VIDEO_RUNTIME',error));
      return;
    }
    if(!child){
      finish(reject,videoError('视频处理工具未能启动','VIDEO_RUNTIME'));
      return;
    }
    timer=Number.isFinite(timeout)&&timeout>0
      ?setTimeout(()=>{
        try{child.kill();}catch{}
        finish(reject,videoError('视频抽帧超时','VIDEO_TIMEOUT'));
      },timeout)
      :null;
    signal?.addEventListener('abort',onAbort,{once:true});
    if(signal?.aborted){onAbort();return;}
    child.stderr?.on('data',value=>{stderr=(stderr+String(value)).slice(-16000);});
    child.stdout?.on('data',value=>{
      stdout+=String(value);
      if(stdout.length>maxOutputBytes){
        try{child.kill();}catch{}
        finish(reject,videoError('视频增强输出异常','VIDEO_ENHANCEMENT'));
      }
    });
    child.on('error',error=>{
      finish(reject,videoError('视频处理工具未能启动','VIDEO_RUNTIME',error));
    });
    child.on('close',code=>{
      if(code!==0&&!allowFailure){
        finish(reject,videoError('视频格式无法解码','VIDEO_DECODE'));
      }else{
        finish(resolve,{stdout,stderr,code});
      }
    });
    child.stdin?.on('error',()=>{});
    try{child.stdin?.end(input===undefined?'':input);}catch{}
  });
}

async function fetchBytes(url,{fetchImpl,signal,timeout=30000,maxBytes,headers={}}={}){
  throwIfAborted(signal);
  const host=sourceHost(url);
  const scope=timeoutScope(signal,timeout);
  let reader=null;
  try{
    const response=await fetchImpl(url,{redirect:'error',headers,signal:scope.signal,credentials:'omit'});
    if(!response.ok){
      const status=Number(response.status);
      const error=videoError('视频附件下载失败（HTTP '+status+(host?'，来源 '+host:'')+'）','VIDEO_RESOURCE');
      if(Number.isInteger(status)&&status>0)error.httpStatus=status;
      if(host)error.sourceHost=host;
      throw error;
    }
    const declared=Number(response.headers?.get?.('content-length'));
    if(Number.isFinite(declared)&&declared>maxBytes){
      const error=videoError('视频超过下载大小限制','VIDEO_RESOURCE');
      if(host)error.sourceHost=host;
      throw error;
    }
    const chunks=[];
    let size=0;
    if(response.body?.getReader){
      reader=response.body.getReader();
      for(;;){
        throwIfAborted(signal);
        const {done,value}=await reader.read();
        if(done)break;
        size+=value.length;
        if(size>maxBytes){
          const error=videoError('视频超过下载大小限制','VIDEO_RESOURCE');
          if(host)error.sourceHost=host;
          throw error;
        }
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks);
    }
    const bytes=Buffer.from(await response.arrayBuffer());
    if(bytes.length>maxBytes){
      const error=videoError('视频超过下载大小限制','VIDEO_RESOURCE');
      if(host)error.sourceHost=host;
      throw error;
    }
    return bytes;
  }catch(error){
    if(signal?.aborted)throw abortError(signal?.reason||error);
    if(scope.timedOut()){
      const timeoutError=videoError('视频下载超时'+(host?'（来源 '+host+'）':''),'VIDEO_TIMEOUT');
      if(host)timeoutError.sourceHost=host;
      throw timeoutError;
    }
    if(['VIDEO_RESOURCE','VIDEO_TIMEOUT','VIDEO_INVALID'].includes(error?.code)){
      if(host&&!error.sourceHost)error.sourceHost=host;
      throw error;
    }
    const fetchError=videoError('视频附件下载失败（网络连接错误'+(host?'，来源 '+host:'')+'）','VIDEO_RESOURCE');
    if(host)fetchError.sourceHost=host;
    throw fetchError;
  }finally{
    try{await reader?.cancel();}catch{}
    scope.cleanup();
  }
}

function assertVideoContainer(bytes){
  if(bytes.subarray(4,8).toString()==='ftyp'
    ||bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))
    ||bytes.subarray(0,4).toString()==='RIFF')return;
  throw videoError('附件不是支持的 MP4、MOV、WebM 或 AVI 视频','VIDEO_INVALID');
}

function platformReferences(value){
  if(typeof value==='string')return[value.trim()].filter(Boolean);
  if(!value||typeof value!=='object')return[];
  return[value.file_path,value.file,value.url]
    .filter(item=>typeof item==='string'&&item.trim())
    .map(item=>item.trim());
}

function localFileFromReference(reference){
  if(/^file:\/\//i.test(reference)){
    try{return fileURLToPath(reference);}catch{return '';}
  }
  if(/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(reference))return '';
  return reference;
}

async function readPlatformResult(value,{fetchImpl,signal,maxBytes}){
  const references=platformReferences(value);
  let untrusted=false;
  for(const reference of references){
    if(/^https?:\/\//i.test(reference)){
      if(!trustedMedia(reference)){untrusted=true;continue;}
      const bytes=await fetchBytes(reference,{fetchImpl,signal,timeout:30000,maxBytes});
      if(!bytes.length)throw videoError('视频为空','VIDEO_RESOURCE');
      assertVideoContainer(bytes);
      return{bytes,origin:'platform-url'};
    }
    const file=localFileFromReference(reference);
    if(!file)continue;
    let info;
    try{info=statSync(file);}catch{continue;}
    if(!info.isFile())continue;
    if(info.size>maxBytes)throw videoError('视频超过下载大小限制','VIDEO_RESOURCE');
    if(!info.size)throw videoError('视频为空','VIDEO_RESOURCE');
    const bytes=readFileSync(file);
    assertVideoContainer(bytes);
    return{bytes,origin:'platform-file'};
  }
  if(untrusted)throw videoError('平台返回的视频地址不可信','VIDEO_RESOURCE');
  throw videoError('视频不可读取或文件不存在','VIDEO_RESOURCE');
}

async function loadMedia(data,{getPlatformFile,fetchImpl,signal,maxBytes}){
  const source=String(data.source||'').toLowerCase();
  const file=String(data.file||'');
  const explicitUrl=String(data.url||'');
  const directUrl=explicitUrl||(/^https:\/\//i.test(file)?file:'');
  if(source==='bilibili'){
    if(!directUrl||!bilibiliMedia(directUrl))throw videoError('Bilibili 只接受已解析的 HTTPS 媒体直链','VIDEO_INVALID');
    const bytes=await fetchBytes(directUrl,{
      fetchImpl,signal,timeout:30000,maxBytes,
      headers:{Referer:BILIBILI_REFERER,'User-Agent':BILI_BROWSER_UA,Range:'bytes=0-'},
    });
    if(!bytes.length)throw videoError('视频为空','VIDEO_RESOURCE');
    assertVideoContainer(bytes);
    return{bytes,origin:'bilibili-media'};
  }
  if(explicitUrl){
    if(!trustedMedia(explicitUrl))throw videoError('该链接不是可信的直接视频地址','VIDEO_RESOURCE');
    const bytes=await fetchBytes(explicitUrl,{fetchImpl,signal,timeout:30000,maxBytes});
    if(!bytes.length)throw videoError('视频为空','VIDEO_RESOURCE');
    assertVideoContainer(bytes);
    return{bytes,origin:'trusted-url'};
  }
  if(/^https?:\/\//i.test(file)){
    if(!trustedMedia(file))throw videoError('该链接不是可信的直接视频地址','VIDEO_RESOURCE');
    const bytes=await fetchBytes(file,{fetchImpl,signal,timeout:30000,maxBytes});
    if(!bytes.length)throw videoError('视频为空','VIDEO_RESOURCE');
    assertVideoContainer(bytes);
    return{bytes,origin:'trusted-url'};
  }
  if(/^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(file)){
    throw videoError('用户提供的本地文件地址不能直接读取','VIDEO_RESOURCE');
  }
  const id=String(data.file_id||file||'');
  if(!/^[\w-]{8,160}(?:\.(?:mp4|webm|mov|mkv|avi))?$/i.test(id)){
    throw videoError('没有可读取的视频文件标识','VIDEO_RESOURCE');
  }
  const value=await getPlatformFile(id);
  throwIfAborted(signal);
  return readPlatformResult(value,{fetchImpl,signal,maxBytes});
}

function requestedWindow(data,duration,fps){
  const safeEnd=Math.max(0,duration-Math.max(.1,1/fps));
  const startValue=Number(data.start);
  const endValue=Number(data.end);
  const windowValue=Number(data.window);
  const start=Number.isFinite(startValue)&&startValue>0?Math.min(startValue,safeEnd):0;
  let end=safeEnd,requested=start>0;
  if(Number.isFinite(windowValue)&&windowValue>0){
    end=Math.min(safeEnd,start+windowValue);
    requested=true;
  }else if(Number.isFinite(endValue)&&endValue>start){
    end=Math.min(safeEnd,endValue);
    requested=true;
  }
  if(end<=start)end=Math.min(safeEnd,start+.1);
  return{start,end,requested};
}

function framePoints(window,count=4){
  if(count<=1)return[window.start];
  return[0,.33,.66,.95].map(ratio=>window.start+(window.end-window.start)*ratio);
}

function jpegPart(bytes,name){
  if(bytes.length>MAX_FRAME_BYTES||bytes[0]!==255||bytes[1]!==216){
    throw videoError('视频画面无效','VIDEO_INVALID');
  }
  return{type:'image',mediaType:'image/jpeg',name,data:bytes.toString('base64')};
}

async function readBasic(data,material,{runtime,config,dir,signal,spawnImpl}){
  const input=join(dir,'input.mp4');
  writeFileSync(input,material.bytes);
  const common=['-hide_banner','-loglevel','info','-protocol_whitelist','file,pipe'];
  const metadata=await run(runtime.ffmpegPath,[...common,'-i',input],{
    timeout:Math.min(15000,Number(config.metadataTimeoutMs)||8000),
    allowFailure:true,spawnImpl,signal,
  });
  const match=metadata.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if(!match)throw videoError('未能读取视频时长','VIDEO_INVALID');
  const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
  if(!Number.isFinite(duration)||duration<=0)throw videoError('未能读取有效的视频时长','VIDEO_INVALID');
  if(duration>MAX_DURATION_SECONDS)throw videoError('目前支持资源安全上限 4 小时以内的视频','VIDEO_INVALID');
  const fps=Number(metadata.stderr.match(/\b([\d.]+) fps\b/)?.[1])||25;
  const window=requestedWindow(data,duration,fps);
  const times=framePoints(window,4);
  const frames=[];
  const deadline=Date.now()+25000;
  for(let index=0;index<times.length;index++){
    throwIfAborted(signal);
    const file=join(dir,'frame-'+index+'.jpg');
    await run(runtime.ffmpegPath,[
      '-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe',
      '-ss',times[index].toFixed(3),'-i',input,'-map','0:v:0','-frames:v','1',
      '-vf','scale=768:768:force_original_aspect_ratio=decrease',
      '-pix_fmt','yuv420p','-q:v','4','-threads','1','-y',file,
    ],{
      timeout:Math.max(500,Math.min(7000,deadline-Date.now())),
      spawnImpl,signal,
    });
    let bytes;
    try{bytes=readFileSync(file);}catch(error){throw videoError('视频画面没有生成','VIDEO_INVALID',error);}
    frames.push({at:Math.round(times[index]*1000)/1000,part:jpegPart(bytes,'video-frame-'+index)});
  }
  return{
    duration,source:'ffmpeg-local',frames,audioDecoded:false,status:'sampled',
    window:{
      start:Math.round(window.start*1000)/1000,
      end:Math.round(window.end*1000)/1000,
      requested:window.requested,
    },
  };
}

async function readPlus(data,material,{runtime,config,dir,getCacheDir,signal,spawnImpl,mobile}){
  const request={
    outDir:dir,
    runtime:{
      ...config,
      ffmpegPath:runtime.ffmpegPath,
      ffprobePath:runtime.ffprobePath,
      allowWhisper:config.allowWhisper!==false&&config.mobile!==true&&mobile!==true,
      mobile:config.mobile===true||mobile===true,
    },
    maxFrames:Math.min(12,Math.max(4,Number(data.maxFrames)||8)),
    cacheDir:join(getCacheDir(),'videos','watch-cache'),
  };
  const start=Number(data.start);
  const window=Number(data.window);
  const end=Number(data.end);
  if(Number.isFinite(start)&&start>=0)request.start=start;
  if(Number.isFinite(window)&&window>0)request.window=Math.min(MAX_DURATION_SECONDS,window);
  else if(Number.isFinite(end)&&end>Number(request.start||0))request.window=Math.min(MAX_DURATION_SECONDS,end-Number(request.start||0));
  if(data.web===true)request.url=String(data.url||data.file||'');
  else{
    if(!material)throw videoError('视频附件尚未准备好','VIDEO_RESOURCE');
    request.media=join(dir,'input.mp4');
    writeFileSync(request.media,material.bytes);
  }
  let result;
  try{
    result=await run(runtime.videoPlusPythonPath,[fileURLToPath(new URL('./tools/video_plus.py',import.meta.url))],{
      timeout:Math.min(600000,Number(config.analysisTimeoutMs)||180000),
      spawnImpl,signal,input:JSON.stringify(request),maxOutputBytes:2*1024*1024,
    });
  }catch(error){
    if(isAbort(error,signal))throw abortError(signal?.reason||error);
    if(error?.code==='VIDEO_TIMEOUT'){
      throw videoError('视频增强分析超时，未取得的部分不能当作已观看','VIDEO_ENHANCEMENT',error);
    }
    throw videoError('本地视频增强分析未能完成','VIDEO_ENHANCEMENT',error);
  }
  let parsed;
  try{parsed=JSON.parse(result.stdout);}catch(error){throw videoError('视频增强输出无效','VIDEO_ENHANCEMENT',error);}
  if(!parsed.ok)throw videoError(parsed.error||'视频读取失败','VIDEO_ENHANCEMENT');
  const frames=[];
  for(const frame of parsed.frames||[]){
    if(typeof frame.file!=='string'||frame.file!==basename(frame.file)||!/^frame-\d+\.jpg$/.test(frame.file)){
      throw videoError('视频画面路径无效','VIDEO_ENHANCEMENT');
    }
    let bytes;
    try{bytes=readFileSync(join(dir,frame.file));}catch(error){throw videoError('视频画面没有生成','VIDEO_ENHANCEMENT',error);}
    const at=Number(frame.at);
    if(!Number.isFinite(at)||at<0)throw videoError('视频画面时间点无效','VIDEO_ENHANCEMENT');
    frames.push({at,part:jpegPart(bytes,'video-frame-'+frames.length)});
  }
  if(!frames.length)throw videoError('视频增强分析没有返回可用画面','VIDEO_ENHANCEMENT');
  return{...parsed,frames,source:parsed.source||'video-watch-plus-local'};
}

export function createVideoReader({
  getConfig,getCacheDir,getPlatformFile,fetchImpl=globalThis.fetch,spawnImpl=spawn,
  platform=process.platform,env=process.env,mobile=false,continuous=true,
}={}){
  let busy=false,closed=false;
  const playback=createVideoPlayback({spawnImpl}),streams=new Map(),preparing=new Map(),activeByScope=new Map();
  function configNow(){const c=getConfig?.()||{};return mobile?{...c,mobile:true,allowWhisper:false,whisperModelPath:''}:c;}
  function runtimeNow(){return resolveVideoRuntime(configNow(),{platform,env});}
  function enhancedReady(runtime,config){return config.videoPlus!==false&&runtime.enhancedAvailable;}
  function isMobile(config){return mobile===true||config.mobile===true;}
  function status(){
    const config=configNow(),runtime=runtimeNow(),enhanced=enhancedReady(runtime,config);
    const whisper=!isMobile(config)&&enhanced&&Boolean(config.whisperModelPath)
      &&existsSync(join(config.whisperModelPath,'model.bin'));
    return{
      revision:VIDEO_READER_REVISION,
      available:runtime.basicAvailable,
      enhanced,
      basicAvailable:runtime.basicAvailable,
      enhancedAvailable:enhanced,
      basic:{available:runtime.basicAvailable,ffmpeg:runtime.executables.ffmpeg},
      enhancedCapability:{...runtime.enhanced},
      executables:{...runtime.executables},
      executableSources:{...runtime.sources},
      webSupported:enhanced,
      web:{supported:enhanced},
      bilibiliDirectSupported:runtime.bilibiliDirectSupported,
      bilibili:{directMediaSupported:runtime.bilibiliDirectSupported,maxBytes:ENHANCED_MAX_BYTES},
      platform:runtime.platform,
      liveWindow:runtime.basicAvailable,
      continuousPlayback:continuous,frameRate:2,activeStreams:[...streams.values()].map(v=>playback.snapshot(v.id,v.scope)).filter(Boolean),
      maxBytes:enhanced?ENHANCED_MAX_BYTES:MAX_BYTES,
      maxFrames:enhanced?8:4,
      maxDurationSeconds:MAX_DURATION_SECONDS,
      audioAnalysis:enhanced&&!isMobile(config),
      source:continuous?'ffmpeg-realtime':enhanced?'video-watch-plus-local':'ffmpeg-local',
      whisper,
    };
  }
  async function readSnapshot(data={},options={}){
    const signal=options.signal||data.signal;
    throwIfAborted(signal);
    const config=configNow(),runtime=runtimeNow();
    if(!runtime.basicAvailable)throw videoError('视频抽帧工具未安装','VIDEO_RUNTIME');
    if(busy)throw videoError('正在读取另一段视频，请稍后再发','VIDEO_BUSY');
    busy=true;
    let dir='';
    try{
      dir=join(getCacheDir(),'videos','sample-'+randomUUID());
      mkdirSync(dir,{recursive:true});
      throwIfAborted(signal);
      const source=String(data.source||'').toLowerCase();
      const enhanced=enhancedReady(runtime,config);
      if(data.web===true&&source!=='bilibili'){
        if(!enhanced)throw videoError('网页视频需要可用的增强视频环境','VIDEO_ENHANCEMENT');
        return await readPlus(data,null,{runtime,config,dir,getCacheDir,signal,spawnImpl,mobile});
      }
      if(source==='bilibili'){
        const material=await loadMedia(data,{
          getPlatformFile,fetchImpl,signal,maxBytes:ENHANCED_MAX_BYTES,
        });
        throwIfAborted(signal);
        return await readBasic(data,material,{runtime,config,dir,signal,spawnImpl});
      }
      if(enhanced){
        const material=await loadMedia(data,{
          getPlatformFile,fetchImpl,signal,maxBytes:ENHANCED_MAX_BYTES,
        });
        throwIfAborted(signal);
        try{
          return await readPlus(data,material,{runtime,config,dir,getCacheDir,signal,spawnImpl,mobile:isMobile(config)});
        }catch(error){
          if(isAbort(error,signal))throw abortError(signal?.reason||error);
          if(['VIDEO_RESOURCE','ABORT_ERR'].includes(error?.code))throw error;
          throwIfAborted(signal);
          return await readBasic(data,material,{runtime,config,dir,signal,spawnImpl});
        }
      }
      const material=await loadMedia(data,{getPlatformFile,fetchImpl,signal,maxBytes:MAX_BYTES});
      throwIfAborted(signal);
      return await readBasic(data,material,{runtime,config,dir,signal,spawnImpl});
    }finally{
      try{
        if(dir&&existsSync(dir))for(const name of readdirSync(dir)){
          try{const file=join(dir,name);if(statSync(file).isFile())unlinkSync(file);}catch{}
        }
      }catch{}
      try{if(dir&&existsSync(dir))rmdirSync(dir);}catch{}
      busy=false;
    }
  }
  const scopeFor=data=>String(data.streamScope||'standalone');
  const identityFor=data=>String(data.mediaId||data.file_id||data.file||data.url||'');
  function streamIdentity(data){const scope=scopeFor(data),media=identityFor(data);if(!media)throw videoError('需要视频来源','VIDEO_RESOURCE');return {scope,id:createHash('sha256').update(scope+'\0'+media).digest('hex')};}
  function discard(id){const entry=streams.get(id);if(!entry)return;try{playback.control(id,'stop',{scope:entry.scope});}finally{streams.delete(id);if(activeByScope.get(entry.scope)===id)activeByScope.delete(entry.scope);}}
  function reset(){close();closed=false;}
  function close(){closed=true;for(const p of preparing.values())p.controller.abort();playback.close();streams.clear();activeByScope.clear();}
  function control({action='status',streamScope='standalone',sessionId='',at}={}){
    const scope=String(streamScope),id=sessionId||activeByScope.get(scope);if(!id)return {ok:true,status:'stopped',frames:[]};
    const entry=streams.get(id);if(!entry||entry.scope!==scope)throw videoError('视频会话不属于当前对话','VIDEO_SCOPE');
    entry.usedAt=Date.now();if(action==='stop'){discard(id);return {ok:true,status:'stopped',sessionId:id,frames:[]};}
    const snapshot=action==='status'?playback.snapshot(id,scope):playback.control(id,action,{scope,at});if(action==='seek')entry.cursor=-Infinity;
    return {ok:true,...snapshot,sessionId:id,frames:[]};
  }
  async function prepareStream(data,{signal,id,scope}){
    const runtime=runtimeNow(),config=configNow();if(!runtime.basicAvailable)throw videoError('视频抽帧工具未安装','VIDEO_RUNTIME');
    const directory=join(getCacheDir(),'videos','playback-'+randomUUID());mkdirSync(directory,{recursive:true});let ownedFile='',started=false;
    const cleanup=()=>{try{if(ownedFile&&existsSync(ownedFile))unlinkSync(ownedFile);}catch{}try{rmdirSync(directory);}catch{}};
    try{
      let file='';
      if(data.web===true&&data.source!=='bilibili'){
        if(!enhancedReady(runtime,config))throw videoError('这个网站的视频需要可用的下载组件','VIDEO_ENHANCEMENT');
        const request={outDir:directory,runtime:{...config,ffmpegPath:runtime.ffmpegPath,ffprobePath:runtime.ffprobePath,allowWhisper:false,mobile:isMobile(config)},cacheDir:join(getCacheDir(),'videos','watch-cache'),url:data.url,resolveOnly:true};
        const output=await run(runtime.videoPlusPythonPath,[fileURLToPath(new URL('./tools/video_plus.py',import.meta.url))],{spawnImpl,signal,input:JSON.stringify(request),timeout:Math.min(180000,Number(config.analysisTimeoutMs)||90000)});
        let parsed;try{parsed=JSON.parse(output.stdout);}catch{throw videoError('网站视频下载没有返回有效文件','VIDEO_RESOURCE');}
        if(parsed.ok!==true||typeof parsed.media!=='string')throw videoError('未取得可读取的网站视频文件','VIDEO_RESOURCE');
        const root=realpathSync(getCacheDir())+sep,candidate=realpathSync(parsed.media);if(!candidate.startsWith(root)||!existsSync(candidate)||!statSync(candidate).isFile()||statSync(candidate).size>ENHANCED_MAX_BYTES)throw videoError('网站视频文件未通过核对','VIDEO_INVALID');file=candidate;
      }else{
        const material=await loadMedia(data,{getPlatformFile,fetchImpl,signal,maxBytes:ENHANCED_MAX_BYTES});throwIfAborted(signal);
        ownedFile=join(directory,'input.mp4');writeFileSync(ownedFile,material.bytes);file=ownedFile;
      }
      const metadata=await run(runtime.ffmpegPath,['-hide_banner','-loglevel','info','-protocol_whitelist','file,pipe','-i',file],{spawnImpl,signal,timeout:10000,allowFailure:true});
      const m=metadata.stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/),duration=m?Number(m[1])*3600+Number(m[2])*60+Number(m[3]):0;if(!duration||duration>MAX_DURATION_SECONDS)throw videoError('未取得可支持的视频时长','VIDEO_INVALID');throwIfAborted(signal);
      if(closed)throw abortError();
      // Incoming requests replace old sources in this conversation; keep decode resources bounded.
      const old=activeByScope.get(scope);if(old&&old!==id)discard(old);
      const max=isMobile(config)?2:4;while(streams.size>=max){const oldest=[...streams.values()].sort((a,b)=>a.usedAt-b.usedAt)[0];discard(oldest.id);}
      playback.start({id,scope,file,ffmpegPath:runtime.ffmpegPath,duration,start:Number(data.start)||0,cleanup});started=true;
      const entry={id,scope,cursor:-Infinity,usedAt:Date.now()};streams.set(id,entry);activeByScope.set(scope,id);return entry;
    }finally{if(!started)cleanup();}
  }
  async function readContinuous(data={},options={}){
    const signal=options.signal||data.signal;throwIfAborted(signal);if(closed)throw abortError();
    const {scope,id}=streamIdentity(data);if(data.restart===true&&streams.has(id))discard(id);let entry=streams.get(id);
    if(!entry){let pending=preparing.get(id);if(!pending){const controller=new AbortController(),combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;pending={controller,promise:null};pending.promise=prepareStream(data,{signal:combined,id,scope}).finally(()=>{if(preparing.get(id)===pending)preparing.delete(id);});preparing.set(id,pending);}entry=await pending.promise;}
    throwIfAborted(signal);entry.usedAt=Date.now();
    if(Number.isFinite(Number(data.start))&&data.start!==undefined){const snap=playback.snapshot(id,scope);if(snap&&Math.abs((Number(snap.at)||0)-Number(data.start))>2){playback.control(id,'seek',{scope,at:Number(data.start)});entry.cursor=-Infinity;}}
    const result=await playback.read(id,{scope,after:entry.cursor,waitMs:Math.min(5000,Math.max(0,Number(data.waitMs)||2200)),minFrames:4,signal});
    if(result.status==='failed'){discard(id);throw videoError('视频连续解码失败','VIDEO_DECODE');}
    if(Number.isFinite(result.cursor))entry.cursor=result.cursor;
    return {...result,source:'ffmpeg-realtime',mode:'continuous',continuous:true,positionSource:data.positionSource||'decoder-clock',audioDecoded:false};
  }

  return{read:continuous?readContinuous:readSnapshot,status,control,close,reset};
}
