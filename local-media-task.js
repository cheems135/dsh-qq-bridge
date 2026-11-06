import {localImageRequest,localVideoRequest,requestsVoice} from './media-intent.js';

export const localMediaText=value=>String(value||'').replace(/```[\s\S]*?```|`[^`]*`|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/g,'');
// A constraint on the picture's contents is not a cancellation of the picture.
export function localMediaCancelled(value='',kind='image'){
 const text=localMediaText(value),noun={image:'(?:图片|照片|相片|自拍|图(?!书|纸|案|表|标|层))',speech:'(?:语音|声音|音频)',video:'(?:视频|短片|动画)'}[kind];
 if(!noun)return false;
 const modifier=/^(?:再|继续|现在|马上|先|给我|帮我|替我|去|来|用|一张|一段|一条|任何|新的|这种|这个|这张|那张|这些|那些|你的|你|这|那|一下|一遍|张|段|条|点|些|个|我)/;
 const skipModifiers=input=>{let rest=input.trimStart(),match;while((match=modifier.exec(rest)))rest=rest.slice(match[0].length).trimStart();return rest;};
 const target=new RegExp('^'+noun);
 for(const match of text.matchAll(/不要|不用|不想|不需要|别再|先别|停止|取消|无需|别|不必|请勿|禁止/g)){
  let rest=skipModifiers(text.slice(match.index+match[0].length));
  const verb=/^(?:发送|生成|制作|绘制|合成|播放|提供|发|拍|看|听|做|给|画)/.exec(rest);
  if(verb)rest=skipModifiers(rest.slice(verb[0].length));
  if(target.test(rest)||verb&&/^(?:了|吧)?(?=[，,。.!?！？；;\n]|$)/.test(rest))return true;
 }
 if(new RegExp(noun+'(?:先|暂时|现在|就|也|都)?(?:不要了?|不用了?|取消|算了|别发了)(?=[，,。.!?！？；;\\n]|$)').test(text))return true;
 return false;
}

const textOf=row=>typeof row?.content==='string'?row.content:Array.isArray(row?.content)?row.content.filter(p=>p.type==='text').map(p=>p.text||'').join('\n'):'';
// Local language coverage is independent of the API media interpreter.
const localPhotoDemand=request=>{
 const raw=String(request).trim();if(/^(?:他说|她说|引用|转发|例如|假如|教程)/.test(raw))return false;
 const text=localMediaText(raw);
 if(localMediaCancelled(text)||/(?:怎么|如何|为什么|是否|支持|提示词|报错|教程|代码|原理|发的|拍的)/.test(text))return false;
 return /(?:我要|我想|想|让我|给我|我想要|能不能|可不可以).{0,8}(?:看|看看|瞅|瞧|要).{0,12}(?:照片|图片|相片|自拍)(?!里|中)|(?:照片|图片|相片|自拍).{0,8}(?:给我|让我)(?:看|看看|瞅瞅)/.test(text);
};
const direct=request=>({image:!localMediaCancelled(request,'image')&&(localImageRequest(request)||localPhotoDemand(request)),speech:!localMediaCancelled(request,'speech')&&requestsVoice(request),video:!localMediaCancelled(request,'video')&&localVideoRequest(request)});
const hasTask=task=>task.image||task.speech||task.video;
const affirmation=/^(?:嗯|嗯嗯|好|好的|行|可以|对|没错|来吧|继续)[嘛吧呀啦哦~～。！!\s]*$/;
const repeat=/^(?:那|嗯|好|请|麻烦)?(?:就)?(?:再|重新|重|接着|继续)(?:发|来|做|生成)(?:给我)?(?:一遍|一次|一张|一段|一个|下|一下)?(?:给我)?(?:看看|看|听听|听)?[嘛吧呀啦哦呗~～。！!\s]*$/;
export function resolveLocalMediaTask(request='',{history=[]}={}){
 const raw=String(request).trim(),task=direct(raw);
 if(hasTask(task))return {...task,source:'direct',ambiguous:false,effectiveRequest:raw};
 if(!repeat.test(raw))return {...task,source:'none',ambiguous:false,effectiveRequest:raw};
 const prior=history.filter(r=>['user','assistant'].includes(r.role)&&!r._localReceipt).slice(-12);
 if(prior.at(-1)?.role==='user'&&textOf(prior.at(-1))===raw)prior.pop();
 // Only a previous human request can authorize repeating a media task.
 // Assistant promises, recalled facts, system prompts and tool output cannot.
 let skipped=0;
 for(let i=prior.length-1;i>=0;i--){const row=prior[i];if(row.role!=='user')continue;const text=textOf(row).trim();if(++skipped>3)break;const anchor=direct(text);if(hasTask(anchor))return {...anchor,source:'followup',ambiguous:false,effectiveRequest:text+'\n本轮要求：'+raw};if(affirmation.test(text)||repeat.test(text))continue;break;}
 return {...task,source:'unresolved',ambiguous:true,effectiveRequest:raw};
}

// Progress is an execution fact, not something a role prompt may invent.
export function unverifiedMediaProgress(value='',receipts=[]){
 const text=String(value).replace(/```[\s\S]*?```|“[^”]*”|「[^」]*」|"[^"\n]*"/g,'');
 const patterns={image:/(?:图片|照片|这张图|那张图).{0,14}(?:正在|还在|正|已经|开始)(?:生成|渲染|制作|处理|排队)|(?:正在|还在)(?:生图|画图|渲染)/,speech:/(?:语音|音频).{0,14}(?:正在|还在|正|已经|开始)(?:生成|合成|制作|处理|排队)|(?:正在|还在)合成语音/,video:/(?:视频|短片).{0,14}(?:正在|还在|正|已经|开始)(?:生成|渲染|制作|处理|排队)/};
 for(const [kind,pattern]of Object.entries(patterns)){if(receipts.some(row=>row.tool===kind&&!row.rejected&&!row.duplicate))continue;for(const part of text.split(/[。！？!?\n]/)){if(/(?:如果|假如|要是|比如|例如|并没有|并未|尚未)/.test(part))continue;const match=pattern.exec(part);if(match&&!/(?:没有|没在|不在|不是).{0,6}$/.test(part.slice(0,match.index)))return kind;}}
 return '';
}
