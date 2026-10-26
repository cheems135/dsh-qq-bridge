// Bounded local FFmpeg sampling, following the frame-first approach used by
// MoFox and AstrBot video integrations. No third-party parsing proxy or cookies.
import {readFileSync,writeFileSync,mkdirSync,statSync,unlinkSync,rmdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
const MAX_BYTES=32*1024*1024;
const trustedMedia=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&/(?:^|\.)(?:qq\.com|qpic\.cn|qq\.net)$/.test(u.hostname);}catch{return false;}};
function run(exe,args,{timeout=10000,allowFailure=false,spawnImpl=spawn}={}){
  return new Promise((resolve,reject)=>{
    let stderr='',done=false;const child=spawnImpl(exe,args,{windowsHide:true,stdio:['ignore','ignore','pipe']});
    const timer=setTimeout(()=>{if(done)return;done=true;child.kill();reject(Error('视频抽帧超时'));},timeout);
    child.stderr?.on('data',b=>{stderr=(stderr+String(b)).slice(-16000);});
    child.on('error',()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('FFmpeg 未能启动'));});
    child.on('close',code=>{if(done)return;done=true;clearTimeout(timer);if(code!==0&&!allowFailure)reject(Error('视频格式无法解码'));else resolve(stderr);});
  });
}
export function createVideoReader({getConfig,getCacheDir,getPlatformFile,fetchImpl=globalThis.fetch,spawnImpl=spawn}={}){
  let busy=false;
  function status(){const c=getConfig()||{};return{available:!!c.ffmpegPath&&existsSync(c.ffmpegPath),maxBytes:MAX_BYTES,maxFrames:4,source:'ffmpeg-local'};}
  async function read(data={}){
    if(!status().available)throw Error('视频抽帧工具未安装');if(busy)throw Error('正在读取另一段视频，请稍后再发');busy=true;
    let dir='',owned=[];
    try{
      let bytes,url=String(data.url||'');
      if(!url&&/^https:\/\//i.test(String(data.file||'')))url=data.file;
      if(url){
        if(!trustedMedia(url))throw Error('该链接不是直接上传的 QQ 视频地址；网页视频暂只读取可取得的文字');
        const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('视频附件下载失败');if(Number(response.headers?.get?.('content-length'))>MAX_BYTES)throw Error('视频超过 32MB');
        const chunks=[];let size=0;
        if(response.body?.getReader){const reader=response.body.getReader();try{for(;;){const result=await reader.read();if(result.done)break;size+=result.value.length;if(size>MAX_BYTES)throw Error('视频超过 32MB');chunks.push(Buffer.from(result.value));}}finally{try{await reader.cancel();}catch{}}bytes=Buffer.concat(chunks);}
        else bytes=Buffer.from(await response.arrayBuffer());
      }else{
        const id=String(data.file_id||data.file||'');if(!/^[\w-]{8,160}(?:\.(?:mp4|webm|mov|mkv|avi))?$/i.test(id))throw Error('没有可读取的 QQ 视频文件标识');
        const file=await getPlatformFile(id);if(!file||!existsSync(file))throw Error('NapCat 没有返回已下载的视频');
        if(statSync(file).size>MAX_BYTES)throw Error('视频超过 32MB');bytes=readFileSync(file);
      }
      if(!bytes?.length||bytes.length>MAX_BYTES)throw Error('视频为空或超过 32MB');
      if(!(bytes.subarray(4,8).toString()==='ftyp'||bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'))||bytes.subarray(0,4).toString()==='RIFF'))throw Error('附件不是支持的 MP4、MOV、WebM 或 AVI 视频');
      dir=join(getCacheDir(),'videos','sample-'+randomUUID());mkdirSync(dir,{recursive:true});const input=join(dir,'input.mp4');owned.push(input);writeFileSync(input,bytes);
      const exe=getConfig().ffmpegPath,common=['-hide_banner','-loglevel','info','-protocol_whitelist','file,pipe'];
      const metadata=await run(exe,[...common,'-i',input],{timeout:5000,allowFailure:true,spawnImpl});
      const match=metadata.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);if(!match)throw Error('未能读取视频时长');
      const duration=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);if(!duration||duration>300)throw Error('目前支持 5 分钟以内的视频片段');
      const fps=Number(metadata.match(/\b([\d.]+) fps\b/)?.[1])||25;
      const safeEnd=Math.max(0,duration-Math.max(0.1,1/fps));
      const frames=[],times=[0,0.33,0.66,0.95].map(r=>safeEnd*r);
      const deadline=Date.now()+20000;
      for(let i=0;i<times.length;i++){
        const file=join(dir,'frame-'+i+'.jpg');owned.push(file);
        await run(exe,['-hide_banner','-loglevel','error','-protocol_whitelist','file,pipe','-ss',times[i].toFixed(3),'-i',input,'-map','0:v:0','-frames:v','1','-vf','scale=768:768:force_original_aspect_ratio=decrease','-pix_fmt','yuvj420p','-q:v','4','-threads','1','-y',file],{timeout:Math.max(500,Math.min(6500,deadline-Date.now())),spawnImpl});
        if(statSync(file).size>2*1024*1024)throw Error('视频帧过大');
        frames.push({at:Math.round(times[i]*10)/10,part:{type:'image',mediaType:'image/jpeg',name:'video-frame-'+i,data:readFileSync(file).toString('base64')}});
      }
      return{duration,frames,audioDecoded:false,status:'sampled'};
    }finally{
      for(const file of owned)try{unlinkSync(file);}catch{}
      if(dir)try{rmdirSync(dir);}catch{} // No recursive delete; only our tracked temporary files.
      busy=false;
    }
  }
  return{read,status};
}
