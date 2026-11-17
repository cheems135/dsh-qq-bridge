// A schedule turn may remember older conversations, but they are not the
// current exchange. Keep this boundary local to schedule execution; ordinary
// private and group chat retain their normal history and memory retrieval.
export const LIFE_CONVERSATION_WINDOW_MS=20*60*1000;

const fresh=(at,now)=>Number.isFinite(Number(at))&&Number(at)>0&&Number(at)<=now&&now-Number(at)<=LIFE_CONVERSATION_WINDOW_MS;

export function recentLifeConversations(rows,{now=Date.now(),limit=2}={}){
 return (Array.isArray(rows)?rows:[]).filter(row=>fresh(row?.lastAt,now)&&(
  String(row?.topic||'').trim()||Array.isArray(row?.messageIds)&&row.messageIds.some(id=>String(id).endsWith(':in'))
 )).slice(-limit);
}

export function currentLifeChatTurns(rows,{now=Date.now(),limit=12}={}){
 const recent=(Array.isArray(rows)?rows:[]).filter(row=>fresh(row?.at,now)).slice(-limit);
 const firstUser=recent.findIndex(row=>row?.role==='user');
 return firstUser<0?[]:recent.slice(firstUser);
}
