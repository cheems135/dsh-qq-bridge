// IDs make repeated completion updates and restarts safe to account for once.
export const billingDay=at=>new Date(at).toLocaleDateString('en-CA',{timeZone:'Asia/Shanghai'});
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
 const {auxiliaryEntries,...publicUsage}=usage||{};
 const auxiliaryTotal=Number(usage?.auxiliaryTotal)||0;
 return {...publicUsage,auxiliaryTotal,auxiliaryCalls:Number(usage?.auxiliaryCalls)||0,turnTotal:Math.max(0,(Number(usage?.total)||0)-auxiliaryTotal),pricing:'按插件配置单价估算；媒体余额及积分另计，以服务商账单为准'};
}
