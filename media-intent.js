import {operationText} from './operation-context.js';

const parts=value=>String(value||'').slice(0,4000).split(/[。！？!?\n；;]/).map(s=>s.trim()).filter(Boolean);
const unquotedMediaText=value=>String(value||'').replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g,'');
const meta=s=>/(?:触发词|提示词|接口|工作流|开关|设置|配置|功能|报错|原理|额度|限制|登录|模型|api(?:\s*key)?|失败|发不出来|无法发送|不会发|为什么不发|怎么不发)/i.test(s);
export function declinesMedia(value='',kind){
  const form=kind==='voice'?'(?:语音|声音|听你说|听)':'(?:图片|照片|自拍|发图|看你|看)';
  return new RegExp('(?:不要|不用|不想|别|停止|不需要|不方便|先别|无需).{0,8}'+form+'|'+form+'.{0,4}(?:不要|不用|算了)').test(String(value));
}
// Questions about an existing picture's execution do not authorize a new job.
// Keep a separate explicit redo clause (including after a comma) actionable.
export function imageExecutionInquiry(value=''){
  const clauses=parts(unquotedMediaText(value)).flatMap(s=>s.split(/[，,；;]/)).map(s=>s.trim()).filter(Boolean);
  const inquiry=s=>/(?:是不是|是否|有没有|有没|为什么|为何|怎么|如何|怎样)/.test(s)
    &&/(?:参考图|原图|这(?:一)?张|那(?:一)?张|刚才|刚刚|之前|上次|上一张)/.test(s)
    &&/(?:生成|绘制|画|拍|参考|用)/.test(s);
  const command=s=>!inquiry(s)&&!/(?:不要|不用|别|无需|不必|停止|取消).{0,12}(?:生成|绘制|画|拍|发|重做|再来)/.test(s)
    &&(/(?:再|重新|请|帮我|给我|麻烦|能不能|可不可以).{0,40}(?:生成|绘制|画|拍|发|重做)|^(?:生成|绘制|画|拍|发)/.test(s)
      ||/(?:再|重新)(?:来|做)(?:一|个|张|幅|次|遍)/.test(s));
  return clauses.some(inquiry)&&!clauses.some(command);
}
export function requestsImage(value=''){
  if(imageExecutionInquiry(value))return false;
  return parts(unquotedMediaText(value)).some(text=>{
    // Naming the selected workflow/API is also normal in an execution request.
    // Configuration questions still must not start a paid image job.
    const execute=/(?:实际|直接|现在|重新|再)(?:帮我|给我|为我)?(?:生成|绘制|拍)|(?:请|帮我|给我)(?:用|使用|通过)[^。！？\n]{1,50}(?:生成|绘制|拍)(?:一|张|幅|个|照)/.test(text)
      &&!/(?:怎么|如何|为什么|能否|是否|修复|调试|解决|设置|配置|教程|报错)/.test(text);
    if((meta(text)&&!execute)||declinesMedia(text,'image'))return false;
    if(/(?:怎么|如何|怎样).{0,12}(?:拍|发)(?:一|张|照)|(?:会不会|支持|是否|会).{0,4}拍照.{0,4}(?:吗|么|[?？])/.test(text))return false;
    if(/(?:发|画|生成|拍)(?:给我)?的(?:图|图片|照片|自拍|画)/.test(text)&&!/(?:再|重新|另外|新的).{0,5}(?:画|生成|发|拍)/.test(text))return false;
    if(/(?:别|不要|不用|无需|不必|不需要|先别|暂时别|请勿|禁止)(?:再|给我|帮我|替我|继续|现在|马上|去|来|给)?(?:发|画|生成|拍|绘制|制作)/.test(text))return false;
    if(/(?:刚才|之前|已经|上次).{0,12}(?:发的|生成的|画的|拍的)|(?:这张|那张|图片|照片).{0,8}(?:里有什么|里面有什么|画了什么|写了什么|是什么|是什么意思|内容是什么|看见什么)/.test(text)&&!/(?:再|重新|另外|新的).{0,5}(?:画|生成|发|拍)|(?:给我|帮我|请).{0,5}(?:画|生成|绘制)/.test(text))return false;
    // A photo request often omits the noun: “再拍一张给我看”. Keep this
    // after cancellation/history guards, and do not treat “拍一下头” as a photo.
    if(/拍(?:一|两|几|多)?张|拍(?:个)?照|拍(?:个)?自拍/.test(text))return true;
    if(/(?:发(?:给我)?|给我发)(?:一|两|几|再)?张(?:给我看(?:看)?|让我看(?:看)?|看看|看|[吧嘛呀呗吗呢~～，,]|$)/.test(text))return true;
    if(/(?:请|帮我|给我|我想要|我要|我想看|想看).{0,5}(?:生成|绘制|画|拍|发|来).{0,30}(?:图|画|照片|自拍|张|幅)/.test(text))return true;
    if(/(?:生成|绘制)(?:一|个|张|幅|些|一下|点|给我|帮我|图|照片|自拍|$)|画(?:一|两|几)?(?:张|幅|个|点)/.test(text))return true;
    if(/(?:发(?:给我)?|来|拍)(?:一|两|几|再)?(?:张|幅|个).{0,30}(?:图|画|照片|自拍)|给我(?:一|两|几)?(?:张|幅).{0,20}(?:图|照片|自拍)/.test(text))return true;
    if(/(?:^|[，,：:])(?:请)?发(?:给我)?(?:一?下)?(?:图|图片|照片|自拍)(?:[，,]|$)|(?:我想要|我要)(?:一|两|几)?(?:张|幅).{0,20}(?:图|照片|自拍)/.test(text))return true;
    if(/(?:怎么看|看法|观点|意见|理解|代码|文章|链接|视频|电影|表情包|截图)/.test(text))return false;
    return /(?:想看|看看|给我看|让我看|给我瞅|想瞅|想瞧|让我瞧|想见见).{0,10}(?:你(?:的|现在|在|今天|此刻|本人|长|穿|样子|一眼)|自拍|穿搭|窗外|眼前|那边的风景)|(?:看看|看一眼|瞅瞅|瞧瞧)(?:你|你的样子)/.test(text);
  });
}
export function requestsDrawing(value=''){
  return parts(value).some(text=>{
    if(meta(text)||/(?:照片|自拍|拍照|摄影|生成图|ai图|表情包)/i.test(text))return false;
    if(/(?:怎么画|画法|画得|画完|画好|画的|画了|画的是什么|画了什么|画面|漫画|动画|画风|画笔|笔画|画师|作画过程)/.test(text))return false;
    if(/(?:不要|不用|别|停止|不需要|先别|无需).{0,6}(?:画|绘制)/.test(text))return false;
    return /(?:请|帮我|给我|替我|能不能|可不可以|可以|想要|我要|我想(?:要|看)?).{0,8}(?:画|绘制|手绘|涂鸦)|(?:画|绘制|手绘|涂鸦)(?:一|两|几|个|张|幅|下|点|只)/.test(text);
  });
}
export function singingArrangement(value=''){
 const text=String(value||'');
 if(/(?:不要|不用|不加|不带|无需|别加|没有)\s*(?:任何)?伴奏|清唱.{0,3}(?:优先|最好)|最好.{0,3}清唱/.test(text))return 'acapella';
 if(/(?:不用|不要|别)清唱|带(?:点|上|个)?伴奏|加(?:点|上|个)?伴奏|配(?:点|上)?伴奏|伴奏版|跟着伴奏/.test(text))return 'backed';
 return 'acapella';
}
// Select from the confirmed library only when the user has left the title open.
export function openSongChoice(value=''){
 const text=String(value||'').replace(/(?:不用|不要|别|不一定要|不一定需要)清唱/g,'')
  .replace(/清唱/g,'唱').replace(/(?:不用|不要|不加|不带|带上?|加点?|轻|有)?伴奏(?:版|也行|也可以)?|[，,。！!？?～~\s]/g,'');
 return /^(?:请|你|来|给我|为我|想听你|能不能|可以|随便|随意|挑|选|自己|帮我|我想听|再|一会儿)*唱(?:一|个|支|首|段|小|短|歌)*(?:给我听|听听|吧|呗|呀|嘛)?$/.test(text);
}
export function requestsSinging(value=''){
 const original=String(value||'').trim();
 if(/^(?:他说|她说|转发|引用|教程|假如|例如|比如|测试词)/.test(original))return false;
 const text=unquotedMediaText(original)
   .replace(/(?:不用|不要|别|不一定要|不一定需要)清唱(?=[，,。！？；\s]|$)|(?:不要|不用|不带|不加|无需|别加)(?:任何)?伴奏/g,'');
 if(/(?:不要|不用|不想|别|停止|取消|不需要|先别|不用再)[^，,。！？；\n]{0,8}(?:唱|哼)|(?:唱歌|翻唱|清唱)(?:先|就|暂时)?(?:算了|取消|不要了)|只(?:用|要)文字|不要出声|别出声/.test(text))return false;
 return parts(text).some(clause=>{
   if(/(?:怎么|怎样|如何|为什么|是否支持|能否支持)[^，,]{0,18}(?:唱|哼|接口|工作流|API)|(?:会不会|支持|开启|关闭|开通|配置|设置|教程|歌词分析)|(?:刚才|之前|上次|昨天).{0,9}(?:唱的|录的)|(?:唱|哼)的(?:好不好|人|是谁|是什么歌)|(?:唱|哼)得|(?:唱|哼)过|歌词.{0,4}(?:意思|分析)/i.test(clause))return false;
   const action=/(?:给我|为我|帮我|想听你|听你|能不能|可不可以|可以|请|带(?:点|上)?伴奏|跟着伴奏)[^，,]{0,16}(?:翻唱|清唱|演唱|唱(?!片|法|的)|哼(?:唱|一|两|几|个|首|段))|(?:想听|听一下|听听)[^，,]{0,10}你(?:自己)?唱的(?:歌|版本|那段)|(?:来|发)(?:一|几)?(?:首|段|两句)[^，,]{0,5}(?:翻唱|清唱|你(?:自己)?唱的)|(?:^|[，、\s])(?:你(?:来)?|那你)?(?:再|重新|接着)?(?:翻唱|清唱|演唱|唱(?:一|两|几|个|首|段|歌|给我|《|下)|哼(?:唱|一|两|几|个|首|段))/u.test(clause);
   const explicitService=/(?:用|使用|走|调用|通过)[^，,]{0,26}(?:running\s*hub|api|工作流)[^，,]{0,24}(?:翻唱|清唱|演唱|唱(?:一|两|几|首|段|歌|给我|《|下)|哼唱)/i.test(clause);
   return (!meta(clause)&&action)||explicitService;
 });
}

// A cover workflow uses the stored song, so a specific new title needs different audio.
export function requestsDifferentCover(value=''){
 const text=String(value||'');
 return /《[^》\n]{1,100}》|(?:换|另|再选)(?:一|个|首|段){1,3}(?:歌|曲)?|(?:用|拿)(?:我|这次|刚才|刚刚).{0,8}(?:发|传|这份|这个).{0,8}(?:音频|原曲|歌|片段)/.test(text);
}
export function requestsVoice(value=''){
  if(requestsSinging(value))return true;
  return parts(value).some(text=>{
    const explicit=text.split(/[，,]/).some(clause=>!meta(clause)&&/(?:请|另外|同时|再|也|帮我|给我).{0,8}发.{0,10}语音/.test(clause));
    if((meta(text)&&!explicit)||declinesMedia(text,'voice')||/(?:歌词|歌曲|音乐|唱歌|视频|如何配音)/.test(text))return false;
    if(/(?:看法|意见|建议|观点|分析|解释|怎么想)/.test(text)&&!/(?:语音|声音|亲口|说给我听)/.test(text))return false;
    if(/(?:打开|关闭|启用|禁用).{0,6}(?:语音|声音)|(?:语音|声音).{0,6}(?:打开|关闭|关了|开启|关掉)/.test(text))return false;
    return /(?:语音|发.{0,6}声音|用.{0,5}(?:声音|语音)|说给我听|念给我听|读给我听|讲给我听|想听.{0,8}(?:你|声音)|听听你|亲口.{0,8}(?:说|讲)|用嘴.{0,4}(?:说|讲|读|念)|voice message|read aloud)/i.test(text);
  });
}
export function localImageRequest(value=''){
 const raw=String(value).trim();
 if(/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(raw))return false;
 const text=unquotedMediaText(raw);
 if(/(?:支持|有).{0,8}(?:生图|生成图片).{0,8}(?:吗|么)|(?:生成|画).{0,10}(?:提示词|教程|代码)|(?:不要|不用|别|无需).{0,8}(?:生成|绘制|画|生图)/.test(text))return false;
 if(localVideoRequest(text)&&!/(?:图片|照片|自拍|拍照|生图|画(?:一|张|幅))/.test(text))return false;
 return requestsImage(text)||requestsDrawing(text);
}
export function localVideoRequest(value=''){
 const raw=String(value).trim();if(/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(raw))return false;
 const text=unquotedMediaText(raw);
 return parts(text).some(part=>{
  if(meta(part)||/(?:不要|不用|别|停止|不需要|先别|无需).{0,8}(?:生成|制作|做|视频|短片|动画)/.test(part))return false;
  if(/(?:怎么|如何|怎样).{0,12}(?:生成|制作|做)|(?:生成|制作|做).{0,16}(?:提示词|教程|代码|原理|示例)|(?:支持|可以|能).{0,4}(?:生成|制作)(?:视频|短片|动画片段).{0,4}(?:吗|么|[?？])/.test(part))return false;
  if(/(?:刚才|之前|上次|已经|刚刚).{0,12}(?:生成|制作|做)|(?:生成|制作|做)(?:的|过|了).{0,10}(?:视频|短片)/.test(part)&&!/(?:再|重新|另外|新的).{0,6}(?:生成|制作|做|来)/.test(part))return false;
  return /(?:生成|制作|做|来).{0,12}(?:视频|短片|动画片段)/.test(part);
 });
}
export function directMediaIntent(value=''){
  const quoted=/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(String(value).trim());
  const draw=!quoted&&requestsDrawing(value);
  const kinds=quoted?[]:['image','voice'].filter(kind=>kind==='image'?(!draw&&requestsImage(value)):requestsVoice(value));
  return {kinds,draw,source:'direct',request:operationText(value,900)};
}
// Only current human words authorize media; attachments and recalled messages do not.
export function selectMediaIntent(value='',decision={},available={image:true,voice:true}){
  const text=String(value).trim(),direct=directMediaIntent(text);
  const veto=kind=>!available[kind]||declinesMedia(text,kind)||(kind==='voice'&&/(?:用|只要|只用|改成|发)(?:纯)?文字|不要出声|别出声|不方便听/.test(text));
  if(direct.kinds.length)return {...direct,kinds:direct.kinds.filter(kind=>!veto(kind))};
  if(!text||meta(text)||/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(text))return {...direct,kinds:[]};
  const confidence=Number(decision.confidence)||0,form=decision.form;
  const kinds=confidence>=.8?(form==='voice'?['voice']:form==='image'?['image']:form==='voice_image'?['image','voice']:[]):[];
  return {kinds:kinds.filter(kind=>!veto(kind)),source:'contextual',confidence,form,reason:operationText(decision.reason||'',160),request:operationText(text,900)};
}
export function mediaIntentHint(intent){
  if(intent?.draw)return '【本轮画画请求】对方要的是你亲手画的，不是 AI 生图：用 bridge_drawing 亲手画（create 建画布 → path/line/ellipse 起稿、分层上色 → render 看效果再改），画完用 bridge_life_share 把导出的 PNG 发到当前对话。不要用 [图:…] 走生图，也不要说这是 AI 画的；画不好就直说哪里不行。';
  const singing=requestsSinging(intent?.request);
  if(singing&&intent.coverNeedsAudio)return '【本轮翻唱】对方要的是另一首歌。这套翻唱工作流使用保存的原曲片段，请自然说明需要在唱歌页换成那首歌的片段。这一轮不生成或发送旧歌曲。';
  if(!intent?.kinds?.length)return '';
  const songHint=!singing?'':intent.cover
    ? '【本轮翻唱】程序会用保存的原曲片段和参考音色提交翻唱。不需要写歌词、语音标签或复制指令，自然接话即可；按真实回执确认发送。'
    : '【本轮唱歌】用 [语音:唱歌] 另起一段，后面写实际要唱的歌词。是否生成以 RunningHub 的实际回执为准。';
  return (songHint?songHint+'\n':'')+'【本轮媒体表达参考】'+JSON.stringify(intent)+(intent.source==='direct'?'\n对方本轮明确邀请发送媒体。':'\n这是表达形式判断的建议，不是对方明确要求；request仅保留对方原话。先直接回答原问题，自主选择媒体时不改变意思，不把理由或计划当已发生的事实。')+(intent.kinds.includes('image')?'请实际输出单独一行 [图:具体画面]；“看看你在干嘛”应结合当前模拟日程，拍角色前置自拍或眼前后置视角，别只描述自己在做什么。':'')+(!singing&&intent.kinds.includes('voice')?'请把实际要说的话写为 [语音:合适语气]台词；“想听你说晚安”要用声音说晚安，不只回复文字或介绍语音功能。':'')+'不重复发送，不假装媒体已经成功送达；成功与否由程序回执确认。';
}
export const IMAGE_DELIVERY_RULES='【发图顺序：群聊和私聊相同】先发图片，再发配文、画面描述、感想和语音。图片前可以完全不说话。需要先回答与图片无关的问题时，单独写[即时回复]正文，下一行写[图:具体画面]。依赖图片的配话放图后。如果只想先打一声招呼，可以简短自然地说正在准备。调皮、傲娇等符合当前人设时，也可以先逗一句“就不给你”，但仍实际发图，不把逗弄当作取消请求。不强制使用这些示例，不提前描述画面或声称已经发出。图用单独一行 [图:具体画面]，其余文字和语音放图后。';

export function imageLeadIn(value=''){
  const text=String(value).trim();if(!text||text.length>32||/\[|https?:|已经|好了|拍完|发了|发给你了|送达/.test(text))return false;
  return /^(?:(?:(?:哼|哎呀|好啦|好嘛|行啦)[，,！!。.\s]*)?(?:等等|稍等(?:我)?(?:一下|一会儿?|会儿?|片刻)?|等(?:我|一下|下|一会儿?|会儿?|片刻)(?:一下|一会儿?|会儿?)?|给我(?:一点|点)时间|马上(?:就)?(?:好|来)|让我(?:先)?(?:拍(?:一下|一张|张照|张照片)?|找(?:一下)?角度|调整(?:一下|下)?(?:灯光|角度))|我(?:先|正|还)?(?:在)?(?:拍(?:照|照片|一张|张照|张照片)?|准备(?:拍照|拍|一下)?|找(?:一下)?角度|调整(?:一下|下)?(?:灯光|角度)|挑(?:一张|张照片)?|选(?:一张|张照片)?)|就不给你(?:看)?|才不给你(?:看)?|先不给你(?:看)?|才不让你看)(?:啦|呢|哦|喔|呀|哈|哼|嘛|吧|噢|诶)*[\s，,。.!！?？~～…]*)+$/u.test(text);
}

// Keep model-written captions intact, but put them behind the actual picture.
// A lead-in is optional and is never fabricated by the transport.
export function imageFirstReply(value=''){
  const body=String(value).trim();
  const parts=body.split(/(\[(?:图|图片|照片)[:：]\s*[^\]\n]{1,800}\])/).map(s=>s.trim()).filter(Boolean);
  const isPicture=s=>/^\[(?:图|图片|照片)[:：][^\]\n]+\]$/.test(s),first=parts.findIndex(isPicture);
  if(first<0)return body;
  const prefix=parts.slice(0,first).flatMap(s=>s.split(/\r\n?|\n/)).map(s=>s.trim()).filter(Boolean);
  const lead=prefix.findIndex(imageLeadIn),pictures=parts.filter(isPicture);
  return [...(lead<0?[]:[prefix[lead]]),...pictures,...prefix.filter((_,i)=>i!==lead),...parts.slice(first).filter(s=>!isPicture(s))].join('\n');
}
const speechComparable=value=>String(value||'').replace(/[\s，,。.!！?？“”‘’"'「」『』]/g,'');
function requestedVoiceQuotes(request=''){
  if(!requestsVoice(request))return [];
  return [...String(request).matchAll(/(?:说|念|读|台词(?:是|为)?|内容(?:是|为)?)\s*[:：]?\s*[“‘"'「『]([^”’"'」』\n]+)[”’"'」』]/g)].map(m=>m[1]);
}
// An exact, separately requested line is independent of the picture's caption.
// Do not let an unverified picture-success announcement escape this boundary.
export function independentRequestedVoice(chunk,request=''){
  const match=String(chunk).match(/^\s*\[语音(?:[:：][^\]\n]+)?\]\s*([\s\S]+)$/);
  return !!match&&requestedVoiceQuotes(request).some(line=>speechComparable(line)===speechComparable(match[1]));
}
export function completeMediaReply(value,intent,currentRequest=''){
  const cover=intent?.cover===true&&intent.kinds?.includes('voice');
  let body=String(value||'').trim();if(!body||/^\[skip\]$/i.test(body))return cover?'[语音:唱歌]':body;
  // Some models put the requested words inside the marker instead of after it.
  // Recover only verbatim requested speech, never read a mood/direction aloud.
  const quoted=requestedVoiceQuotes(currentRequest||intent?.request);
  body=body.replace(/\[语音[:：]([^\]\n]{1,800})\]/g,(mark,line)=>quoted.some(text=>speechComparable(text)===speechComparable(line))?'[语音]'+line+'\n':mark);
  const image=/\[(?:图|图片|照片)[:：][^\]\n]+\]/,voice=/\[语音(?:[:：][^\]\n]+)?\]/;
  if(intent?.kinds?.includes('image')&&!image.test(body)){
    const description=String(intent.request||'当前角色此刻自然想分享的照片，按语境选择近脸、半身或眼前后置视角').replace(/[\[\]\r\n]/g,' ').slice(0,220);
    if(/(?:不能|无法|没法|不支持|发不|没有).{0,16}(?:图|照片|发送|能力|功能)|发不过来/.test(body))body='';
    body+=(body?'\n':'')+'[图:'+description+']';
  }
  if(cover&&!voice.test(body)){
    if(body.length<=65&&/(?:不能|没法|无法|不支持).{0,12}(?:唱|翻唱)|唱不了/.test(body))body='';
    body+=(body?'\n':'')+'[语音:唱歌]';
  }
  /* 只在对方明确点名要语音、而且这句本身就是一句台词时才兜底合成。
     以前不管多长的回复都整段念出来：解析、报错、参数说明全被念，还一直在扣积分。 */
  const spokenCandidate=body.replace(image,'').trim();
  /* 工作产出不进语音：代码块、表格、频段数字、报错、参数说明这些是给人看的，别念。 */
  const workOutput=/```|\|.*\||(?:\d+\s*(?:hz|khz|db|dbfs|ms|%))|参数|频段|实测|报错|失败|超时|版本|代码|接口|日志|缓存|脚本/i.test(spokenCandidate)
    || (spokenCandidate.match(/[：:]/g)||[]).length>=2
    || /(?:^|\n)\s*(?:[-*•]|\d+[.、])/.test(spokenCandidate);
  const shortLine=spokenCandidate.length<=60&&!workOutput;
  if(intent?.kinds?.includes('voice')&&!voice.test(body)&&intent.direct===true&&!requestsSinging(intent.request)&&shortLine){
    let spoken=spokenCandidate.replace(/\r\n?|\n/g,' ');
    if(/(?:不能|无法|没法|不支持|没有).{0,16}(?:语音|声音|发送|能力|功能)/.test(spoken))spoken='';
    if(!spoken)spoken=/晚安/.test(intent.request||'')?'晚安，好好休息。':/早安/.test(intent.request||'')?'早安。':'嗯，我在听。';
    const pictures=[...body.matchAll(new RegExp(image.source,'g'))].map(m=>m[0]);
    body=['[语音]'+spoken,...pictures].join('\n');
  }
  // 标签可能被写在引子后面：语音必须独占一段开头，否则会把
  // [语音:温柔] 原样当文字发出去；图和语音也拆成各自的消息，保住先后顺序。
  const mark=body.match(voice);
  if(mark&&body.slice(0,mark.index).trim()!==''){
    const before=body.slice(0,mark.index).trim(),after=body.slice(mark.index+mark[0].length).trim();
    body=before+'\n'+mark[0]+after;
  }
  // Put media in separate platform messages even when the model puts them inline.
  return body.replace(new RegExp(image.source,'g'),'\n$&\n').trim();
}
