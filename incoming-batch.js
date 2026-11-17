// Batch only adjacent observations from the same sender. Keep every original
// segment and message id; an image is context for the preceding words too.
export function mergeableIncoming(payload,text,segments){
 return !payload._sleepReview&&!/^[/／]|^(查|搜)(一下|一搜)?[:：\s]/.test(String(text||''))&&segments.every(s=>['text','face','at','image','mface'].includes(s.type));
}
export function selectIncomingBatch(queued,startedAt,{textOf,segmentsOf,maxBytes=150000}={}){
 const first=queued[0];if(!first)return [];
 const batch=[first];let size=Buffer.byteLength(JSON.stringify(first.payload));
 if(!mergeableIncoming(first.payload,textOf(first.payload),segmentsOf(first.payload.message)))return batch;
 for(const next of queued.slice(1,20)){
  if(next.key!==first.key||String(next.payload.user_id)!==String(first.payload.user_id)||Number(next.at)>startedAt||next.at-first.at>60000||!mergeableIncoming(next.payload,textOf(next.payload),segmentsOf(next.payload.message)))break;
  const bytes=Buffer.byteLength(JSON.stringify(next.payload));if(size+bytes>maxBytes)break;
  batch.push(next);size+=bytes;
 }
 return batch;
}
