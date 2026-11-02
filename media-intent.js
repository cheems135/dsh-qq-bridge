import {operationText} from './operation-context.js';

const parts=value=>String(value||'').slice(0,4000).split(/[。！？!?\n；;]/).map(s=>s.trim()).filter(Boolean);
const meta=s=>/(?:触发词|提示词|接口|工作流|开关|设置|配置|功能|报错|原理|额度|限制|登录|模型|api(?:\s*key)?|失败|发不出来|无法发送|不会发|为什么不发|怎么不发)/i.test(s);
export function declinesMedia(value='',kind){
  const form=kind==='voice'?'(?:语音|声音|听你说|听)':'(?:图片|照片|自拍|发图|看你|看)';
  return new RegExp('(?:不要|不用|不想|别|停止|不需要|不方便|先别|无需).{0,8}'+form+'|'+form+'.{0,4}(?:不要|不用|算了)').test(String(value));
}
export function requestsImage(value=''){
  return parts(value).some(text=>{
    if(meta(text)||declinesMedia(text,'image'))return false;
    if(/(?:发|画|生成|拍)(?:给我)?的(?:图|图片|照片|自拍|画)/.test(text)&&!/(?:再|重新|另外|新的).{0,5}(?:画|生成|发|拍)/.test(text))return false;
    if(/(?:别|不要|不用|无需|不必|不需要|先别|暂时别|请勿|禁止)(?:再|给我|帮我|替我|继续|现在|马上|去|来|给)?(?:发|画|生成|拍|绘制|制作)/.test(text))return false;
    if(/(?:刚才|之前|已经|上次).{0,12}(?:发的|生成的|画的|拍的)|(?:这张|那张|图片|照片).{0,8}(?:里有什么|里面有什么|画了什么|写了什么|是什么|是什么意思|内容是什么|看见什么)/.test(text)&&!/(?:再|重新|另外|新的).{0,5}(?:画|生成|发|拍)|(?:给我|帮我|请).{0,5}(?:画|生成|绘制)/.test(text))return false;
    if(/(?:请|帮我|给我|我想要|我要|我想看|想看).{0,5}(?:生成|绘制|画|拍|发|来).{0,30}(?:图|画|照片|自拍|张|幅)/.test(text))return true;
    if(/(?:生成|绘制)(?:一|个|张|幅|些|一下|点|给我|帮我|图|照片|自拍|$)|画(?:一|两|几)?(?:张|幅|个|点)/.test(text))return true;
    if(/(?:发(?:给我)?|来|拍)(?:一|两|几|再)?(?:张|幅|个).{0,30}(?:图|画|照片|自拍)|给我(?:一|两|几)?(?:张|幅).{0,20}(?:图|照片|自拍)/.test(text))return true;
    if(/(?:^|[，,：:])(?:请)?发(?:给我)?(?:一?下)?(?:图|图片|照片|自拍)(?:[，,]|$)|(?:我想要|我要)(?:一|两|几)?(?:张|幅).{0,20}(?:图|照片|自拍)/.test(text))return true;
    if(/(?:怎么看|看法|观点|意见|理解|代码|文章|链接|视频|电影|表情包|截图)/.test(text))return false;
    return /(?:想看|看看|给我看|让我看|给我瞅|想瞅|想瞧|让我瞧|想见见).{0,10}(?:你(?:的|现在|在|今天|此刻|本人|长|穿|样子|一眼)|自拍|穿搭|窗外|眼前|那边的风景)|(?:看看|看一眼|瞅瞅|瞧瞧)(?:你|你的样子)/.test(text);
  });
}
export function requestsSinging(value=''){
 const text=String(value||'');
 if(meta(text)||/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(text.trim())||/(?:不要|不用|不想|别|停止|不需要|先别).{0,6}(?:唱|清唱|哼)|歌词.{0,4}(?:意思|分析)|怎么.{0,4}(?:唱歌|清唱)/.test(text))return false;
 return /(?:给我|为我|想听你|听你|能不能|可以|请).{0,8}(?:唱|清唱|哼)|^(?:唱(?:一|两|几|个|首|段|歌)|清唱|哼(?:一|个|首|段))/.test(text);
}
export function requestsVoice(value=''){
  if(requestsSinging(value))return true;
  return parts(value).some(text=>{
    if(meta(text)||declinesMedia(text,'voice')||/(?:歌词|歌曲|音乐|唱歌|视频|如何配音)/.test(text))return false;
    if(/(?:看法|意见|建议|观点|分析|解释|怎么想)/.test(text)&&!/(?:语音|声音|亲口|说给我听)/.test(text))return false;
    if(/(?:打开|关闭|启用|禁用).{0,6}(?:语音|声音)|(?:语音|声音).{0,6}(?:打开|关闭|关了|开启|关掉)/.test(text))return false;
    return /(?:语音|发.{0,6}声音|用.{0,5}(?:声音|语音)|说给我听|念给我听|读给我听|讲给我听|想听.{0,8}(?:你|声音)|听听你|亲口.{0,8}(?:说|讲)|用嘴.{0,4}(?:说|讲|读|念)|voice message|read aloud)/i.test(text);
  });
}
export function directMediaIntent(value=''){
  const quoted=/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(String(value).trim());
  const kinds=quoted?[]:['image','voice'].filter(kind=>kind==='image'?requestsImage(value):requestsVoice(value));
  return {kinds,source:'direct',request:operationText(value,900)};
}
// Only current human words authorize media; attachments and recalled messages do not.
export function selectMediaIntent(value='',decision={},available={image:true,voice:true}){
  const text=String(value).trim(),direct=directMediaIntent(text);
  const veto=kind=>!available[kind]||declinesMedia(text,kind)||(kind==='voice'&&/(?:用|只要|只用|改成|发)(?:纯)?文字|不要出声|别出声|不方便听/.test(text));
  if(direct.kinds.length)return {...direct,kinds:direct.kinds.filter(kind=>!veto(kind))};
  if(!text||meta(text)||/^(?:他说|她说|转发|引用|教程|假如|例如)/.test(text))return {...direct,kinds:[]};
  const confidence=Number(decision.confidence)||0,form=decision.form;
  const kinds=confidence>=.8?(form==='voice'?['voice']:form==='image'?['image']:form==='voice_image'?['image','voice']:[]):[];
  return {kinds:kinds.filter(kind=>!veto(kind)),source:'contextual',confidence,form,reason:operationText(decision.reason||'',160),request:operationText(decision.request||text,900)};
}
export function mediaIntentHint(intent){
  if(!intent?.kinds?.length)return '';
  return (requestsSinging(intent.request)?'【本轮清唱请求】已有按谱歌曲库（内置两只老虎，也可由号主教谱）。点歌使用 [语音:清唱] 后放实际歌词，不加说话开场；程序按当前真实点歌请求查确认歌谱，再用当前音色合成实际旋律和节拍。未知歌曲需要歌谱或示范，不用自由旋律冒充原曲。明确要求原创时才走实验自由清唱。不要仅凭旧语音印象声称不能唱；成功与否以实际工具结果为准。\n':'')+'【本轮已理解的媒体请求】'+JSON.stringify(intent)+'\n这是对方自然表达的当前要求，不受自主分享次数或间隔限制。'+(intent.kinds.includes('image')?'请实际输出单独一行 [图:具体画面]；“看看你在干嘛”应结合当前模拟日程，拍角色前置自拍或眼前后置视角，别只描述自己在做什么。':'')+(intent.kinds.includes('voice')?'请把实际要说的话写为 [语音:合适语气]台词；“想听你说晚安”要用声音说晚安，不只回复文字或介绍语音功能。':'')+'不重复发送，不假装媒体已经成功送达；成功与否由程序回执确认。';
}
export const IMAGE_DELIVERY_RULES='【发图顺序：群聊和私聊相同】先发图片，再发配文、画面描述、感想和语音。图片前可以完全不说话；如果想先开口，只说一句简短的等待或拍摄提示，例如“等等”“我在拍”。调皮、傲娇等符合当前人设时，也可以先逗一句“就不给你”，但仍实际发图，不把逗弄当作取消请求。不强制使用这些示例，不提前描述画面或声称已经发出。图用单独一行 [图:具体画面]，其余文字和语音放图后。';

export function imageLeadIn(value=''){
  const text=String(value).trim();if(!text||text.length>32||/\[|https?:|已经|好了|拍完|发了|发给你了|送达/.test(text))return false;
  return /^(?:(?:(?:哼|哎呀|好啦|好嘛|行啦)[，,！!。.\s]*)?(?:等等|稍等(?:我)?(?:一下|一会儿?|会儿?|片刻)?|等(?:我|一下|下|一会儿?|会儿?|片刻)(?:一下|一会儿?|会儿?)?|给我(?:一点|点)时间|马上(?:就)?(?:好|来)|让我(?:先)?(?:拍(?:一下|一张|张照|张照片)?|找(?:一下)?角度|调整(?:一下|下)?(?:灯光|角度))|我(?:先|正|还)?(?:在)?(?:拍(?:照|照片|一张|张照|张照片)?|准备(?:拍照|拍|一下)?|找(?:一下)?角度|调整(?:一下|下)?(?:灯光|角度)|挑(?:一张|张照片)?|选(?:一张|张照片)?)|就不给你(?:看)?|才不给你(?:看)?|先不给你(?:看)?|才不让你看)(?:啦|呢|哦|喔|呀|哈|哼|嘛|吧|噢|诶)*[\s，,。.!！?？~～…]*)+$/u.test(text);
}

// Keep model-written captions intact, but put them behind the actual picture.
// A lead-in is optional and is never fabricated by the transport.
export function imageFirstReply(value=''){
  const body=String(value).trim(),picture=/\[(?:图|图片|照片)[:：]\s*[^\]\n]{1,800}\]/g;
  if(!picture.test(body))return body;
  const parts=body.replace(picture,mark=>'\n|||\n'+mark+'\n|||\n').split(/\|\|\|/).map(s=>s.trim()).filter(Boolean);
  const isPicture=s=>/^\[(?:图|图片|照片)[:：][^\]\n]+\]$/.test(s),first=parts.findIndex(isPicture);
  const prefix=parts.slice(0,first).flatMap(s=>s.split(/\r?\n/)).map(s=>s.trim()).filter(Boolean);
  const lead=prefix.findIndex(imageLeadIn),pictures=parts.filter(isPicture);
  return [...(lead<0?[]:[prefix[lead]]),...pictures,...prefix.filter((_,i)=>i!==lead),...parts.slice(first).filter(s=>!isPicture(s))].join('\n|||\n');
}
export function completeMediaReply(value,intent){
  let body=String(value||'').trim();if(!body||/\[skip\]/i.test(body))return body;
  const image=/\[(?:图|图片|照片)[:：][^\]\n]+\]/,voice=/\[语音(?:[:：][^\]\n]+)?\]/;
  if(intent?.kinds?.includes('image')&&!image.test(body)){
    const description=String(intent.request||'当前角色此刻自然想分享的照片，按语境选择近脸、半身或眼前后置视角').replace(/[\[\]\r\n]/g,' ').slice(0,220);
    if(/(?:不能|无法|没法|不支持|发不|没有).{0,16}(?:图|照片|发送|能力|功能)|发不过来/.test(body))body='';
    body+=(body?'\n|||\n':'')+'[图:'+description+']';
  }
  if(intent?.kinds?.includes('voice')&&!voice.test(body)){
    const singing=requestsSinging(intent.request);
    if(singing&&/(?:不能|无法|没法|不支持|没有).{0,16}(?:唱|清唱|演唱)/.test(body))return body;
    let spoken=body.replace(image,'').replace(/\|\|\|/g,'').trim();
    if(/(?:不能|无法|没法|不支持|没有).{0,16}(?:语音|声音|发送|能力|功能)/.test(spoken))spoken='';
    if(!spoken)spoken=/晚安/.test(intent.request||'')?'晚安，好好休息。':/早安/.test(intent.request||'')?'早安。':'嗯，我在听。';
    const pictures=[...body.matchAll(new RegExp(image.source,'g'))].map(m=>m[0]);
    body=(singing?'[语音:清唱]':'[语音]')+spoken+(pictures.length?'\n|||\n'+pictures.join('\n|||\n'):'');
  }
  // 标签可能被写在引子后面：语音必须独占一段开头，否则会把
  // [语音:温柔] 原样当文字发出去；图和语音也拆成各自的消息，保住先后顺序。
  const mark=body.match(voice);
  if(mark&&body.slice(0,mark.index).trim()!==''){
    const before=body.slice(0,mark.index).trim(),after=body.slice(mark.index+mark[0].length).trim();
    body=before+'\n|||\n'+mark[0]+after;
  }
  // Put media in separate platform messages even when the model puts them inline.
  return body.replace(new RegExp(image.source,'g'),mark=>'\n|||\n'+mark+'\n|||\n').replace(/(?:\s*\|\|\|\s*){2,}/g,'\n|||\n').replace(/^\s*\|\|\|\s*|\s*\|\|\|\s*$/g,'').trim();
}
