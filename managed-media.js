import {existsSync,lstatSync,readdirSync,unlinkSync,statSync,mkdirSync,copyFileSync,readFileSync,writeFileSync,openSync,readSync,closeSync,rmdirSync,symlinkSync} from 'node:fs';
import {join,resolve,relative,dirname,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
export const MANAGED_MEDIA_DIRS=['voice','stickers','messages','photos','videos','audio-input','audio-analysis','music-input','browser','desktop','phone','reference-padded','life-artifacts','drawings','social-assets','singing-renders','singing-samples'];
const temporary=['voice','messages','videos','audio-input','audio-analysis','music-input','browser','desktop','phone','reference-padded','singing-renders','photos/requests','photos/gen'];
const within=(root,p)=>{const r=relative(resolve(root),resolve(p));return r!==''&&!r.startsWith('..')&&!isAbsolute(r);};
export function mediaRetention(v={}){const n=(x,d,min,max)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Number(x))):d;return {enabled:v.enabled!==false,days:n(v.days,7,1,365),maxMB:n(v.maxMB,4096,256,1048576)};}
function files(root){if(!existsSync(root)||lstatSync(root).isSymbolicLink())return [];return readdirSync(root).flatMap(name=>{const p=join(root,name),s=lstatSync(p);return s.isSymbolicLink()?[]:s.isDirectory()?files(p):[{file:p,bytes:s.size,mtime:s.mtimeMs}];});}
export function managedMediaSnapshot(root){const categories=Object.fromEntries(MANAGED_MEDIA_DIRS.map(name=>[name,files(join(root,name)).reduce((n,x)=>n+x.bytes,0)]));return {root:resolve(root),categories,totalBytes:Object.values(categories).reduce((a,b)=>a+b,0),temporaryBytes:temporary.reduce((n,name)=>n+files(join(root,name)).reduce((a,b)=>a+b.bytes,0),0),protected:'收藏表情、相册、画本源文件、作品、歌曲示范和私人记忆不会自动删除'};}
export function cleanManagedMedia(root,{config={},pinned=[],now=Date.now(),dryRun=false}={}){
 if(dirname(resolve(root))===resolve(root))throw Error('不能在磁盘根目录执行媒体整理');
 const cfg=mediaRetention(config),pins=new Set(pinned.map(p=>resolve(p))),rows=temporary.flatMap(name=>files(join(root,name))).filter(r=>within(root,r.file)).sort((a,b)=>a.mtime-b.mtime),limit=cfg.maxMB*1024*1024;
 let total=rows.reduce((n,r)=>n+r.bytes,0),bytes=0,count=0;const selected=[];
 for(const row of rows){if(pins.has(resolve(row.file))||now-row.mtime<3600000)continue;if(now-row.mtime<cfg.days*86400000&&total<=limit)continue;selected.push(row);total-=row.bytes;bytes+=row.bytes;}
 if(!dryRun)for(const row of selected){if(!within(root,row.file)||lstatSync(row.file).isSymbolicLink())continue;unlinkSync(row.file);count++;}
 return {ok:true,dryRun,files:dryRun?selected.length:count,bytes,remainingTemporaryBytes:total,protected:'不清理收藏、作品、画本、记忆、配置或登录信息'};
}
// Copy and verify before removing any original. Old directory references keep
// resolving via junctions on Windows; other platforms retain the verified source.
export function migrateManagedMedia(from,to){
 from=resolve(from);to=resolve(to);if(from===to)return {copied:0};if(dirname(to)===to||within(from,to)||within(to,from))throw Error('新旧媒体目录不能互相包含，也不能选择磁盘根目录');
 if(existsSync(to)&&readdirSync(to).length&&!existsSync(join(to,'.qq-bridge-media-root.json')))throw Error('请选择空目录，或此前由插件管理的媒体目录；不合并其他文件夹');
 const entries=MANAGED_MEDIA_DIRS.flatMap(n=>files(join(from,n))).concat(['messages.json','bridge.log'].flatMap(n=>{const p=join(from,n);return existsSync(p)&&!lstatSync(p).isSymbolicLink()?[{file:p,bytes:statSync(p).size}]:[]}));
 const hash=p=>{const h=createHash('sha256'),fd=openSync(p,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=readSync(fd,buffer,0,buffer.length,null)))h.update(buffer.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}};
 for(const row of entries){const target=join(to,relative(from,row.file));if(existsSync(target)&&hash(target)!==hash(row.file))throw Error('目标目录已有不同内容，请选择一个空目录；原文件未删除');}
 mkdirSync(to,{recursive:true});for(const row of entries){const target=join(to,relative(from,row.file));mkdirSync(dirname(target),{recursive:true});if(!existsSync(target))copyFileSync(row.file,target);if(hash(target)!==hash(row.file))throw Error('媒体复制核对失败，原文件保留');}
 if(process.platform==='win32')for(const name of MANAGED_MEDIA_DIRS){const old=join(from,name),target=join(to,name);if(!existsSync(old)||lstatSync(old).isSymbolicLink())continue;const owned=files(old);if(owned.some(r=>!within(from,r.file)))throw Error('迁移路径越界');
  function clear(p){if(!within(from,p)||lstatSync(p).isSymbolicLink())throw Error('不处理目录链接');for(const n of readdirSync(p)){const child=join(p,n),s=lstatSync(child);if(s.isSymbolicLink())throw Error('目录含外部链接，原文件保留');if(s.isDirectory())clear(child);else{const copied=join(to,relative(from,child));if(!existsSync(copied)||hash(copied)!==hash(child))throw Error('迁移期间文件仍在变化，停止清理原位置');unlinkSync(child);}}rmdirSync(p);}
  // A link in any subtree prevents deletion of that subtree altogether.
  const links=p=>readdirSync(p).some(n=>{const q=join(p,n),s=lstatSync(q);return s.isSymbolicLink()||s.isDirectory()&&links(q);});if(links(old))continue;
  mkdirSync(target,{recursive:true});clear(old);symlinkSync(target,old,'junction');
 }
 writeFileSync(join(to,'.qq-bridge-media-root.json'),JSON.stringify({owner:'dsh-im-bridge',version:1}));return {copied:entries.length,oldReferencesPreserved:true};
}
