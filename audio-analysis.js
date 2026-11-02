import {spawn} from 'node:child_process';
import {existsSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function createAudioAnalysis({getRuntime,getCacheDir,authorize=()=>true,spawnImpl=spawn}={}){
 function status(){const r=getRuntime()||{};return {available:[r.ffmpegPath,r.ffprobePath,r.videoPlusPythonPath].every(p=>p&&existsSync(p)),transcription:existsSync(join(r.whisperModelPath||'','model.bin')),backend:'local-audio-evidence',uploadsAudio:false};}
 async function analyze(args={},context={}){
  if(!authorize(context))throw Error('没有当前音频操作权限');if(!status().available)throw Error('本地音频分析需要现有FFmpeg和Python环境');
  if(!existsSync(String(args.file||'')))throw Error('请先通过DSH工具取得真实的本地音频文件，不能把网页链接当作音频路径');
  const cacheDir=join(getCacheDir(),'audio-analysis');mkdirSync(cacheDir,{recursive:true});
  const value=await new Promise((resolve,reject)=>{let out='',done=false;
   const child=spawnImpl(getRuntime().videoPlusPythonPath,[fileURLToPath(new URL('./tools/audio-inspect.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
   const timer=setTimeout(()=>{if(done)return;done=true;child.kill();reject(Error('本地音频分析超时'));},args.transcribe?240000:args.music||args.charts?180000:45000);
   const abort=()=>child.kill();context.signal?.addEventListener('abort',abort,{once:true});
   child.stdout.on('data',b=>{out+=String(b);if(out.length>1000000)child.kill();});child.stderr.on('data',()=>{});
   child.on('error',()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('本地音频环境无法启动'));});
   child.on('close',()=>{context.signal?.removeEventListener('abort',abort);if(done)return;done=true;clearTimeout(timer);try{const v=JSON.parse(out);if(!v.ok)throw Error(v.error||'音频分析失败');resolve(v);}catch(e){reject(e);}});
   child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({...args,runtime:getRuntime(),cacheDir}));
  });
  if(!authorize(context))throw Error('音频处理期间权限或账号已改变，旧结果未提交');return value;
 }
 return {analyze,status};
}
