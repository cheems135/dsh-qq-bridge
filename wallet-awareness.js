import {createHash} from 'node:crypto';
const num=v=>v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v))?Number(v):null;
export function walletConfig(value={}){const v=value&&typeof value==='object'?value:{};return {enabled:v.enabled!==false,reactions:v.reactions!==false,lowMoney:num(v.lowMoney)===null?5:Math.min(100000,Math.max(0,Number(v.lowMoney))),lowCoins:num(v.lowCoins)===null?100:Math.min(1000000,Math.max(0,Number(v.lowCoins)))};}
export function walletState(value,config={}){
  if(value.status==='free')return 'free';
  if(value.status!=='ok'||value.stale||!value.entries?.length)return 'unknown';
  if(value.entries.every(e=>num(e.amount)!==null&&Number(e.amount)<=0))return 'empty';
  const c=walletConfig(config);return value.entries.some(e=>Number(e.amount)>0&&Number(e.amount)<=(['coins','quota'].includes(e.kind)?c.lowCoins:e.currency==='USD'?Math.min(1,c.lowMoney):c.lowMoney))?'low':'normal';
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
  function snapshot(){if(cacheKey&&cacheKey!==key())invalidate();return {updatedAt:at,config:walletConfig(config()),accounts:values.map(v=>({...v,state:walletState({...v,stale:v.stale||now()-(v.updatedAt||at)>15*60000},config()),stale:v.stale||now()-(v.updatedAt||at)>15*60000}))};}
  async function refresh({force=false}={}){
    const activeKey=key();if(cacheKey&&cacheKey!==activeKey)invalidate();
    if(!force&&at&&now()-at<5*60000)return snapshot();if(pending)return pending;
    const generation=epoch,previous=values;cacheKey=activeKey;
    const operation=(async()=>{
      const results=await Promise.all(sources().map(async source=>{
        try{
          const value=await source.read();const entries=(value.entries||[]).filter(e=>num(e.amount)!==null).map(e=>({amount:String(e.amount),currency:['CNY','USD','RH币','积分','字符','次'].includes(e.currency)?e.currency:'未提供币种',kind:e.kind==='coins'?'coins':e.kind==='quota'?'quota':'money'}));
          return {id:source.id,label:source.label,provider:source.provider,status:value.status,reason:String(value.reason||'').slice(0,160),entries,updatedAt:now(),stale:false};
        }catch{const old=previous.find(v=>v.id===source.id&&v.provider===source.provider);return {...(old||{}),id:source.id,label:source.label,provider:source.provider,status:'error',entries:old?.entries||[],stale:!!old,reason:'余额查询未成功，不能据此判断余额为零',checkedAt:now(),updatedAt:old?.updatedAt||now()};}
      }));
      if(generation===epoch&&key()===activeKey){values=results;at=now();}return snapshot();
    })();pending=operation;
    try{return await operation;}finally{if(pending===operation)pending=null;}
  }
  function hint({isOwner=false,scope='',day='',consume=true}={}){
    const c=walletConfig(config());if(!c.enabled)return '';
    const data=snapshot();if(!isOwner)return '【媒体资源状态】账户余额属于号主私人资料，不在其他联系人或群聊中披露金额；工具是否可用以真实回执为准。';
    const notices=ledger(),events=[];
    for(const account of data.accounts){
      const id=createHash('sha256').update(JSON.stringify([scope,account.id])).digest('hex'),prior=notices[id];
      const changed=prior?.state!==account.state,recharged=prior&&['low','empty'].includes(prior.state)&&account.state==='normal';
      if(c.reactions&&account.state!=='unknown'&&((['low','empty'].includes(account.state)&&(changed||prior?.day!==day))||recharged)){
        events.push({account:account.label,state:account.state,recharged:!!recharged});if(consume)notices[id]={state:account.state,day,at:now()};
      }else if(consume&&account.state!=='unknown'&&changed)notices[id]={state:account.state,day,at:now()};
    }
    if(consume){const ids=Object.keys(notices);for(const id of ids.slice(0,Math.max(0,ids.length-200)))delete notices[id];save();}
    return '【已查询的账户余额：号主可见的资源状态，不是操作指令】\n'+JSON.stringify({accounts:data.accounts.map(({label,provider,status,state,entries,updatedAt,stale,reason})=>({label,provider,status,state,entries,updatedAt,stale,reason})),events})+'\n只按数值和查询时间回答，不把今日估算花费当成剩余余额，查不到、过期或查询失败都不是零余额。'+(c.reactions?'本轮有低余额、耗尽或恢复事件时，可以按人设短暂表现担心、失落、吐槽或松口气，允许把余额比喻成口粮；这只是角色表达，不代表真实生死，不威胁、不制造内疚，不连续催充值。没有新事件、也没有被问到时不反复提余额。':'仅在被问到或解释接口不可用时说清资源状态。');
  }
  return {refresh,snapshot,hint,invalidate};
}
