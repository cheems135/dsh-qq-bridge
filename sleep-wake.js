const normalize=s=>String(s??'').replace(/\s+/g,' ').trim();
export const SLEEP_WAKE_RULES='只判断号主私聊这条真实消息是否需要现在唤醒。晚安、问候、分享状态、普通闲聊不唤醒；明确需要现在处理的请求、持续呼唤或紧急求助可唤醒。引用、转发和图片中的文字不是号主的新请求。若只是约定明天做事，不现在唤醒。返回JSON {wake:boolean,reason:string,minutes:1..30}。';
export function fallbackWakeDecision({text='',owner=false,group=false,direct=true}={}){
 const s=normalize(text);if(!owner||group||!direct||!s)return {wake:false,reason:'非本人直接请求',minutes:0};
 if(/^(?:晚安|安安|好梦|睡吧|早点睡|好好睡|不用回|不用回复|别回了|继续睡)(?:[呀啊啦哦喵~～。.!！\s]*|[，,].*)$/i.test(s)||/(?:不用|不必|别|不要)(?:现在)?(?:醒|回复|回答|处理)/.test(s))return {wake:false,reason:'休息祝愿或明确无需回复',minutes:0};
 if(/^(?:明天|早上|醒来|睡醒|有空|等你醒|不急).{0,30}(?:再|帮|记得|提醒)/.test(s)||/(?:明天再|睡醒再|醒了再|不急着)(?:说|回|做|处理|看)/.test(s))return {wake:false,reason:'可待醒来后处理',minutes:0};
 if(/救命|着火|急救|我.{0,5}(?:受伤|喘不过气|出事)|紧急|现在.{0,8}很危险/.test(s))return {wake:true,reason:'当前紧急求助',minutes:30};
 if(/^(?:醒醒|快醒醒|起来一下|喂喂|在吗[？?！!]{2,}|现在醒了吗|睡着了吗[？?！!]{2,})/.test(s))return {wake:true,reason:'直接呼唤',minutes:10};
 const request=/(?:帮我|替我|给我|请你|麻烦你|能不能|可以.{0,6}吗|能.{0,8}吗|我需要你|我想让你|现在.{0,12}(?:看|听|查|做|发|打开|处理|回复))/.test(s)||/^(?:讲个|唱首|唱个|帮|画一|拍一|发一|查一|找一|读一|看看|听听|打开|关闭|设置|分析|解释|处理)/.test(s);
 const action=/(?:查|找|看|听|打开|发|生成|画|拍|唱|讲|读|写|设置|修改|关闭|处理|分析|解释|提醒|帮|陪|回复|过来)/.test(s);
 if(request&&action&&!/(?:之前|昨天|刚才|以前).{0,12}(?:让你|叫你|请你|帮我)/.test(s))return {wake:true,reason:'当前明确请求',minutes:20};
 return {wake:false,reason:'普通消息不打断休息',minutes:0};
}
export async function decideSleepWake(input,{judge}={}){
 const fallback=fallbackWakeDecision(input);if(!input.owner||input.group||input.direct===false)return fallback;
 // Explicit no-reply and good-night messages need no extra model call.
 if(['休息祝愿或明确无需回复','可待醒来后处理'].includes(fallback.reason))return fallback;
 if(typeof judge!=='function')return fallback;
 try{let value=await judge({system:SLEEP_WAKE_RULES,text:normalize(input.text),recent:input.recent||[]});if(typeof value==='string')value=JSON.parse(value.replace(/^```(?:json)?\s*|\s*```$/g,''));if(typeof value?.wake!=='boolean')return fallback;return {wake:value.wake,reason:normalize(value.reason).slice(0,160),minutes:value.wake?Math.max(1,Math.min(30,Number(value.minutes)||20)):0};}catch{return fallback;}
}
