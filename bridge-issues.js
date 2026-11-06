import {randomUUID} from 'node:crypto';
import {redactInvocation} from './invocation-journal.js';

// Separate local operational errors from messages intended for a QQ contact.
export function createBridgeIssues({getRows=()=>[],setRows=()=>{},save=()=>{},now=Date.now,limit=80}={}){
 return {
  record(event={},scope={}){
   const safe=redactInvocation({...scope,...event}),rows=Array.isArray(getRows())?getRows():[],id=String(safe.id||randomUUID()).slice(0,160),accountId=String(safe.accountId||'');
   let row=rows.find(r=>r.id===id&&r.accountId===accountId);
   if(row)return row;
   row={id,at:Number(safe.at)||now(),accountId:String(safe.accountId||''),personaId:String(safe.personaId||''),chat:String(safe.chat||safe.key||''),backend:safe.backend==='api'?'api':'local',kind:String(safe.kind||'chat'),message:String(safe.message||safe.error||'操作未完成').slice(0,1600),auditId:String(safe.auditId||''),acknowledged:false};
   setRows([...rows,row].slice(-limit));save();return row;
  },
  list({accountId}={}){return (Array.isArray(getRows())?getRows():[]).filter(r=>accountId===undefined||r.accountId===accountId).slice(-limit).reverse().map(redactInvocation);},
  acknowledge(ids,{accountId}={}){const selected=new Set(ids||[]);for(const row of Array.isArray(getRows())?getRows():[])if(row.accountId===accountId&&selected.has(row.id))row.acknowledged=true;save();},
 };
}

export function unresolvedLocalReceipts(receipts=[]){
 const last=new Map();for(const row of receipts){const previous=last.get(row.tool);if(previous&&!previous.rejected&&!previous.duplicate&&!previous.limited&&(row.rejected||row.duplicate||row.limited))continue;last.set(row.tool,row);}
 return [...last.values()].filter(r=>r.ok===false);
}
