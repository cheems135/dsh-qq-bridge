// Shared by initiative planning, the public-profile tool and native discovery.
// This is writing guidance, not a text filter or a second generation pass.
export const QQ_SIGNATURE_GUIDANCE='QQ签名是所有访客可见的个人资料短句，应脱离聊天也能独立成立。表达自己的心情、兴趣、审美或态度，俏皮、冷淡、自嘲都可以；没有新表达就保留原签名。直接写成品，不写“签名应该怎么写”的自我说明，不搬私聊求助、催回复或任务进度，不公开私有称呼与关系细节。任务暂停只代表执行状态，不能据此推断正在难过或等待救助；确需帮助就在原会话说明。用户明确指定原文时尊重原意，仍核对隐私。';

export function publicProfileHistory(rows=[],limit=8){
  return rows.filter(row=>['signature','qzone','qzoneReply'].includes(row.action))
    .slice(0,limit).map(({action,text})=>({action,text}));
}
