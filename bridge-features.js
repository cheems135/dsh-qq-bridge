import {createHash, randomUUID} from 'node:crypto';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import http from 'node:http';
import https from 'node:https';
import {gunzipSync, inflateSync, brotliDecompressSync} from 'node:zlib';

export const chatKeyValid = key => /^(private|group):\d{5,20}$/.test(String(key));
export const messageIdValid = id => /^-?\d{1,24}$/.test(String(id));
export const textHash = value => createHash('sha256').update(String(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase()).digest('hex');
export function decodeEntities(value) {
  return String(value ?? '').replace(/&#(x[\da-f]+|\d+);?/gi, (_,code) => {
    const n = code[0].toLowerCase()==='x' ? parseInt(code.slice(1),16) : Number(code);
    return n>0 && n<=0x10ffff && !(n>=0xd800&&n<=0xdfff) ? String.fromCodePoint(n) : '';
  }).replace(/&(amp|quot|apos|lt|gt|nbsp);/g, (_,name) => ({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '})[name]);
}
export function segmentsOf(message) {
  if(Array.isArray(message))return message;
  if(typeof message!=='string')return [];
  const result=[];let start=0;
  for(const match of message.matchAll(/\[CQ:(\w+)((?:,[^\]]*)?)\]/g)) {
    if(match.index>start)result.push({type:'text',data:{text:decodeEntities(message.slice(start,match.index))}});
    const data={};for(const pair of match[2].slice(1).split(',')){const at=pair.indexOf('=');if(at>0)data[pair.slice(0,at)]=decodeEntities(pair.slice(at+1));}
    result.push({type:match[1],data});start=match.index+match[0].length;
  }
  if(start<message.length)result.push({type:'text',data:{text:decodeEntities(message.slice(start))}});
  return result;
}
export function extractIncoming(message, selfId='') {
  const segments=segmentsOf(message);const texts=[];const cards=[];const replies=[];const forwards=[];const urls=[];
  function addUrl(value){for(const m of String(value||'').matchAll(/https?:\/\/[^\s<>"'\u0000-\u001f]+/gi)){const raw=decodeEntities(m[0]).replace(/[，。！？、）】》；]+$/,'');try{const u=new URL(raw);if(!urls.includes(u.href))urls.push(u.href)}catch{}}}
  for(const segment of segments.slice(0,100)) {
    const type=String(segment?.type||'');const data=segment?.data||{};
    if(type==='text'){texts.push(String(data.text||''));addUrl(data.text);}
    else if(type==='at'&&String(data.qq)!==String(selfId))texts.push('@'+String(data.qq||''));
    else if(['image','record','video','file','face','mface'].includes(type))texts.push(({record:'[语音]',video:'[视频]',file:'[文件]',face:'[表情]',mface:'[表情]'})[type]||'');
    else if(type==='reply'&&messageIdValid(data.id))replies.push(String(data.id));
    else if(type==='forward'&&String(data.id||'').length<200)forwards.push(String(data.id||''));
    else if(type==='node'){const child=extractIncoming(data.content||data.message||[],selfId);texts.push('[转发] '+child.text);urls.push(...child.urls);cards.push(...child.cards);}
    else if(['json','xml','share','music'].includes(type)){
      const raw=String(data.data??data.content??'').slice(0,150000);let obj=data;
      if(type==='json')try{obj=JSON.parse(raw)}catch{try{obj=JSON.parse(decodeEntities(raw))}catch{obj={}}}
      const values={}; const structural=[]; let visited=0;
      function walk(node,depth=0){if(!node||typeof node!=='object'||depth>10||visited++>500)return;for(const[k,v]of Object.entries(node)){const key=k.toLowerCase().replace(/[_-]/g,'');if(typeof v==='string'||typeof v==='number'){if(!values[key]&&String(v).trim())values[key]=decodeEntities(v).trim();}else{structural.push(key);walk(v,depth+1)}}}walk(obj);
      const pick=(...names)=>names.map(k=>values[k]).find(Boolean)||'';
      let title=pick('title','songname','videotitle','trackname','name','prompt').slice(0,240);
      let description=pick('desc','summary','detail1','description','content').slice(0,600);
      let author=pick('singer','singername','artist','artistname','author','nickname','uploader','performer').slice(0,160);
      let platform=pick('tag','source','sourcename','appname').slice(0,100);
      let duration=pick('duration','durationtext','playtime').slice(0,60);
      const typeHint=[obj?.app,obj?.view,obj?.type,...structural].join(' ').toLowerCase();
      let kind=type==='music'||/music|audio|song|netease|qq音乐|网易云/.test(typeHint)?'music':/video|bilibili|douyin/.test(typeHint)?'video':'link';
      const navigational=['jumpurl','qqdocurl','target','contentjumpurl','newsurl','weburl','url'];
      let target=pick(...navigational);
      if(type==='xml'){
        const xml=decodeEntities(raw);
        const xmlText=name=>{const m=xml.match(new RegExp('<'+name+'\\b[^>]*>([\\s\\S]*?)<\\/'+name+'>','i'));return m?decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/<[^>]+>/g,'')).trim():'';};
        title=xmlText('title').slice(0,240)||title;
        description=(xmlText('summary')||xmlText('brief')).slice(0,600)||description;
        author=(xmlText('singer')||xmlText('author')).slice(0,160)||author;
        platform=(xml.match(/<source\b[^>]*\bname=["']([^"']*)["']/i)?.[1]||'').slice(0,100)||platform;
        const xmlKind=xml.match(/\b(action|serviceID)=["']([^"']+)["']/i)?.[2]||'';
        if(/music|audio/i.test(xmlKind+' '+xml))kind='music';else if(/video/i.test(xmlKind))kind='video';
        target=xml.match(/\b(?:url|jumpUrl|actionData)=["'](https?:\/\/[^"']+)["']/i)?.[1]||target;
      }
      if(!target){const match=raw.replace(/\\\//g,'/').match(/https?:\/\/[^\s<>"'\u0000-\u001f]+/i);if(match&&!/\.(?:png|jpe?g|gif|webp|mp3|mp4|m4a|ogg)(?:[?#]|$)/i.test(match[0]))target=match[0];}
      if(target)addUrl(target);
      if(kind==='music'&&!author&&description&&description!==title)author=description.slice(0,160);
      if(type==='music'&&!platform)platform=({qq:'QQ 音乐',163:'网易云音乐',custom:'自定义音乐'})[String(data.type)]||String(data.type||'');
      const mediaId=String(data.id||'').slice(0,100);
      const card={type,kind,title,description,author,platform,duration,mediaId};cards.push(card);
      texts.push('[分享卡片] '+[title,author&&'作者/歌手：'+author,description!==author&&description].filter(Boolean).join(' · '));
    }
  }
  if(replies.length)texts.push('[引用消息]');
  if(forwards.length)texts.push('[合并转发]');
  return {text:texts.filter(Boolean).join('\n').trim().slice(0,20000),segments,cards,urls:[...new Set(urls)].slice(0,3),replies:[...new Set(replies)].slice(0,3),forwards:[...new Set(forwards)].slice(0,2)};
}
export function describeSharedCard(card) {
  const label=card.kind==='music'?'音乐':card.kind==='video'?'视频':'链接';
  const lines=[`${label}分享卡片信息：${card.title||'未提供标题'}`];
  if(card.author)lines.push('作者/歌手：'+card.author);
  if(card.platform)lines.push('来源：'+card.platform);
  if(card.duration)lines.push('标注时长：'+card.duration);
  if(card.description&&card.description!==card.author)lines.push('卡片简介：'+card.description);
  if(card.mediaId&&!card.title)lines.push('平台作品编号：'+card.mediaId+'（尚未取得作品名称）');
  if(card.kind==='music')lines.push('能力边界：只取得卡片和网页文字，没有播放或分析音频，不能声称听过旋律、演唱或音色。');
  else if(card.kind==='video')lines.push('能力边界：只取得卡片和网页文字，没有解码视频画面或声音，不能声称看过视频。');
  else lines.push('能力边界：卡片标题和简介不等于网页全文；如分享的是视频或音乐，未分析媒体本体。');
  return lines.join('\n');
}
export function describeSharedLink(link) {
  const status=({read:'已读取网页文字正文',disabled:'链接读取已关闭',metadata:'仅提取到页面元信息，没有可靠正文',restricted:'页面要求登录或验证，未读到正文',empty:'没有提取到有效内容',failed:'读取失败'})[link.status]||'读取状态未知';
  const details=[link.author&&'作者/歌手：'+link.author,link.siteName&&'来源：'+link.siteName,link.duration&&'标注时长：'+link.duration].filter(Boolean).join('\n');
  const boundary=link.mediaType==='music'?'\n媒体边界：这是音乐页面的文字资料，没有播放或分析音乐本体。':link.mediaType==='video'?'\n媒体边界：这是视频页面的文字资料，没有解码视频画面或声音。':'\n媒体边界：网页文字读取不包含视频、音乐和封面画面的识别。';
  return `链接：${link.finalUrl||link.url}\n读取状态：${status}\n标题：${link.title||'未取得'}\n简介：${link.description||'无'}${details?'\n'+details:''}\n${link.body?'网页文字摘录：\n'+link.body:'原因：'+(link.error||'正文不可用；只能根据卡片标题/简介交流，不要声称读过全文')}${boundary}`;
}
export function publicAddress(address) {
  if(isIP(address)===4){const [a,b,c]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===100&&b>=64&&b<=127)||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));}
  if(isIP(address)!==6)return false;
  const v=address.toLowerCase();const first=parseInt(v.split(':')[0]||'0',16);
  return first>=0x2000&&first<=0x3fff&&!v.startsWith('2001:db8:');
}
export function redactUrl(value) {
  try{const u=new URL(value);u.username='';u.password='';u.hash='';for(const key of [...u.searchParams.keys()])if(/token|auth|secret|key|cookie|skey|signature|credential/i.test(key))u.searchParams.set(key,'[redacted]');return u.href.slice(0,1800)}catch{return ''}
}
export async function publicGet(value,{signal,resolve=lookup,maxBytes=1500000}={}) {
  const u=new URL(value);
  if(!['http:','https:'].includes(u.protocol)||u.username||u.password||(u.port&&!['80','443'].includes(u.port)))throw new Error('只读取公开 HTTP / HTTPS 网页');
  const host=u.hostname.replace(/^\[|\]$/g,'');
  if(host.toLowerCase()==='localhost'||host.endsWith('.local'))throw new Error('不读取本机或局域网地址');
  let abortListener;
  const abort = signal ? new Promise((_,reject)=>{abortListener=()=>reject(new Error('网页读取超时或已取消'));if(signal.aborted)abortListener();else signal.addEventListener('abort',abortListener,{once:true})}) : new Promise(()=>{});
  let addresses;
  try { addresses=isIP(host)?[{address:host,family:isIP(host)}]:await Promise.race([resolve(host,{all:true,verbatim:true}),abort]); }
  finally { if(signal&&abortListener)signal.removeEventListener('abort',abortListener); }
  if(!addresses.length||addresses.some(item=>!publicAddress(item.address)))throw new Error('链接指向非公开网络地址');
  const chosen=addresses[0];
  return new Promise((resolveResponse,reject)=>{
    const transport=u.protocol==='https:'?https:http;
    const req=transport.request(u,{method:'GET',agent:false,signal,headers:{'user-agent':'DSH-IM-Bridge/1.8 LinkReader','accept':'text/html,application/xhtml+xml,text/plain,application/json;q=0.8','accept-encoding':'identity'},lookup:(_host,options,cb)=>options?.all?cb(null,[chosen]):cb(null,chosen.address,chosen.family)},res=>{
      if([301,302,303,307,308].includes(res.statusCode)){res.resume();resolveResponse({status:res.statusCode,location:res.headers.location,headers:res.headers,body:''});return;}
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(new Error('网页超过读取大小限制'));return}chunks.push(chunk)});
      res.on('error',reject);res.on('end',()=>{
        try{
          let bytes=Buffer.concat(chunks);const compression=String(res.headers['content-encoding']||'').toLowerCase();
          if(compression==='gzip')bytes=gunzipSync(bytes,{maxOutputLength:maxBytes});
          else if(compression==='br')bytes=brotliDecompressSync(bytes,{maxOutputLength:maxBytes});
          else if(compression==='deflate')bytes=inflateSync(bytes,{maxOutputLength:maxBytes});
          if(bytes.length>maxBytes)throw new Error('解压后网页超过大小限制');
          const contentType=String(res.headers['content-type']||'text/html');
          if(!/text\/|application\/(?:xhtml\+xml|json)/i.test(contentType))throw new Error('链接是文件或媒体，未读取正文');
          const charset=contentType.match(/charset=["']?([\w-]+)/i)?.[1]||'utf-8';
          let body;try{body=new TextDecoder(charset).decode(bytes)}catch{body=bytes.toString('utf8')}
          resolveResponse({status:res.statusCode,headers:res.headers,body});
        }catch(error){reject(error)}
      });
    });
    req.setTimeout(4500,()=>req.destroy(new Error('网页读取超时')));req.on('error',reject);req.end();
  });
}
export function pageContent(html) {
  const raw=String(html||'').slice(0,1500000);const metas={};
  for(const m of raw.matchAll(/<meta\b([^>]+)>/gi)){const a={};for(const p of m[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g))a[p[1].toLowerCase()]=decodeEntities(p[2]??p[3]??p[4]);if(a.property||a.name)metas[(a.property||a.name).toLowerCase()]=a.content||'';}
  const clean=value=>decodeEntities(String(value).replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi,' ').replace(/<!--([\s\S]*?)-->/g,' ').replace(/<\/(p|div|li|h[1-6]|section|article)>|<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,' ')).replace(/[ \t]+/g,' ').replace(/\s*\n\s*/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  let title=clean(metas['og:title']||raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').slice(0,240);
  let description=clean(metas['og:description']||metas.description||'').slice(0,800);
  const candidates=[...raw.matchAll(/<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(m=>clean(m[2])).sort((a,b)=>b.length-a.length);
  let body=candidates[0]||clean(raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1]||raw);
  for(const m of raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const data=JSON.parse(m[1]);const stack=[data];let n=0;while(stack.length&&n++<100){const node=stack.pop();if(!node||typeof node!=='object')continue;if(typeof node.articleBody==='string'&&node.articleBody.length>body.length)body=clean(node.articleBody);for(const v of Object.values(node))if(v&&typeof v==='object')stack.push(v)}}catch{}
  }
  const restricted=/验证码|访问过于频繁|安全验证|sign in to continue|access denied|captcha/i.test(title+' '+body.slice(0,200))||(body.length<500&&/请先登录|登录后查看|需要登录/.test(body));
  let mediaType=/^(music|audio)[.:]/i.test(metas['og:type']||'')?'music':/^video[.:]/i.test(metas['og:type']||'')?'video':'';
  let author=clean(metas.author||metas['article:author']||metas['music:musician']||'').slice(0,160);
  let duration=clean(metas['video:duration']||metas['music:duration']||'').slice(0,60);
  const siteName=clean(metas['og:site_name']||'').slice(0,100);
  const personName=value=>typeof value==='string'?value:Array.isArray(value)?value.map(personName).filter(Boolean).join('、'):value&&typeof value==='object'?String(value.name||''):'';
  for(const m of raw.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)){
    try{const stack=[JSON.parse(m[1])];let n=0;while(stack.length&&n++<100){const node=stack.pop();if(!node||typeof node!=='object')continue;const type=String(node['@type']||'');if(/VideoObject|MusicRecording|MusicAlbum|AudioObject/i.test(type)){mediaType=/VideoObject/i.test(type)?'video':'music';title=title||clean(node.name||node.headline||'').slice(0,240);description=description||clean(node.description||'').slice(0,800);author=author||clean(personName(node.byArtist||node.performer||node.author||node.creator)).slice(0,160);duration=duration||String(node.duration||'').slice(0,60);}for(const v of Object.values(node))if(v&&typeof v==='object')stack.push(v)}}catch{}
  }
  return {title,description,body:restricted?'':body.slice(0,10000),status:restricted?'restricted':body.length>=120?'read':title||description?'metadata':'empty',mediaType,author,duration,siteName};
}
export async function readSharedLink(url,{read=publicGet,signal=AbortSignal.timeout(8500)}={}) {
  let target=new URL(url).href;
  try{
    for(let count=0;count<5;count++){
      const response=await read(target,{signal});
      if(response.location&&[301,302,303,307,308].includes(response.status)){target=new URL(response.location,target).href;continue;}
      if(response.status<200||response.status>=300)throw new Error('网页返回 HTTP '+response.status);
      return {url:redactUrl(url),finalUrl:redactUrl(target),...pageContent(response.body)};
    }
    throw new Error('链接跳转次数过多');
  }catch(error){return{url:redactUrl(url),finalUrl:redactUrl(target),status:'failed',title:'',description:'',body:'',error:String(error.message||error).slice(0,200)}}
}
export function normalizeMemory(value) {
  const data=value&&typeof value==='object'?value:{};
  const items=(Array.isArray(data.items)?data.items:typeof data.text==='string'&&data.text.trim()?[{id:'legacy-'+textHash(data.text).slice(0,16),kind:'topic',text:data.text,source:{type:'legacy'},confirmed:false,updatedAt:data.at}]:[]).slice(0,150).map(item=>({
    id:String(item.id||randomUUID()).slice(0,80),kind:['fact','preference','topic','pending'].includes(item.kind)?item.kind:'pending',text:String(item.text||'').trim().slice(0,1000),
    proposedKind:['fact','preference','topic'].includes(item.proposedKind)?item.proposedKind:'fact',confirmed:item.confirmed===true,pinned:item.pinned===true,
    source:{...(Number(item.source?.observedAt)>0?{observedAt:Number(item.source.observedAt)}:{}),type:String(item.source?.type||'manual').slice(0,30),messageIds:(item.source?.messageIds||[]).map(String).slice(0,10),quote:String(item.source?.quote||'').slice(0,350),speakerId:/^\d{5,20}$/.test(String(item.source?.speakerId||''))?String(item.source.speakerId):'',speakerName:String(item.source?.speakerName||'').slice(0,80)},
    ...(typeof item.slot==='string'?{slot:item.slot.slice(0,100)}:{}),...(Number(item.expiresAt)>0?{expiresAt:Number(item.expiresAt)}:{}),...(item.reviewReason?{reviewReason:String(item.reviewReason).slice(0,180)}:{}),...(Array.isArray(item.history)?{history:item.history.slice(-4).map(h=>({text:String(h.text||'').slice(0,300),at:Number(h.at)||0}))}:{}),
    createdAt:Number(item.createdAt)||Date.now(),updatedAt:Number(item.updatedAt)||Date.now()
  })).filter(i=>i.text);
  return{version:2,items,suppressed:Array.isArray(data.suppressed)?data.suppressed.filter(s=>/^[a-f0-9]{64}$/.test(s)).slice(-400):[],contextAfter:Number(data.contextAfter)||0,at:Number(data.at)||Date.now(),reason:String(data.reason||''),...memoryExtraction(data)};
}
export function memoryText(value,maxChars=2000) {
  const memory=normalizeMemory(value);let used=0;const included=[];
  const order=memory.items.filter(i=>i.kind!=='pending'&&(i.confirmed||i.kind==='topic')&&(!i.expiresAt||i.expiresAt>Date.now())).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||Number(b.confirmed)-Number(a.confirmed)||b.updatedAt-a.updatedAt);
  const lines=[];
  for(const item of order){const line=`[${item.source.type==='auto'?'用户自述':({fact:'已确认事实',preference:'已确认偏好',topic:'话题线索'})[item.kind]}${item.pinned?'·固定':''}${item.source.type==='legacy'?'·旧摘要待核实':''}] ${item.source.speakerId ? '〔'+(item.source.speakerName||'QQ尾号'+item.source.speakerId.slice(-4))+' 的原话〕 ' : ''}${item.text}`;if(!item.pinned&&used+line.length>Math.max(400,maxChars))continue;if(used+line.length>6500)continue;used+=line.length;lines.push(line);included.push(item.id)}
  return{text:lines.join('\n'),ids:included};
}
export function mergeCandidates(value,candidates,evidence) {
  const memory=normalizeMemory(value);const known=new Set(memory.items.map(i=>(i.source.speakerId||'')+':'+textHash(i.text)));
  const diagnostics={submitted:Array.isArray(candidates)?candidates.length:0,duplicates:0,suppressed:0,rejected:{emptyText:0,invalidKind:0,missingSource:0,unmatchedQuote:0,mixedSpeakers:0,capacity:0}};let added=0,pending=0;
  const normalized=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'');
  for(const raw of Array.isArray(candidates)?candidates.slice(0,12):[]){
    const candidate=raw&&typeof raw==='object'?raw:{};const text=String(candidate.text||'').trim().slice(0,300);const hash=textHash(text);
    if(!text){diagnostics.rejected.emptyText++;continue;}
    if(!['fact','preference','topic'].includes(candidate.kind)){diagnostics.rejected.invalidKind++;continue;}
    if(memory.suppressed.includes(hash)){diagnostics.suppressed++;continue;}
    const rawIds=candidate.sourceIds??candidate.source_ids??candidate.messageIds;const supplied=(Array.isArray(rawIds)?rawIds:[]).map(String);const matching=[];
    if(!supplied.length||supplied.some(id=>{const e=evidence.find(row=>String(row.id)===id||String(row.ref||'')===id);if(e&&!matching.includes(e))matching.push(e);return !e;})){diagnostics.rejected.missingSource++;continue;}
    const quote=String(candidate.quote||'').trim().slice(0,250);const quoteSource=quote&&matching.find(e=>normalized(e.text).includes(normalized(quote)));
    if(!quoteSource){diagnostics.rejected.unmatchedQuote++;continue;}
    const speakers=new Set(matching.map(e=>String(e.speakerId||'')));if(speakers.size>1){diagnostics.rejected.mixedSpeakers++;continue;}
    const speakerId=String(quoteSource.speakerId||''),speakerName=String(quoteSource.speakerName||'').slice(0,80),identity=speakerId+':'+hash;
    if(known.has(identity)||known.has(':'+hash)){diagnostics.duplicates++;continue;}
    if(memory.items.length>=150){diagnostics.rejected.capacity++;continue;}
    const topic=candidate.kind==='topic';
    memory.items.push({id:randomUUID(),kind:topic?'topic':'pending',proposedKind:candidate.kind==='preference'?'preference':'fact',text,confirmed:false,pinned:false,source:{type:'summary',observedAt:Number(quoteSource.at)||Date.now(),messageIds:matching.map(e=>String(e.id)),quote,speakerId,speakerName},createdAt:Date.now(),updatedAt:Date.now()});known.add(identity);added++;if(!topic)pending++;
  }
  memory.at=Date.now();memory.reason='structured-summary';return{memory,added,pending,diagnostics};
}
export function normalizeProfile(value={}) {
  const v=value&&typeof value==='object'?value:{};
  return{personaId:String(v.personaId||'').slice(0,100),voiceEnabled:typeof v.voiceEnabled==='boolean'?v.voiceEnabled:null,voiceName:String(v.voiceName||'').slice(0,100),replyChars:Number.isFinite(Number(v.replyChars))?Math.min(2000,Math.max(0,Math.round(Number(v.replyChars)))):0,proactive:typeof v.proactive==='boolean'?v.proactive:null};
}
export function safeBackup(settings,memories,{includeMessages=false,messages=[]}={}) {
  const profiles=Object.fromEntries(Object.entries(settings.contactProfiles||{}).filter(([key])=>chatKeyValid(key)).map(([key,value])=>[key,normalizeProfile(value)]));
  const modelByChat=Object.fromEntries(Object.entries(settings.modelByChat||{}).filter(([key,v])=>chatKeyValid(key)&&v&&/^[\w.-]{1,100}$/.test(v.provider)&&/^[\w./:@-]{1,150}$/.test(v.model)).map(([key,v])=>[key,{provider:String(v.provider),model:String(v.model)}]));
  const safe={personae:(settings.personae||[]).map(p=>({id:String(p.id),name:String(p.name),preset:String(p.preset||'whale'),prompt:String(p.prompt||'')})),activePersonaId:String(settings.activePersonaId||''),basePersona:String(settings.basePersona||''),presetNames:{...settings.presetNames},presetPrompts:{...settings.presetPrompts},
    whitelist:(settings.whitelist||[]).map(String),groups:(settings.groups||[]).map(String),owners:(settings.owners||[]).map(String),userNotes:{...settings.userNotes},disabledUsers:(settings.disabledUsers||[]).map(String),contactProfiles:profiles,
    modelByChat,companion:settings.companion?{enabled:settings.companion.enabled!==false,continuity:settings.companion.continuity!==false,respectPauses:settings.companion.respectPauses!==false,waitMode:settings.companion.waitMode||'natural'}:undefined,memory:{schedule:settings.memory?.schedule==='turns'?'turns':'daily',mode:settings.memory?.mode==='review'?'review':'auto',enabled:settings.memory?.enabled!==false,everyTurns:settings.memory?.everyTurns||40,maxChars:settings.memory?.maxChars||400},dnd:{enabled:!!settings.dnd?.enabled,startHour:settings.dnd?.startHour??23,endHour:settings.dnd?.endHour??9},proactiveCfg:{startHour:settings.proactiveCfg?.startHour??9,endHour:settings.proactiveCfg?.endHour??23,maxPerDay:settings.proactiveCfg?.maxPerDay??3},
    stickerDisabled:[...(settings.stickerDisabled||[])],stickerGroup:{...settings.stickerGroup},stickerGroups:[...(settings.stickerGroups||[])]};
  return{format:'dsh-im-bridge-backup',version:1,createdAt:Date.now(),settings:safe,memories:Object.fromEntries(Object.entries(memories||{}).filter(([key])=>chatKeyValid(key)).map(([key,value])=>[key,normalizeMemory(value)])),...(includeMessages?{messages:messages.slice(-1000).map(m=>({time:m.time,chat:m.chat,dir:m.dir,text:String(m.text||'').slice(0,20000)}))}:{}),assets:[]};
}
export function validateBackup(input) {
  if(input?.format!=='dsh-im-bridge-backup'||input.version!==1)throw new Error('不是支持的 QQ 桥接备份格式');
  const source=input.settings||{};const out=safeBackup(source,input.memories||{}, {includeMessages:Array.isArray(input.messages),messages:Array.isArray(input.messages)?input.messages:[]});
  out.createdAt=Number(input.createdAt)||0;
  out.settings.memory={schedule:source.memory?.schedule==='turns'?'turns':'daily',mode:source.memory?.mode==='review'?'review':'auto',enabled:source.memory?.enabled!==false,everyTurns:Math.min(500,Math.max(5,Number(source.memory?.everyTurns)||40)),maxChars:Math.min(2000,Math.max(120,Number(source.memory?.maxChars)||400))};
  out.settings.dnd={enabled:source.dnd?.enabled===true,startHour:Math.min(23,Math.max(0,Number(source.dnd?.startHour)||0)),endHour:Math.min(24,Math.max(0,Number(source.dnd?.endHour)||0))};
  out.settings.proactiveCfg={startHour:Math.min(23,Math.max(0,Number(source.proactiveCfg?.startHour)||9)),endHour:Math.min(24,Math.max(1,Number(source.proactiveCfg?.endHour)||23)),maxPerDay:Math.min(20,Math.max(1,Number(source.proactiveCfg?.maxPerDay)||3))};
  out.settings.basePersona=out.settings.basePersona.slice(0,20000);
  if(out.settings.personae.length>200||Object.keys(out.memories).length>1000)throw new Error('备份条目数量超过限制');
  for(const name of ['whitelist','groups','owners','disabledUsers'])out.settings[name]=out.settings[name].filter(v=>/^\d{5,20}$/.test(v)).slice(0,1000);
  for(const name of ['presetNames','presetPrompts'])out.settings[name]=Object.fromEntries(Object.entries(out.settings[name]||{}).filter(([key])=>/^[\w-]{1,100}$/.test(key)).map(([key,v])=>[key,String(v).slice(0,20000)]));
  out.settings.userNotes=Object.fromEntries(Object.entries(out.settings.userNotes||{}).filter(([key])=>/^\d{5,20}$/.test(key)).map(([key,v])=>[key,String(v).slice(0,100)]));
  out.settings.personae=out.settings.personae.filter(p=>/^[\w-]{1,100}$/.test(p.id)).map(p=>({...p,name:p.name.slice(0,100),prompt:p.prompt.slice(0,20000),preset:/^[\w-]{1,100}$/.test(p.preset)?p.preset:'whale'}));
  out.settings.stickerGroup=Object.fromEntries(Object.entries(out.settings.stickerGroup||{}).filter(([key])=>safeAssetName(key)).map(([k,v])=>[k,String(v).slice(0,100)]));
  out.settings.stickerDisabled=out.settings.stickerDisabled.filter(safeAssetName);out.settings.stickerGroups=out.settings.stickerGroups.map(v=>String(v).slice(0,100)).slice(0,200);
  let bytes=0;
  out.assets=(Array.isArray(input.assets)?input.assets:[]).map(asset=>{
    if(!safeAssetName(asset.name)||!/\.(png|jpe?g|gif|webp)$/i.test(asset.name)||!/^[-\w+/=\s]*$/.test(String(asset.data||'')))throw new Error('素材文件名或编码不合法');
    const data=Buffer.from(String(asset.data||''),'base64');bytes+=data.length;
    const image=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||data[0]===255&&data[1]===216||/^GIF8/.test(data.subarray(0,6).toString())||data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP';
    if(!image||data.length>8*1024*1024||bytes>32*1024*1024)throw new Error('素材不是支持的图片或总量超过 32MB');
    return{name:asset.name,data:data.toString('base64')};
  });
  return out;
}
export function safeAssetName(name) {return typeof name==='string'&&name.length>0&&name.length<=180&&!/[<>:"/\\|?*\u0000-\u001f]/.test(name)&&!name.includes('..')&&!/[. ]$/.test(name)&&!name.startsWith('.')&&!/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)}

export function memoryEvidence(rows, key, floor=0, everyTurns=40) {
  const privateId=key.startsWith('private:')?key.split(':')[1]:'';
  const limit=Math.max(80,Math.min(500,Math.round(Number(everyTurns)||40)*2));
  return rows.filter(m=>m.chat===key&&m.dir==='in'&&Number(m.time)>=floor)
    .map((m,i)=>({at:Number(m.time)||0,id:String(m.messageId||m.localId||'local-'+m.time+'-'+i),text:String(m.userText!==undefined?m.userText:m.text||'').trim().slice(0,2000),speakerId:String(m.speakerId||privateId),speakerName:String(m.speakerName||'').slice(0,80)}))
    .filter(m=>m.text&&(privateId||/^\d{5,20}$/.test(m.speakerId))&&!/^\[图片\]$|^\[分享卡片\]|^\[合并转发\]/.test(m.text))
    .slice(-limit);
}
export function memoryOverview(value, maxChars=2000) {
  const memory=normalizeMemory(value); const used=memoryText(memory,maxChars);
  return {total:memory.items.length,confirmed:memory.items.filter(i=>i.confirmed&&i.kind!=='pending').length,pending:memory.items.filter(i=>i.kind==='pending').length,topics:memory.items.filter(i=>i.kind==='topic').length,legacy:memory.items.filter(i=>i.source.type==='legacy').length,used:used.ids.length,usedChars:used.text.length,extractionAfter:memory.extractionAfter,legacyExtractionAfter:memory.legacyExtractionAfter,extractionBoundary:memory.extractionBoundary,evidenceExclusions:memory.evidenceTombstones.length};
}

export function memoryExtraction(value) {
  const data=value&&typeof value==='object'?value:{};const modern=Number(data.extractionVersion)===1;
  const after=modern?Math.max(0,Number(data.extractionAfter)||0):0;
  const legacyAfter=modern?Math.max(0,Number(data.legacyExtractionAfter)||0):Math.max(0,Number(data.contextAfter)||0);
  const tombstones=(Array.isArray(data.evidenceTombstones)?data.evidenceTombstones:[]).filter(x=>x&&typeof x==='object').map(x=>({messageId:String(x.messageId||'').slice(0,120),quote:String(x.quote||'').slice(0,350)})).filter(x=>x.messageId||x.quote).slice(-1000);
  return {extractionVersion:1,extractionAfter:after,legacyExtractionAfter:legacyAfter,extractionBoundary:['clear','source_unknown','none'].includes(data.extractionBoundary)?data.extractionBoundary:'none',evidenceTombstones:tombstones};
}
export function extractionEvidence(rows,key,value,everyTurns=40,{olderHistory=false}={}) {
  const policy=memoryExtraction(value);const floor=Math.max(policy.extractionAfter,olderHistory?0:policy.legacyExtractionAfter);
  return memoryEvidence(rows,key,floor,everyTurns).filter(row=>!policy.evidenceTombstones.some(t=>t.messageId?String(row.id)===t.messageId:!!t.quote&&String(row.text).includes(t.quote))).map((row,i)=>({...row,ref:'u'+(i+1)}));
}
export function applyMemoryEditPolicy(memory,action,item,body={},now=Date.now()) {
  Object.assign(memory,memoryExtraction(memory));
  const rememberSource=entry=>{
    const ids=entry?.source?.messageIds||[];const quote=String(entry?.source?.quote||'');
    if(ids.length){for(const messageId of ids)memory.evidenceTombstones.push({messageId:String(messageId),quote});return true;}
    if(quote){memory.evidenceTombstones.push({messageId:'',quote});return true;}return false;
  };
  if(action==='clear'){
    for(const entry of memory.items||[])rememberSource(entry);
    memory.extractionAfter=Math.max(memory.extractionAfter,now+1);memory.legacyExtractionAfter=0;memory.extractionBoundary='clear';
  }else if(action==='delete'||action==='save'&&item&&item.text!==String(body.text||'').trim().slice(0,1000)){
    if(!rememberSource(item)){memory.extractionAfter=Math.max(memory.extractionAfter,now+1);memory.extractionBoundary='source_unknown';}
  }
  const seen=new Set();memory.evidenceTombstones=memory.evidenceTombstones.filter(t=>{const key=t.messageId+'\n'+t.quote;if(seen.has(key))return false;seen.add(key);return true;});
  if(memory.evidenceTombstones.length>1000){memory.extractionAfter=Math.max(memory.extractionAfter,now+1);memory.extractionBoundary='source_unknown';memory.evidenceTombstones=memory.evidenceTombstones.slice(-1000);}
  return memory;
}
export function mergeMemoryPolicy(current,incoming) {
  const left=memoryExtraction(current),right=memoryExtraction(incoming);const hardWinner=right.extractionAfter>left.extractionAfter?right:left;
  const unique=new Map();for(const t of [...left.evidenceTombstones,...right.evidenceTombstones])unique.set(t.messageId+'\n'+t.quote,t);
  Object.assign(current,{extractionVersion:1,extractionAfter:Math.max(left.extractionAfter,right.extractionAfter),legacyExtractionAfter:Math.max(left.legacyExtractionAfter,right.legacyExtractionAfter),extractionBoundary:hardWinner.extractionBoundary,evidenceTombstones:[...unique.values()].slice(-1000)});
  current.suppressed=[...new Set([...(current.suppressed||[]),...(incoming?.suppressed||[])])].slice(-400);
  if(unique.size>1000){current.extractionAfter=Math.max(current.extractionAfter,Date.now()+1);current.extractionBoundary='source_unknown';}
  return current;
}
