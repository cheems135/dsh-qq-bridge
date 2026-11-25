import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync,readdirSync,existsSync,statSync,copyFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,basename,extname} from 'node:path';
import {songKey,sameSingingSegment} from './singing-plan.js';
import {musicTarget} from './music-input.js';

const run=promisify(execFile),hash=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>String(value||'').replace(/[\x00-\x1f]/g,' ').trim().slice(0,160);
const maximumUpload=16*1024*1024;
const scope=c=>hash(JSON.stringify([c.accountId||'',c.personaId||'']));
const check=c=>{c.signal?.throwIfAborted();c.validate?.();};

export function musicSearchCandidates(value){
 const urls=[],seen=new Set();let size=0;
 function visit(item){
  if(size++>300)return;
  if(typeof item==='string')for(const raw of item.match(/https?:\/\/[^\s<>"']+/g)||[]){
   let url=raw.replace(/&amp;/g,'&').replace(/[)\]，。]+$/,'');
   try{const target=new URL(url);if(/(^|\.)bing\.com$/.test(target.hostname)&&target.pathname==='/ck/a'){const u=target.searchParams.get('u')||'';if(u.startsWith('a1'))url=Buffer.from(u.slice(2),'base64url').toString();}}catch{}
   const target=musicTarget(url);if(target&&!seen.has(target.url)){seen.add(target.url);urls.push(target);}
  }
  else if(Array.isArray(item))for(const child of item)visit(child);
  else if(item&&typeof item==='object')for(const child of Object.values(item))visit(child);
 }
 visit(value);return urls.slice(0,5);
}

export async function probeSongAudio(file,{ffprobePath,signal}={}){
 if(!ffprobePath)throw Error('当前音频探测组件不可用，无法核对原曲文件');
 const {stdout}=await run(ffprobePath,['-v','error','-show_format','-show_streams','-of','json',file],{windowsHide:true,timeout:15000,maxBuffer:1024*1024,signal});
 const metadata=JSON.parse(stdout),audio=metadata.streams?.find(row=>row.codec_type==='audio');
 if(!audio)throw Error('取得的文件没有可用音频轨道');
 const tags={...audio.tags,...metadata.format?.tags},duration=Number(metadata.format?.duration||audio.duration);
 const format=metadata.format?.format_name||'',extension=/wav/.test(format)?'wav':/flac/.test(format)?'flac':audio.codec_name==='mp3'?'mp3':audio.codec_name==='vorbis'||audio.codec_name==='opus'?'ogg':/mp4|m4a/.test(format)?'m4a':audio.codec_name==='aac'?'aac':'';
 return {title:clean(tags.title||tags.TITLE),artist:clean(tags.artist||tags.ARTIST||tags.album_artist),duration:Number.isFinite(duration)?duration:null,extension,hasVideo:metadata.streams.some(row=>row.codec_type==='video'&&row.disposition?.attached_pic!==1)};
}

export async function materializeSongAudio(file,info,directory,{ffmpegPath,signal,segment=null}={}){
 const bytes=readFileSync(file),digest=hash(bytes);
 if(!segment&&bytes.length<=maximumUpload&&info.extension&&!info.hasVideo){const target=join(directory,digest+'.'+info.extension);if(!existsSync(target))copyFileSync(file,target);return target;}
 if(!ffmpegPath)throw Error('原曲需要提取或压缩，但当前 FFmpeg 不可用');
 const from=segment?.start||0,to=segment?Math.min(segment.end,info.duration||segment.end):null;
 if(segment&&to<=from)throw Error('请求的原曲片段超出音频时长');
 const wav=!!segment&&to-from<=60,extension=wav?'wav':'mp3';
 const target=join(directory,digest+(segment?'-'+hash(JSON.stringify(segment)).slice(0,16):'')+'.'+extension);if(existsSync(target)&&statSync(target).size<=maximumUpload)return target;
 const temp=join(directory,randomUUID()+'.partial.'+extension);
 try{
  await run(ffmpegPath,['-v','error','-nostdin','-n','-i',file,...(segment?['-ss',String(from),'-t',String(to-from)]:[]),'-map','0:a:0','-vn',...(wav?['-codec:a','pcm_s16le']:['-codec:a','libmp3lame','-b:a','128k']),temp],{windowsHide:true,timeout:120000,maxBuffer:256000,signal});
  if(statSync(temp).size>maximumUpload)throw Error('提取后的音频仍超过上传容量，需要缩小片段范围');
  renameSync(temp,target);return target;
 }finally{try{unlinkSync(temp);}catch{}}
}

export function createSingingSourcePreparer({rootFor,resolve,upload,lookup,getRuntime=()=>({}),getUploadScope=()=>'',probe=probeSongAudio,materialize=materializeSongAudio,now=Date.now}={}){
 const inFlight=new Map();
 function records(c){
  const root=rootFor(c);if(!existsSync(root))return [];
  const result=[];for(const name of readdirSync(root).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)))try{
   const file=join(root,name);if(statSync(file).size>16000)continue;
   const row=JSON.parse(readFileSync(file,'utf8'));if(row.scope===scope(c)&&row.verified===true&&row.title&&row.audio)result.push(row);
  }catch{}
  return result.sort((a,b)=>b.at-a.at);
 }
 function list(c){return records(c).filter(row=>row.uploadScope===getUploadScope(c)).map(row=>({...row,origin:row.origin||'extracted-audio'}));}
 function available({input,candidates=[],title=''}={}){return !!(input?.url||input?.file||candidates.length||typeof lookup==='function'&&title);}
 async function prepare(args={},c={}){
  check(c);const title=clean(args.title),artist=clean(args.artist);
  const cached=list(c).filter(row=>(!title||songKey(row.title)===songKey(title))&&(!artist||songKey(row.artist)===songKey(artist))&&sameSingingSegment(row.segment,args.segment));
  const explicit=args.input?.url||args.input?.file||args.input?.songId||args.input?.id;
  if(title&&!explicit&&!args.preferCurrent&&cached.length)return {...cached[0],cached:true};
  const token=scope(c)+':'+hash(JSON.stringify([title,artist,args.segment||null,getUploadScope(c),args.input||null,args.candidates||[]]));
  if(inFlight.has(token))return inFlight.get(token).then(result=>{check(c);return result;});
  const pending=execute(args,{...c},title,artist).finally(()=>inFlight.delete(token));inFlight.set(token,pending);return pending;
 }
 async function execute(args,c,title,artist){
  const failures=[],seen=new Set();
  const attempt=async input=>{
   check(c);const id=JSON.stringify([input.file||'',input.url||'',input.id||input.songId||'']);if(seen.has(id))return null;seen.add(id);
   try{
    const source=input.file?{...input,file:input.file,provider:input.provider||'local'}:await resolve({...input,includeLyrics:false},c);
    check(c);if(!source.file||!existsSync(source.file)||statSync(source.file).size>128*1024*1024)throw Error('没有取得可读取的原曲音频');
    const info=await probe(source.file,{...getRuntime(c),signal:c.signal});check(c);
    const filename=basename(source.file,extname(source.file)),namedFile=!/^[a-f0-9-]{20,}$/i.test(filename)&&!/^(?:rh-audio|breeze|local)-/i.test(filename)&&!/^(?:source|audio|input|download|reference|sample|recording|录音|音频)(?:[-_ ]?\d+)?$/i.test(filename)?filename:'';
    const originalName=source.originalName?basename(source.originalName,extname(source.originalName)):'';
    const usableOriginal=originalName&&!/^[a-f0-9-]{20,}$/i.test(originalName)?originalName:'';
    const actualTitle=clean(source.title||info.title||usableOriginal||namedFile),actualArtist=clean(source.author||source.artist||info.artist);
    if(!actualTitle)throw Error('音频已取得，但文件和原站资料都没有可靠歌名，需要核对歌曲身份');
    if(title&&songKey(title)!==songKey(actualTitle))throw Error('实际取得的是《'+actualTitle+'》，与点歌《'+title+'》不一致');
    if(artist&&songKey(artist)!==songKey(actualArtist))throw Error('原唱信息与点歌不一致，需要核对版本');
    if((args.excludeTitles||[]).some(name=>songKey(name)===songKey(actualTitle)))throw Error('这首已经唱过，当前要求换一首新歌');
    const root=rootFor(c);mkdirSync(root,{recursive:true});
    const original=await materialize(source.file,info,root,{...getRuntime(c),signal:c.signal});check(c);
    const local=args.segment?await materialize(original,info,root,{...getRuntime(c),signal:c.signal,segment:args.segment}):original;check(c);
    const uploadedInfo=args.segment?await probe(local,{...getRuntime(c),signal:c.signal}):info;check(c);
    if(args.segment&&Number(uploadedInfo.duration)>args.segment.end-args.segment.start+0.05)throw Error('实际裁剪时长超过请求范围，本次未上传');
    const bytes=readFileSync(local);if(!bytes.length||bytes.length>maximumUpload)throw Error('原曲音频不符合当前上传容量');
    const sha256=hash(bytes),old=list(c).find(row=>row.sha256===sha256&&songKey(row.title)===songKey(actualTitle)&&sameSingingSegment(row.segment,args.segment));
    if(old)return {...old,cached:true};
    const result=await upload({type:'audio',name:actualTitle+extname(local),data:bytes.toString('base64'),signal:c.signal});check(c);
    if(!/^(?:api\/)?[\w./-]{1,500}$/.test(result.fileName||'')||result.fileName.split('/').includes('..'))throw Error('原曲上传没有返回可用素材名');
    const row={id:hash(JSON.stringify([actualTitle,actualArtist,sha256,args.segment||null])),scope:scope(c),title:actualTitle,artist:actualArtist,audio:result.fileName,verified:true,origin:'extracted:'+String(source.provider||'local'),url:String(source.url||input.url||'').slice(0,1200),songId:String(source.songId||input.id||'').slice(0,100),sha256,localFile:basename(local),originalLocalFile:basename(original),duration:uploadedInfo.duration||null,originalDuration:info.duration||null,segment:args.segment||null,expectedDuration:source.expectedDuration||null,preview:!args.segment&&source.expectedDuration>0&&Number.isFinite(info.duration)&&info.duration+2<source.expectedDuration,at:now(),uploadScope:getUploadScope(c)};
    const file=join(root,row.id+'.json'),temp=file+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,JSON.stringify(row),{mode:0o600});renameSync(temp,file);}finally{try{unlinkSync(temp);}catch{}}
    return row;
   }catch(error){check(c);failures.push(String(error.message).slice(0,240));return null;}
  };
  const inputs=args.input?[args.input]:args.candidates||[];
  for(const input of inputs){const result=await attempt(input);if(result)return result;}
  if(!args.input&&typeof lookup==='function'){
   check(c);try{const found=await lookup({title,artist},c);for(const input of found||[]){const result=await attempt(input);if(result)return result;}}catch(error){check(c);failures.push(String(error.message).slice(0,240));}
  }
  const error=Object.assign(Error('已尝试自动获取原曲，但尚未准备成功：'+(failures.at(-1)||'没有取得对应的音乐链接或音频')+'。先说明实际缺失的链接、登录或歌曲信息，不要求本人重复下载和填写插件。'),{code:'SONG_ACQUISITION_FAILED',attempted:seen.size,reasons:failures});throw error;
 }
 return {prepare,list,available};
}
