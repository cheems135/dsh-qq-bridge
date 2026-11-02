import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {publicGet,redactUrl} from './bridge-features.js';
export function musicTarget(value={}){
 if(typeof value==='string')value={url:value};
 const raw=String(value.url||''),id=String(value.songId||value.mediaId||'');
 if(id&&/^\d{1,20}$/.test(id)&&(!raw&&/网易|163|netease/i.test(value.platform||'')||value.songId))return {provider:'netease',id,url:'https://music.163.com/song?id='+id};
 try{const u=new URL(raw);if(!['https:','http:'].includes(u.protocol)||u.username||u.password)return null;
  if(/^(?:music|y\.music)\.163\.com$/.test(u.hostname)){
   const nested=new URL(u.hash.startsWith('#/')?u.origin+u.hash.slice(1):u.href),song=nested.searchParams.get('id')||nested.pathname.match(/\/song\/(\d+)/)?.[1];
   if(/\/song(?:\/|$)/.test(nested.pathname)&&/^\d{1,20}$/.test(song||''))return {provider:'netease',id:song,url:'https://music.163.com/song?id='+song};
  }
  if(/^(?:163cn\.tv|163cn\.com)$/.test(u.hostname))return {provider:'netease-share',url:u.href};
  if(/\.(?:mp3|flac|wav|ogg|m4a|aac)(?:$)/i.test(u.pathname)||value.audioUrl===raw)return {provider:'direct',url:u.href};
 }catch{}return null;
}
export function selectMusicInput(extracted={}){
 for(const card of extracted.cards||[])if(card.kind==='music'){
  const target=musicTarget({...card,url:card.url||extracted.urls?.[0]||''});if(target)return {...target,title:card.title||'',author:card.author||'',audioUrl:card.audioUrl||''};
  if(card.audioUrl){const target=musicTarget({url:card.audioUrl,audioUrl:card.audioUrl});if(target)return {...target,title:card.title||'',author:card.author||''};}
 }
 for(const url of extracted.urls||[]){const target=musicTarget(url);if(target)return target;}return null;
}
export function parseMusicLyrics(value,{source='',provider='user',songId='',confirmed=false}={}){
 const raw=String(value||'').replace(/\u0000/g,'').slice(0,64000),lines=[];
 for(const row of raw.split(/\r?\n/)){
  const text=row.replace(/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g,'').trim();
  const stamps=[...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
  if(!text||/^\[(?:ar|ti|al|by|offset|length|re|ve):/i.test(text))continue;
  if(stamps.length)for(const m of stamps)lines.push({time:Number(m[1])*60+Number(m[2])+Number('0.'+(m[3]||'0')),text});
  else lines.push({time:null,text});
 }
 const meaningful=lines.filter(line=>!/^(?:纯音乐[，,]?请欣赏|instrumental)$/i.test(line.text));
 return {status:meaningful.length?'available':raw.trim()?'instrumental':'unavailable',provider,songId,source:redactUrl(source),confirmed:provider==='netease'||confirmed===true,lines:meaningful.sort((a,b)=>(a.time??Infinity)-(b.time??Infinity)),text:meaningful.map(line=>line.text).join('\n'),coverage:'歌词来源单独记录；它不是由频谱推导，也不能证明已听完整首歌'};
}
export function createMusicInput({getCacheDir,request=publicGet,now=()=>Date.now()}={}){
 const cache=new Map();
 async function get(url,signal,maxBytes=72*1024*1024){
  let target=url;for(let i=0;i<6;i++){
   const response=await request(target,{binary:true,maxBytes,timeoutMs:15000,signal});
   if([301,302,303,307,308].includes(response.status)){if(!response.location)throw Error('音乐地址跳转缺少目标');target=new URL(response.location,target).href;continue;}
   if(response.status!==200)throw Error('音乐服务未提供可用音频（HTTP '+response.status+'）');return {...response,url:target};
  }throw Error('音乐链接跳转过多');
 }
 async function lyrics(input={},context={}){
  if(typeof input==='string')input={url:input};
  if(typeof input.lyrics==='string')return parseMusicLyrics(input.lyrics,{provider:'user',confirmed:input.lyricsConfirmed===true});
  const target=musicTarget(input)||input;if(target.provider!=='netease'||!/^\d{1,20}$/.test(target.id||''))return {status:'unavailable',lines:[],text:'',reason:'需要对应网易云歌曲编号或本人提供的歌词文件'};
  const url='https://music.163.com/api/song/lyric?os=pc&id='+target.id+'&lv=-1&kv=-1&tv=-1';
  try{const response=await get(url,context.signal||AbortSignal.timeout(15000),256000),raw=JSON.parse(Buffer.from(response.bytes||[]).toString());if(raw.code!==200)throw Error('平台未开放这首歌的歌词');const result=parseMusicLyrics(raw.lrc?.lyric||'',{source:url,provider:'netease',songId:target.id});if(raw.nolyric===true)result.status='instrumental';if(raw.uncollected===true)result.reason='平台尚未收录歌词';if(raw.tlyric?.lyric)result.translation=parseMusicLyrics(raw.tlyric.lyric,{source:url,provider:'netease',songId:target.id}).lines;return result;}
  catch{return {status:'unavailable',provider:'netease',songId:target.id,source:url,lines:[],text:'',reason:'平台歌词暂不可取得，可提供LRC或确认过的歌词；不使用机器猜测补齐'};}
 }
 async function resolve(input={},context={}){
  const target=musicTarget(input)||input;if(!target?.provider||!target.url)throw Error('请提供网易云歌曲链接、分享卡片或真实音频地址');
  const signal=context.signal?AbortSignal.any([context.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  let actual=target;
  if(target.provider==='netease-share'){
   const response=await get(target.url,signal,1500000);actual=musicTarget(response.url);
   if(!actual){const html=Buffer.from(response.bytes||[]).toString();const embedded=html.match(/https?:\/\/(?:music|y\.music)\.163\.com\/(?:m\/)?song\?[^\s"'<>]+/)?.[0];actual=embedded?musicTarget(embedded.replaceAll('&amp;','&')):null;}
   if(!actual)throw Error('分享短链没有解析到具体歌曲，请打开后复制歌曲链接');
  }
  const cacheKey=actual.provider+':'+(actual.id||actual.url),old=cache.get(cacheKey);
  if(old&&now()-old.at<5*60000&&existsSync(old.result.file))return {...old.result,cached:true};
  let metadata={title:String(input.title||''),author:String(input.author||''),expectedDuration:null};
  if(actual.provider==='netease')try{
   const detail=await get('https://music.163.com/api/song/detail/?id='+actual.id+'&ids='+encodeURIComponent('['+actual.id+']'),signal,1500000);
   const raw=JSON.parse(Buffer.from(detail.bytes).toString()),song=raw.songs?.find(s=>String(s.id)===actual.id);
   if(song)metadata={title:String(song.name||metadata.title),author:(song.artists||song.ar||[]).map(a=>a.name).filter(Boolean).join(' / '),expectedDuration:Number(song.duration||song.dt)>0?Number(song.duration||song.dt)/1000:null};
  }catch{}
  const songLyrics=await lyrics({...actual,...(input.lyrics?{lyrics:input.lyrics,lyricsConfirmed:input.lyricsConfirmed}:{})},{signal});
  const candidates=[...(input.audioUrl?[input.audioUrl]:[]),actual.provider==='netease'?'https://music.163.com/song/media/outer/url?id='+actual.id+'.mp3':actual.url];
  let failure;
  for(const url of [...new Set(candidates)])try{
   const response=await get(url,signal),bytes=Buffer.from(response.bytes||[]),type=String(response.headers?.['content-type']||'').toLowerCase();
   if(!bytes.length||/html|json|text\//.test(type)||/^\s*[<{]/.test(bytes.subarray(0,60).toString()))throw Error('平台返回了网页或限制提示，没有返回音频');
   const dir=join(getCacheDir(),'music-input');mkdirSync(dir,{recursive:true});const file=join(dir,createHash('sha256').update(bytes).digest('hex')+'.audio');if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx'});
   const result={file,url:redactUrl(actual.url),provider:actual.provider,songId:actual.id||'',...metadata,lyrics:songLyrics,acquisition:'public-playable-audio',coverage:'只取得平台当前公开提供的音频，是否完整以解码时长与歌曲标注时长核对；歌词另有来源，未使用第三方解锁或复制账号Cookie'};cache.set(cacheKey,{at:now(),result});return result;
  }catch(e){failure=e;}
  const error=Error('没有取得这首歌可分析的音频：'+String(failure?.message||'暂不可播放')+'。可让DSH打开原站尝试播放；若需登录或会员请询问本人，也可提供本地音频。');error.reason='audio-unavailable';error.lyrics=songLyrics;error.music={...metadata,provider:actual.provider,songId:actual.id||'',url:redactUrl(actual.url)};throw error;
 }
 return {resolve,lyrics};
}
