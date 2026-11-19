import {qzoneDay,dailySpaceOffer} from './qzone-policy.js';
const CONTACT_HISTORY_MS=7*86400000;
const normalize=value=>String(value||'').normalize('NFKC').replace(/[\p{P}\p{S}\s]/gu,'').toLowerCase();
const sameScope=(r,j)=>r.accountId===j.accountId&&r.chat===j.chat&&(r.personaId||'')===(j.personaId||'');
const contactText=job=>job.proactiveParagraphBatch&&job.bubbleIndex===1?'':normalize(job.proactiveParagraphText||(job.segments||[]).filter(s=>s.type==='text').map(s=>s.data?.text||'').join(''));
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
const privateContact=chat=>String(chat||'').startsWith('private:');

// An outbox reservation is not evidence that the other person received a message.
export function unansweredPrivateInitiative(job,outbox,messages,lastIncoming){
 if(!job.initiative||job.manualInitiative||job.commitmentId||!privateContact(job.chat))return false;
 const scope=row=>row.accountId===job.accountId&&row.chat===job.chat;
 const afterReply=(at,episode)=>Number(at)>0&&Number(at)>=Number(lastIncoming||0)
  &&(!episode||episode!==job.proactiveEpisode);
 return outbox.some(row=>scope(row)&&row.initiative===true&&!row.manualInitiative&&!row.commitmentId&&!row.lifeJobId&&!row.sourceLifeJobId
   &&row.status==='sent'&&!row.retracted&&!row.withdrawn&&afterReply(row.sentAt||row.ackAt||row.at,row.proactiveEpisode))
  ||messages.some(row=>scope(row)&&row.dir==='out'&&row.delivery==='sent'&&row.automaticPrivate===true&&!row.retracted
   &&afterReply(row.initiativeSentAt||row.time,row.proactiveEpisode));
}

export function proactiveDenial(job,rows,lastIncoming,now=Date.now(),privateMinGapMinutes=0){
 if(!job.initiative||job.manualInitiative)return '';
 const own=rows.filter(r=>sameScope(r,job)&&now-r.at<CONTACT_HISTORY_MS);
 const episode=job.proactiveEpisode&&own.find(r=>r.episode===job.proactiveEpisode);
 const gap=Math.max(0,Math.min(1440,Number(privateMinGapMinutes)||0))*60_000;
 if(gap&&privateContact(job.chat)&&!job.commitmentId){
  if(episode){
   if(Number(lastIncoming||0)<=Number(episode.lastIncoming||0)){
    if(job.id&&episode.deliveryId===job.id)return '';
    if(job.id&&job.bubbleIndex===1&&job.proactiveParagraphBatch&&job.proactiveParagraphBatch===episode.paragraphBatch
      &&(!episode.secondDeliveryId||episode.secondDeliveryId===job.id))return '';
   }
   return '本次主动私聊已经占用一个通知，暂缓后续消息';
  }
  if(lastIncoming>0&&now-lastIncoming<Math.min(gap,30*60_000))return '刚聊过，先留一点安静时间';
  if(rows.some(r=>r.accountId===job.accountId&&privateContact(r.chat)&&now-r.at<gap))return '全账号主动私聊间隔还未到';
 }
 if(episode)return '';
 const text=contactText(job);
 // Decision probes have no payload. Check content when it actually reaches the outbox.
 if(!job.segments)return '';
 if(own.some(r=>now-r.at<6*3600000&&(text&&(r.texts||[]).includes(text)||!text&&job.fingerprint&&(r.fingerprints||[]).includes(job.fingerprint))))return '最近已经主动说过相同内容，不重复发送';
 const latest=Math.max(0,...own.map(r=>Number(r.at)||0));
 if(latest&&Number(lastIncoming||0)<=latest&&/^(?:你)?(?:在吗|在不在|怎么不回(?:我|消息)?|怎么还不回(?:我|消息)?|回我(?:一下)?|理理我|看到(?:了)?(?:就)?回(?:我)?(?:一下)?)(?:呀|啊|呢|嘛|哦|吧|啦)*$/.test(text))return '不重复追问在不在或催促回复';
 return '';
}
export function reserveProactive(job,rows,lastIncoming,now=Date.now()){
 const denial=proactiveDenial(job,rows,lastIncoming,now);if(denial)throw Error(denial);
 if(!job.initiative||job.manualInitiative)return false;
 const own=rows.find(r=>sameScope(r,job)&&r.episode===job.proactiveEpisode),text=contactText(job);
 if(own){if(job.id&&own.deliveryId===job.id)own.at=now;
  if(job.id&&job.bubbleIndex===1&&job.proactiveParagraphBatch&&job.proactiveParagraphBatch===own.paragraphBatch&&!own.secondDeliveryId)own.secondDeliveryId=job.id;
  own.texts||=[];own.fingerprints||=[];if(text&&!own.texts.includes(text))own.texts.push(text);if(job.fingerprint&&!own.fingerprints.includes(job.fingerprint))own.fingerprints.push(job.fingerprint);return false;}
 const value={accountId:job.accountId,personaId:job.personaId||'',chat:job.chat,episode:job.proactiveEpisode,deliveryId:job.id||'',...(job.bubbleIndex===0&&job.proactiveParagraphBatch?{paragraphBatch:job.proactiveParagraphBatch}:{}),at:now,lastIncoming:Number(lastIncoming)||0,texts:text?[text]:[],fingerprints:job.fingerprint?[job.fingerprint]:[]};
 rows.push(value);
 for(let i=rows.length-1;i>=0;i--)if(now-rows[i].at>=CONTACT_HISTORY_MS)rows.splice(i,1);
 const scoped=rows.filter(r=>sameScope(r,job));for(const old of scoped.slice(0,-32)){const i=rows.indexOf(old);if(i>=0)rows.splice(i,1);}
 return true;
}
