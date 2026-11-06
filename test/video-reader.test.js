import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {createVideoReader} from '../video-reader.js';
import {BILI_BROWSER_UA} from '../bilibili-login.js';

const JPEG=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0xff,0xd9]);
test('coded network failures are sanitized and remain eligible for CDN failover',async t=>{
  const s=setup(t);
  const reader=createVideoReader({continuous:false,getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),platform:'win32',env:{Path:''},fetchImpl:async()=>{throw Object.assign(Error('https://cdn.bilivideo.com/private?token=SIGNED'),{code:'ECONNRESET'});}});
  await assert.rejects(reader.read({source:'bilibili',url:'https://cdn.bilivideo.com/private?token=SIGNED'}),error=>{
    assert.equal(error.code,'VIDEO_RESOURCE');assert.equal(error.sourceHost,'cdn.bilivideo.com');assert.doesNotMatch(error.message,/SIGNED|private|https:/);return true;
  });
});
function mp4(){const bytes=Buffer.alloc(32);bytes.write('ftyp',4);bytes.write('isom',8);return bytes;}

function fixture(t){
  const root=mkdtempSync(join(process.cwd(),'test','video-reader-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}

function executable(root,name){
  const file=join(root,name+'.exe');
  writeFileSync(file,'');
  return file;
}

function fakeSpawn({duration='00:10:00.00',plusFailure=false,plusDelay=0,onCall=()=>{}}={}){
  const calls=[];
  const spawnImpl=(exe,args,options)=>{
    const child=new EventEmitter();
    child.stdout=new EventEmitter();
    child.stderr=new EventEmitter();
    child.stdin=new EventEmitter();
    let killed=false;
    const call={exe,args,options,input:''};
    calls.push(call);
    onCall(call);
    child.kill=()=>{
      if(killed)return;
      killed=true;
      setImmediate(()=>child.emit('close',255));
    };
    child.stdin.end=value=>{
      call.input=String(value||'');
      if(String(args[0]||'').endsWith('video_plus.py')){
        const finish=()=>{
          if(killed)return;
          if(plusFailure){
            child.stdout.emit('data','{"ok":false,"error":"optional audio failed"}');
            child.emit('close',1);
          }else{
            const request=JSON.parse(call.input);
            writeFileSync(join(request.outDir,'frame-00.jpg'),JPEG);
            child.stdout.emit('data',JSON.stringify({
              ok:true,duration:600,frames:[{at:2.5,file:'frame-00.jpg'}],
              audio:{status:'unavailable'},window:{start:2.5,end:2.5,requested:false},
            }));
            child.emit('close',0);
          }
        };
        plusDelay?setTimeout(finish,plusDelay):queueMicrotask(finish);
        return;
      }
      queueMicrotask(()=>{
        if(killed)return;
        if(args.includes('-frames:v')){
          writeFileSync(args.at(-1),JPEG);
        }else{
          child.stderr.emit('data','Input #0\n  Duration: '+duration+', start: 0.000000, bitrate: 1 kb/s\n  25 fps\n');
        }
        child.emit('close',0);
      });
    };
    return child;
  };
  return{calls,spawnImpl};
}

function setup(t,{plus=false,spawnOptions={}}={}){
  const root=fixture(t),cache=join(root,'cache'),file=join(root,'attachment.mp4');
  writeFileSync(file,mp4());
  const config={
    ffmpegPath:executable(root,'ffmpeg'),
    metadataTimeoutMs:1000,
    analysisTimeoutMs:1000,
  };
  if(plus){
    config.ffprobePath=executable(root,'ffprobe');
    config.videoPlusPythonPath=executable(root,'python');
  }
  const fake=fakeSpawn(spawnOptions);
  let platformCalls=0;
  const reader=createVideoReader({continuous:false,
    getConfig:()=>config,
    getCacheDir:()=>cache,
    getPlatformFile:async id=>{platformCalls++;return{file_path:file,file,url:''};},
    fetchImpl:async()=>{throw Error('unexpected fetch');},
    spawnImpl:fake.spawnImpl,
    platform:'win32',
    env:{Path:''},
    mobile:true,
  });
  return{root,file,config,fake,reader,platformCalls:()=>platformCalls};
}

test('basic FFmpeg sampling runs without Python, accepts a platform object, and proves JPEG frames at requested times',async t=>{
  const s=setup(t);
  const result=await s.reader.read({file_id:'12345678-abcd.mp4',start:3,window:4});
  assert.equal(result.source,'ffmpeg-local');
  assert.equal(result.duration,600);
  assert.deepEqual(result.window,{start:3,end:7,requested:true});
  assert.equal(result.frames.length,4);
  assert.deepEqual(result.frames.map(frame=>frame.at),[3,4.32,5.64,6.8]);
  for(const frame of result.frames){
    assert.equal(frame.part.type,'image');
    assert.equal(frame.part.mediaType,'image/jpeg');
    assert.equal(typeof frame.part.data,'string');
    assert.deepEqual(Buffer.from(frame.part.data,'base64'),JPEG);
  }
  assert.equal(s.fake.calls.length,5);
  assert.ok(s.fake.calls.every(call=>call.exe===s.config.ffmpegPath));
  assert.equal(s.platformCalls(),1);
  const status=s.reader.status();
  assert.equal(status.available,true);
  assert.equal(status.enhanced,false);
  assert.equal(status.webSupported,false);
  assert.equal(status.bilibiliDirectSupported,true);
  assert.deepEqual(status.basic,{available:true,ffmpeg:true});
  assert.equal(status.whisper,false);
});

test('Bilibili direct media uses basic FFmpeg with Referer and UA only',async t=>{
  const s=setup(t);
  const url='https://upos-sz-mirrorcos.bilivideo.com/video.m4s?token=test';
  const fetches=[];
  s.reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,
    getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>{throw Error('must not use platform file');},
    fetchImpl:async(input,options)=>{
      fetches.push({input,options});
      return new Response(mp4(),{status:200,headers:{'content-length':String(32)}});
    },
    spawnImpl:s.fake.spawnImpl,
    platform:'win32',
    env:{Path:''},
    mobile:true,
  });
  const result=await s.reader.read({source:'bilibili',url,web:true});
  assert.equal(result.source,'ffmpeg-local');
  assert.equal(fetches.length,1);
  assert.equal(fetches[0].input,url);
  assert.equal(fetches[0].options.headers.Referer,'https://www.bilibili.com/');
  assert.equal(fetches[0].options.headers['User-Agent'],BILI_BROWSER_UA);
  assert.equal(Object.hasOwn(fetches[0].options.headers,'Cookie'),false);
  assert.equal(fetches[0].options.credentials,'omit');
  assert.equal(result.frames.length,4);
});

test('Bilibili HTTP failures expose only a sanitized status and source host',async t=>{
  const s=setup(t);
  const url='https://upos-sz-mirrorcos.bilivideo.com/video.m4s?token=SIGNED&cookie=SECRET';
  s.reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,
    getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>{throw Error('must not use platform file');},
    fetchImpl:async()=>new Response(null,{status:403}),
    spawnImpl:s.fake.spawnImpl,
    platform:'win32',
    env:{Path:''},
    mobile:true,
  });
  await assert.rejects(s.reader.read({source:'bilibili',url}),error=>{
    assert.equal(error.code,'VIDEO_RESOURCE');
    assert.equal(error.httpStatus,403);
    assert.equal(error.sourceHost,'upos-sz-mirrorcos.bilivideo.com');
    assert.match(error.message,/HTTP 403/);
    const diagnostic=error.message+JSON.stringify(error);
    assert.doesNotMatch(diagnostic,/SIGNED|SECRET|token=|video\.m4s|cookie=/);
    return true;
  });
  assert.equal(s.fake.calls.length,0);
});

test('Bilibili validation rejects lookalike hosts, credentials, and custom ports before fetching',async t=>{
  const s=setup(t);
  const bad=[
    'https://bilivideo.com.evil.test/video.m4s',
    'https://user:pass@upos.bilivideo.com/video.m4s',
    'https://upos.bilivideo.com:8443/video.m4s',
  ];
  let fetches=0;
  s.reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),getPlatformFile:async()=>'',
    fetchImpl:async()=>{fetches++;return new Response(mp4());},spawnImpl:s.fake.spawnImpl,
    platform:'win32',env:{Path:''},
  });
  for(const url of bad){
    await assert.rejects(s.reader.read({source:'bilibili',url}),error=>error.code==='VIDEO_INVALID');
  }
  assert.equal(fetches,0);
});

test('non-Bilibili web mode remains enhanced-only and does not fall back to basic',async t=>{
  const s=setup(t);
  await assert.rejects(s.reader.read({web:true,url:'https://www.bilibili.com/video/BV1234567890'}),error=>error.code==='VIDEO_ENHANCEMENT');
  assert.equal(s.fake.calls.length,0);
});

test('direct user local paths stay rejected while a platform-returned file URL is accepted',async t=>{
  const s=setup(t);
  let platformCalls=0;
  const reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>{platformCalls++;return{file_path:'file:///'+s.file.replaceAll('\\','/')};},
    fetchImpl:async()=>{throw Error('unexpected fetch');},spawnImpl:s.fake.spawnImpl,
    platform:'win32',env:{Path:''},
  });
  await assert.rejects(reader.read({file:s.file}),error=>error.code==='VIDEO_RESOURCE');
  assert.equal(platformCalls,0);
  const result=await reader.read({file_id:'12345678-abcd.mp4'});
  assert.equal(result.frames.length,4);
  assert.equal(platformCalls,1);
});

test('a platform-returned HTTPS QQ URL is validated and downloaded before basic sampling',async t=>{
  const s=setup(t);
  const url='https://multimedia.qq.com/download?fileid=test';
  const fetches=[];
  const reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>({file:'',file_path:'',url}),
    fetchImpl:async(input,options)=>{
      fetches.push({input,options});
      return new Response(mp4(),{status:200});
    },
    spawnImpl:s.fake.spawnImpl,platform:'win32',env:{Path:''},
  });
  const result=await reader.read({file_id:'12345678-abcd.mp4'});
  assert.equal(result.source,'ffmpeg-local');
  assert.deepEqual(fetches.map(item=>item.input),[url]);
  assert.equal(fetches[0].options.credentials,'omit');
});

test('an optional enhanced-analysis failure falls back to basic sampling for an attachment',async t=>{
  const s=setup(t,{plus:true,spawnOptions:{plusFailure:true}});
  const result=await s.reader.read({file_id:'12345678-abcd.mp4',start:2,window:1});
  assert.equal(result.source,'ffmpeg-local');
  assert.equal(result.frames.length,4);
  assert.ok(s.fake.calls.some(call=>String(call.args[0]).endsWith('video_plus.py')));
  const payload=JSON.parse(s.fake.calls.find(call=>String(call.args[0]).endsWith('video_plus.py')).input);assert.equal(payload.runtime.mobile,true);assert.equal(payload.runtime.allowWhisper,false);assert.equal(payload.runtime.whisperModelPath,'');
  assert.ok(s.fake.calls.some(call=>call.args.includes('-frames:v')));
});

test('missing platform files and invalid containers are not hidden by enhanced fallback',async t=>{
  const s=setup(t,{plus:true});
  const reader=createVideoReader({continuous:false,
    getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>({file_path:join(s.root,'missing.mp4')}),
    fetchImpl:globalThis.fetch,spawnImpl:s.fake.spawnImpl,platform:'win32',env:{Path:''},
  });
  await assert.rejects(reader.read({file_id:'12345678-abcd.mp4'}),error=>error.code==='VIDEO_RESOURCE');
  assert.equal(s.fake.calls.length,0);
  const invalid=join(s.root,'invalid.mp4');
  writeFileSync(invalid,'not a video');
  const invalidReader=createVideoReader({continuous:false,
    getConfig:()=>s.config,getCacheDir:()=>join(s.root,'cache'),
    getPlatformFile:async()=>invalid,fetchImpl:async()=>{throw Error('unexpected');},
    spawnImpl:s.fake.spawnImpl,platform:'win32',env:{Path:''},
  });
  await assert.rejects(invalidReader.read({file_id:'12345678-abcd.mp4'}),error=>error.code==='VIDEO_INVALID');
  assert.equal(s.fake.calls.length,0);
});

test('aborting during enhanced analysis prevents attachment fallback',async t=>{
  const s=setup(t,{plus:true,spawnOptions:{plusDelay:150}});
  const controller=new AbortController();
  const pending=s.reader.read({file_id:'12345678-abcd.mp4'}, {signal:controller.signal});
  setTimeout(()=>controller.abort(),10);
  await assert.rejects(pending,error=>error.name==='AbortError');
  assert.ok(s.fake.calls.some(call=>String(call.args[0]).endsWith('video_plus.py')));
  assert.equal(s.fake.calls.some(call=>call.args.includes('-frames:v')),false);
});
