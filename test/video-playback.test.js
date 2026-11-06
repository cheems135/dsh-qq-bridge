import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createVideoPlayback} from '../video-playback.js';

function jpeg(size=32,tag=0){
  const bytes=Buffer.alloc(Math.max(6,size),tag);
  bytes[0]=0xff;
  bytes[1]=0xd8;
  bytes[bytes.length-2]=0xff;
  bytes[bytes.length-1]=0xd9;
  return bytes;
}

function mockSpawn(){
  const calls=[];
  const spawnImpl=(exe,args,options)=>{
    const child=new EventEmitter();
    child.stdout=new EventEmitter();
    child.stderr=new EventEmitter();
    const call={exe,args,options,child,killed:0};
    child.kill=()=>{
      call.killed++;
      setImmediate(()=>child.emit('close',255));
      return true;
    };
    calls.push(call);
    return child;
  };
  return{calls,spawnImpl};
}

function emitSplit(call,bytes,sizes=[1,2,3,5,8,13]){
  let offset=0;
  let index=0;
  while(offset<bytes.length){
    const size=sizes[index++%sizes.length];
    call.child.stdout.emit('data',bytes.subarray(offset,offset+size));
    offset+=size;
  }
}

function channel(spawnImpl){
  return createVideoPlayback({spawnImpl,fps:2,maxFrames:12,maxFrameBytes:1024});
}

test('starts realtime FFmpeg and decodes JPEGs split at arbitrary stream boundaries',async()=>{
  const fake=mockSpawn();
  const playback=channel(fake.spawnImpl);
  const started=playback.start({
    id:'simpletestid',scope:'chat-1',file:'clip file.mp4',ffmpegPath:'ffmpeg',
    duration:20,start:1,
  });
  assert.equal(started.status,'streaming');
  assert.equal(started.at,1);
  assert.equal(fake.calls.length,1);
  const call=fake.calls[0];
  assert.equal(call.exe,'ffmpeg');
  assert.deepEqual(call.args.slice(0,8),[
    '-hide_banner','-loglevel','error','-re','-ss','1','-i','clip file.mp4',
  ]);
  assert.ok(call.args.includes('-an'));
  assert.equal(call.args[call.args.indexOf('-vf')+1],
    'fps=2,scale=512:512:force_original_aspect_ratio=decrease');
  assert.equal(call.args[call.args.indexOf('-threads')+1],'1');
  assert.deepEqual(call.args.slice(-5),[
    '-f','image2pipe','-vcodec','mjpeg','pipe:1',
  ]);

  const first=jpeg(180,1),second=jpeg(220,2),third=jpeg(190,3);
  const pending=playback.read('simpletestid',{
    scope:'chat-1',after:-Infinity,waitMs:500,minFrames:2,
  });
  emitSplit(call,Buffer.concat([first,second]));
  const result=await pending;
  assert.equal(result.status,'streaming');
  assert.equal(result.frames.length,2);
  assert.deepEqual(result.frames.map(frame=>frame.at),[1,1.5]);
  assert.equal(result.frames[0].part.type,'image');
  assert.equal(result.frames[0].part.mediaType,'image/jpeg');
  assert.deepEqual(Buffer.from(result.frames[0].part.data,'base64'),first);
  assert.deepEqual(Buffer.from(result.frames[1].part.data,'base64'),second);
  assert.deepEqual(result.window,{start:1,end:1.5,requested:true});
  assert.equal(result.cursor,1.5);
  assert.equal(result.coverage.complete,false);
  assert.equal(result.audioDecoded,false);

  const nextPending=playback.read('simpletestid',{
    scope:'chat-1',after:result.cursor,waitMs:500,minFrames:1,
  });
  emitSplit(call,third);
  const next=await nextPending;
  assert.deepEqual(next.frames.map(frame=>frame.at),[2]);
  playback.close();
});

test('ring is bounded and reports discarded unread coverage as a gap',async()=>{
  const fake=mockSpawn();
  const playback=createVideoPlayback({
    spawnImpl:fake.spawnImpl,fps:2,maxFrames:2,maxFrameBytes:1024,
  });
  playback.start({id:'ringtest',scope:'scope',file:'x',ffmpegPath:'ffmpeg',duration:10});
  emitSplit(fake.calls[0],Buffer.concat([
    jpeg(80,1),jpeg(80,2),jpeg(80,3),jpeg(80,4),jpeg(80,5),
  ]));
  const result=await playback.read('ringtest',{
    scope:'scope',waitMs:20,minFrames:1,
  });
  assert.deepEqual(result.frames.map(frame=>frame.at),[1.5,2]);
  assert.equal(result.coverage.gap,true);
  assert.equal(result.coverage.decodedFrom,1.5);
  assert.equal(result.coverage.decodedTo,2);
  assert.equal(result.coverage.complete,false);
  const snap=playback.snapshot('ringtest','scope');
  assert.equal(snap.decodedFrames,5);
  playback.close();
});

test('session ids are isolated and scope mismatches never touch another decoder',async()=>{
  const fake=mockSpawn();
  const playback=channel(fake.spawnImpl);
  const one=playback.start({
    id:'scopeone',scope:'a',file:'one',ffmpegPath:'ffmpeg',duration:10,
  });
  assert.equal(one.id,'scopeone');
  assert.equal(fake.calls.length,1);
  const reused=playback.start({
    id:'scopeone',scope:'a',file:'ignored',ffmpegPath:'other',duration:99,
  });
  assert.equal(reused.duration,10);
  assert.equal(fake.calls.length,1);
  assert.throws(()=>playback.start({
    id:'scopeone',scope:'b',file:'two',ffmpegPath:'ffmpeg',duration:10,
  }),error=>error.code==='VIDEO_PLAYBACK_SCOPE');
  assert.throws(()=>playback.read('scopeone',{scope:'b',waitMs:0}),
    error=>error.code==='VIDEO_PLAYBACK_SCOPE');
  playback.start({id:'scopetwo',scope:'b',file:'two',ffmpegPath:'ffmpeg',duration:10});
  assert.equal(fake.calls.length,2);
  assert.throws(()=>playback.start({
    id:'../unsafe',scope:'a',file:'x',ffmpegPath:'ffmpeg',duration:10,
  }),error=>error.code==='VIDEO_PLAYBACK_INVALID');
  playback.close();
});

test('pause, resume, seek, stale close, and stop have truthful process lifecycles',async()=>{
  const fake=mockSpawn();
  let cleanupCalls=0;
  const playback=channel(fake.spawnImpl);
  playback.start({
    id:'controls',scope:'scope',file:'input.mp4',ffmpegPath:'ffmpeg',duration:10,
    start:2,cleanup:()=>{cleanupCalls++;},
  });
  const old=fake.calls[0];
  emitSplit(old,jpeg(64,1));
  const paused=playback.control('controls','pause',{scope:'scope'});
  assert.equal(paused.status,'paused');
  assert.equal(old.killed,1);
  assert.equal(cleanupCalls,0);
  const pausedRead=await playback.read('controls',{
    scope:'scope',waitMs:200,minFrames:12,
  });
  assert.equal(pausedRead.status,'paused');
  assert.deepEqual(pausedRead.frames.map(frame=>frame.at),[2]);

  const resumed=playback.control('controls','resume',{scope:'scope'});
  assert.equal(resumed.status,'streaming');
  assert.equal(fake.calls.length,2);
  const current=fake.calls[1];
  assert.equal(current.args[current.args.indexOf('-ss')+1],'2.5');
  emitSplit(current,jpeg(64,2));
  old.child.emit('close',1);
  assert.equal(playback.snapshot('controls','scope').status,'streaming');

  const sought=playback.control('controls','seek',{scope:'scope',at:99});
  assert.equal(sought.at,10);
  assert.equal(sought.status,'streaming');
  assert.equal(fake.calls.length,3);
  const latest=fake.calls[2];
  assert.equal(latest.args[latest.args.indexOf('-ss')+1],'10');
  const afterSeek=await playback.read('controls',{scope:'scope',waitMs:5,minFrames:1});
  assert.deepEqual(afterSeek.frames,[]);
  assert.equal(afterSeek.coverage.gap,false);

  assert.throws(()=>playback.control('controls','seek',{scope:'scope',at:NaN}),
    error=>error.code==='VIDEO_PLAYBACK_INVALID');
  playback.control('controls','stop',{scope:'scope'});
  assert.equal(cleanupCalls,1);
  assert.equal(latest.killed,1);
  assert.throws(()=>playback.control('controls','stop',{scope:'scope'}),
    error=>error.code==='VIDEO_PLAYBACK_NOT_FOUND');
  playback.close();
  assert.equal(cleanupCalls,1);
});

test('read cancellation removes its listeners without stopping the decoder',async()=>{
  const fake=mockSpawn();
  const playback=channel(fake.spawnImpl);
  playback.start({id:'abortwait',scope:'s',file:'x',ffmpegPath:'ffmpeg',duration:10});
  const listeners=new Set();
  const signal={
    aborted:false,
    reason:undefined,
    addEventListener(type,listener){if(type==='abort')listeners.add(listener);},
    removeEventListener(type,listener){if(type==='abort')listeners.delete(listener);},
  };
  const pending=playback.read('abortwait',{
    scope:'s',minFrames:12,waitMs:5000,signal,
  });
  assert.equal(listeners.size,1);
  signal.aborted=true;
  signal.reason='cancel';
  for(const listener of [...listeners])listener();
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.equal(listeners.size,0);
  assert.equal(fake.calls[0].killed,0);
  assert.equal(playback.snapshot('abortwait','s').status,'streaming');
  playback.close();
});

test('EOF resolves a pending read as ended and cleanup remains explicit',async()=>{
  const fake=mockSpawn();
  let cleanupCalls=0;
  const playback=channel(fake.spawnImpl);
  playback.start({
    id:'eoftest',scope:'s',file:'x',ffmpegPath:'ffmpeg',duration:10,
    cleanup:()=>{cleanupCalls++;},
  });
  const pending=playback.read('eoftest',{scope:'s',minFrames:4,waitMs:1000});
  fake.calls[0].child.stdout.emit('end');
  assert.equal(playback.snapshot('eoftest','s').status,'streaming');
  fake.calls[0].child.emit('close',0);
  const result=await pending;
  assert.equal(result.status,'ended');
  assert.equal(cleanupCalls,0);
  assert.equal(playback.snapshot('eoftest','s').status,'ended');
  playback.close();
  assert.equal(cleanupCalls,1);
});

test('oversized corrupt JPEG data and decoder exits produce sanitized failures',async()=>{
  const fake=mockSpawn();
  const playback=createVideoPlayback({
    spawnImpl:fake.spawnImpl,fps:2,maxFrames:4,maxFrameBytes:32,
  });
  playback.start({
    id:'corrupt',scope:'secret-scope',file:'C:\\private\\movie.mp4',
    ffmpegPath:'ffmpeg',duration:10,
  });
  fake.calls[0].child.stderr.emit('data','file=C:\\private\\movie.mp4 token=SECRET');
  fake.calls[0].child.stdout.emit('data',Buffer.concat([
    Buffer.from([0xff,0xd8]),
    Buffer.alloc(100,0x11),
  ]));
  const corrupt=await playback.read('corrupt',{scope:'secret-scope',waitMs:20});
  assert.equal(corrupt.status,'failed');
  assert.equal(corrupt.error.message,'视频解码流异常');
  assert.doesNotMatch(JSON.stringify(corrupt),/private|SECRET|stderr|movie\.mp4/i);
  assert.equal(fake.calls[0].killed,1);
  playback.close();

  const exits=mockSpawn();
  const second=channel(exits.spawnImpl);
  second.start({
    id:'exitfail',scope:'s',file:'another-private.mp4',ffmpegPath:'ffmpeg',
    duration:10,
  });
  exits.calls[0].child.stdout.emit('end');
  exits.calls[0].child.emit('close',1);
  const failed=await second.read('exitfail',{scope:'s',waitMs:20});
  assert.equal(failed.status,'failed');
  assert.equal(failed.error.message,'视频解码失败');
  assert.doesNotMatch(JSON.stringify(failed),/another-private|ffmpeg/i);
  assert.equal(exits.calls[0].killed,0);
  second.close();

  const junk=mockSpawn();
  const third=createVideoPlayback({
    spawnImpl:junk.spawnImpl,fps:2,maxFrames:4,maxFrameBytes:32,
  });
  third.start({
    id:'junkfail',scope:'s',file:'private.mp4',ffmpegPath:'ffmpeg',duration:10,
  });
  junk.calls[0].child.stdout.emit('data',Buffer.alloc(64,0x11));
  const junkResult=await third.read('junkfail',{scope:'s',waitMs:20});
  assert.equal(junkResult.status,'failed');
  assert.equal(junkResult.error.message,'视频解码流异常');
  assert.doesNotMatch(JSON.stringify(junkResult),/private|ffmpeg/i);
  third.close();
});
