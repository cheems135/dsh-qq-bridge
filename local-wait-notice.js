import {cleanLocalReply,needsDialogueRepair} from './local-reply.js';
export function cleanWaitNotice(value){
 const text=cleanLocalReply(value);
 if(!text||text.length>70||needsDialogueRepair(text)||/[\[\]{}<>`]|https?:|[A-Za-z]:[\\/]|已经|完成了|生成好了|发给你了|送达|\d+\s*(?:秒|分钟)/i.test(text))return '';
 return text;
}
export function fallbackWaitNotice(kind,style='natural',recent=[]){
 const thing=kind==='image'?'这张图':kind==='video'?'这段视频':'这段语音';
 const choices=kind==='queue'?['前面还有任务，我等它忙完就接着看你这条。','还没轮到这边，我先排着，空下来接着聊。','这边得等前面的任务结束，你这条我留着呢。']
 :style==='playful'?[`${thing}还在做呢，先陪我待一会儿。`,`先等等我，${thing}还没准备好。`,`${thing}得慢慢来，再给我一点时间。`]
 :style==='formal'?[`${thing}还在处理，请再稍等片刻。`,`还需要一些时间准备${thing}。`,`${thing}尚未返回结果，我会继续等候。`]
 :style==='gentle'?[`${thing}还在准备，再陪我等一会儿吧。`,`先别着急，我还在等${thing}的结果。`,`${thing}还没好，咱们再等一会儿。`]
 :[`${thing}还在准备，等我一下。`,`我还在等${thing}的结果，再给我一点时间。`,`${thing}还没回来，我接着等。`];
 return choices.find(text=>!recent.some(old=>similarNotice(old,text)))||'';
}
export const similarNotice=(a,b)=>String(a||'').replace(/[\p{P}\p{S}\s]/gu,'')===String(b||'').replace(/[\p{P}\p{S}\s]/gu,'');
export function personaWaitStyle(prompt=''){
 const text=String(prompt);if(/傲娇|毒舌|嘴硬/.test(text))return 'playful';if(/严谨|正式|敬语|礼貌克制/.test(text))return 'formal';if(/温柔|柔和|体贴/.test(text))return 'gentle';return 'natural';
}
export const WAIT_NOTICE_RULE='直接执行本轮真实工具，不另外生成等待台词、不声称工具已完成。未取得结果时，程序会在等待达到180秒后核对状态并自然说明；不要提前或重复发送固定等待消息。';
export function createWaitNotice({emit=()=>{},style='natural',recent=[],remember=()=>{},delayMs=10000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,pendingKind='',sent=false,notice='';
 const announce=kind=>{if(sent||!notice)return false;if(timer)clearTimer(timer);timer=null;pendingKind='';sent=true;remember(notice);emit({type:'notice',kind,source:'model',text:notice});return true;};
 return {announce,get hasText(){return !!notice;},set(value){const text=cleanWaitNotice(value);notice=recent.some(old=>similarNotice(old,text))?'':text;},start(kind){if(sent||!['queue','image','video','speech'].includes(kind))return;if(timer){if(pendingKind===kind||kind==='queue')return;clearTimer(timer);}pendingKind=kind;timer=setTimer(()=>{timer=null;pendingKind='';if(sent)return;const text=notice||fallbackWaitNotice(kind,style,recent);if(!text)return;sent=true;remember(text);emit({type:'notice',kind,source:notice?'model':'fallback',text});},delayMs);timer?.unref?.();},stop(kind){if(kind&&pendingKind!==kind)return;if(timer)clearTimer(timer);timer=null;pendingKind='';},get sent(){return sent;}};
}

export function createTaskWaitMonitor({getStatus=async()=>({state:'unknown'}),emit=()=>{},style='natural',delayMs=180000,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 let timer=null,closed=false,started=false;
 return {start(){if(started||closed)return;started=true;timer=setTimer(async()=>{timer=null;let status;try{status=await getStatus();}catch{status={state:'unknown'};}if(closed||status?.state==='done')return;
 const prefix=style==='playful'?'唔，':style==='gentle'?'跟你说一声，':style==='formal'?'目前，':'';
 const reason=String(status?.reason||'');const failure=/SEARCH_UNRELATED/.test(reason)?'搜到的页面没对上原词，还没有可靠答案。':/超时|timeout/i.test(reason)?'刚才的工具等到超时了，我还没拿到结果。':/fetch failed|ECONN|连接|网络/i.test(reason)?'刚才连接没接上，工具没有完成，我还没拿到结果。':'刚才的工具没有成功，我还没拿到你要的结果。具体原因留在调用记录里了。';
 const text=status?.state==='failed'?failure:status?.state==='queued'?'前面的任务还没结束，这一轮还在排队，我继续等着。':status?.state==='running'?'这轮还没结束，我还在等实际结果，暂时没收到完成回执。':'暂时没能确认那边是否还在运行，也没有拿到结果。我先把这个情况告诉你，免得你一直空等。';
 emit({type:'notice',kind:'status',source:'status',status:status?.state||'unknown',text:prefix+text});},delayMs);timer?.unref?.();},stop(){closed=true;if(timer!==null)clearTimer(timer);timer=null;}};
}
