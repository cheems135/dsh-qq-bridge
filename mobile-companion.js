import {unlinkSync} from 'node:fs';
import {resolveVideoRuntime} from './video-runtime.js';
import {convertVisualFrame} from './visual-capture.js';

// Capture goes through the host phone tools and their actual system grants.
// No ADB shell, new service, or local language/vision model is started here.
export async function capturePhoneCompanion(options,context,budget,{phone,runtime={},convert=convertVisualFrame}={}){
 if(options.target!=='phone')throw Error('请选择手机屏幕');
 if(!phone?.act)throw Error('DSH Go 原生手机工具尚未接入');
 const ffmpeg=resolveVideoRuntime(runtime).ffmpegPath;if(!ffmpeg)throw Error('手机画面缩放需要已有的 FFmpeg 环境');
 let result;
 try{result=await phone.act({action:'observe',detail:false},context);}
 catch(error){
  const message=String(error.message);
  if(/另一个手机操作正在进行|手机工具.*忙碌/.test(message))return {pending:true};
  if(/DSH(?: Go)? 自己的界面|DSH Go 自身/.test(message))return {pending:true,reason:'请切到要陪看的应用，等待下一张屏幕画面'};
  throw error;
 }
 const capturedAt=Date.now();
 try{
  context.signal?.throwIfAborted();
  if(!result.file||result.locked)throw Error('没有取得手机画面，请亮屏解锁并检查 DSH Go 截图授权');
  const data=await convert(ffmpeg,result.file,'scale='+budget.maxEdge+':'+budget.maxEdge+':force_original_aspect_ratio=decrease','image2pipe',context.signal);
  context.signal?.throwIfAborted();
  const signature=await convert(ffmpeg,result.file,'scale=16:9','rawvideo',context.signal);
  return {data:data.toString('base64'),signature:Array.from(signature),mediaType:'image/jpeg',capturedAt,audioState:'not-captured',coverage:'本次 DSH Go 原生手机截图；只观察当前画面，没有取得系统声音'};
 }finally{try{unlinkSync(result.file);}catch{}}
}
