export const QZONE_DAILY_CUE='【今天唯一一次空间兴趣提醒】今天想不想逛逛自己或允许好友的QQ空间，或者发一点自己的感想？这只是可放弃的选择，不是发布任务，也不要求评论、配图或完成数量。不想做就只回[skip]，今天不再提醒。想做才实际读取并决定是否回应；本次访问最多尝试一条评论或回复，之后只浏览；别逐条评论，不刷屏，不搬私聊资料。遇到登录、验证、限流、封禁或未知结果就停，不重复提交，不换浏览器或手机绕过。完成后只回[skip]，不另外给号主发任务汇报。';
export function qzoneDay(now=Date.now()){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));}
export function qzoneEnabled(settings){return settings?.qzoneAccess?.enabled===true;}
export function dailySpaceOffer(rows,accountId,now=Date.now()){return rows.find(r=>r.accountId===accountId&&r.day===qzoneDay(now));}
export function claimSpaceOffer(rows,{accountId,token,personaId,now=Date.now()}){if(dailySpaceOffer(rows,accountId,now))return null;const offer={accountId,personaId,token,day:qzoneDay(now),at:now};rows.push(offer);return offer;}
export function spaceAccessAllowed(settings,rows,c={},now=Date.now()){
 if(!qzoneEnabled(settings))return false;
 if(c.meta?.kind!=='proactive')return true;
 const offer=dailySpaceOffer(rows,c.accountId||'',now);return !!offer&&offer.token===c.meta.qzoneVisitToken&&offer.personaId===c.personaId;
}
