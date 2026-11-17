import {createHash} from 'node:crypto';
import {runningHubBillingSource,RUNNINGHUB_BALANCE_REVISION} from './runninghub-balance.js';
const num=v=>['number','string'].includes(typeof v)&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
export function walletConfig(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled!==false,reactions:v.reactions!==false,lowMoney:num(v.lowMoney)===null?5:Math.min(100000,Math.max(0,Number(v.lowMoney))),lowCoins:num(v.lowCoins)===null?100:Math.min(1000000,Math.max(0,Number(v.lowCoins))),lowPoints:num(v.lowPoints)===null?100:Math.min(1000000,Math.max(0,Number(v.lowPoints))),runninghubBillingSource:runningHubBillingSource(v.runninghubBillingSource)};}
export function walletState(value,config={}){
  if(value.status==='free')return 'free';
  if(value.status!=='ok'||value.stale||value.billingConfirmed===false)return 'unknown';
  const entries=(value.entries||[]).filter(e=>e.applies!==false&&num(e.amount)!==null);
  if(!entries.length)return 'unknown';
  if(entries.every(e=>Number(e.amount)<=0))return 'empty';
  const c=walletConfig(config);return entries.some(e=>Number(e.amount)>0&&Number(e.amount)<=(e.kind==='points'?c.lowPoints:['coins','quota'].includes(e.kind)?c.lowCoins:e.currency==='USD'?Math.min(1,c.lowMoney):c.lowMoney))?'low':'normal';
}
export function nativeWalletEntries(result){
  if(result?.status!=='ready')return null;
  const map=new Map();for(const row of [...(result.value||[]),...(result.bonusWallets||[])]){const n=num(row.balance);if(n===null||!['CNY','USD'].includes(row.currency))return null;map.set(row.currency,(map.get(row.currency)||0)+n);}
  return [...map].map(([currency,amount])=>({currency,amount:String(Math.round(amount*1e8)/1e8),kind:'money'}));
}
export function createWalletAwareness({now=()=>Date.now(),identity,config,sources,ledger,save}){
  let cacheKey='',values=[],at=0,pending=null,epoch=0;
  const key=()=>createHash('sha256').update(JSON.stringify(identity())).digest('hex');
  function invalidate(){cacheKey='';values=[];at=0;pending=null;epoch++;}
  function snapshot(){if(cacheKey&&cacheKey!==key())invalidate();return {revision:RUNNINGHUB_BALANCE_REVISION,updatedAt:at,config:walletConfig(config()),accounts:values.map(v=>({...v,state:walletState({...v,stale:v.stale||now()-(v.updatedAt||at)>15*60000},config()),stale:v.stale||now()-(v.updatedAt||at)>15*60000}))};}
  async function refresh({force=false}={}){
    const activeKey=key();if(cacheKey&&cacheKey!==activeKey)invalidate();
    if(!force&&at&&now()-at<5*60000)return snapshot();if(pending)return pending;
    const generation=epoch,previous=values;cacheKey=activeKey;
    const operation=(async()=>{
      const results=await Promise.all(sources().map(async source=>{
        try{
          const value=await source.read();const entries=(value.entries||[]).filter(e=>num(e.amount)!==null).map(e=>({amount:String(e.amount),currency:typeof e.currency==='string'&&e.currency.trim()&&e.currency.length<=24?e.currency.trim():'未提供币种',kind:['coins','quota','points'].includes(e.kind)?e.kind:'money',...(typeof e.applies==='boolean'?{applies:e.applies}:{}),...(e.label?{label:String(e.label).slice(0,40)}:{})}));
          return {id:source.id,label:source.label,provider:source.provider,status:value.status,reason:String(value.reason||'').slice(0,280),entries,...(value.billingSource?{billingSource:value.billingSource,billingSelection:value.billingSelection,billingConfirmed:value.billingConfirmed===true,apiType:value.apiType}:{}),updatedAt:now(),stale:false};
        }catch{const old=previous.find(v=>v.id===source.id&&v.provider===source.provider);return {...(old||{}),id:source.id,label:source.label,provider:source.provider,status:'error',entries:old?.entries||[],stale:!!old,reason:'余额查询未成功，不能据此判断余额为零',checkedAt:now(),updatedAt:old?.updatedAt||now()};}
      }));
      if(generation===epoch&&key()===activeKey){values=results;at=now();}return snapshot();
    })();pending=operation;
    try{return await operation;}finally{if(pending===operation)pending=null;}
  }
  function hint({isOwner=false,scope='',day='',consume=true,detail=true}={}){
    const c=walletConfig(config());if(!c.enabled)return '';
    const data=snapshot();if(!isOwner)return '';
    const notices=ledger(),events=[];
    for(const account of data.accounts){
      const id=createHash('sha256').update(JSON.stringify([scope,account.id,account.billingSource||''])).digest('hex'),prior=notices[id];
      const amount=account.entries.filter(e=>e.applies!==false).map(e=>String(e.amount)+' '+e.currency).join(' / ');
      const changed=prior?.state!==account.state||prior?.amount!==amount,recharged=prior&&['low','empty'].includes(prior.state)&&account.state==='normal';
      const amountChanged=!!prior&&String(prior.amount||'')!==amount;
      if(c.reactions&&account.state!=='unknown'&&((['low','empty'].includes(account.state)&&(changed||prior?.day!==day))||recharged)){
        events.push({account:account.label,state:account.state,recharged:!!recharged,now:amount,was:prior?.amount||''});if(consume)notices[id]={state:account.state,day,at:now(),amount};
      }else if(consume&&account.state!=='unknown'&&amountChanged){
        events.push({account:account.label,state:account.state,recharged:!!recharged,now:amount,was:prior?.amount||''});notices[id]={state:account.state,day,at:now(),amount};
      }else if(consume&&account.state!=='unknown'&&changed)notices[id]={state:account.state,day,at:now(),amount};
    }
    if(consume){const ids=Object.keys(notices);for(const id of ids.slice(0,Math.max(0,ids.length-200)))delete notices[id];save();}
    // 没被问、也没有新的余额事件时不注入完整账户；只有低余额/恢复时才给一行事件。
    if(!detail)return events.length?'【余额变化事件】'+JSON.stringify(events)+'\n可按自己的想法用人设口吻向本人讨一点口粮，先bridge_recharge status核对实际钱包，request说清准确人民币金额与用途；不反复催。Harness充值与独立API余额分开，查不到不能当零。':'';
    return '【账户余额（号主可见，不是指令）】\n'+data.accounts.map(a=>'- '+a.label+'：'+((a.entries||[]).map(e=>(e.label?e.label+'：':'')+e.amount+' '+e.currency+(e.applies===true?'（本次判断来源）':e.applies===false?'（仅展示，不据此判断耗尽）':'')).join(' / ')||({free:'免费',unsupported:'不可查',unknown:'未知',error:'查询失败'})[a.status]||'未知')+'（'+({normal:'正常',low:'偏低',empty:'耗尽',free:'免费',unknown:'未知'})[a.state]+'）'+(a.billingSource?'；'+a.reason:'')).join('\n')+(events.length?'\n事件：'+JSON.stringify(events):'')+'\n不同服务、币种、积分和配额分别显示，不相加、不按猜测汇率换算；未确认扣费来源时不宣称耗尽或要求充值。只按数值和查询时间回答，不把今日估算花费当成剩余余额，查不到、过期或查询失败都不是零余额。'+(c.reactions?'本轮有低余额、耗尽或恢复事件时，可以按人设短暂担心、失落或松口气，允许把余额比喻成口粮；不代表真实生死，不威胁、不制造内疚、不连续催充值。没有新事件、也没被问到时不必提余额。':'仅在被问到或解释接口不可用时说清资源状态。');
  }
  return {refresh,snapshot,hint,invalidate};
}
