import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,renameSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');
const key=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,'');
const idPattern=/^[0-9a-f]{64}$/;
const maxBytes=32*1024*1024;
export const isRenderedCoverFilename=name=>/^rh-audio-[a-f0-9-]+\.(?:wav|mp3)$/i.test(name);

export function coverRequestTitle(text){
  const raw=String(text??'').normalize('NFKC').trim();
  if(/重新|重录|重唱|重做|换(?:种|个|个新)|新(?:版|编曲)|别唱|别放|不要|不用|不想|然后|顺便|再(?:画|拍|生成)/.test(raw))return '';
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
      if(row.id!==id||!['wav','mp3'].includes(row.ext)||!key(row.title)||row.scope!==hash(JSON.stringify(scope())))return null;
      const audio=mediaPath(id,row.ext),audioStat=lstatSync(audio);
      if(!audioStat.isFile()||audioStat.size!==row.bytes||audioStat.size>maxBytes)return null;
      return {...row,file:audio};
    }catch{return null;}
  }
  function list(){
    if(!existsSync(dir()))return [];
    return readdirSync(dir()).filter(name=>/^[0-9a-f]{64}\.json$/.test(name))
      .map(name=>get(name.slice(0,-5))).filter(Boolean).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id));
  }
  function find(title){const name=key(title);return name?list().find(row=>key(row.title)===name)||null:null;}
  function save(title,source){
    title=String(title??'').normalize('NFKC').trim().replace(/^《|》$/g,'').trim();
    if(!title||title.length>80||/[\x00-\x1f\x7f]/.test(title))throw Error('请输入 1 到 80 字的歌曲或片段名');
    const stat=lstatSync(source);
    if(!stat.isFile()||stat.size<128||stat.size>maxBytes)throw Error('翻唱音频不可读或超过 32MB');
    const bytes=readFileSync(source);
    const isWav=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';
    const isMp3=bytes.toString('ascii',0,3)==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
    if(!isWav&&!isMp3)throw Error('保存翻唱只接受已经生成的 WAV 或 MP3');
    const ext=isWav?'wav':'mp3',sha256=hash(bytes),id=hash(JSON.stringify([key(title),sha256]));
    const existing=get(id);if(existing)return existing;
    const row={id,title,ext,sha256,bytes:bytes.length,at:now(),scope:hash(JSON.stringify(scope()))};
    mkdirSync(dir(),{recursive:true});
    for(const [target,value] of [[mediaPath(id,ext),bytes],[rowPath(id),JSON.stringify(row)]]){
      const tmp=target+'.'+randomUUID()+'.tmp';
      try{writeFileSync(tmp,value,{mode:0o600});renameSync(tmp,target);}
      finally{try{unlinkSync(tmp);}catch{}}
    }
    return get(id);
  }
  return {get,list,find,save};
}
