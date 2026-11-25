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

// Record the crash window before handing a request to a model or tool runner.
// A positive timestamp means submission may have occurred, not that it succeeded.
export function markSubmissionStarted(audit, persist, requestId) {
  audit.submissionStartedAt = Date.now();
  if (requestId) audit.submissionRequestId = requestId;
  if (persist() === false) {
    audit.submissionStartedAt = 0;
    delete audit.submissionRequestId;
    throw new Error('无法保存请求状态，本轮未提交');
  }
}
