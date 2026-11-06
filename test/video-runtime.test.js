import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {basename,join} from 'node:path';
import {resolveVideoRuntime} from '../video-runtime.js';

function fixtureRoot(t){
  const root=mkdtempSync(join(process.cwd(),'test','video-runtime-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  return root;
}

function touch(file){
  mkdirSync(join(file,'..'),{recursive:true});
  writeFileSync(file,'');
}

test('runtime resolution prefers existing custom executables over PATH and separates basic from enhanced readiness',t=>{
  const root=fixtureRoot(t),relative='test/'+basename(root);
  touch(join(root,'custom','ffmpeg'));
  touch(join(root,'path-a','ffmpeg'));
  touch(join(root,'path-b','ffprobe'));
  touch(join(root,'path-b','python3'));
  const runtime=resolveVideoRuntime({
    ffmpegPath:'./'+relative+'/custom/ffmpeg',
  },{platform:'linux',env:{PATH:relative+'/path-a:'+relative+'/path-b'}});
  assert.equal(runtime.ffmpegPath,join(root,'custom','ffmpeg'));
  assert.equal(runtime.sources.ffmpeg,'configured');
  assert.equal(runtime.ffprobePath,join(root,'path-b','ffprobe'));
  assert.equal(runtime.videoPlusPythonPath,join(root,'path-b','python3'));
  assert.deepEqual(runtime.basic,{available:true,ffmpeg:true});
  assert.deepEqual(runtime.enhanced,{available:true,ffmpeg:true,ffprobe:true,python:true});
  assert.equal(runtime.webSupported,true);
  assert.equal(runtime.bilibiliDirectSupported,true);
});

test('Windows PATH resolution requires .exe while Linux rejects Windows executables',t=>{
  const root=fixtureRoot(t),relative='test/'+basename(root);
  touch(join(root,'windows','ffmpeg.exe'));
  touch(join(root,'windows','ffprobe.exe'));
  touch(join(root,'windows','python.exe'));
  const win=resolveVideoRuntime({},{
    platform:'win32',
    env:{Path:join(root,'windows')},
  });
  assert.equal(win.ffmpegPath,join(root,'windows','ffmpeg.exe'));
  assert.equal(win.ffprobePath,join(root,'windows','ffprobe.exe'));
  assert.equal(win.videoPlusPythonPath,join(root,'windows','python.exe'));
  const incompatible=resolveVideoRuntime({
    ffmpegPath:'./'+relative+'/windows/ffmpeg.exe',
    ffprobePath:'./'+relative+'/windows/ffprobe.exe',
    videoPlusPythonPath:'./'+relative+'/windows/python.exe',
  },{platform:'linux',env:{PATH:relative+'/windows'}});
  assert.equal(incompatible.ffmpegPath,'');
  assert.equal(incompatible.ffprobePath,'');
  assert.equal(incompatible.videoPlusPythonPath,'');
  assert.equal(incompatible.basicAvailable,false);
});

test('a missing custom executable falls through to the PATH candidate',t=>{
  const root=fixtureRoot(t),relative='test/'+basename(root);
  touch(join(root,'bin','ffmpeg'));
  const runtime=resolveVideoRuntime({ffmpegPath:'./missing/ffmpeg'},{
    platform:'linux',env:{PATH:relative+'/bin'},
  });
  assert.equal(runtime.ffmpegPath,join(root,'bin','ffmpeg'));
  assert.equal(runtime.sources.ffmpeg,'path');
});
