import fs from 'node:fs';
import path from 'node:path';
import {homedir} from 'node:os';
const devices=['phone','desktop'];
const validDevice=value=>{if(!devices.includes(value))throw Error('请选择手机版或电脑版配置');return value;};
export function profileDefaults(device,{home=homedir(),nativeDevice=process.platform==='win32'?'desktop':'phone'}={}){
 validDevice(device);
 return{wsUrl:'ws://127.0.0.1:3001',accessToken:'',napcatDir:device==='phone'?'/root/projects/napcat/squashfs-root':nativeDevice==='desktop'?path.win32.join(home,'NapCat'):'%USERPROFILE%\\NapCat',launcher:''};
}
function normalized(device,value,defaults){
 const next={...defaults};
 for(const key of ['wsUrl','accessToken','napcatDir','launcher'])if(typeof value?.[key]==='string')next[key]=value[key].trim();
 let url;try{url=new URL(next.wsUrl);}catch{throw Error('QQ 连接地址无效');}
 if(!['ws:','wss:'].includes(url.protocol)||url.username||url.password)throw Error('QQ 连接地址请使用 ws:// 或 wss://，令牌单独填写');
 if(!next.napcatDir||next.napcatDir.length>1600||/[\x00-\x1f]/.test(next.napcatDir+next.launcher)||next.accessToken.length>8192)throw Error('设备路径或令牌格式无效');
 if(device==='phone'&&!path.posix.isAbsolute(next.napcatDir))throw Error('手机版 NapCat 路径应以 / 开头');
 if(device==='desktop'&&!path.win32.isAbsolute(next.napcatDir)&&!next.napcatDir.startsWith('%USERPROFILE%\\'))throw Error('电脑版 NapCat 路径应包含盘符');
 if(device==='phone')next.launcher='';
 return{...next,configured:value?.configured!==false,tokenConfigured:value?.tokenConfigured!==false};
}
export function createDeviceProfiles(options){
 const io=options.fs||fs,own=validDevice(options.device),dir=path.join(options.dataDir,'device-sync','profiles'),viewFile=path.join(options.dataDir,'device-sync','device-profile-view.json');
 const fileFor=device=>path.join(dir,'runtime-'+device+'.json');
 const defaults=d=>profileDefaults(d,{home:options.home,nativeDevice:own});
 const native=()=>{const value=options.current();return{wsUrl:value.wsUrl,accessToken:value.accessToken||'',napcatDir:value.napcatDir,launcher:value.launcher||'',configured:true,tokenConfigured:true};};
 let state,lastEffective;
 const write=(file,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';if(io.existsSync(file)&&io.readFileSync(file,'utf8')===bytes)return;io.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';io.writeFileSync(temp,bytes,{mode:0o600});io.renameSync(temp,file);};
 const effective=value=>{
  let result=value.configured===false?native():{...value};
  if(result.tokenConfigured===false)result.accessToken=native().accessToken;
  if(own==='desktop'&&result.napcatDir?.startsWith('%USERPROFILE%\\'))result.napcatDir=path.win32.join(options.home||homedir(),result.napcatDir.slice(14));
  return result;
 };
 function load(){
  let view={};if(io.existsSync(viewFile))view=JSON.parse(io.readFileSync(viewFile,'utf8'));
  state={version:1,editingDevice:devices.includes(view.editingDevice)?view.editingDevice:own,profiles:{}};
  for(const device of devices){
   const file=fileFor(device),existed=io.existsSync(file);
   const value=existed?JSON.parse(io.readFileSync(file,'utf8')):device===own?native():{configured:false,tokenConfigured:false};
   state.profiles[device]=normalized(device,value,defaults(device));
   if(!existed&&device===own)write(file,state.profiles[device]);
  }
  if(state.profiles[own].configured!==false)options.apply(effective(state.profiles[own]),{startup:true});
  lastEffective=native();
 }
 function captureCurrent(){
  const current=native(),changed=['wsUrl','accessToken','napcatDir','launcher'].filter(key=>current[key]!==lastEffective[key]);
  if(!changed.length)return;
  const next={...state.profiles[own],configured:true};for(const key of changed)next[key]=current[key];if(changed.includes('accessToken'))next.tokenConfigured=true;
  state.profiles[own]=normalized(own,next,defaults(own));lastEffective=current;write(fileFor(own),state.profiles[own]);
 }
 function snapshot(){
  return{runtimeDevice:own,editingDevice:state.editingDevice,version:options.version,sharedRules:true,profiles:Object.fromEntries(devices.map(d=>{const {accessToken,...profile}=d===own?{...state.profiles[d],...native()}:state.profiles[d];return[d,{...profile,hasAccessToken:!!accessToken}];}))};
 }
 function select(device){state.editingDevice=validDevice(device);write(viewFile,{editingDevice:state.editingDevice});return snapshot();}
 function save(device,patch={}){
  validDevice(device);const candidate={...state.profiles[device]};
  candidate.configured=true;
  for(const key of ['wsUrl','napcatDir','launcher'])if(typeof patch[key]==='string')candidate[key]=patch[key];
  if(typeof patch.accessToken==='string'&&patch.accessToken.trim()){candidate.accessToken=patch.accessToken;candidate.tokenConfigured=true;}
  if(patch.clearToken===true){candidate.accessToken='';candidate.tokenConfigured=true;}
  const next=normalized(device,candidate,defaults(device)),previous=state.profiles[device];
  state.profiles[device]=next;
  try{if(device===own){lastEffective=effective(next);options.apply(lastEffective,{startup:false});lastEffective=native();}write(fileFor(device),next);}
  catch(error){state.profiles[device]=previous;if(device===own){options.apply(effective(previous),{startup:true});lastEffective=native();}throw error;}
  return{ok:true,applied:device===own,...snapshot()};
 }
 function restore(value){
  if(!value||value.version!==1||!value.profiles||!devices.every(d=>value.profiles[d]&&typeof value.profiles[d]==='object'))throw Error('设备配置备份格式无效');
  const previous=state,next={version:1,editingDevice:devices.includes(value.editingDevice)?value.editingDevice:own,profiles:{}};
  for(const device of devices)next.profiles[device]=normalized(device,value.profiles[device],defaults(device));
  const persist=value=>{for(const device of devices)write(fileFor(device),value.profiles[device]);write(viewFile,{editingDevice:value.editingDevice});};
  try{state=next;persist(next);load();}catch(error){state=previous;persist(previous);options.apply(effective(previous.profiles[own]),{startup:true});lastEffective=native();throw error;}
  return snapshot();
 }
 load();
 return{snapshot,select,save,captureCurrent,reload:load,exportData:()=>JSON.parse(JSON.stringify({...state,profiles:{...state.profiles,[own]:native()}})),restore};
}
