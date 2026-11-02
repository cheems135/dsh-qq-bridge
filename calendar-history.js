// Rebuild local calendar journals from retained evidence, never from old summaries.
export function calendarHistory({rows=[],audits=[],outbox=[],accountId='',allowed=()=>false}){
  const valid=x=>x&&(x.accountId||'')===accountId&&allowed(x.chat);
  const history=audits.filter(valid).filter(a=>a.persona&&Number(a.at)>0).sort((a,b)=>a.at-b.at);
  const entries=[],seen=new Set(),covered=new Set();let unknown=0;
  const add=row=>{const id=JSON.stringify([row.chat,row.personaId,row.dir,row.localId||row.messageId]);if(seen.has(id))return;seen.add(id);entries.push(row);};
  for(const a of history){
    // userWords was captured before quotes, websites, images and system context were added.
    const matchingRows=rows.filter(r=>valid(r)&&r.chat===a.chat&&(a.inboundIds||[]).map(String).includes(String(r.messageId)));
    const speakers=[...new Set(matchingRows.map(r=>r.speakerId).filter(Boolean))];
    if(typeof a.userWords==='string'&&a.userWords.trim()&&(a.chat.startsWith('private:')||speakers.length===1)){
      const ids=(a.inboundIds||[]).map(String);for(const id of ids)covered.add(a.chat+':'+id);
      add({chat:a.chat,accountId,personaId:a.persona,time:matchingRows[0]?.time||a.at,dir:'in',messageId:ids[0]||'audit:'+a.id,userText:a.userWords,speakerId:a.chat.startsWith('private:')?a.chat.split(':')[1]:speakers[0],speakerName:matchingRows[0]?.speakerName||''});
    }
  }
  for(const row of rows.filter(valid)){
    if(row.dir==='in'&&covered.has(row.chat+':'+String(row.messageId)))continue;
    if(row.dir==='out'&&row.delivery!=='sent')continue;
    const match=history.find(a=>a.chat===row.chat&&(a.inboundIds||[]).concat(a.messageIds||[]).map(String).includes(String(row.messageId)));
    // Never guess another persona from the currently selected role.
    const peers=history.filter(a=>a.chat===row.chat),before=peers.filter(a=>a.at<=row.time).at(-1),after=peers.find(a=>a.at>=row.time);
    const inferred=before&&after&&before.persona===after.persona?before.persona:null;
    const personaId=row.personaId||match?.persona||inferred||'legacy';if(personaId==='legacy')unknown++;
    add({...row,accountId,personaId});
  }
  for(const job of outbox.filter(valid).filter(j=>j.status==='sent')){
    const a=history.find(a=>a.id===job.auditId),personaId=job.personaId||a?.persona;
    if(!personaId)continue;
    const text=(job.segments||[]).filter(s=>s.type==='text').map(s=>s.data?.text||'').join('\n');if(!text.trim())continue;
    add({chat:job.chat,accountId,personaId,time:job.at,dir:'out',localId:job.id,messageId:job.messageId,delivery:'sent',text});
  }
  // Group traffic is high-volume: collapse raw group messages into 10-minute
  // activity receipts before they reach the daily/monthly memory summarizer.
  const compacted=[],groupBuckets=new Map();
  for(const entry of entries){
    if(!String(entry.chat||'').startsWith('group:')){compacted.push(entry);continue;}
    const bucket=Math.floor(Number(entry.time||0)/600000),key=entry.chat+':'+bucket;
    let item=groupBuckets.get(key);
    if(!item){item={...entry,dir:'in',messageId:'group-receipt:'+bucket,localId:'',speakerId:'',speakerName:'群聊摘要',text:'',userText:'',_lines:[]};groupBuckets.set(key,item);}
    const line=(entry.dir==='out'?'她：':'群友：')+String(entry.text||entry.userText||'').replace(/\s+/g,' ').trim().slice(0,120);
    if(line.replace(/^(?:她|群友)：/,'').trim())item._lines.push(line);
  }
  for(const item of groupBuckets.values()){const lines=[...new Set(item._lines)].slice(0,10);item.text=item.userText=lines.join('；').slice(0,700);delete item._lines;compacted.push(item);}
  return {entries:compacted.sort((a,b)=>a.time-b.time),scanned:rows.length+audits.length+outbox.length,unknown:compacted.filter(r=>r.personaId==='legacy').length};
}
