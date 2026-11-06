export const SOCIAL_SPEECH_RULES=[
 '【和本人说话】当前人设、此刻情绪和你们刚才聊的事共同决定表达。主动分享时先抓住真正吸引你的一个细节，表达喜欢、嫌弃、得意、好奇或分歧，让对方有地方接话；可以接梗、联想、邀请一起看，也可以说完就停。不是每次都兴奋，不强行撒娇，不机械追问。',
 '消息正文写你想对他说的话，长短由意思决定。不要把资料摘要、工具覆盖范围、任务步骤和验收结果变成对他的汇报；只在他问进度或确实需要说明失败时自然交代。必要的不确定性用一句平常话讲清，不编没看见的细节。',
 '普通浏览、分享、登录、窗口切换和数字活动直接按已开放能力继续，不把“申请权限、等待审批”当聊天内容。缺少账号或扫码时只说需要本人提供或完成的那一件事，不再索取插件的登录许可。',
 '付款仍问本人：说清楚你为什么想买、给谁付、多少钱，再用当前人设自然问他愿不愿意。不要逐项报“操作/目标/金额/审批编号”，不要把状态字段、JSON或工具名写进正文。评论是否发布仍按本人手动选择，不替他打开发布开关。',
 '同一件东西只发一份正文；已用分享工具发出后只回 [skip]，不再复述或另发完成回执。对方没接话不连催，不假装对方已经同意或回应。',
].join('\n');

const text=(value,max=400)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,max);
export function paymentQuestionInput(question,{persona='',tone='',recent=[]}={}){
 const details=question.details||{};
 return {system:[persona,SOCIAL_SPEECH_RULES,
  '只返回JSON {"lead":"你这次想做这件事的具体念头或理由，可留空","ask":"一句符合角色口吻的付款询问"}。只改说法，不改事实，不宣布已付款，不代替本人答应。金额和收款方会由程序原样放在中间，你不再写数字、金额、币种、收款名称、网址、工具名或审批术语。不要凭空编理由；原问题没有理由就让lead留空。',
  tone?'当前语气底色：'+text(tone,300):'',
 ].filter(Boolean).join('\n'),user:JSON.stringify({originalQuestion:text(question.question),merchant:text(details.merchant),amount:text(details.amount,40),currency:text(details.currency,20),recent:recent.slice(-4).map(row=>({role:row.role,text:text(row.text,350)}))})};
}
export function paymentQuestionText(question={},rewritten){
 const d=question.details||{},currency={CNY:'元',RMB:'元',USD:'美元',EUR:'欧元',JPY:'日元'}[d.currency]||text(d.currency||'元',20);
 const merchant=text(d.merchant,180),amount=text(d.amount,50);
 const cleanPart=(value,max)=>{const body=text(value,max);return /\d|https?:|bridge_|审批|执行日志|状态码|已(?:经)?(?:付|支付)|付款成功/.test(body)?'':body;};
 const lead=cleanPart(rewritten?.lead,180),ask=cleanPart(rewritten?.ask,100);
 const facts=merchant&&amount?`这笔是给「${merchant}」的 ${amount} ${currency}。`:amount?`这笔要付 ${amount} ${currency}。`:'付款的金额和收款方还没核对清楚，先不付。';
 return [lead,facts,merchant&&amount?(ask||'这笔你愿意让我付吗？'):''].filter(Boolean).join('\n');
}
