import {randomUUID} from 'node:crypto';

const secretKey=/^(?:(?:x[-_])?api[-_]?key|authorization|cookie|set-cookie|password|passwd|secret|access[-_]?token|refresh[-_]?token|token|sessdata|bili_jct|csrf)$/i;
export function redactInvocation(value){
 const seen=new WeakSet(),budget={left:50000};
 function visit(input,depth=0){
  if(input===null||typeof input==='boolean'||typeof input==='number')return input;
  if(typeof input==='string'){
   if(/^data:[^;]+;base64,/i.test(input))return '[媒体数据已省略]';
   const safe=input.replace(/\bBearer\s+[\w.+/=-]+/gi,'Bearer [已隐藏]').replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{12,}\b/g,'[已隐藏]').replace(/([?&](?:token|api_key|key|password)=)[^&\s]+/gi,'$1[已隐藏]').replace(/(https?:\/\/)[^/\s:@]+:[^@\s/]+@/gi,'$1[已隐藏]@');
   const limit=Math.max(0,Math.min(16000,budget.left));budget.left-=Math.min(limit,safe.length);return safe.length>limit?safe.slice(0,limit)+' [记录已截短]':safe;
  }
  if(input===undefined)return undefined;
  if(typeof input!=='object'||depth>6||seen.has(input)||budget.left<=0)return '[已省略]';
  seen.add(input);
  if(Array.isArray(input))return input.slice(0,80).map(item=>visit(item,depth+1));
  const out={};for(const [key,item]of Object.entries(input).slice(0,80)){if(['__proto__','constructor','prototype'].includes(key))continue;out[key]=secretKey.test(key)||['value','fieldValue'].includes(key)&&secretKey.test(String(input.fieldName||input.field||input.name||''))?'[已隐藏]':/^(?:base64|imageData|image_base64|audioData)$/i.test(key)||key==='data'&&typeof item==='string'&&/image|audio|video/.test(String(input.type||input.mediaType||''))?'[媒体数据已省略]':visit(item,depth+1);}return out;
 }
 return visit(value);
}

export function createInvocationJournal({getRows=()=>[],setRows=()=>{},save=()=>{},now=Date.now,limit=240}={}){
 return {
  record(event={},scope={}){
   const safe=redactInvocation({...event,...scope}),rows=Array.isArray(getRows())?getRows():[];
   const id=String(safe.id||randomUUID()).slice(0,120);let row=rows.find(item=>item.id===id&&item.accountId===safe.accountId);
   if(row&&Number(safe.updatedAt)>0&&row.updatedAt>=safe.updatedAt)return row;
   if(!row){row={id,at:Number(safe.at)||now()};rows.push(row);}
   const previous=row.status;Object.assign(row,safe,{id,updatedAt:now()});
   if(['returned','failed','cancelled','rejected'].includes(previous)&&['started','submitted'].includes(safe.status))row.status=previous;
   setRows(rows.slice(-limit));save();return row;
  },
  list({accountId,backend='',kind='',limit:count=120}={}){
   return (getRows()||[]).filter(row=>(accountId===undefined||row.accountId===accountId)&&(!backend||row.backend===backend)&&(!kind||row.kind===kind)).slice(-Math.max(1,Math.min(240,Number(count)||120))).reverse().map(row=>redactInvocation(row));
  },
 };
}

export function invocationKind(tool,args={}){
 if(/video|视频/i.test(tool)||args.kind==='video')return 'video';
 if(/^(?:image|.*\.image)$/.test(tool)||args.kind==='image')return 'image';
 if(/speech|语音/.test(tool))return 'speech';return 'tool';
}
