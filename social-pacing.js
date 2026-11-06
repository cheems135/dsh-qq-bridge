import {qzoneDay,dailySpaceOffer} from './qzone-policy.js';
export const PROACTIVE_GAP_MS=30*60000;
export function signatureAvailable(rows,accountId,now=Date.now()){return !rows.some(r=>r.accountId===accountId&&r.day===qzoneDay(now));}
export function claimSignature(rows,accountId,now=Date.now()){
 if(!signatureAvailable(rows,accountId,now))throw Error('今天已尝试自动修改签名，明天再考虑；本人明确要求修改不受此限制');
 const row={accountId,day:qzoneDay(now),at:now};rows.push(row);return row;
}
export function claimSpaceComment(offers,c,row,now=Date.now()){
 if(c.meta?.kind!=='proactive'||!['comment','reply'].includes(row.kind))return false;
 const offer=dailySpaceOffer(offers,c.accountId||'',now);
 if(!offer||offer.token!==c.meta.qzoneVisitToken||offer.personaId!==c.personaId)throw Error('这轮不是今天的空间访问');
 if(offer.commentAttempt)throw Error('这次空间访问已尝试一条评论或回复，继续浏览即可，不再连续评论');
 offer.commentAttempt={id:row.id,kind:row.kind,at:now};return true;
}
export function proactiveDenial(job,rows,lastIncoming,now=Date.now()){
 if(!job.initiative||job.manualInitiative)return '';
 const account=rows.filter(r=>r.accountId===job.accountId),own=account.find(r=>r.chat===job.chat);
 if(own&&job.proactiveEpisode&&own.episode===job.proactiveEpisode)return '';
 if(own&&Number(lastIncoming||0)<=own.at)return '等对话里有新消息再主动开口，不连续催回复';
 const latest=Math.max(0,...account.map(r=>Number(r.at)||0));
 if(latest&&now-latest<PROACTIVE_GAP_MS)return '距离上次主动联系不足30分钟，暂时保持安静';
 return '';
}
export function reserveProactive(job,rows,lastIncoming,now=Date.now()){
 const denial=proactiveDenial(job,rows,lastIncoming,now);if(denial)throw Error(denial);
 if(!job.initiative||job.manualInitiative)return false;
 const own=rows.find(r=>r.accountId===job.accountId&&r.chat===job.chat);
 if(own?.episode===job.proactiveEpisode)return false;
 const value={accountId:job.accountId,chat:job.chat,episode:job.proactiveEpisode,at:now,lastIncoming:Number(lastIncoming)||0};
 if(own)Object.assign(own,value);else rows.push(value);return true;
}
