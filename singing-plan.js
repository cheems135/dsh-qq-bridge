export const songKey=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');
const clean=value=>String(value??'').normalize('NFKC').trim().slice(0,80);
const quoted=value=>[...String(value||'').matchAll(/《([^《》\n]{1,80})》/g)].map(match=>clean(match[1]));
const generic=/^(?:你|我|自己|这个|那个|这首|那首|这段|那段|歌|歌曲|首歌|一首歌?|一段歌?|新歌|新的歌|随便(?:一首)?|两句|几句|首新歌|一首新歌)$/;

function count(value){
 if(/^\d+(?:\.\d+)?$/.test(value))return Number(value);
 const digits={零:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};let result=0,current=0;
 for(const char of value){if(Object.hasOwn(digits,char))current=digits[char];else if(char==='十'){result+=(current||1)*10;current=0;}else if(char==='百'){result+=(current||1)*100;current=0;}else return NaN;}return result+current;
}
export function singingSegment(request='',{start,end,seconds}={}){
 const text=String(request||'').replace(/《[^》]*》/g,'');
 if(start!==undefined||end!==undefined||seconds!==undefined){const from=Number(start||0),to=end!==undefined?Number(end):from+Number(seconds);if(!Number.isFinite(from)||!Number.isFinite(to)||from<0||to<=from)throw Error('歌曲裁剪范围无效');return {start:from,end:to};}
 const range=text.match(/(?:从)?\s*(\d+(?:\.\d+)?)\s*秒?\s*(?:到|至|—|~|～|-)\s*(\d+(?:\.\d+)?)\s*秒/);
 if(range){const from=Number(range[1]),to=Number(range[2]);if(to<=from)throw Error('歌曲裁剪结束时间必须晚于开始时间');return {start:from,end:to};}
 const duration=text.match(/(?:前|开头(?:的)?|最初(?:的)?|只(?:唱|试|尝试|要|取|截)?|一小段|一段|截(?:取)?|剪(?:取)?).{0,5}?([\d零一二两三四五六七八九十百.]+)\s*(秒|分钟|分|s(?:ec)?|min)/i);
 if(!duration)return null;const length=count(duration[1])*(/分钟|分|min/i.test(duration[2])?60:1);return length>0&&Number.isFinite(length)?{start:0,end:length}:null;
}
export const sameSingingSegment=(left,right)=>!left&&!right||!!left&&!!right&&left.start===right.start&&left.end===right.end;

export function parseSingingRequest(request='',context=[]){
 const words=String(request||'').normalize('NFKC').trim();
 const fresh=/重新|重唱|重录|重做|新录|新唱|新版|新的版本|再录|别(?:放|发|用).{0,12}(?:存|旧)|不(?:是|要|用).{0,12}(?:库存|旧版|播放上次|放上次)/.test(words);
 const different=/新歌|新的(?:歌|歌曲)|换(?:一)?首|另一首|别的歌/.test(words);
 const titles=quoted(words);
 if(titles.length>1)return {title:'',fresh,different,ambiguous:true};
 let title=titles[0]||'',reference=false;
 if(!title&&/这(?:个|首|段)|那(?:个|首|段)/.test(words)){
  reference=true;
  for(const row of [...context].reverse()){
   if(!['user','assistant'].includes(row.role))continue;
   const text=[row.text,row.rawText].filter(Boolean).join('\n');
   const names=[...new Set(quoted(text))];
   const card=text.match(/\[分享卡片\]\s*([^\n·]{1,80})/);
   if(card)names.push(clean(card[1]));
   const distinct=[...new Set(names)];
   if(distinct.length>1)return {title:'',fresh,different,reference,ambiguous:true};
   if(distinct.length===1){title=distinct[0];break;}
  }
 }
 if(!title&&!reference){
  const match=words.match(/(?:翻唱|清唱|演唱|唱)(?:一下|一遍|一首|首|一段|段|给我|给你|你|再|个)*\s*(.+?)(?:给我听|给我|吧|吗|呀|呗|谢谢|[。！!？?])?$/)||words.match(/(?:播放|点歌|听听|听)(?:一下|一遍|一首|首|一段|段|给我|给你|你|再|个)*\s*(.+?)(?:给我听|给我|吧|吗|呀|呗|谢谢|[。！!？?])?$/);
  const candidate=clean(match?.[1]||'').replace(/(?:给我听|给我|吧|吗|呀|呗|谢谢|[。！!？?])+$/,'').trim();
  if(candidate&&!singingSegment(candidate)&&!generic.test(candidate)&&!/[，,。！？!?\n]/.test(candidate)&&!/(?:不要|别|重新|库存|一首|新歌|唱)/.test(candidate))title=candidate;
 }
 return {title,fresh,different,reference,ambiguous:false};
}

export function selectSingingPlan({request='',context=[],contextSong=null,config={},versions=[],sources=[],activeSource=null,title='',artist='',fresh=false,preview=false,workflowKey='',segment=singingSegment(request)}={}){
 const parsed=parseSingingRequest(request,context);
 const explicitTitle=!!title,current=activeSource?.verified===true?activeSource:contextSong;
 if(title&&parsed.title&&!parsed.reference&&songKey(title)!==songKey(parsed.title))return {action:'clarify',reason:'当前歌名与这次点歌不一致，请先核对'};
 title=clean(title||parsed.title);artist=clean(artist);
 fresh=fresh||parsed.fresh;
 if(parsed.ambiguous&&!(parsed.reference&&current?.title))return {action:'clarify',reason:'这次点歌包含多个可能的歌名，请先确认是哪一首'};
 if((!title||parsed.reference&&!explicitTitle)&&!parsed.different){
  if(current?.title){title=clean(current.title);artist=artist||clean(current.artist||current.author);}
  else if(current?.pendingIdentity)return {action:'need-source',reason:'本轮有新的音乐素材，尚未核对歌名，先解析实际音频，不能使用默认旧曲'};
 }
 const configured=config.songAudio&&config.songTitle&&config.songIdentityAudio===config.songAudio
  ?{title:clean(config.songTitle),artist:clean(config.songArtist),audio:config.songAudio,verified:true,origin:'configured-source'}:null;
 if(!title){
  if(parsed.reference)return {action:'need-source',reason:'还没从这次引用核对出歌名和对应原曲，不能拿默认旧曲代替'};
  if(parsed.different)return {action:'need-source',reason:'想换新歌需要对应的新原曲；当前默认素材不代表任意一首歌'};
  if(configured)title=configured.title;
  else if(preview&&config.songAudio)return {action:'preview',sourceSong:null,audio:config.songAudio,title:''};
  else return {action:'need-source',reason:'当前原曲素材还没有绑定歌名，请在唱歌页填写原曲歌名并确认素材'};
 }
 const named=versions.filter(row=>row.deleted!==true&&songKey(row.title)===songKey(title)&&(!artist||songKey(row.artist||row.sourceSong?.artist)===songKey(artist)));
 const artists=new Set(named.map(row=>songKey(row.artist||row.sourceSong?.artist)).filter(Boolean));
 if(!artist&&artists.size>1)return {action:'clarify',title,reason:'库存里有不同歌手的同名歌曲，请先确认版本'};
 const sameSource=row=>!parsed.reference||!activeSource||(activeSource.sha256?row.sourceSong?.sha256===activeSource.sha256:row.sourceSong?.audio===activeSource.audio);
 const ready=named.filter(row=>row.quality==='accepted'&&row.disabled!==true&&row.identityVerified===true&&sameSource(row)&&sameSingingSegment(row.sourceSong?.segment,segment)).sort((a,b)=>(b.at||0)-(a.at||0));
 if(!fresh&&ready.length)return {action:'reuse',title,artist:ready[0].artist||ready[0].sourceSong?.artist||'',version:ready[0]};
 const pending=named.filter(row=>row.quality==='unreviewed'&&row.disabled!==true&&row.identityVerified===true&&sameSource(row)&&sameSingingSegment(row.sourceSong?.segment,segment)).sort((a,b)=>(b.at||0)-(a.at||0));
 if(!fresh&&!preview&&pending.length)return {action:'review',title,artist:pending[0].artist||'',version:pending[0],reason:'《'+title+'》已有一版生成结果，尚未确认；请先反馈这版是否可用，明确要求重唱才再次生成'};
 const matches=source=>source?.verified===true&&source.audio&&songKey(source.title)===songKey(title)&&(!artist||songKey(source.artist)===songKey(artist))&&sameSingingSegment(source.segment,segment);
 const sourceSong=matches(activeSource)?activeSource:sources.find(matches)||named.map(row=>row.sourceSong).find(matches)||(matches(configured)?configured:null);
 if(!sourceSong)return {action:'need-source',title,artist,reason:'没有核对到《'+title+'》对应的原曲素材，不能把旧音频当成这首歌'};
 return {action:'generate',title:sourceSong.title,artist:sourceSong.artist||'',sourceSong,audio:sourceSong.audio,fresh,segment};
}
