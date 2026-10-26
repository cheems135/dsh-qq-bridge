import {calendarNow} from './life-memory.js';
const integer=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback;
export function initiativeState(value={},now=Date.now()){
  const day=calendarNow(now,'Asia/Shanghai').day,old=value&&typeof value==='object'?value:{};
  return{day,counts:Object.fromEntries(['signature','qzone','chats'].map(k=>[k,old.day===day?integer(old.counts?.[k],0,0,1000):0])),lastActionAt:Number(old.lastActionAt)||0,log:Array.isArray(old.log)?old.log.slice(0,30):[],...(old.lastError?{lastError:old.lastError}:{})};
}
export function initiativeWindow(config,now=Date.now()){
  const hour=Math.floor(calendarNow(now,'Asia/Shanghai').minute/60),start=integer(config.wakeStart,9,0,23),end=integer(config.wakeEnd,23,0,24);
  return start<=end?hour>=start&&hour<end:hour>=start||hour<end;
}
export function initiativeAllowed(config,state,{kind='chats',now=Date.now(),manual=false,quiet=false}={}){
  if(manual)return true;
  if(!config.enabled||quiet||!initiativeWindow(config,now))return false;
  if((state.counts[kind]||0)>=integer(config.maxPerDay?.[kind],0,0,1000))return false;
  return !state.lastActionAt||now-state.lastActionAt>=integer(config.minGapMinutes,45,1,1440)*60000;
}
