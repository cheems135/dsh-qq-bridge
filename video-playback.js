import {spawn} from 'node:child_process';

const SOI=Buffer.from([0xff,0xd8]);
const EOI=Buffer.from([0xff,0xd9]);
const EMPTY=Buffer.alloc(0);
const MAX_WAIT_MS=30000;
const SESSION_ID=/^(?:[a-f0-9]{64}|[A-Za-z0-9]{1,100})$/;

function playbackError(message,code,cause){
  const error=Error(message,{cause});
  error.code=code;
  return error;
}

function abortError(cause){
  const error=Error('视频播放读取已取消',{cause});
  error.name='AbortError';
  error.code='ABORT_ERR';
  return error;
}

function assertSessionId(id){
  if(typeof id!=='string'||!SESSION_ID.test(id)){
    throw playbackError('视频播放会话标识无效','VIDEO_PLAYBACK_INVALID');
  }
}

function clampTime(value,duration){
  if(!Number.isFinite(value))return 0;
  return Math.max(0,Math.min(duration,value));
}

function selectedFrames(session,after){
  return session.ring.filter(frame=>frame.at>after);
}

function publicRange(range,step){
  const end=range.end===range.start?range.start+step:range.end;
  return{start:range.start,end};
}

function publicError(error){
  if(!error)return null;
  return{code:error.code,message:error.message};
}

export function createVideoPlayback({
  spawnImpl=spawn,
  now=Date.now,
  fps=2,
  maxFrames=12,
  maxFrameBytes=512*1024,
}={}){
  if(typeof spawnImpl!=='function'||typeof now!=='function'){
    throw playbackError('视频播放参数无效','VIDEO_PLAYBACK_INVALID');
  }
  if(!Number.isFinite(fps)||fps<=0
    ||!Number.isSafeInteger(maxFrames)||maxFrames<=0
    ||!Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<=0){
    throw playbackError('视频播放参数无效','VIDEO_PLAYBACK_INVALID');
  }

  const frameStep=1/fps;
  const sessions=new Map();

  function snapshot(session){
    return{
      id:session.id,
      scope:session.scope,
      status:session.status,
      at:session.at,
      decodedFrames:session.decodedFrames,
      duration:session.duration,
      observed:session.observed.map(range=>publicRange(range,frameStep)),
      observedRanges:session.observed.map(range=>publicRange(range,frameStep)),
      error:publicError(session.error),
      frameRate:fps,
      audioDecoded:false,
    };
  }

  function notify(session){
    for(const waiter of [...session.waiters]){
      if(session.status!=='streaming'
        ||selectedFrames(session,waiter.after).length>=waiter.minFrames){
        waiter.settle();
      }
    }
  }

  function readResult(session,after){
    const frames=selectedFrames(session,after);
    for(const frame of frames)frame.delivered=true;
    const materials=frames.map(frame=>({
      at:frame.at,
      part:{
        type:'image',
        mediaType:'image/jpeg',
        data:frame.bytes.toString('base64'),
        name:frame.name,
      },
    }));
    const decodedFrom=session.ring[0]?.at??null;
    const decodedTo=session.ring.at(-1)?.at??null;
    const windowStart=frames[0]?.at??session.at;
    const windowEnd=frames.at(-1)?.at??session.at;
    return{
      status:session.status,
      sessionId:session.id,
      duration:session.duration,
      frames:materials,
      window:{start:windowStart,end:windowEnd,requested:true},
      coverage:{
        decodedFrom,
        decodedTo,
        deliveredFrom:frames[0]?.at??null,
        deliveredTo:frames.at(-1)?.at??null,
        gap:session.gap,
        complete:false,
      },
      cursor:frames.at(-1)?.at??null,
      frameRate:fps,
      audioDecoded:false,
      error:publicError(session.error),
    };
  }

  function resetParser(session){
    session.parser={inFrame:false,buffer:EMPTY,junkBytes:0};
  }

  function resetRing(session){
    session.ring=[];
    session.gap=false;
    session.currentRange=null;
    resetParser(session);
  }

  function addFrame(session,bytes,localIndex){
    const at=session.decodeStart+localIndex/fps;
    const ordinal=session.nextFrameOrdinal++;
    const frame={
      ordinal,
      at,
      bytes,
      name:'video-frame-'+ordinal+'.jpg',
      delivered:false,
    };
    session.ring.push(frame);
    while(session.ring.length>maxFrames){
      const discarded=session.ring.shift();
      if(!discarded.delivered)session.gap=true;
    }
    session.decodedFrames++;
    session.at=at;
    session.lastDecodedAt=at;
    session.updatedAt=now();
    if(!session.currentRange){
      session.currentRange={start:at,end:at+frameStep};
      session.observed.push(session.currentRange);
    }else{
      session.currentRange.end=Math.max(session.currentRange.end,at+frameStep);
    }
    notify(session);
  }

  function failSession(session,message,{kill=true}={}){
    if(session.status==='failed'||session.status==='ended'||session.status==='paused')return;
    const child=session.process;
    session.process=null;
    session.status='failed';
    session.error=playbackError(message,'VIDEO_DECODE');
    session.updatedAt=now();
    resetParser(session);
    if(child&&kill){
      try{child.kill();}catch{}
    }
    notify(session);
  }

  function endSession(session,child){
    if(session.process!==child)return;
    session.process=null;
    session.status='ended';
    session.updatedAt=now();
    resetParser(session);
    try{child.kill();}catch{}
    notify(session);
  }

  function consumeJpegChunk(session,chunk){
    const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(String(chunk),'latin1');
    let offset=0;
    while(offset<bytes.length){
      if(!session.parser.inFrame){
        if(session.parser.buffer.length===1&&session.parser.buffer[0]===0xff&&bytes[offset]===0xd8){
          session.parser.inFrame=true;
          session.parser.buffer=Buffer.from(SOI);
          session.parser.junkBytes=0;
          offset++;
          continue;
        }
        const marker=bytes.indexOf(SOI,offset);
        if(marker<0){
          const skipped=bytes.length-offset;
          if(session.parser.junkBytes+skipped>maxFrameBytes){
            failSession(session,'视频解码流异常');
            return;
          }
          session.parser.junkBytes+=skipped;
          session.parser.buffer=bytes[bytes.length-1]===0xff
            ?Buffer.from([0xff])
            :EMPTY;
          return;
        }
        if(session.parser.junkBytes+marker-offset>maxFrameBytes){
          failSession(session,'视频解码流异常');
          return;
        }
        session.parser.inFrame=true;
        session.parser.buffer=Buffer.from(SOI);
        session.parser.junkBytes=0;
        offset=marker+SOI.length;
        continue;
      }

      if(session.parser.buffer[session.parser.buffer.length-1]===0xff
        &&offset<bytes.length&&bytes[offset]===0xd9){
        if(session.parser.buffer.length+1>maxFrameBytes){
          failSession(session,'视频解码流异常');
          return;
        }
        session.parser.buffer=Buffer.concat([
          session.parser.buffer,
          bytes.subarray(offset,offset+1),
        ]);
        offset++;
        const frame=session.parser.buffer;
        session.parser={inFrame:false,buffer:EMPTY,junkBytes:0};
        addFrame(session,frame,session.localDecodeIndex++);
        continue;
      }

      const marker=bytes.indexOf(EOI,offset);
      if(marker>=0){
        const take=marker+EOI.length-offset;
        if(session.parser.buffer.length+take>maxFrameBytes){
          failSession(session,'视频解码流异常');
          return;
        }
        session.parser.buffer=Buffer.concat([
          session.parser.buffer,
          bytes.subarray(offset,marker+EOI.length),
        ]);
        offset=marker+EOI.length;
        const frame=session.parser.buffer;
        session.parser={inFrame:false,buffer:EMPTY,junkBytes:0};
        addFrame(session,frame,session.localDecodeIndex++);
        continue;
      }

      const take=bytes.length-offset;
      if(session.parser.buffer.length+take>maxFrameBytes){
        failSession(session,'视频解码流异常');
        return;
      }
      session.parser.buffer=Buffer.concat([
        session.parser.buffer,
        bytes.subarray(offset),
      ]);
      return;
    }
  }

  function launch(session,start){
    if(session.process){
      const previous=session.process;
      session.process=null;
      try{previous.kill();}catch{}
    }
    session.decodeStart=start;
    session.at=start;
    session.localDecodeIndex=0;
    session.currentRange=null;
    session.status='streaming';
    session.error=null;
    session.updatedAt=now();
    resetParser(session);

    const args=[
      '-hide_banner','-loglevel','error','-re',
      '-ss',String(start),
      '-i',session.file,
      '-an',
      '-vf','fps='+fps+',scale=512:512:force_original_aspect_ratio=decrease',
      '-q:v','5',
      '-threads','1',
      '-f','image2pipe',
      '-vcodec','mjpeg',
      'pipe:1',
    ];
    let child;
    try{
      child=spawnImpl(session.ffmpegPath,args,{
        windowsHide:true,
        stdio:['ignore','pipe','pipe'],
      });
    }catch{
      failSession(session,'视频解码器不可用');
      return;
    }
    if(!child||typeof child.on!=='function'){
      failSession(session,'视频解码器不可用');
      return;
    }
    session.process=child;
    const isCurrent=()=>session.process===child;
    child.stdout?.on?.('data',chunk=>{
      if(isCurrent())consumeJpegChunk(session,chunk);
    });
    child.stdout?.on?.('error',()=>{
      if(isCurrent())failSession(session,'视频解码流异常');
    });
    // stdout can close before a failing process reports its exit code.
    // Only the process close event establishes successful end of playback.
    child.stderr?.on?.('data',()=>{});
    child.stderr?.on?.('error',()=>{});
    child.on('error',()=>{
      if(isCurrent())failSession(session,'视频解码器不可用');
    });
    child.on('close',code=>{
      if(!isCurrent())return;
      if(code===0)endSession(session,child);
      else failSession(session,'视频解码失败',{kill:false});
    });
  }

  function getSession(id,scope){
    assertSessionId(id);
    const session=sessions.get(id);
    if(!session){
      throw playbackError('视频播放会话不存在','VIDEO_PLAYBACK_NOT_FOUND');
    }
    if(session.scope!==scope){
      throw playbackError('视频播放会话作用域不匹配','VIDEO_PLAYBACK_SCOPE');
    }
    return session;
  }

  function start(options={}){
    const{id,scope,file,ffmpegPath,duration,start:startValue=0,cleanup=()=>{}}=options;
    assertSessionId(id);
    const existing=sessions.get(id);
    if(existing){
      if(existing.scope!==scope){
        throw playbackError('视频播放会话作用域不匹配','VIDEO_PLAYBACK_SCOPE');
      }
      return snapshot(existing);
    }
    if(typeof scope!=='string'||!scope||scope.length>256
      ||typeof file!=='string'||!file
      ||typeof ffmpegPath!=='string'||!ffmpegPath
      ||typeof cleanup!=='function'
      ||!Number.isFinite(duration)||duration<0
      ||!Number.isFinite(startValue)){
      throw playbackError('视频播放参数无效','VIDEO_PLAYBACK_INVALID');
    }

    const safeStart=clampTime(startValue,duration);
    const session={
      id,
      scope,
      file,
      ffmpegPath,
      duration,
      at:safeStart,
      decodeStart:safeStart,
      status:'streaming',
      decodedFrames:0,
      nextFrameOrdinal:0,
      localDecodeIndex:0,
      lastDecodedAt:null,
      ring:[],
      gap:false,
      observed:[],
      currentRange:null,
      parser:{inFrame:false,buffer:EMPTY,junkBytes:0},
      waiters:new Set(),
      cleanup,
      cleaned:false,
      process:null,
      error:null,
      startedAt:now(),
      updatedAt:now(),
    };
    sessions.set(id,session);
    launch(session,safeStart);
    return snapshot(session);
  }

  function read(id,options={}){
    const session=getSession(id,options.scope);
    const signal=options.signal;
    if(signal?.aborted)throw abortError(signal.reason);
    const after=options.after===undefined?-Infinity:Number(options.after);
    if(Number.isNaN(after)){
      throw playbackError('视频播放读取游标无效','VIDEO_PLAYBACK_INVALID');
    }
    const requestedMin=Number(options.minFrames);
    const minFrames=Number.isFinite(requestedMin)
      ?Math.max(0,Math.min(maxFrames,Math.floor(requestedMin)))
      :4;
    const requestedWait=Number(options.waitMs);
    const waitMs=Number.isFinite(requestedWait)
      ?Math.max(0,Math.min(MAX_WAIT_MS,Math.floor(requestedWait)))
      :2500;

    if(session.status!=='streaming'||selectedFrames(session,after).length>=minFrames
      ||waitMs===0){
      return Promise.resolve(readResult(session,after));
    }

    return new Promise((resolve,reject)=>{
      let timer=null;
      let finished=false;
      const waiter={
        after,
        minFrames,
        settle(){
          if(finished)return;
          finished=true;
          session.waiters.delete(waiter);
          if(timer)clearTimeout(timer);
          signal?.removeEventListener?.('abort',onAbort);
          resolve(readResult(session,after));
        },
      };
      const onAbort=()=>{
        if(finished)return;
        finished=true;
        session.waiters.delete(waiter);
        if(timer)clearTimeout(timer);
        signal?.removeEventListener?.('abort',onAbort);
        reject(abortError(signal?.reason));
      };
      session.waiters.add(waiter);
      signal?.addEventListener?.('abort',onAbort,{once:true});
      timer=setTimeout(()=>waiter.settle(),waitMs);
      if(selectedFrames(session,after).length>=minFrames
        ||session.status!=='streaming'){
        waiter.settle();
      }
    });
  }

  function control(id,action,options={}){
    const session=getSession(id,options.scope);
    if(!['pause','resume','seek','stop'].includes(action)){
      throw playbackError('视频播放控制操作无效','VIDEO_PLAYBACK_INVALID');
    }
    if(action==='pause'){
      if(session.status==='streaming'){
        const child=session.process;
        session.process=null;
        session.status='paused';
        session.currentRange=null;
        session.updatedAt=now();
        resetParser(session);
        if(child){
          try{child.kill();}catch{}
        }
        notify(session);
      }
      return snapshot(session);
    }
    if(action==='resume'){
      if(session.status==='streaming')return snapshot(session);
      const resumeAt=clampTime(
        (session.lastDecodedAt===null?session.at:session.lastDecodedAt+frameStep),
        session.duration,
      );
      launch(session,resumeAt);
      return snapshot(session);
    }
    if(action==='seek'){
      const at=Number(options.at);
      if(!Number.isFinite(at)){
        throw playbackError('视频播放定位时间无效','VIDEO_PLAYBACK_INVALID');
      }
      resetRing(session);
      launch(session,clampTime(at,session.duration));
      return snapshot(session);
    }

    const child=session.process;
    session.process=null;
    session.status='paused';
    session.updatedAt=now();
    session.cleaned=true;
    resetParser(session);
    if(child){
      try{child.kill();}catch{}
    }
    notify(session);
    const result=snapshot(session);
    sessions.delete(id);
    try{
      const cleanupResult=session.cleanup();
      cleanupResult?.catch?.(()=>{});
    }catch{}
    return result;
  }

  function snapshotById(id,scope){
    return snapshot(getSession(id,scope));
  }

  function close(){
    for(const session of [...sessions.values()]){
      control(session.id,'stop',{scope:session.scope});
    }
  }

  return{
    start,
    read,
    control,
    snapshot:snapshotById,
    close,
  };
}
