// Tool callbacks must use their own turn, never the newest sender on a reused
// group session. Missing explicit turns fail closed rather than borrowing one.
export function qqTurnMeta(chat,exec={}){
 const turn=exec?.turn??exec?.turnId;
 if(turn!==undefined&&turn!==null)return chat?.turns?.get(turn)?.meta;
 const running=[...chat?.turns?.values?.()||[]];
 if(running.length===1)return running[0].meta;
 if(running.length>1)return undefined;
 const pending=chat?.pendingTurns||[];
 return pending.length===1?pending[0]:undefined;
}
