import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {basename,dirname,join,resolve} from 'node:path';

export const BACKUPS_PER_TYPE=5;
const digest=value=>createHash('sha256').update(value).digest('hex');
const checkpoint=/^before-(restore|full-sync)-(\d{10,16})(?:-[0-9a-f-]{36})?\.json$/;
const syncId=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
function eligible(root,name){const path=join(root,name);return dirname(resolve(path))===resolve(root)&&!fs.lstatSync(path).isSymbolicLink();}

// Run the corresponding import validator on the bytes read back from disk before
// expiring older checkpoints. Retention errors must never discard the new backup.
export function saveCheckpoint(root,family,value,validate) {
  if(!['restore','full-sync'].includes(family))throw Error('备份类型无效');
  fs.mkdirSync(root,{recursive:true});
  const file=join(root,'before-'+family+'-'+Date.now()+'-'+randomUUID()+'.json');
  const bytes=Buffer.from(JSON.stringify(value));
  const temp=file+'.tmp';
  try{
    fs.writeFileSync(temp,bytes,{mode:0o600,flag:'wx'});
    const read=fs.readFileSync(temp);
    if(digest(read)!==digest(bytes))throw Error('恢复点读回校验失败');
    validate(JSON.parse(read));
    fs.renameSync(temp,file);
  }catch(error){try{fs.unlinkSync(temp);}catch{}throw error;}
  const others=fs.readdirSync(root,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!==basename(file)&&checkpoint.exec(e.name)?.[1]===family);
  others.sort((a,b)=>Number(checkpoint.exec(b.name)[2])-Number(checkpoint.exec(a.name)[2]));
  for(const e of others.slice(BACKUPS_PER_TYPE-1)){if(eligible(root,e.name))fs.unlinkSync(join(root,e.name));}
  return file;
}

export function verifySyncCheckpoint(folder,prepared) {
  const manifest=JSON.parse(fs.readFileSync(join(folder,'manifest.json'),'utf8'));
  if(!Array.isArray(manifest)||manifest.length!==prepared.length)throw Error('同步恢复点清单不完整');
  for(const [i,p] of prepared.entries()){
    const m=manifest[i];
    if(m.key!==p.item.key||m.existed!==(p.old!==null))throw Error('同步恢复点键不一致');
    if(p.old!==null&&digest(fs.readFileSync(join(folder,digest(m.key))))!==digest(p.old))throw Error('同步恢复副本读回校验失败');
  }
}

export function rotateSyncCheckpoints(folder) {
  const root=dirname(folder),current=basename(folder);
  if(!syncId.test(current)||basename(root)!=='backups'||!eligible(root,current))return;
  // Only expire recognized per-transfer manifests; ignore user files, incomplete runs and links.
  const candidates=[];
  for(const e of fs.readdirSync(root,{withFileTypes:true})){
    if(e.name===current||!e.isDirectory()||!syncId.test(e.name))continue;
    const dir=join(root,e.name),mfile=join(dir,'manifest.json');
    try{
      if(!fs.lstatSync(mfile).isFile())continue;
      const items=JSON.parse(fs.readFileSync(mfile,'utf8'));
      if(!Array.isArray(items)||!items.every(m=>typeof m?.key==='string'&&typeof m.existed==='boolean'))continue;
      const allowed=new Set(['manifest.json',...items.filter(m=>m.existed).map(m=>digest(m.key))]);
      const files=fs.readdirSync(dir,{withFileTypes:true});
      if(files.length!==allowed.size||files.some(f=>!f.isFile()||!allowed.has(f.name)))continue;
      candidates.push({dir,files,time:fs.statSync(mfile).mtimeMs});
    }catch{}
  }
  for(const old of candidates.sort((a,b)=>b.time-a.time).slice(BACKUPS_PER_TYPE-1)){
    if(!eligible(root,basename(old.dir)))continue;
    for(const file of old.files)if(eligible(old.dir,file.name))fs.unlinkSync(join(old.dir,file.name));
    fs.rmdirSync(old.dir);
  }
}
