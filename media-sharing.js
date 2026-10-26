import {createHash,randomUUID} from 'node:crypto';
const bound=(v,f,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Math.round(Number(v)))):f;
export function sharingConfig(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled===true,voice:v.voice!==false,images:v.images!==false,duringChat:v.duringChat!==false,idle:v.idle!==false,minGapMinutes:bound(v.minGapMinutes,60,10,1440),maxVoicePerDay:bound(v.maxVoicePerDay,4,0,20),maxImagesPerDay:bound(v.maxImagesPerDay,2,0,10)};}
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function sharingLedger(value={},now=Date.now()){
  const d=new Date(now),day=[d.getFullYear(),d.getMonth()+1,d.getDate()].join('-');
  const old=value&&typeof value==='object'?value:{};
  return {day,counts:old.day===day?{voice:Math.max(0,Number(old.counts?.voice)||0),image:Math.max(0,Number(old.counts?.image)||0)}:{voice:0,image:0},lastAt:Number(old.lastAt)||0,contexts:old.contexts&&typeof old.contexts==='object'?old.contexts:{},log:Array.isArray(old.log)?old.log.slice(-40):[]};
}
export function sharingAllowed(config,ledger,{kind,now=Date.now(),idle=false}={}){
  if(!config.enabled||!(idle?config.idle:config.duringChat))return false;
  if(kind==='voice'&&!config.voice||kind==='image'&&!config.images||!['voice','image'].includes(kind))return false;
  if((ledger.counts[kind]||0)>=(kind==='voice'?config.maxVoicePerDay:config.maxImagesPerDay))return false;
  return !ledger.lastAt||now-ledger.lastAt>=config.minGapMinutes*60_000;
}
export function reserveShare(config,ledger,{kind,key,personaId,topic='',idle=false,now=Date.now()}={}){
  if(!sharingAllowed(config,ledger,{kind,idle,now}))return null;
  const scope=hash([key,personaId]),fingerprint=hash([kind,String(topic).trim().toLowerCase().replace(/\s+/g,' ')]);
  const recent=(ledger.contexts[scope]||[]).filter(e=>now-e.at<24*60*60_000);
  if(recent.some(e=>e.hash===fingerprint))return null;
  const item={id:randomUUID(),at:now,key,personaId,kind,status:'generating'};
  ledger.counts[kind]++;ledger.lastAt=now;ledger.contexts[scope]=[...recent,{at:now,hash:fingerprint}].slice(-8);
  const scopes=Object.keys(ledger.contexts);for(const id of scopes.slice(0,Math.max(0,scopes.length-100)))delete ledger.contexts[id];
  ledger.log=[...ledger.log,item].slice(-40);return item;
}
export function finishShare(ledger,item,status,error=''){const found=ledger.log.find(e=>e.id===item?.id);if(found){found.status=status;if(error)found.error=String(error).slice(0,180);}}
export function explicitlyRequestsVoice(text=''){if(/(?:不要|别发|不用|不想听|不方便听).{0,8}(?:语音|声音)|(?:语音).{0,8}(?:开关|设置|接口|问题|失败)/.test(text))return false;return /(?:语音|发.{0,6}声音|用.{0,5}(?:声音|语音)|说给我听|念给我听|voice message|read aloud)/i.test(text);}
