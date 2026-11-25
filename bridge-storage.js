import fs from 'node:fs';
import {constants} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {MANAGED_MEDIA_DIRS,TEMPORARY_MEDIA_DIRS} from './managed-media.js';

const marker='.qq-bridge-storage-v1.json';
const locationFile='.qq-bridge-location-v1.json';
const mediaNames=new Set(MANAGED_MEDIA_DIRS);
const memoryNames=new Set(['memory-hub','calendar-memory','learning-memory','persona-growth','meme-study','singing','memories.json']);
const tempNames=new Set(TEMPORARY_MEDIA_DIRS);
const cacheFile=name=>name==='messages.json'||/^messages\.json\.damaged-[a-f0-9-]+$/.test(name)||/^(?:bridge|napcat-(?:desktop|mobile))(?:\.sync-[\da-f]+)?\.log(?:\.previous)?$/.test(name);
const uuid=()=>randomUUID();

export function transferableStorageKey(kind,relativeName){
  const first=relativeName.split('/')[0];
  if(kind==='cache')return (mediaNames.has(first)||first==='messages.json')&&!relativeName.endsWith('.tmp');
  if(kind==='memory')return memoryNames.has(first)&&!relativeName.endsWith('.tmp');
  return true;
}

function readOptional(file) {
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

function acquireMoveLock(dir){
  const file=join(dir,'.qq-bridge-move-lock');
  try{fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(fs.readFileSync(file,'utf8'));
    let stale=false;
    if(Number.isSafeInteger(pid)&&pid>0)try{process.kill(pid,0);}catch(check){stale=check.code==='ESRCH';}
    if(!stale)throw Error('另一个引擎正在迁移桥接资料，请稍后再启动');
    fs.unlinkSync(file);
    fs.writeFileSync(file,String(process.pid),{flag:'wx',mode:0o600});
  }
  return ()=>{if(fs.readFileSync(file,'utf8')===String(process.pid))fs.unlinkSync(file);};
}
function writeJson(file, value) {
  fs.mkdirSync(dirname(file),{recursive:true});
  const tmp=file+'.'+uuid()+'.tmp';
  try{fs.writeFileSync(tmp,JSON.stringify(value),{mode:0o600,flag:'wx'});fs.renameSync(tmp,file);}
  catch(error){try{fs.unlinkSync(tmp);}catch{}throw error;}
}
function names(dir) {
  try{return fs.readdirSync(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
}
function physical(path) {
  const p=resolve(path);
  try{return fs.realpathSync.native(p);}catch(error){
    if(error.code!=='ENOENT'||dirname(p)===p)throw error;
    // Do not interpret a broken junction as an ordinary, creatable directory.
    if(fs.lstatSync(p,{throwIfNoEntry:false})?.isSymbolicLink())throw Error('目录链接已失效：'+p);
    return join(physical(dirname(p)),basename(p));
  }
}
function inside(parent,child){
  const rel=relative(parent,child);
  return !rel||(!rel.startsWith('..'+sep)&&rel!=='..'&&!isAbsolute(rel));
}
function layout(root) {
  return {root,data:join(root,'profile'),memory:join(root,'memory'),cache:join(root,'media'),workspace:join(root,'workspaces')};
}
function legacyLayout(config){
  const settings=readOptional(join(config.dataDir,'settings.json'))||{};
  return {root:'',data:config.dataDir,memory:settings.memoryDir||config.dataDir,cache:settings.cacheDir||config.dataDir,
    workspace:join(dirname(config.dataDir),'im-bridge-chats'),state:config.stateFile,
    stickers:settings.cacheDir?join(settings.cacheDir,'stickers'):config.stickerDir,
    log:settings.cacheDir?join(settings.cacheDir,'bridge.log'):config.logFile};
}

// The cache can be a shared drive folder. Only explicit bridge-owned entries
// are portable. The profile, by contrast, is the configured private plugin directory.
function sourceEntries(src,onSkip) {
  const result=[],claimed=new Set(), buckets=new Map(Object.entries(src).filter(([k,v])=>k!=='root'&&v).map(([k,v])=>[k,physical(v)]));
  function add(kind,name,path){
    // Configured roots can be junctions (the common Windows layout). Never
    // follow an unrecognized link encountered *inside* those roots.
    const item=fs.lstatSync(path,{throwIfNoEntry:false});
    if(!item)return;
    if(item.isSymbolicLink()&&kind!=='workspace'){
      if(onSkip){onSkip();return;}
      throw Error('资料包含目录链接，请核对后迁移：'+path);
    }
    const full=physical(path);
    if(claimed.has(full))return;
    claimed.add(full);
    if(fs.existsSync(full))result.push({kind,name,path:full,logical:resolve(path)});
  }
  for(const name of mediaNames)add('cache',name,name==='stickers'&&src.stickers?src.stickers:join(src.cache,name));
  for(const entry of names(src.cache))if(cacheFile(entry.name)&&!(entry.name==='bridge.log'&&src.log))add('cache',entry.name,join(src.cache,entry.name));
  if(src.log)add('cache','bridge.log',src.log);
  for(const name of memoryNames)add('memory',name,join(src.memory,name));
  add('workspace','',src.workspace);
  if(src.state)add('data','state.json',src.state);
  for(const entry of names(src.data)){
    const name=entry.name, file=join(src.data,name);
    if(name===locationFile||name===marker||name.startsWith('.qq-bridge-move-')||name.endsWith('.tmp'))continue;
    if(['cache','memory','workspace'].some(k=>buckets.get(k)!==buckets.get('data')&&buckets.get(k)===physical(file)))continue;
    if(mediaNames.has(name)||cacheFile(name)||memoryNames.has(name)){
      if(claimed.has(physical(file)))continue;
      // Old cache and memory copies in the profile are not authoritative.
      continue;
    }
    add('data',name,file);
  }
  return result;
}

function hashFile(file){
  const hash=createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.allocUnsafe(1024*1024);
  try{let count;while((count=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,count));}finally{fs.closeSync(fd);}
  return hash.digest('hex');
}

function migrationTarget(input,src) {
  if(typeof input!=='string'||!isAbsolute(input)||input.includes('\0')||/^[\\/]{2}/.test(input))throw Error('请选择本机的绝对目录');
  const target=physical(input);
  if(src.root&&(inside(physical(src.root),target)||inside(target,physical(src.root))))throw Error('新的统一目录不能与当前统一目录互相包含');
  if(dirname(target)===target||namesIfDirectory(target).length)throw Error('目标必须是新的或空的专用目录，不能选磁盘根目录');
  for(const name of ['data','memory','workspace','cache']){
    const source=physical(src[name]);
    if(inside(target,source))throw Error('目标不能覆盖当前使用的数据目录');
    if(inside(source,target) && !(source===physical(src.cache)&&dirname(target)===source))
      throw Error('目标不能位于当前资料、作品或聊天目录内');
  }
  if(inside(physical(src.cache),target)&&(mediaNames.has(basename(target))||memoryNames.has(basename(target))||basename(target).startsWith('.')))
    throw Error('请选择独立的数据子目录');
  return target;
}
function namesIfDirectory(dir){
  if(!fs.existsSync(dir))return [];
  if(!fs.lstatSync(dir).isDirectory())throw Error('目标不是目录');
  return names(dir);
}

function filesIn(path,visit,skip) {
  if(skip?.has(path))return;
  const stat=fs.lstatSync(path);
  if(stat.isSymbolicLink())throw Error('资料内含未识别的目录链接，保留原位置：'+path);
  if(stat.isFile()){visit(path,stat);return;}
  if(!stat.isDirectory())throw Error('资料内含特殊文件，保留原位置：'+path);
  for(const item of names(path))filesIn(join(path,item.name),visit,skip);
}

function relocatePaths(doc, pairs) {
  function visit(value,field) {
    if(typeof value==='string'){
      if(['text','userText','prompt','content','quote','signature','description','basePersona','personaPrompt','userNickname','title','summary','nickname'].includes(field)||!isAbsolute(value))return value;
      for(const [old,next] of pairs)if(inside(old,resolve(value)))return join(next,relative(old,resolve(value)));
      return value;
    }
    if(Array.isArray(value))return value.map(v=>visit(v,field));
    if(value&&typeof value==='object')for(const key of Object.keys(value))value[key]=visit(value[key],key);
    return value;
  }
  return visit(doc,'');
}

// Older installations keep the vocal sample library behind this specific
// junction. Validate its destination before treating it as a duplicate.
function singingSamplesAlias(src){
  const link=join(physical(src.memory),'singing','samples');
  if(!fs.lstatSync(link,{throwIfNoEntry:false})?.isSymbolicLink())return null;
  const canonical=join(src.cache,'singing-samples');
  return physical(link)===physical(canonical)&&fs.statSync(canonical).isDirectory()?link:null;
}

// Copy into a same-volume staging directory, verify every file and recheck the
// source listing before publishing. The previous tree remains available on failure.
function copyStorage(src,target,id) {
  const next=layout(target);
  fs.mkdirSync(dirname(target),{recursive:true});
  const stage=fs.mkdtempSync(join(dirname(target),'.qq-bridge-move-'));
  const staged=layout(stage),skip=new Set([stage,target]),manifest=new Map();
  try{
    const sampleAlias=singingSamplesAlias(src);
    if(sampleAlias)skip.add(sampleAlias);
    const entries=sourceEntries(src).filter(e=>!skip.has(e.path));
    const separate=[src.cache,src.memory,src.workspace].map(physical).filter(p=>p!==physical(src.data));
    const exclusions=e=>new Set([...skip,...(e.kind==='data'?separate:[]),...entries.filter(other=>other.path!==e.path&&inside(e.path,other.path)).map(other=>other.path)]);
    let requiredBytes=0;
    for(const e of entries)filesIn(e.path,(_file,stat)=>{requiredBytes+=stat.size;},exclusions(e));
    if(fs.statfsSync){
      const disk=fs.statfsSync(stage);
      if(disk.bavail*disk.bsize<requiredBytes)throw Error('目标卷剩余空间不足以容纳完整副本，原资料保留');
    }
    const pairs=entries.flatMap(e=>[[e.logical,join(next[e.kind],e.name)],[e.path,join(next[e.kind],e.name)]]);
    for(const kind of ['workspace','cache','memory','data'])pairs.push([resolve(src[kind]),next[kind]],[physical(src[kind]),next[kind]]);
    pairs.sort((a,b)=>b[0].length-a[0].length);
    for(const kind of ['workspace','cache','memory','data'])fs.mkdirSync(staged[kind],{recursive:true});
    for(const entry of entries) {
      const to=join(staged[entry.kind],entry.name);
      if(fs.statSync(entry.path).isDirectory())fs.mkdirSync(to,{recursive:true});
      filesIn(entry.path,(file,stat)=>{
        const dest=join(to,relative(entry.path,file)), digest=hashFile(file);
        fs.mkdirSync(dirname(dest),{recursive:true});
        fs.copyFileSync(file,dest,constants.COPYFILE_EXCL);
        if(hashFile(dest)!==digest)throw Error('复制校验失败：'+basename(file));
        // Only rewrite live JSON configuration / operation references. Transcript
        // and backup payloads can carry integrity hashes and stay byte-for-byte intact.
        const rewritable=(entry.kind==='data'&&/^(settings|state|features|service-connections|website-mcp|qq-media-refs|life-execution)\.json$/.test(entry.name))||
          (entry.kind==='cache'&&entry.name==='saved-covers'&&basename(file)==='library.json');
        if(rewritable){
          const value=relocatePaths(JSON.parse(fs.readFileSync(dest,'utf8')),pairs);
          if(entry.name==='settings.json'){value.cacheDir=next.cache;value.memoryDir=next.memory;}
          writeJson(dest,value);
          if(JSON.stringify(JSON.parse(fs.readFileSync(dest,'utf8')))!==JSON.stringify(value))throw Error('目标设置读回校验失败');
        }
        fs.utimesSync(dest,stat.atime,stat.mtime);
        manifest.set(file,{size:stat.size,time:stat.mtimeMs});
      },exclusions(entry));
    }
    let count=0;
    for(const e of sourceEntries(src))if(!skip.has(e.path))filesIn(e.path,(file,stat)=>{
      const saved=manifest.get(file);
      if(!saved||saved.size!==stat.size||saved.time!==stat.mtimeMs)throw Error('复制期间资料发生变化，请重新执行');
      count++;
    },exclusions(e));
    if(count!==manifest.size)throw Error('复制期间文件数量发生变化，原位置继续使用');
    if(singingSamplesAlias(src)!==sampleAlias)throw Error('复制期间歌曲样本目录发生变化，请重新执行');
    if(sampleAlias){
      const link=join(staged.memory,'singing','samples'),dest=join(next.cache,'singing-samples');
      if(!fs.statSync(join(staged.cache,'singing-samples')).isDirectory())throw Error('歌曲样本目录副本未通过校验');
      fs.mkdirSync(dirname(link),{recursive:true});
      const windows=sep==='\\';
      fs.symlinkSync(windows?dest:relative(dirname(link),join(staged.cache,'singing-samples')),link,windows?'junction':'dir');
      const readback=fs.readlinkSync(link);
      if(relative(dest,resolve(dirname(join(next.memory,'singing','samples')),readback)))throw Error('歌曲样本链接读回校验失败');
    }
    writeJson(join(stage,marker),{version:1,id,files:count});
    if(fs.existsSync(target))fs.rmdirSync(target); // Only an empty directory is accepted.
    fs.renameSync(stage,target);
    return count;
  }catch(error){
    // This path was freshly created by mkdtemp, never supplied by a request.
    if(dirname(stage)===dirname(target)&&basename(stage).startsWith('.qq-bridge-move-'))fs.rmSync(stage,{recursive:true,force:true});
    throw error;
  }
}

export function openBridgeStorage(config,{initialize=false}={}) {
  const anchor=join(config.dataDir,locationFile);
  let state=readOptional(anchor)||{version:1};
  if(state.version!==1)throw Error('无法读取桥接存储位置');
  let active=state.active?layout(state.active):null;
  if(active && !readOptional(join(active.root,marker))?.id)throw Error('桥接数据盘暂不可用，已停止初始化以保护原记录');
  if(!active&&!state.pending&&initialize&&!names(config.dataDir).length){
    const root=join(config.dataDir,'store');
    fs.mkdirSync(root,{recursive:true});writeJson(join(root,marker),{version:1,id:uuid(),files:0});
    state={version:1,active:root};writeJson(anchor,state);active=layout(root);
  }
  if(state.pending){
    const release=acquireMoveLock(config.dataDir);
    try{
    state=readOptional(anchor);
    if(!state?.pending)return openBridgeStorage(config);
    const p=state.pending;
    try{
      // A previous launch may have published the verified tree immediately before a crash.
      if(!readOptional(join(p.target,marker)) || readOptional(join(p.target,marker)).id!==p.id) {
        const src=active||legacyLayout(config);
        const target=migrationTarget(p.target,src);
        copyStorage(src,target,p.id);
      }
      const replacement={version:1,active:p.target,lastMovedAt:Date.now()};
      writeJson(anchor,replacement);state=replacement;active=layout(state.active);
    }catch(error){
      if(readOptional(join(p.target,marker))?.id===p.id)throw error; // retain pending for recovery of the pointer
      state={...state,pending:null,error:String(error.message).slice(0,350)};writeJson(anchor,state);
    }
    }finally{release();}
  }
  return {
    active,
    paths:()=>active||legacyLayout(config),
    info:()=>({root:active?.root||'',pending:state.pending?.target||'',error:state.error||'',suggested:join(active?dirname(active.root):legacyLayout(config).cache,'QQ桥接资料库')}),
    plan(input){
      const target=migrationTarget(input,active||legacyLayout(config));
      const next={...state,error:'',pending:{id:uuid(),target}};
      writeJson(anchor,next);state=next;
      return target;
    },
    cancel(){const next={...state,pending:null,error:''};writeJson(anchor,next);state=next;}
  };
}

function category(kind, name) {
  const first=name.split('/')[0];
  if(kind==='workspace'||kind==='cache'&&(/^(chat-history|messages\.json)(?:$|[./])/.test(name))||kind==='data'&&first==='session-memory')return 'chats';
  if(kind==='memory')return 'memory';
  if(kind==='data'&&(/^(?:backups|maintenance-backups|device-sync\/backups)(?:\/|$)/.test(name)||/\.bak(?:$|[-.])|\.last-good$/.test(name)))return 'backups';
  if(kind==='data'&&first==='operation-journal'||/\.log(?:\.previous)?$/.test(name))return 'logs';
  if(kind==='cache'&&(tempNames.has(first)||TEMPORARY_MEDIA_DIRS.some(prefix=>name.startsWith(prefix+'/'))))return 'temporary';
  if(kind==='cache'||kind==='data'&&first==='persona-images')return 'assets';
  return 'profile';
}

export async function storageUsage(src,hostSessions) {
  const bytes={chats:0,memory:0,assets:0,temporary:0,logs:0,backups:0,profile:0};
  const categories=Object.fromEntries(MANAGED_MEDIA_DIRS.map(name=>[name,0]));
  const seen=new Set();let skipped=0,hostBytes=0,sampleAlias=null;
  try{sampleAlias=singingSamplesAlias(src);}catch{}
  async function walk(path,kind,name){
    const pending=[{path,name}];
    while(pending.length){
      const batch=pending.splice(-32);
      await Promise.all(batch.map(async item=>{
        try{
          const stat=await fs.promises.lstat(item.path,{bigint:true});
          if(stat.isSymbolicLink()){if(item.path!==sampleAlias)skipped++;return;}
          const identity=stat.ino?stat.dev+':'+stat.ino:item.path;
          if(seen.has(identity))return;
          seen.add(identity);
          if(stat.isDirectory()){
            for(const child of await fs.promises.readdir(item.path))pending.push({path:join(item.path,child),name:item.name+'/'+child});
          }else if(stat.isFile()){
            const size=Number(stat.size);
            if(kind==='host'){hostBytes+=size;return;}
            bytes[category(kind,item.name)]+=size;
            const first=item.name.split('/')[0];
            if(kind==='cache'&&mediaNames.has(first))categories[first]+=size;
          }
        }catch(error){if(error.code!=='ENOENT')skipped++;}
      }));
    }
  }
  for(const e of sourceEntries(src,()=>skipped++))await walk(e.path,e.kind,e.name);
  let freeBytes=null;
  try{const disk=await fs.promises.statfs(src.cache);freeBytes=disk.bavail*disk.bsize;}catch{}
  if(hostSessions)await walk(hostSessions,'host','');
  return {bytes,totalBytes:Object.values(bytes).reduce((a,b)=>a+b,0),freeBytes,skipped,hostBytes,hostSessions,categories};
}
