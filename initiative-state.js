import {calendarNow} from './life-memory.js';
const integer=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.min(max,Math.max(min,Math.round(Number(value)))):fallback;
export function initiativeState(value={},now=Date.now()){
  const day=calendarNow(now,'Asia/Shanghai').day,old=value&&typeof value==='object'?value:{};
  return{day,counts:Object.fromEntries(['signature','qzone','qzoneReplies','chats'].map(k=>[k,old.day===day?integer(old.counts?.[k],0,0,10000):0])),actions:old.actions&&typeof old.actions==='object'?old.actions:{},lastActionAt:Number(old.lastActionAt)||0,log:Array.isArray(old.log)?old.log.slice(0,30):[],...(Number(old.nextGapFor)>0?{nextGapFor:Number(old.nextGapFor),nextGapAt:Number(old.nextGapAt)||0}:{}),...(old.lastError?{lastError:old.lastError}:{})};
}
export function initiativeWindow(config,now=Date.now()){
  const hour=Math.floor(calendarNow(now,'Asia/Shanghai').minute/60),start=integer(config.wakeStart,9,0,23),end=integer(config.wakeEnd,23,0,24);
  return start<=end?hour>=start&&hour<end:hour>=start||hour<end;
}
/** 下次主动间隔：在基准之上加随机抖动。固定间隔等于把作息写在脸上。 */
export function initiativeGapMs(config={},rng=Math.random){
  const base=integer(config.minGapMinutes,45,1,1440)*60000,jitter=integer(config.gapJitterPercent,80,0,400);
  if(jitter===0)return base;
  return base+Math.round(base*rng()*jitter/100);
}
export function initiativeAllowed(config,state,{kind='chats',now=Date.now(),manual=false,quiet=false,rng=Math.random}={}){
  if(manual)return true;
  if(!config.enabled||quiet||!initiativeWindow(config,now))return false;
  if(config.unrestricted)return true;
  if((state.counts[kind]||0)>=integer(config.maxPerDay?.[kind],0,0,1000))return false;
  const times=Object.entries(state.actions||{}).filter(([action])=>kind==='chats'?!['qzone','qzoneReply','signature'].includes(action):action===(kind==='qzoneReplies'?'qzoneReply':kind)).map(([,row])=>Number(row.lastAt)||0);
  const lastAt=Object.keys(state.actions||{}).length?Math.max(0,...times):state.lastActionAt;
  if(!lastAt)return true;
  // 每次动作后抽定一个具体时刻并一直沿用到下次动作，避免每次调用重新随机导致总取最短。
  const bound=Number(state.nextGapFor)===lastAt&&Number(state.nextGapAt)>0;
  if(!bound){state.nextGapFor=lastAt;state.nextGapAt=lastAt+initiativeGapMs(config,rng);}
  return now>=Number(state.nextGapAt);
}
