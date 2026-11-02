import {createHash,createDecipheriv} from 'node:crypto';
const hash=b=>createHash('sha256').update(b).digest('hex');
const encode=v=>Buffer.from(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function stable(v){if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';return JSON.stringify(v);}
const stamp=v=>object(v)?Math.max(0,...['updatedAt','at','time','generatedAt','lastUpdatedAt'].map(k=>Number(v[k])||0)):0;
export function compareVersions(left,right){
 const parse=v=>{const m=String(v).match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);if(!m)throw Error('无法识别插件版本号：'+String(v).slice(0,60));return {n:m.slice(1,4).map(BigInt),pre:m[4]?.split('.')};};
 const a=parse(left),b=parse(right);for(let i=0;i<3;i++)if(a.n[i]!==b.n[i])return a.n[i]>b.n[i]?1:-1;
 if(!a.pre||!b.pre)return !a.pre&&!b.pre?0:!a.pre?1:-1;
 for(let i=0;i<Math.max(a.pre.length,b.pre.length);i++){const x=a.pre[i],y=b.pre[i];if(x===y)continue;if(x===undefined||y===undefined)return x===undefined?-1:1;const nx=/^\d+$/.test(x),ny=/^\d+$/.test(y);if(nx&&ny)return BigInt(x)>BigInt(y)?1:-1;if(nx!==ny)return nx?-1:1;return x>y?1:-1;}return 0;
}
function identity(v){
 if(!object(v))return 'value:'+stable(v);
 if(v.messageId&&v.chat)return 'message:'+JSON.stringify([v.accountId||'',v.chat,String(v.messageId),v.dir||'']);
 if(v.id!==undefined)return 'id:'+JSON.stringify([v.accountId||'',v.chat||v.key||'',String(v.id)]);
 if(v.localId)return 'local:'+v.localId;
 if(v.qq)return 'qq:'+String(v.qq);
 return 'value:'+stable(v);
}
export function mergeSyncJson(left,right,{prefer='desktop',key=''}={}){
 if(/^memory\/memory-hub\/source-/.test(key))return prefer==='desktop'?left:right;
 function merge(a,b,field='',depth=0,parentPrefer=prefer){
  if(a===undefined)return b;if(b===undefined)return a;if(stable(a)===stable(b))return a;
  const preferred=stamp(a)!==stamp(b)?stamp(a)>stamp(b)?'desktop':'phone':parentPrefer;
  if(depth>70)return preferred==='desktop'?a:b;
  if(Array.isArray(a)&&Array.isArray(b)){
   const rows=[],seen=new Map();for(const value of a){const id=identity(value);seen.set(id,rows.length);rows.push(value);}
   for(const value of b){const id=identity(value);if(seen.has(id)){const at=seen.get(id);rows[at]=merge(rows[at],value,field,depth+1,preferred);}else{seen.set(id,rows.length);rows.push(value);}}
   if(rows.length&&rows.every(v=>object(v)&&stamp(v)>0))rows.sort((x,y)=>stamp(x)-stamp(y));return rows;
  }
  if(object(a)&&object(b)){const out=Object.create(null);for(const name of new Set([...Object.keys(a),...Object.keys(b)]))out[name]=merge(a[name],b[name],field?field+'.'+name:name,depth+1,preferred);return out;}
  if(typeof a==='number'&&typeof b==='number'&&/(?:^|\.)(?:floors|revisions|contextAfter|lastRead|lastSeen|seenAt|lastPoll)(?:\.|$)/.test(field))return Math.max(a,b);
  if(typeof a==='boolean'&&typeof b==='boolean'&&/(?:^|\.)(?:deleted|reverted|removed|disabled)$/.test(field))return a||b;
  return preferred==='desktop'?a:b;
 }
 const out=JSON.parse(JSON.stringify(merge(left,right)));
 if(/^memory\/memory-hub\/[a-f0-9]{64}\.json$/.test(key)){
  if(stable(left.meta)!==stable(right.meta))throw Error('共享记忆范围校验失败');
  out.cutoff=Math.max(left.cutoff||0,right.cutoff||0);
  out.suppressed=[...new Set([...(left.suppressed||[]),...(right.suppressed||[])])];
  const denied=new Set(out.suppressed);
  out.facts.items=(out.facts?.items||[]).filter(f=>(f.source?.observedAt||f.updatedAt||0)>out.cutoff&&!(f.source?.messageIds||[]).some(id=>denied.has(id)));
  const slots=new Map();for(const f of out.facts.items){const slot=(f.source?.speakerId||'')+':'+(f.slot||f.id),old=slots.get(slot);if(!old||(f.source?.observedAt||f.updatedAt)>(old.source?.observedAt||old.updatedAt))slots.set(slot,f);}out.facts.items=[...slots.values()];
  for(const [actor,v]of Object.entries(out.views||{})){
   const a=left.views?.[actor],b=right.views?.[actor];
   // A reflection and its evidence are an indivisible, persona-specific record.
   const capsule=!a?.capsule?b?.capsule:!b?.capsule?a.capsule:(a.capsule.at||0)>=(b.capsule.at||0)?a.capsule:b.capsule;
   v.capsule=capsule&&capsule.at>out.cutoff&&!capsule.sourceIds?.some(id=>denied.has(id))?capsule:null;
   v.diaries=(v.diaries||[]).filter(d=>d.at>out.cutoff&&!d.sourceIds?.some(id=>denied.has(id)));
   v.lastConsolidatedAt=Math.max(a?.lastConsolidatedAt||0,b?.lastConsolidatedAt||0,out.cutoff);
  }
  out.sourceVersion=Math.max(left.sourceVersion||0,right.sourceVersion||0);
 }
 if(key==='data/settings.json'&&object(out)){
  const a=Array.isArray(left.whitelist)?left.whitelist:null,b=Array.isArray(right.whitelist)?right.whitelist:null;
  const disabled=new Set([...(left.disabledUsers||[]),...(right.disabledUsers||[])]);
  if(a?.length===0)for(const id of b||[])disabled.add(id);if(b?.length===0)for(const id of a||[])disabled.add(id);
  out.disabledUsers=[...disabled];out.disabledGroups=[...new Set([...(left.disabledGroups||[]),...(right.disabledGroups||[])])];
  // Administrative authority is never expanded by merging an old device profile.
  if(Array.isArray(left.owners)&&Array.isArray(right.owners))out.owners=left.owners.filter(id=>right.owners.includes(id));
  for(const [id,p]of Object.entries(out.contactProfiles||{})){const pa=left.contactProfiles?.[id]?.proactive,pb=right.contactProfiles?.[id]?.proactive;if(pa===false||pb===false)p.proactive=false;else if(pa===true&&pb===true)p.proactive=true;else p.proactive=null;}
 }
 function sanitize(value){
  if(!value||typeof value!=='object')return;
  if(Array.isArray(value.suppressed)&&Array.isArray(value.items)){const banned=new Set(value.suppressed);value.items=value.items.filter(item=>{const text=item?.summary||item?.text;return !text||!banned.has(hash(String(text)))&&!banned.has(hash(JSON.stringify(text)));});}
  for(const v of Object.values(value))sanitize(v);
 }
 sanitize(out);
 if(key==='data/state.json'&&object(out)){out.chats={};out.accountPaused=true;}
 if(key==='data/features.json'&&object(out)){
  out.generation=0;
  for(const job of out.outbox||[])if(['queued','sending'].includes(job.status)){job.status='cancelled';job.error='合并同步后取消旧待发任务';}
  for(const job of out.inbox||[])if(['queued','processing'].includes(job.status)){job.status='cancelled';job.error='合并同步后取消旧输入任务';}
 }
 if(key==='data/life-execution.json'&&object(out)){
  for(const j of out.jobs||[])if(['planned','queued','running','waiting_user'].includes(j.status)){j.status='interrupted';j.reason='设备合并后旧任务不自动重放，请按当前日程重新安排';}
  out.sleep={};out.wake={};
 }
 return out;
}
export function conflictKey(key,digest){return 'profiles/conflicts/'+(key.length<600?key:hash(key))+'/'+digest+(key.endsWith('.json')?'.json':'.bin');}
// Produces a complete, verified plan before either device is committed.
export async function buildUnionPlan(left,right,{read}={}){
 const manifests={desktop:left,phone:right},files={desktop:left.files,phone:right.files},work=[],conflicts=[],cache=new Map();
 const sourceSide=compareVersions(left.version,right.version)>=0?'desktop':'phone';
 const opposite=s=>s==='desktop'?'phone':'desktop';
 const bytes=async(side,key)=>{const id=side+':'+key;if(!cache.has(id)){const b=await read(side,key,files[side][key]);if(hash(b)!==files[side][key].hash)throw Error('合并前文件校验失败');cache.set(id,b);}return cache.get(id);};
 const copy=(from,to,key,targetKey=key)=>{const meta=files[from][key];if(files[to][targetKey]?.hash===meta.hash)return;work.push({from,to,key:targetKey,sourceKey:key,hash:meta.hash,size:meta.size,remove:false});};
 const merged=(to,key,data)=>{const b=encode(data),digest=hash(b);if(files[to][key]?.hash!==digest)work.push({to,key,bytes:b,hash:digest,size:b.length,remove:false});};
 const archive=(side,key)=>{const target=conflictKey(key,files[side][key].hash);for(const to of ['desktop','phone'])copy(side,to,key,target);};
 const alternateFor=(key,digest)=>{const dot=key.lastIndexOf('.'),slash=key.lastIndexOf('/');return (dot>slash?key.slice(0,dot):key)+'.sync-'+digest.slice(0,16)+(dot>slash?key.slice(dot):'');};
 const mediaMaps={desktop:[],phone:[]};
 for(const key of Object.keys(left.files)){const a=left.files[key],b=right.files[key];if(!b||a.hash===b.hash||key.endsWith('.json')||!/^(cache|persona|workspace)\//.test(key))continue;const losing=(a.modifiedAt||0)>=(b.modifiedAt||0)?'phone':'desktop';mediaMaps[losing].push([key,alternateFor(key,files[losing][key].hash)]);}
 const remap=(value,side,jsonKey)=>{
  if(typeof value==='string'){let text=value;for(const [old,replacement]of mediaMaps[side]){text=text.split('@bridge/'+old).join('@bridge/'+replacement);const prefix=old.split('/')[0]+'/';if(jsonKey.startsWith(prefix)&&text===old.slice(prefix.length))text=replacement.slice(prefix.length);}return text;}
  if(Array.isArray(value))return value.map(v=>remap(v,side,jsonKey));
  if(object(value)){const out=Object.create(null);for(const [k,v]of Object.entries(value))out[k]=remap(v,side,jsonKey);return out;}return value;
 };
 let vaultSide=null;const vault='data/phone-mobile-secrets.json',vaultKey='data/phone-mobile-secrets.key';
 if((left.files[vault]||right.files[vault])&&(left.files[vault]?.hash!==right.files[vault]?.hash||left.files[vaultKey]?.hash!==right.files[vaultKey]?.hash)){
  const valid=[];for(const side of ['desktop','phone'])if(files[side][vault]){
   try{const saved=JSON.parse((await bytes(side,vault)).toString());if(!saved.encrypted){valid.push(side);continue;}if(!files[side][vaultKey])continue;const key=await bytes(side,vaultKey);if(key.length!==32)continue;if(saved.encrypted){const d=createDecipheriv('aes-256-gcm',key,Buffer.from(saved.iv,'base64'));d.setAuthTag(Buffer.from(saved.tag,'base64'));const clear=Buffer.concat([d.update(Buffer.from(saved.encrypted,'base64')),d.final()]);clear.fill(0);}valid.push(side);}catch{}
  }
  if(!valid.length)throw Error('支付保险箱缺少有效配对密钥，未开始覆盖数据');
  vaultSide=valid.sort((a,b)=>(files[b][vault].modifiedAt||0)-(files[a][vault].modifiedAt||0))[0];
 }
 for(const key of new Set([...Object.keys(left.files),...Object.keys(right.files)])){
  const a=left.files[key],b=right.files[key];if(a?.hash===b?.hash)continue;
  if(key.startsWith('source/')){const from=sourceSide,to=opposite(from);if(files[from][key])copy(from,to,key);else if(files[to][key])work.push({to,key,remove:true,size:0});continue;}
  if(!a||!b){const from=a?'desktop':'phone';copy(from,opposite(from),key);continue;}
  // Existing conflict archives are immutable, content-addressed copies.
  if(key.startsWith('profiles/conflicts/')){throw Error('私有冲突副本发生同名校验冲突，未覆盖');}
  conflicts.push(key);archive('desktop',key);archive('phone',key);
  const prefer=vaultSide&&[vault,vaultKey].includes(key)?vaultSide:(a.modifiedAt||0)>=(b.modifiedAt||0)?'desktop':'phone';
  if(key.endsWith('.json')&&!key.startsWith('secrets/')&&key!==vault&&Math.max(a.size,b.size)<=64*1024*1024){
   try{const data=mergeSyncJson(remap(JSON.parse((await bytes('desktop',key)).toString()),'desktop',key),remap(JSON.parse((await bytes('phone',key)).toString()),'phone',key),{prefer,key});for(const side of ['desktop','phone'])merged(side,key,data);continue;}catch(error){if(/校验/.test(error.message))throw error;}
  }
  copy(prefer,opposite(prefer),key);
  // Media with colliding filenames remain individually addressable on both devices.
  if(/^(cache|persona|workspace)\//.test(key)){
   const from=opposite(prefer),alternate=alternateFor(key,files[from][key].hash);for(const to of ['desktop','phone'])copy(from,to,key,alternate);
  }
 }
 const unique=[...new Map(work.map(item=>[item.to+':'+item.key,item])).values()];
 return {work:unique,conflicts,sourceSide,version:manifests[sourceSide].version,policy:'higher-version-and-union'};
}
