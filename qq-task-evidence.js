import {localGroupSendRequest} from './local-qq-task.js';
export function qqGroupName(value=''){return String(value).replace(/<\$[^>\r\n]{1,80}>/g,'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,100);}
export function qqTaskEvidence(query,{outbox=[],tasks=[],audits=[],accountId='',personaId='',allowedGroups=[],now=Date.now()}={}){
 const text=String(query||'');if(!/群/.test(text)||!/(?:发|说|冒|记得|哪个|名字|群名|任务)/.test(text))return null;
 const numbers=[...text.matchAll(/(?<!\d)(\d{5,20})(?!\d)/g)].map(m=>m[1]);
 const relevant=tasks.filter(t=>t.accountId===accountId&&t.personaId===personaId&&now-t.at<7*86400000);
 const oldRequest=[...audits].reverse().find(a=>a.accountId===accountId&&a.persona===personaId&&String(a.chat||'').startsWith('private:')&&localGroupSendRequest(a.userWords||a.input||''));
 const requestedGroup=oldRequest?[...String(oldRequest.userWords||oldRequest.input).matchAll(/(?<!\d)(\d{5,20})(?!\d)/g)].map(m=>m[1]).filter(g=>allowedGroups.includes(g)):[];
 const selected=numbers.length?numbers:/(?:刚|刚才|之前|那个|叫你|让你|哪个)/.test(text)?[...new Set(relevant.length?relevant.slice(-1).map(t=>t.target?.slice(6)).filter(Boolean):requestedGroup)]:[];
 const groups=selected.filter(g=>allowedGroups.includes(g)).slice(0,3);if(!groups.length)return null;
 return {readAt:now,groups:groups.map(group=>{
  const target='group:'+group,attempt=relevant.filter(t=>t.target===target).at(-1);
  const rows=outbox.filter(j=>j.accountId===accountId&&j.personaId===personaId&&j.chat===target&&now-j.at<7*86400000).slice(-10);
  return {target,name:qqGroupName(attempt?.name||''),attempt:attempt?{at:attempt.at,text:attempt.text,status:attempt.status,deliveryId:attempt.deliveryId}:null,messages:rows.map(j=>({id:j.id,at:j.at,status:j.status,text:j.localTranscript||j.segments?.filter(s=>s.type==='text').map(s=>s.data?.text||'').join('\n')||'[媒体]',messageId:j.messageId||'',verified:j.verification?.state==='observed'})),coverage:rows.length?'这是实际QQ发送队列和回执；仅sent表示平台接收，读回核对与对方已读分别处理':'这份最近7天的本机记录没有查到发往此群的消息；不能拿私聊承诺当作发送事实，也不能断言更早从未发送'};
 }),instruction:'回答发了什么时按target逐群核对，只复述实际正文；不能把甲群的消息说成乙群，不用私聊里的“已发”作证据。群名未知就说未知，不编造群名、群主或群友反应。'};
}

export function qqTaskAnswer(query,evidence){
 const text=String(query||'');
 if(!evidence||/(?:谁|其他人|群友).{0,10}(?:发|说)/.test(text)||!/(?:你|自己|刚刚|刚才|刚|叫你|让你).{0,45}(?:发|说|冒)|(?:发|说).{0,20}(?:什么|啥|哪个|名字|群名)|记得自己/.test(text))return '';
 return evidence.groups.map(g=>{
  const label=(g.name?g.name+'（'+g.target.slice(6)+'）':g.target.slice(6)),sent=g.messages.filter(m=>m.status==='sent');
  if(sent.length)return '我在'+label+'发过这些：\n'+sent.slice(-3).map(m=>m.text).join('\n')+'\n这些有 QQ 接收回执，群友有没有看见我还不知道';
  const waiting=g.messages.filter(m=>['queued','sending'].includes(m.status));
  if(waiting.length)return '发往'+label+'的内容还在等发送确认：\n'+waiting.map(m=>m.text).join('\n')+'\n现在还不能说已经发出';
  if(g.messages.length)return '发往'+label+'的消息还没有成功回执，我不能说已经发成了';
  return '我在最近这份发送记录里没查到发往'+label+'的回执，之前若说已经发了，那句话没有依据';
 }).join('\n\n');
}
