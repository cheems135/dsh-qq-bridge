import {createHash,randomUUID} from 'node:crypto';
import {calendarNow} from './life-memory.js';
import {requestsVoice} from './media-intent.js';
const bound=(v,f,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Math.round(Number(v)))):f;
export function sharingConfig(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled===true,limits:v.limits!==false,voice:v.voice!==false,images:v.images!==false,duringChat:v.duringChat!==false,idle:v.idle!==false,schedule:v.schedule!==false,minGapMinutes:bound(v.minGapMinutes,60,10,1440),maxVoicePerDay:bound(v.maxVoicePerDay,4,0,20),maxImagesPerDay:bound(v.maxImagesPerDay,2,0,10)};}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function sharingLedger(value={},now=Date.now()){
  const day=calendarNow(now,'Asia/Shanghai').day;
  const old=value&&typeof value==='object'?value:{};
  const sameDay=old.day===day||old.day===day.replace(/-0/g,'-');
  return {day,counts:sameDay?{voice:Math.max(0,Number(old.counts?.voice)||0),image:Math.max(0,Number(old.counts?.image)||0)}:{voice:0,image:0},lastAt:Number(old.lastAt)||0,contexts:old.contexts&&typeof old.contexts==='object'?old.contexts:{},scenes:Object.fromEntries(Object.entries(old.scenes||{}).filter(([,at])=>now-at<2*86400000).slice(-120)),log:Array.isArray(old.log)?old.log.slice(-40):[]};
}
export function sharingAllowed(config,ledger,{kind,now=Date.now(),idle=false,direct=false}={}){
  if(!config.enabled||!(idle?config.idle:config.duringChat))return false;
  if(kind==='voice'&&!config.voice||kind==='image'&&!config.images||!['voice','image'].includes(kind))return false;
  // limits=false 时不再按代码里的固定数量/间隔拦截；功能开关（语音、图片、聊天中允许）仍然生效。
  if(config.limits===false)return true;
  if((ledger.counts[kind]||0)>=(kind==='voice'?config.maxVoicePerDay:config.maxImagesPerDay))return false;
  // 直接回复由她自己判断要不要用媒体，不受“自主分享”的间隔和重复指纹限制；
  // 每日上限仍然保留，避免刷屏。主动搭话/定时分享继续走间隔规则。
  return direct||!ledger.lastAt||now-ledger.lastAt>=config.minGapMinutes*60_000;
}
export function scheduleShareId(key,personaId,scene){return scene?.date&&scene?.phase?hash([key,personaId,scene.date,scene.phase]):'';}
export function scheduleShareSeen(ledger,key,personaId,scene){const id=scheduleShareId(key,personaId,scene);return !!id&&!!ledger.scenes?.[id];}
export function reserveShare(config,ledger,{kind,key,personaId,topic='',scene=null,idle=false,direct=false,now=Date.now()}={}){
  if(!sharingAllowed(config,ledger,{kind,idle,now,direct}))return null;
  if(config.limits!==false&&scene&&scheduleShareSeen(ledger,key,personaId,scene))return null;
  const scope=hash([key,personaId]),fingerprint=hash([kind,String(topic).trim().toLowerCase().replace(/\s+/g,' ')]);
  const recent=(ledger.contexts[scope]||[]).filter(e=>now-e.at<24*60*60_000);
  if(config.limits!==false&&!direct&&recent.some(e=>e.hash===fingerprint))return null;
  const sceneId=scheduleShareId(key,personaId,scene),item={id:randomUUID(),at:now,key,personaId,kind,status:'generating',...(sceneId?{sceneId}:{})};
  if(sceneId){ledger.scenes=ledger.scenes||{};ledger.scenes[sceneId]=now;}
  ledger.counts[kind]++;ledger.lastAt=now;ledger.contexts[scope]=[...recent,{at:now,hash:fingerprint}].slice(-8);
  const scopes=Object.keys(ledger.contexts);for(const id of scopes.slice(0,Math.max(0,scopes.length-100)))delete ledger.contexts[id];
  ledger.log=[...ledger.log,item].slice(-40);return item;
}
export function finishShare(ledger,item,status,error=''){const found=ledger.log.find(e=>e.id===item?.id);if(found){found.status=status;if(error)found.error=String(error).slice(0,180);}}
export function explicitlyRequestsVoice(text=''){return requestsVoice(text);}
