import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {songKey} from './singing-plan.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const key=songKey;
const idPattern=/^[0-9a-f]{64}$/;
const maxBytes=128*1024*1024;
export const isRenderedCoverFilename=name=>/^rh-audio-[a-f0-9-]+\.(?:wav|mp3)$/i.test(name);

export function coverRequestTitle(text){
  const raw=String(text??'').normalize('NFKC').trim();
  if(/重新|重录|重唱|重做|换(?:种|个|个新)|新(?:歌|曲|版|编曲)|新的(?:歌|曲)|另一|别的(?:歌|曲)|别唱|别放|不要|不用|不想|然后|顺便|再(?:画|拍|生成)/.test(raw))return '';
  if(!/唱|翻唱|点歌|听|放|播放|发|来一|点一/.test(raw))return '';
  const pairs=[...raw.matchAll(/《([^《》\n]{1,80})》/g)];
  if(pairs.length===1)return pairs[0][1].trim();
  if(pairs.length)return '';
  const name=raw.replace(/^(?:可以|能不能|请|麻烦|我想|想|再|给我|帮我|给我来)+/,'')
    .replace(/^(?:唱|翻唱|播放|放|听|点歌|发|来)(?:给我|一下|一遍|一首|一段|一首歌|个|那首|这首)*/,'')
    .replace(/(?:给我听|给我|吧|吗|呀|嘛|呗|啦|谢谢|[。！!？?，,])+\s*$/,'').trim();
  return name.length<=80&&!/[\r\n。！？!?]/.test(name)?name:'';
}

export function createCoverLibrary({root,scope,now=Date.now}){
  const dir=()=>join(root(),hash(JSON.stringify(scope())));
  const rowPath=id=>join(dir(),id+'.json');
  const mediaPath=(id,ext)=>join(dir(),id+'.'+ext);
  function get(id){
    if(!idPattern.test(String(id)))return null;
    try{
      const file=rowPath(id),stat=lstatSync(file);
      if(!stat.isFile()||stat.size>8192)return null;
      const row=JSON.parse(readFileSync(file,'utf8'));
      if(row.deleted===true||row.id!==id||!['wav','mp3'].includes(row.ext)||!key(row.title)||row.scope!==hash(JSON.stringify(scope())))return null;
      const audio=mediaPath(id,row.ext),audioStat=lstatSync(audio);
      if(!audioStat.isFile()||audioStat.size!==row.bytes||audioStat.size>maxBytes)return null;
      return {...row,quality:['accepted','rejected'].includes(row.quality)?row.quality:'unreviewed',identityVerified:row.identityVerified===true,file:audio};
    }catch{return null;}
  }
  function list(){
    if(!existsSync(dir()))return [];
    return readdirSync(dir()).filter(name=>/^[0-9a-f]{64}\.json$/.test(name))
      .map(name=>get(name.slice(0,-5))).filter(Boolean).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
  }
  function find(title,{artist=''}={}){
    const name=key(title),named=name?list().filter(row=>key(row.title)===name&&(!artist||key(row.artist||row.sourceSong?.artist)===key(artist))):[];
    if(!artist&&new Set(named.map(row=>key(row.artist||row.sourceSong?.artist)).filter(Boolean)).size>1)return null;
    return named.find(row=>row.quality==='accepted'&&row.identityVerified===true&&row.disabled!==true)||null;
  }
  function update(row,changes){
    const {file,...metadata}=row,target=rowPath(row.id),tmp=target+'.'+randomUUID()+'.tmp';
    try{writeFileSync(tmp,JSON.stringify({...metadata,...changes,updatedAt:now()}),{mode:0o600});renameSync(tmp,target);}
    finally{try{unlinkSync(tmp);}catch{}}
    return get(row.id);
  }
  function review(id,{quality,reason='',feedbackQuote=''}={}){
    const row=get(id);if(!row)throw Error('这份翻唱不存在');
    if(!['accepted','rejected'].includes(quality))throw Error('请选择确认可复用或停用这个版本');
    return update(row,{quality,identityVerified:quality==='accepted'||row.identityVerified,reviewReason:String(reason).slice(0,240),feedbackQuote:String(feedbackQuote).slice(0,200),reviewedAt:now()});
  }
  function save(title,source,details={}){
    title=String(title??'').normalize('NFKC').trim().replace(/^《|》$/g,'').trim();
    if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title))throw Error('请输入 1 到 80 字的歌曲或片段名');
    if(details.sourceSong?.verified===true&&key(details.sourceSong.title)!==key(title))throw Error('保存歌名与已核对的原曲不一致，未给旧音频换标签');
    const stat=lstatSync(source);
    if(!stat.isFile()||stat.size<128||stat.size>maxBytes)throw Error('翻唱音频不可读或超过 128MB');
    const bytes=readFileSync(source);
    const isWav=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';
    const isMp3=bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
    if(!isWav&&!isMp3)throw Error('保存翻唱只接受已经生成的 WAV 或 MP3');
    const ext=isWav?'wav':'mp3',sha256=hash(bytes);
    const existing=list().find(row=>key(row.title)===key(title)&&row.sha256===sha256);
    if(existing)return details.autoSaved?existing:review(existing.id,{quality:details.quality||'accepted'});
    let id=hash(JSON.stringify([key(title),sha256]));
    try{if(JSON.parse(readFileSync(rowPath(id),'utf8')).deleted===true)id=hash(JSON.stringify([key(title),sha256,randomUUID()]));}catch{}
    const sourceSong=details.sourceSong?.verified===true?{title:String(details.sourceSong.title||'').slice(0,80),artist:String(details.sourceSong.artist||'').slice(0,80),audio:String(details.sourceSong.audio||'').slice(0,500),verified:true,origin:String(details.sourceSong.origin||'').slice(0,80),sha256:String(details.sourceSong.sha256||'').slice(0,64),url:String(details.sourceSong.url||'').slice(0,1200),songId:String(details.sourceSong.songId||'').slice(0,100),duration:details.sourceSong.duration||null,preview:details.sourceSong.preview===true,segment:details.sourceSong.segment||null}:null;
    if(sourceSong&&key(sourceSong.title)!==key(title))throw Error('保存歌名与已核对的原曲不一致，未给旧音频换标签');
    const artist=String(details.artist||sourceSong?.artist||'').slice(0,80);
    const row={id,title,ext,sha256,bytes:bytes.length,at:now(),scope:hash(JSON.stringify(scope())),artist,
      quality:details.autoSaved?'unreviewed':details.quality||'accepted',identityVerified:details.identityVerified===undefined?(!!sourceSong||details.autoSaved!==true):details.identityVerified===true,
      sourceSong,workflowKey:String(details.workflowKey||'').slice(0,64),workflowId:String(details.workflowId||'').slice(0,80),version:String(details.version||new Date(now()).toISOString()).slice(0,100),tags:[...new Set(['翻唱',title,artist,sourceSong?.segment?sourceSong.segment.start+'–'+sourceSong.segment.end+'秒':'',...(Array.isArray(details.tags)?details.tags:[])].filter(Boolean))].slice(0,12),
      autoSaved:details.autoSaved===true,originInvocationId:String(details.originInvocationId||'').slice(0,100)};
    mkdirSync(dir(),{recursive:true});
    for(const [target,value] of [[mediaPath(id,ext),bytes],[rowPath(id),JSON.stringify(row)]]){
      const tmp=target+'.'+randomUUID()+'.tmp';
      try{writeFileSync(tmp,value,{mode:0o600});renameSync(tmp,target);}
      finally{try{unlinkSync(tmp);}catch{}}
    }
    return get(id);
  }
  function remove(id){
    const row=get(id);
    if(!row)return false;
    const {file,...metadata}=row;
    const target=rowPath(id),tmp=target+'.'+randomUUID()+'.tmp';
    try{
      writeFileSync(tmp,JSON.stringify({...metadata,deleted:true,updatedAt:now()}),{mode:0o600});
      renameSync(tmp,target);
    }finally{try{unlinkSync(tmp);}catch{}}
    // Keep the deletion record so paired-device synchronization cannot restore this version.
    try{unlinkSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
    return true;
  }
  function isRejectedFile(source){
    if(!source||!existsSync(dir()))return false;
    const rejected=[];
    for(const name of readdirSync(dir()).filter(name=>/^[0-9a-f]{64}\.json$/.test(name)))try{
      const path=join(dir(),name);if(lstatSync(path).size>8192)continue;
      const row=JSON.parse(readFileSync(path,'utf8'));
      if(row.scope===hash(JSON.stringify(scope()))&&row.quality==='rejected'&&idPattern.test(row.sha256))rejected.push(row.sha256);
    }catch{}
    if(!rejected.length)return false;
    let file;try{file=String(source).startsWith('file:')?fileURLToPath(source):String(source);}catch{return false;}
    try{const stat=lstatSync(file);return stat.isFile()&&stat.size<=maxBytes&&rejected.includes(hash(readFileSync(file)));}catch{return false;}
  }
  function hasOriginInvocation(id){
    if(!id||!existsSync(dir()))return false;
    return readdirSync(dir()).filter(name=>/^[0-9a-f]{64}\.json$/.test(name)).some(name=>{try{const file=join(dir(),name);if(lstatSync(file).size>8192)return false;return JSON.parse(readFileSync(file,'utf8')).originInvocationId===id;}catch{return false;}});
  }
  return {get,list,find,save,remove,review,isRejectedFile,hasOriginInvocation};
}
