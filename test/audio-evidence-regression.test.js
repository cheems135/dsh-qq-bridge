import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAudioAnalysis} from '../audio-analysis.js';
test('audio validation preserves real repeats and never lets heuristic music classification veto VAD',()=>{
 const result=spawnSync('python',['-B',fileURLToPath(new URL('./audio-evidence-regression.py',import.meta.url))],{encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr||result.error?.message||result.stdout);
 assert.match(result.stdout,/PASS:/);
});
test('shared audio analysis exposes conflicting evidence to API callers and respects mobile isolation',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'shared-audio-'));
 const file=join(folder,'input.wav');writeFileSync(file,'fixture');let submitted;
 const raw={ok:true,start:0,end:3,acoustic:{kind:'纯音/提示音',confidence:'medium'},transcription:{status:'candidate',segments:[{start:0,end:2,text:'现在确实有人说话',noSpeech:.1}]}};
 const spawnImpl=()=>{const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=data=>{submitted=JSON.parse(data);queueMicrotask(()=>{child.stdout.emit('data',JSON.stringify(raw));child.emit('close',0);});};return child;};
 const options={getRuntime:()=>({ffmpegPath:process.execPath,ffprobePath:process.execPath,videoPlusPythonPath:process.execPath,whisperModelPath:'fixture'}),getCacheDir:()=>folder,spawnImpl};
 try{
  const result=await createAudioAnalysis(options).analyze({file,transcribe:true});
  assert.equal(submitted.transcribe,true);assert.match(result.acoustic.kind,/可能含可辨识人声/);assert.equal(result.localClassification.rawAcoustic.kind,'纯音/提示音');
  const mobile=await createAudioAnalysis({...options,apiOnly:true}).analyze({file,transcribe:true});
  assert.equal(submitted.transcribe,false);assert.equal(submitted.runtime.whisperModelPath,'');assert.equal(mobile.transcription.status,'unavailable');
 }finally{rmSync(folder,{recursive:true,force:true});}
});
