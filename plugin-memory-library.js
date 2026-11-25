import {createHash} from 'node:crypto';
import {mergeSyncJson} from './sync-union.js';

// Files stay in the plugin's configured memory directory. The active QQ account is
// a transport identity used by callers to authorize work, never the owner of a memory.
export const PLUGIN_MEMORY_OWNER='dsh:persona-library';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const missing=()=>Object.assign(Error('Memory document does not exist'),{code:'ENOENT'});
const docPattern=/^(?:growth-)?[a-f0-9]{64}\.json$/;
const sourcePattern=/^source-([a-f0-9]{64})-([a-f0-9]{64})\.json$/;

export function libraryFile(kind,meta,accountId=meta.accountId||''){
 const key=meta.key||'';
 if(kind==='hub')return digest([accountId,key])+'.json';
 const parts=kind==='calendar'?[meta.kind,accountId,key,meta.personaId]:[accountId,key,meta.personaId];
 return (kind==='growth'?'growth-':'')+digest(parts)+'.json';
}
export function createPluginMemoryStorage(kind,{storage,activeAccount,location,personaVersion=(_,v)=>v}){
 let tag='',catalog=null;
 function register(c,meta){
  const virtual=libraryFile(kind,meta,c.account),stable=libraryFile(kind,meta,PLUGIN_MEMORY_OWNER);
  if(!c.docs.has(virtual))c.docs.set(virtual,{meta:{...meta,accountId:c.account},stable,legacy:[],sources:new Map()});
  return c.docs.get(virtual);
 }
 function index(){
  const account=activeAccount()||'',next=JSON.stringify([location(),account]);
  if(catalog&&tag===next)return catalog;
  const files=storage.list(), c={account,docs:new Map(),aliases:new Map(),origins:new Map(),files:new Set(files)};
  for(const file of files){
   if(!docPattern.test(file))continue;
   let doc;try{doc=storage.read(file);}catch(error){if(error.code==='MEMORY_CORRUPT'||error.code==='ENOENT')continue;throw error;}
   if(!doc?.meta||libraryFile(kind,doc.meta)!==file)continue;
   const group=register(c,doc.meta);
   c.origins.set(file,doc.meta.accountId||'');
   c.aliases.set(file.slice(0,-5),group);
   if(file!==group.stable)group.legacy.push(file);
  }
  if(kind==='hub')for(const file of files){
   const parts=sourcePattern.exec(file);if(!parts)continue;
   const group=c.aliases.get(parts[1]);if(!group)continue;
   if(!group.sources.has(parts[2])||parts[1]+'.json'===group.stable)group.sources.set(parts[2],file);
  }
  catalog=c;tag=next;return c;
 }
 function convertHubView(doc,key,account,dest,convertScope){
  const views={};
  for(const v of Object.values(doc.views||{})){
   v.personaVersion=personaVersion({key,accountId:account,personaId:v.personaId},v.personaVersion,dest)||v.personaVersion;
   for(const entry of [v.capsule,...v.diaries||[]])if(Array.isArray(entry?.sourceScopes))entry.sourceScopes=entry.sourceScopes.map(convertScope);
   views[digest([v.personaId||'legacy',v.personaVersion||'legacy'])]=v;
  }
  doc.views=views;
 }
 function convert(doc,group,c,dest){
  const account=doc.meta.accountId||'';
  if(kind==='hub')convertHubView(doc,doc.meta.key,account,dest,id=>{
   const other=c.aliases.get(id);
   return other?libraryFile(kind,other.meta,dest).slice(0,-5):id;
  });
  doc.meta=kind==='hub'?{accountId:dest,key:group.meta.key}:{...group.meta,accountId:dest};
  return doc;
 }
 function read(file){
  const c=index(),match=sourcePattern.exec(file);
  if(match){
   const group=c.docs.get(match[1]+'.json'),stored=group?.sources.get(match[2]);if(!stored)throw missing();
   const row=storage.read(stored);
   if(stored!=='source-'+row.scope+'-'+row.id+'.json')throw Error('记忆原文与所属范围不一致');
   const source=stored.slice(7,71)+'.json';
   const account=row.sourceAccountId??(source===group.stable?PLUGIN_MEMORY_OWNER:c.origins.get(source));
   return {...row,scope:match[1],sourceAccountId:account,personaVersion:personaVersion({...group.meta,accountId:account,personaId:row.personaId},row.personaVersion,c.account)};
  }
  const group=c.docs.get(file);
  if(!group){if(file.startsWith('limit-'))return storage.read(file);throw missing();}
  if(c.files.has(group.stable)){
   const doc=storage.read(group.stable);if(doc.libraryDeleted)throw missing();
   return convert(doc,group,c,c.account);
  }
  let union;
  for(const source of group.legacy){
   const doc=convert(storage.read(source),group,c,c.account);
   union=union?mergeSyncJson(union,doc,{key:kind==='hub'?'memory/memory-hub/'+file:'',prefer:'phone'}):doc;
  }
  if(!union)throw missing();
  return union;
 }
 function write(file,data){
  const c=index(),match=sourcePattern.exec(file);
  if(match){
   const group=c.docs.get(match[1]+'.json');if(!group||data.id!==match[2]||data.scope!==match[1])throw Error('记忆原文所属范围已改变');
   const scope=group.stable.slice(0,-5),dest='source-'+scope+'-'+data.id+'.json';
   storage.write(dest,{...data,scope,sourceAccountId:data.sourceAccountId??c.account,personaVersion:personaVersion({...group.meta,personaId:data.personaId,accountId:c.account},data.personaVersion,PLUGIN_MEMORY_OWNER)});group.sources.set(data.id,dest);c.files.add(dest);return;
  }
  if(file.startsWith('limit-'))return storage.write(file,data);
  if(!data?.meta||data.meta.accountId!==c.account||libraryFile(kind,data.meta)!==file)throw Error('记忆写入所属范围已改变');
  const group=register(c,data.meta);
  for(const id of [file,group.stable])c.aliases.set(id.slice(0,-5),group);
  storage.write(group.stable,convert(structuredClone(data),group,c,PLUGIN_MEMORY_OWNER));c.files.add(group.stable);group.deleted=false;
 }
 function list(){
  const c=index(),files=[];
  for(const [file,g] of c.docs){
   if(g.deleted===undefined)g.deleted=c.files.has(g.stable)&&storage.read(g.stable).libraryDeleted===true;
   if(g.deleted||!c.files.has(g.stable)&&!g.legacy.length)continue;
   files.push(file);if(kind==='hub')for(const id of g.sources.keys())files.push('source-'+file.slice(0,-5)+'-'+id+'.json');
  }
  return files;
 }
 function prepare(meta){
  const c=index();
  if((meta.accountId||'')===c.account){
   const group=register(c,meta);group.meta={...meta};
   for(const file of [libraryFile(kind,meta),group.stable])c.aliases.set(file.slice(0,-5),group);
  }
 }
 function remove(file){
  const c=index(),g=c.docs.get(file);if(!g)return;
  storage.write(g.stable,{meta:{...g.meta,accountId:PLUGIN_MEMORY_OWNER},libraryDeleted:true});
  c.files.add(g.stable);g.deleted=true;
 }
 return {list,read,write,remove,prepare,reload(){catalog=null;}};
}
