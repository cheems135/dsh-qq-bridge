// IDs make repeated completion updates and restarts safe to account for once.
const dayFormatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai'});
export const billingDay = (at = Date.now()) => {
  const date = new Date(at);
  return Number.isFinite(date.getTime()) ? dayFormatter.format(date) : '';
};

/* 与 usage.json 相同的计费口径：元/百万 token，[空闲, 高峰]。用于给单条调用记录补上花费。 */
const TOKEN_PRICE={hit:[0.02,0.04],miss:[1,2],out:[4,8]};
export function isPeakTime(timeMs){
  const local=new Date((Number(timeMs)||Date.now())+8*3600*1000);
  const day=local.getUTCDay();
  if(day===0||day===6)return false;
  const hour=local.getUTCHours();
  return (hour>=9&&hour<12)||(hour>=14&&hour<18);
}
function tokenCost(usage,at){
  if(!usage||typeof usage!=='object')return 0;
  const tier=isPeakTime(at)?1:0;
  const input=Number(usage.inputTokens)||0,cache=Number(usage.cacheReadTokens)||0,output=Number(usage.outputTokens)||0;
  const cost=(cache/1e6)*TOKEN_PRICE.hit[tier]+(input/1e6)*TOKEN_PRICE.miss[tier]+(output/1e6)*TOKEN_PRICE.out[tier];
  return Number.isFinite(cost)&&cost>0?cost:0;
}
function validDayEntry(entry){
  return Number.isFinite(entry?.cost)&&entry.cost>=0&&Number.isSafeInteger(entry.calls)&&entry.calls>0;
}
export function invocationCost(usage,at){
  const days=usage?.billingDays;
  if(days&&typeof days==='object'){
    const entries=Object.values(days);
    if(entries.length&&entries.every(validDayEntry))return entries.reduce((sum,entry)=>sum+entry.cost,0);
  }
  return tokenCost(usage,at);
}

// DSH appends one usage receipt per assistant step. The daily ledger and the
// retained chat audit can be saved independently or replayed after a restart.
export function accountChatUsage(current,audit,sessionId,event,now=Date.now()){
  const {usage:tokens,turn,step}=event.data;
  if(!tokens||typeof tokens!=='object')return {daily:current,auditChanged:false};
  const timestamp=new Date(event.time??now).getTime(),at=Number.isFinite(timestamp)?timestamp:now;
  const key=turn!=null&&step!=null?JSON.stringify([sessionId,turn,step]):
    event.seq!=null?JSON.stringify([sessionId,'event',event.seq]):null;
  const day=billingDay(at),cost=tokenCost(tokens,at);
  let daily=current,auditChanged=false;
  if(day===billingDay(now)){
    const base=current?.day===day?current:{day,total:0,turns:0,last:0};
    if(!key||!Object.hasOwn(base.chatEntries||{},key)){
      daily={...base,total:(Number(base.total)||0)+cost,turns:(Number(base.turns)||0)+1,last:cost};
      if(key)daily.chatEntries={...base.chatEntries,[key]:true};
    }
  }
  if(audit&&(!key||!audit.usageStepKeys?.includes(key))){
    const previous=audit.usage,usage={...previous},days={...previous?.billingDays};
    // A legacy audit retained only its last receipt; keep what it actually knew.
    if(previous&&!previous.billingDays&&audit.at){
      days[billingDay(audit.at)]={cost:invocationCost(previous,audit.at),calls:1};
    }
    for(const [name,value] of Object.entries(tokens)){
      if(name.endsWith('Tokens')&&Number.isFinite(value))usage[name]=(Number(previous?.[name])||0)+value;
    }
    const prior=days[day];
    days[day]={cost:(prior?.cost||0)+cost,calls:(prior?.calls||0)+1};
    audit.usage={...usage,billingDays:days};
    if(key)(audit.usageStepKeys??=[]).push(key);
    auditChanged=true;
  }
  return {daily,auditChanged};
}
export function costText(cost){  const value=Number(cost)||0;
  if(value<=0)return '';
  if(value<0.0001)return '<0.0001 元';
  return (value<1?value.toFixed(4):value.toFixed(2))+' 元';
}
/* 按今天已记录的调用，分别统计聊天与工具的花费；聊天以 usage.json 的当日累计为准。 */
export function invocationSpend(rows,usage,now=Date.now()){
  const day=billingDay(now);
  let chat=0,tool=0,chatCalls=0,toolCalls=0;
  const requests=new Map();
  for(const row of Array.isArray(rows)?rows:[]){
    if(!row?.at||row.backend==='local')continue;
    const days=row.usage?.billingDays;
    const grouped=days&&typeof days==='object'&&Object.values(days).some(validDayEntry);
    const entry=grouped&&validDayEntry(days[day])?days[day]:undefined;
    if(grouped?!entry:billingDay(row.at)!==day)continue;
    const cost=entry?.cost??invocationCost(row.usage,row.at),calls=entry?.calls??1;
    if(row.kind==='chat'&&row.tool!=='model.complete'){chat+=cost;chatCalls+=calls;}else{tool+=cost;toolCalls+=calls;}
    const key=row.auditId||row.id;if(!key)continue;
    const item=requests.get(key)||{id:key,chat:row.chat||'',cost:0,calls:0,purposes:[]};
    if(row.usage){item.cost+=cost;item.calls+=calls;}
    if(row.purpose&&!item.purposes.includes(row.purpose))item.purposes.push(row.purpose);
    requests.set(key,item);
  }
  const metered=usage&&usage.day===day,auxiliaryTotal=metered?Number(usage.auxiliaryTotal)||0:tool;
  const total=metered?Number(usage.total)||0:chat+tool,turnTotal=metered?Math.max(0,total-auxiliaryTotal):chat;
  return {day,chat:turnTotal,tool:auxiliaryTotal,total,turnTotal,auxiliaryTotal,chatCalls,toolCalls,chatText:costText(turnTotal),toolText:costText(auxiliaryTotal),totalText:costText(total),turnText:costText(turnTotal),requests:[...requests.values()],coverage:'总额包含已记账的辅助模型调用；逐请求明细限当前保留记录，媒体钱包及积分另计'};
}

export function foldAuxiliaryUsage(current,row,price,now=Date.now()){
 if(!row?.id||!Number.isFinite(row.at)||row.backend!=='api'||row.tool!=='model.complete'||!row.usage||!['returned','failed','cancelled'].includes(row.status)||billingDay(row.at)!==billingDay(now))return current;
 const cost=price(row.usage,row.at);if(!Number.isFinite(cost)||cost<0)return current;
 const day=billingDay(now),base=current?.day===day?current:{day,total:0,turns:0,last:0};
 const entries={...(base.auxiliaryEntries||{})},previous=Number(entries[row.id]?.cost)||0;
 if(entries[row.id]&&previous===cost)return current;
 entries[row.id]={cost,at:row.at,auditId:row.auditId||'',purpose:row.purpose||'',provider:row.provider||'',model:row.model||''};
 return {...base,total:Math.max(0,(Number(base.total)||0)+cost-previous),auxiliaryTotal:Math.max(0,(Number(base.auxiliaryTotal)||0)+cost-previous),auxiliaryCalls:Object.keys(entries).length,auxiliaryEntries:entries};
}
export function usageBreakdown(usage){
 const {auxiliaryEntries,chatEntries,...publicUsage}=usage||{};
 const auxiliaryTotal=Number(usage?.auxiliaryTotal)||0;
 return {...publicUsage,auxiliaryTotal,auxiliaryCalls:Number(usage?.auxiliaryCalls)||0,turnTotal:Math.max(0,(Number(usage?.total)||0)-auxiliaryTotal),pricing:'按插件配置单价估算；媒体余额及积分另计，以服务商账单为准'};
}
