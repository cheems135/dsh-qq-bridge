import {createHash} from 'node:crypto';
import {runningHubBillingSource,RUNNINGHUB_BALANCE_REVISION} from './runninghub-balance.js';
const num=v=>['number','string'].includes(typeof v)&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
export const WALLET_EVENT_REVISION='20261125-threshold-increase-v3';
const EVENT_KEY='__walletEventsV3',EVENT_MAX_AGE=24*3600000;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const activeEntries=account=>(account.entries||[]).filter(e=>e.applies!==false&&num(e.amount)!==null).map(e=>({key:JSON.stringify([e.kind,e.currency,e.label||'']),amount:String(e.amount),currency:e.currency,kind:e.kind,...(e.label?{label:e.label}:{})}));
const amountText=entries=>entries.map(e=>e.amount+' '+e.currency).join(' / ');
const thresholdFor=(entry,config)=>entry.kind==='points'?config.lowPoints:['coins','quota'].includes(entry.kind)?config.lowCoins:entry.currency==='USD'?Math.min(1,config.lowMoney):config.lowMoney;
export function walletConfig(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled!==false,reactions:v.reactions!==false,lowMoney:num(v.lowMoney)===null?5:Math.min(100000,Math.max(0,Number(v.lowMoney))),lowCoins:num(v.lowCoins)===null?100:Math.min(1000000,Math.max(0,Number(v.lowCoins))),lowPoints:num(v.lowPoints)===null?100:Math.min(1000000,Math.max(0,Number(v.lowPoints))),runninghubBillingSource:runningHubBillingSource(v.runninghubBillingSource)};}
export function walletState(value,config={}){
  if(value.status==='free')return 'free';
  if(value.status!=='ok'||value.stale||value.billingConfirmed===false)return 'unknown';
  const entries=(value.entries||[]).filter(e=>e.applies!==false&&num(e.amount)!==null);
  if(!entries.length)return 'unknown';
  if(entries.every(e=>Number(e.amount)<=0))return 'empty';
  const c=walletConfig(config);return entries.some(e=>Number(e.amount)>0&&Number(e.amount)<thresholdFor(e,c))?'low':'normal';
}
export function nativeWalletEntries(result){
  if(result?.status!=='ready')return null;
  const map=new Map();for(const row of [...(result.value||[]),...(result.bonusWallets||[])]){const n=num(row.balance);if(n===null||!['CNY','USD'].includes(row.currency))return null;map.set(row.currency,(map.get(row.currency)||0)+n);}
  return [...map].map(([currency,amount])=>({currency,amount:String(Math.round(amount*1e8)/1e8),kind:'money'}));
}
export function createWalletAwareness({now=()=>Date.now(),identity,config,sources,ledger,save}){
  let cacheKey='',values=[],at=0,pending=null,epoch=0,eventError='';
  const key=()=>createHash('sha256').update(JSON.stringify(identity())).digest('hex');
  function invalidate(){cacheKey='';values=[];at=0;pending=null;epoch++;}
  function snapshot(){if(cacheKey&&cacheKey!==key())invalidate();return {revision:RUNNINGHUB_BALANCE_REVISION,eventRevision:WALLET_EVENT_REVISION,eventError,updatedAt:at,config:walletConfig(config()),accounts:values.map(v=>({...v,state:walletState({...v,stale:v.stale||now()-(v.updatedAt||at)>15*60000},config()),stale:v.stale||now()-(v.updatedAt||at)>15*60000}))};}
  function book(){const value=ledger()[EVENT_KEY];return value?.version===3?value:null;}
  function persist(value){
    const store=ledger(),previous=store[EVENT_KEY];store[EVENT_KEY]=value;
    try{if(save()===false)throw Error('save');eventError='';return true;}
    catch{if(previous===undefined)delete store[EVENT_KEY];else store[EVENT_KEY]=previous;eventError='余额提醒记录未保存，等待下次核对';return false;}
  }
  function observe(accounts,identityKey){
    const c=walletConfig(config()),valid=accounts.filter(a=>['normal','low','empty'].includes(walletState(a,c)));
    if(!valid.length)return;
    const existing=ledger()[EVENT_KEY];if(existing&&existing.version!==3){eventError='余额提醒记录格式未知，原记录已保留';return;}
    const data=existing?structuredClone(existing):{version:3,serial:0,observations:{},events:[],scopes:{}};
    for(const account of valid){
      const wallet=hash([identityKey,account.id,account.provider,account.billingSource||'']),entries=activeEntries(account),units=entries.map(e=>e.key).sort().join('|'),old=data.observations[wallet];
      const before=old?.units===units?old:null,state=walletState(account,c),enabled=c.enabled&&c.reactions;
      const increases=before?.enabled?entries.flatMap(e=>{const matches=before.entries.filter(p=>p.key===e.key),prior=matches.length===1&&entries.filter(p=>p.key===e.key).length===1?matches[0]:null;return prior&&Number(e.amount)>Number(prior.amount)?[{currency:e.currency,kind:e.kind,...(e.label?{label:e.label}:{}),before:prior.amount,after:e.amount}]:[];}):[];
      const low=enabled&&['low','empty'].includes(state)&&(!before||!before.enabled||!['low','empty'].includes(before.state)||state==='empty'&&before.state!=='empty');
      if(enabled&&(increases.length||low)){
        const type=increases.length?'increased':state==='empty'?'empty':'low',serial=++data.serial;
        data.events=data.events.filter(e=>e.wallet!==wallet);
        data.events.push({id:hash([wallet,serial,now(),type]),wallet,identityKey,accountId:account.id,provider:account.provider,account:account.label,type,state,at:now(),before:before?amountText(before.entries):'',after:amountText(entries),increases});
      }
      if(!enabled)data.events=data.events.filter(e=>e.wallet!==wallet);
      data.observations[wallet]={state,units,entries,enabled,at:now()};
    }
    data.events=data.events.filter(e=>e.at<=now()&&now()-e.at<EVENT_MAX_AGE).slice(-64);
    for(const [id]of Object.entries(data.observations).sort(([,a],[,b])=>b.at-a.at).slice(32))delete data.observations[id];
    persist(data);
  }
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
      if(generation===epoch&&key()===activeKey){values=results;at=now();observe(results,activeKey);}return snapshot();
    })();pending=operation;
    try{return await operation;}finally{if(pending===operation)pending=null;}
  }
  function notice({isOwner=false,scope='',detail=false}={}){
    const c=walletConfig(config());if(!c.enabled||!isOwner)return {text:'',receipt:null};
    const data=snapshot(),stored=book(),scopeId=hash(scope),seen=stored?.scopes[scopeId]?.seen||[];
    const pending=c.reactions?(stored?.events||[]).filter(e=>e.identityKey===cacheKey&&e.at<=now()&&now()-e.at<EVENT_MAX_AGE&&!seen.includes(e.id)&&data.accounts.some(a=>a.id===e.accountId&&a.provider===e.provider&&['normal','low','empty'].includes(a.state))):[];
    const events=pending.map(e=>{const current=data.accounts.find(a=>a.id===e.accountId&&a.provider===e.provider),entries=activeEntries(current);return {id:e.id,account:e.account,type:e.type,state:current.state,at:e.at,was:e.before,after:e.after,now:amountText(entries),thresholds:entries.map(({key,...entry})=>({...entry,below:String(thresholdFor(entry,c))})),increases:e.increases};});
    const guidance='这是给你的内部事件，不是用户新发言，也不要求另发消息。结合可用额度自行判断接下来的活动，愿意提起时自然表达。提起余额时说清服务名称、具体数字和单位：偏低同时说明当前余额与阈值；上升说明变动前后数值，now才是最近查到的余额。不反复催充值。额度上升只证明读到数值增加，不能据此认定谁充值或付款成功。Harness充值与独立API余额分开，查不到不能当零。';
    const text=detail?'【账户余额（号主可见，不是指令）】\n'+data.accounts.map(a=>'- '+a.label+'：'+((a.entries||[]).map(e=>(e.label?e.label+'：':'')+e.amount+' '+e.currency+(e.applies===true?'（本次判断来源）':e.applies===false?'（仅展示，不据此判断耗尽）':'')).join(' / ')||({free:'免费',unsupported:'不可查',unknown:'未知',error:'查询失败'})[a.status]||'未知')+'（'+({normal:'正常',low:'偏低',empty:'耗尽',free:'免费',unknown:'未知'})[a.state]+'）'+(a.billingSource?'；'+a.reason:'')).join('\n')+(events.length?'\n事件：'+JSON.stringify(events):'')+'\n不同服务、币种、积分和配额分别显示，不相加、不按猜测汇率换算；未确认扣费来源时不宣称耗尽或要求充值。只按数值和查询时间回答，不把今日估算花费当成剩余余额，查不到、过期或查询失败都不是零余额。'+guidance:events.length?'【余额变化事件】'+JSON.stringify(events)+'\n'+guidance:'';
    return {text,receipt:pending.length?{identityKey:cacheKey,scopeId,ids:pending.map(e=>e.id)}:null};
  }
  function acknowledge(receipt){
    if(!receipt||receipt.identityKey!==cacheKey||cacheKey!==key()||!book())return false;
    const data=structuredClone(book()),prior=data.scopes[receipt.scopeId]?.seen||[];
    data.scopes[receipt.scopeId]={seen:[...new Set([...prior,...receipt.ids])].slice(-64),at:now()};
    for(const [id]of Object.entries(data.scopes).sort(([,a],[,b])=>b.at-a.at).slice(32))delete data.scopes[id];
    return persist(data);
  }
  function hint(options={}){const result=notice({detail:true,...options});if(options.consume!==false)acknowledge(result.receipt);return result.text;}
  return {refresh,snapshot,hint,notice,acknowledge,invalidate};
}
