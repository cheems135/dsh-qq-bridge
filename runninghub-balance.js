// Official accountStatus now optionally returns remainPoint (singular).
// https://www.runninghub.cn/runninghub-api-doc-cn/api-425748943
// Points, wallet money and legacy RH coins are separate balances, not exchange rates.
export const RUNNINGHUB_BALANCE_REVISION='20261111-provider-wallet-v2';
export function runningHubBillingSource(value){return ['points','money'].includes(value)?value:'auto';}
function decimal(value){
  if(typeof value==='number')return Number.isFinite(value)?String(value):null;
  if(typeof value!=='string')return null;
  const text=value.trim();return text.length<=100&&/^-?\d+(?:\.\d+)?$/.test(text)&&Number.isFinite(Number(text))?text:null;
}
export function parseRunningHubBalance(data={},options={}){
  const source=runningHubBillingSource(options.billingSource);
  const points=decimal(data.remainPoint),money=decimal(data.remainMoney),coins=decimal(data.remainCoins);
  const currency=typeof data.currency==='string'&&['CNY','USD'].includes(data.currency.toUpperCase())?data.currency.toUpperCase():null;
  // Never infer API key billing from undocumented accountStatus.apiType values.
  // Even a single returned resource does not prove that this key can spend it.
  const selected=source==='auto'?'unknown':source;
  const amount={points,money,coins}[selected];
  const billingConfirmed=selected!=='unknown'&&amount!==null&&amount!==undefined&&(selected!=='money'||currency!==null);
  const labels={points:'新版平台积分',money:'API 钱包',coins:'旧 RH 币'};
  let reason=source==='auto'?'当前 Key 扣费来源尚未确认；先分别显示已返回的余额，请在余额感知中选择判断来源。':'按你指定的“'+labels[selected]+'”判断，不代表平台自动确认扣费来源。';
  if(!billingConfirmed&&selected!=='unknown')reason+='所选余额或钱包币种尚未返回，不能当作零。';
  reason+='积分与 API 钱包分账展示，不相加、不换算，也不能由此推算还可生成几张。';
  return {provider:'runninghub',supported:true,status:[points,money].some(x=>x!==null)?'ok':'unknown',points,money,coins,currency,currentTaskCounts:decimal(data.currentTaskCounts),apiType:String(data.apiType||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,40),billingSource:selected,billingSelection:source,billingConfirmed,reason,revision:RUNNINGHUB_BALANCE_REVISION,updatedAt:options.updatedAt??Date.now()};
}
export function runningHubBalanceEntries(value){
  const entries=[];
  if(value.points!==null&&value.points!==undefined)entries.push({amount:value.points,currency:'积分',kind:'points',label:'新版平台积分',applies:value.billingConfirmed===true&&value.billingSource==='points'});
  if(value.money!==null&&value.money!==undefined)entries.push({amount:value.money,currency:value.currency||'未提供币种',kind:'money',label:'API 钱包',applies:value.billingConfirmed===true&&value.billingSource==='money'});
  return entries;
}
