import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,existsSync,readFileSync,readdirSync,statSync,renameSync,unlinkSync} from 'node:fs';
import {join,basename} from 'node:path';
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
  return {provider:'web',url:u.href};
 }catch{}return null;
}
export function webpageAudioCandidates(html,base){
 const found=new Set(),add=raw=>{try{const url=new URL(raw.replaceAll('&amp;','&').replaceAll('\\/','/'),base);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password)found.add(url.href);}catch{}};
 for(const tag of String(html).match(/<(?:audio|source|meta)\b[^>]*>/gi)||[]){const attrs={};for(const m of tag.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g))attrs[m[1].toLowerCase()]=m[2];if(/^<(?:audio|source)\b/i.test(tag))add(attrs.src||'');else if(/^(?:og:audio(?::url)?|twitter:player:stream)$/i.test(attrs.property||attrs.name||''))add(attrs.content||'');}
 for(const m of String(html).matchAll(/["'](?:contentUrl|audioUrl|audio_url)["']\s*:\s*["']([^"']+)["']/g))add(m[1]);
 return [...found].filter(url=>url!==base).slice(0,12);
}
export function selectMusicInput(extracted={}){
 for(const card of extracted.cards||[])if(card.kind==='music'){
  const target=musicTarget({...card,url:card.url||extracted.urls?.[0]||''});if(target)return {...target,title:card.title||'',author:card.author||'',audioUrl:card.audioUrl||''};
  if(card.audioUrl){const target=musicTarget({url:card.audioUrl,audioUrl:card.audioUrl});if(target)return {...target,title:card.title||'',author:card.author||''};}
 }
 for(const url of extracted.urls||[]){const target=musicTarget(url);if(target)return target;}return null;
}
// Detailed measurements stay available to the audio tool. For chat, distribute
// examples through the measured interval or focus on the time the user named.
export function musicTimePoint(words=''){
 const plain=String(words).replace(/https?:\/\/\S+/g,' ').replace(/(?:凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|今晚|明早)\s*\d{1,2}[:：][0-5]\d/g,' ');
 const clock=plain.match(/(?:^|[^\d:])(\d{1,3})[:：]([0-5]\d)(?!\d)/);
 if(clock)return Number(clock[1])*60+Number(clock[2]);
 const seconds=plain.match(/(?:第|到|在|从|听听|看下|^|\s)(?:(\d{1,3})分(?:钟)?)?(\d{1,4})秒/);
 return seconds?Number(seconds[1]||0)*60+Number(seconds[2]):null;
}
export function musicChatEvidence(result,{at=null,details=false,lyrics=false}={}){
 const m=result.music||{},start=Number(result.start)||0,end=Number(result.end)||0;
 const focus=Number.isFinite(at),from=focus?Math.max(start,at-12):start,to=focus?Math.min(end,at+12):end;
 const sample=(items,limit)=>items.length<=limit?items:Array.from({length:limit},(_,i)=>items[Math.round(i*(items.length-1)/(limit-1))]);
 const nearby=rows=>(rows||[]).filter(r=>r.start<to&&r.end>from);
 const sheet=result.lyrics,lines=sheet?.lines||[];
 const timed=lines.filter(l=>Number.isFinite(l.time)&&l.time>=from&&l.time<=to);
 return {title:result.title,author:result.author,duration:result.duration,coverage:result.coverage,
  ...(focus?{askedAt:at,withinMeasuredRange:at>=start&&at<=end}:{}),
  changes:sample(nearby(m.changes),8),levels:sample(nearby(m.energyTimeline),details?20:5),beatCandidates:m.beatCandidates?.slice(0,2),
  soundWindows:nearby(m.soundSamples?.windows),soundCandidates:sample(nearby(m.soundSamples?.candidates).filter(s=>s.label!=='音乐'),10),
  ...(details?{bandEnergy:m.bandEnergy,keyCandidates:m.keyCandidates,keyAmbiguous:m.keyAmbiguous}:{}),
  lyricSource:sheet?.provider,lyricStatus:sheet?.status,lyricExcerpts:sample(timed.length?timed:!focus&&!result.preview&&!result.partial?lines.filter(l=>l.time==null):[],lyrics?16:4).map(l=>({at:l.time,text:String(l.text).slice(0,120)}))};
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
 const digest=value=>createHash('sha256').update(value).digest('hex');
 const sourceDir=c=>join(getCacheDir(),'music-input','sources',digest(JSON.stringify([c.accountId||'',c.personaId||'',c.key||''])));
 function cached(c={}){
  const dir=sourceDir(c);if(!existsSync(dir))return [];
  const rows=[];for(const name of readdirSync(dir).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)))try{
   const path=join(dir,name);if(statSync(path).size>8192)continue;const row=JSON.parse(readFileSync(path,'utf8'));
   if(!/^[a-f0-9]{64}\.audio$/.test(row.file))continue;const file=join(getCacheDir(),'music-input',row.file);if(existsSync(file))rows.push({...row,file});
  }catch{}return rows.sort((a,b)=>b.at-a.at);
 }
 function remember(result,key,c){
  const dir=sourceDir(c);mkdirSync(dir,{recursive:true});
  const row={sourceKey:digest(key),file:basename(result.file),title:result.title||'',author:result.author||'',provider:result.provider,songId:result.songId||'',url:result.url,expectedDuration:result.expectedDuration||null,at:now()};
  const path=join(dir,row.sourceKey+'.json'),temp=path+'.'+randomUUID()+'.tmp';try{writeFileSync(temp,JSON.stringify(row),{mode:0o600});renameSync(temp,path);}finally{try{unlinkSync(temp);}catch{}}
 }
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
  const target=musicTarget(input)||input;if(!target?.provider||!target.url)throw Error('需要实际歌曲页面、分享卡片或音频地址；也可继续用浏览器、平台工具或本地音频取得素材');
  const signal=context.signal?AbortSignal.any([context.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  let actual=target;
  if(target.provider==='netease-share'){
   const response=await get(target.url,signal,1500000);actual=musicTarget(response.url);
   if(!actual){const html=Buffer.from(response.bytes||[]).toString();const embedded=html.match(/https?:\/\/(?:music|y\.music)\.163\.com\/(?:m\/)?song\?[^\s"'<>]+/)?.[0];actual=embedded?musicTarget(embedded.replaceAll('&amp;','&')):null;}
   if(!actual)throw Error('分享短链没有解析到具体歌曲，请打开后复制歌曲链接');
  }
  const cacheKey=actual.provider+':'+(actual.id||actual.url),memoryKey=digest(JSON.stringify([context.accountId||'',context.personaId||'',context.key||'',cacheKey])),old=cache.get(memoryKey);
  const persisted=!old?cached(context).find(row=>row.sourceKey===digest(cacheKey)&&now()-row.at<24*60*60000):null;
  const prior=old&&now()-old.at<5*60000&&existsSync(old.result.file)?old.result:persisted;
  if(prior){const sheet=input.includeLyrics===false?null:input.lyrics?await lyrics({...actual,lyrics:input.lyrics,lyricsConfirmed:input.lyricsConfirmed},{signal}):prior.lyrics||await lyrics(actual,{signal});const result={...prior,lyrics:sheet};cache.set(memoryKey,{at:now(),result:sheet?result:{...result,lyrics:prior.lyrics||null}});remember(result,cacheKey,context);return {...result,cached:true};}
  let metadata={title:String(input.title||''),author:String(input.author||''),expectedDuration:null};
  if(actual.provider==='netease')try{
   const detail=await get('https://music.163.com/api/song/detail/?id='+actual.id+'&ids='+encodeURIComponent('['+actual.id+']'),signal,1500000);
   const raw=JSON.parse(Buffer.from(detail.bytes).toString()),song=raw.songs?.find(s=>String(s.id)===actual.id);
   if(song)metadata={title:String(song.name||metadata.title),author:(song.artists||song.ar||[]).map(a=>a.name).filter(Boolean).join(' / '),expectedDuration:Number(song.duration||song.dt)>0?Number(song.duration||song.dt)/1000:null};
  }catch{}
  const songLyrics=input.includeLyrics===false?null:await lyrics({...actual,...(input.lyrics?{lyrics:input.lyrics,lyricsConfirmed:input.lyricsConfirmed}:{})},{signal});
  const candidates=[...(input.audioUrl?[input.audioUrl]:[]),actual.provider==='netease'?'https://music.163.com/song/media/outer/url?id='+actual.id+'.mp3':actual.url];
  let failure;
  const seen=new Set();for(const url of candidates)try{
   if(seen.has(url)||seen.size>=14)continue;seen.add(url);
   const response=await get(url,signal),bytes=Buffer.from(response.bytes||[]),type=String(response.headers?.['content-type']||'').toLowerCase();
   if(/html/.test(type)||/^\s*</.test(bytes.subarray(0,60).toString())){candidates.push(...webpageAudioCandidates(bytes.toString(),response.url));throw Error('当前是歌曲页面，继续读取页面提供的实际音频；动态播放或登录页面可交给现有浏览器或平台工具');}
   if(!bytes.length||/html|json|text\//.test(type)||/^\s*[<{]/.test(bytes.subarray(0,60).toString()))throw Error('平台返回了网页或限制提示，没有返回音频');
   const dir=join(getCacheDir(),'music-input');mkdirSync(dir,{recursive:true});const file=join(dir,createHash('sha256').update(bytes).digest('hex')+'.audio');if(!existsSync(file))writeFileSync(file,bytes,{flag:'wx'});
   const result={file,url:redactUrl(actual.url),provider:actual.provider,songId:actual.id||'',...metadata,lyrics:songLyrics,acquisition:'public-playable-audio',coverage:'只取得平台当前公开提供的音频，是否完整以解码时长与歌曲标注时长核对；歌词另有来源，未使用第三方解锁或复制账号Cookie'};cache.set(memoryKey,{at:now(),result});remember(result,cacheKey,context);return result;
  }catch(e){failure=e;}
  const error=Error('没有取得这首歌可分析的音频：'+String(failure?.message||'暂不可播放')+'。可让DSH打开原站尝试播放；可继续原站登录；需要本人扫码时再说明，需要购买会员时先确认付款，也可提供本地音频。');error.reason='audio-unavailable';error.lyrics=songLyrics;error.music={...metadata,provider:actual.provider,songId:actual.id||'',url:redactUrl(actual.url)};throw error;
 }
 return {resolve,lyrics,cached};
}
