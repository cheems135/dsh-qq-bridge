import {spawn} from 'node:child_process';
import {unlinkSync} from 'node:fs';
import {resolveVideoRuntime} from './video-runtime.js';
export function convertVisualFrame(executable,file,filter,format,signal){
 return new Promise((resolve,reject)=>{
  const args=['-v','error','-i',file,'-vf',filter,'-frames:v','1',...(format==='rawvideo'?['-pix_fmt','gray']:['-q:v','5']),'-f',format,'pipe:1'];
  const child=spawn(executable,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let chunks=[],size=0,done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{child.kill();finish(Object.assign(Error('捕获已取消'),{name:'AbortError'}));};
  const timer=setTimeout(()=>{child.kill();finish(Error('画面缩放超时'));},10000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  child.stdout.on('data',b=>{size+=b.length;if(size>1024*1024){child.kill();finish(Error('截图超过大小预算'));}else chunks.push(b);});child.stderr.on('data',()=>{});child.on('error',e=>finish(e));child.on('close',code=>finish(code?Error('截图转换未成功'):null,Buffer.concat(chunks)));
 });
}
// Reuse the existing native desktop route and host guard. No new screenshot
// script, changed execution policy, or antivirus exception is installed.
export async function captureVisualWindow(options,context,budget,{desktop,runtime={}}={}){
 if(options.target!=='screen')throw Error('指定窗口捕获尚未接入；可选独立浏览器或屏幕');
 const ffmpeg=resolveVideoRuntime(runtime).ffmpegPath;if(!ffmpeg)throw Error('屏幕画面缩放需要已有的FFmpeg环境');
 const result=await desktop.act({action:'observe'},context);context.signal?.throwIfAborted();
 if(!result.file||result.locked)throw Error('当前没有可见、已解锁的桌面，未取得屏幕画面');
 try{
  const data=await convertVisualFrame(ffmpeg,result.file,'scale='+budget.maxEdge+':'+budget.maxEdge+':force_original_aspect_ratio=decrease','image2pipe',context.signal);
  const signature=await convertVisualFrame(ffmpeg,result.file,'scale=16:9','rawvideo',context.signal);
  return {data:data.toString('base64'),signature:Array.from(signature),mediaType:'image/jpeg',capturedAt:Date.now(),audioState:'not-captured',coverage:'当前用户桌面的真实画面；没有采集系统声音'};
 }finally{try{unlinkSync(result.file);}catch{}}
}
