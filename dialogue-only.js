// Presentation policy for final chat and speech, never for tool arguments.
export const DIALOGUE_ONLY_RULE='【聊天文体，优先于人设示例】默认只写直接对对方说的话，不加括号或星号包裹的动作、表情、心理、场景和舞台说明，例如不写“（吐了吐舌头，把手机藏起来）”。情绪用实际措辞表达。换人设不改变此规则；只有本轮用户明确要求动作描写、剧情、故事等创作时才写。正常说明中的括号、引用、代码和工具参数保留。';

export function requestedActionNarration(request=''){
 if(/(?:不要|别|禁止|不许|不用|无需|不需要|不能|不得|去掉|删掉)[^，。！？;；\n]{0,16}(?:动作|旁白|心理描写|场景描写|舞台说明)/.test(String(request)))return false;
 const text=String(request).replace(/(?:不要|别|禁止|不许|不用|无需|不需要|不能|不得)[^，。！？;；\n]*/g,'').replace(/\b(?:do not|don't|without|no)\s+(?:stage directions?|actions?|narration|roleplay)\b/gi,'');
 return /(?:写|编|续写|创作|讲|生成|来|继续).{0,18}(?:故事|小说|剧本|剧情|童话)|(?:请|帮我|给我|加入|加上|带上|用|写|描写|描述|演).{0,18}(?:动作描写|动作描述|肢体动作|心理描写|场景描写|旁白|舞台说明|角色扮演)|(?:动作|心理|场景).{0,8}(?:也写|写出来|描写|描述|加上)|\b(?:write|continue|tell)\b.{0,24}\b(?:story|novel|script|scene)\b|\b(?:include|add|describe)\b.{0,16}\b(?:actions?|stage directions?|narration)\b/i.test(text);
}

const stageWords=/(?:瘪.{0,5}嘴|嘟.{0,5}嘴|撅.{0,5}嘴|声音.{0,16}(?:软|糯|轻|低|哑|颤|甜)|(?:带着|带有).{0,16}(?:撒娇|鼻音|哭腔|笑意)|眼眶.{0,8}(?:红|湿)|委屈地|撒娇地|语气.{0,12}(?:委屈|撒娇|温柔|柔软)|吐(?:了)?(?:吐)?舌头|吐舌|眨(?:了)?(?:眨)?眼|歪(?:了)?(?:歪)?头|抬起|低下|低头|抬头|转身|伸手|伸出|抱住|抱紧|拥抱|靠近|凑近|轻轻|微微|轻笑|偷笑|微笑|笑着|笑了|笑眯眯|脸红|害羞|不好意思|心想|心中暗|心里想|轻声|柔声|说道|说着|答道|叹气|叹了|点头|摇头|咬.{0,3}嘴唇|揉.{0,3}(?:眼睛|脑袋|头发)|捏.{0,3}(?:脸|衣角)|把.{0,35}(?:藏|塞|放|拉|盖|抱|拿|捂|推)|(?:赶紧|悄悄|偷偷|得意地|调皮地)|\b(?:smiles?|smiling|blush(?:es|ing)?|winks?|nods?|sighs?|chuckles?|whispers?|leans?|hides?|hiding|tilts? (?:her|his|my) head)\b)/i;
function isStageDirection(value){
 const text=String(value).trim();
 if(/^(?:注|备注|补充|说明|注意)\s*[:：]|^(?:例如|比如|即|也就是|含税|不含税|约\d|共\d|可选|选填|默认|单位|格式|英文|简称)|(?:这个词|一词|意思是|表示的是|术语|定义为)|https?:\/\/|[A-Za-z]:[\\/]/.test(text))return false;
 return /^(?:动作|旁白|心理活动|内心独白|场景)\s*[:：]/.test(text)||stageWords.test(text);
}

export function stripUnrequestedActions(value='',{request=''}={}){
 const original=String(value??'');
 if(requestedActionNarration(request)||/(?:原样|逐字|摘录|引用|翻译|翻成)|(?:写|生成|输出|返回|修改|调试|解释)[^。！？\n]{0,24}(?:代码|脚本|JSON|Markdown)|\b(?:verbatim|quote|translate)\b/i.test(String(request)))return original;
 // Preserve structured data and code verbatim, including strings with actions.
 if(/^\s*[{[]/.test(original)){try{JSON.parse(original);return original;}catch{}}
 const protectedParts=[];
 let text=original.replace(/```[\s\S]*?(?:```|$)|`[^`\n]+`|\[(?:图|图片|照片|语音|声音|表情包|发送|群发|定时|设置|查|收藏表情)(?:[:：][^\]]*)?\]/g,part=>{protectedParts.push(part);return '\uE110'+(protectedParts.length-1)+'\uE111';});
 const stack=[],ranges=[];
 for(let i=0;i<text.length;i++){
  const c=text[i];if(c==='（'||c==='('){stack.push({char:c,start:i});continue;}
  if(c!=='）'&&c!==')')continue;
  const item=stack.at(-1);if(!item||item.char!==(c==='）'?'（':'('))continue;stack.pop();
  const content=text.slice(item.start+1,i);
  // A short gloss such as smile（微笑） is explanatory text.
  if(content.length<16&&/[A-Za-z][A-Za-z-]*$/.test(text.slice(0,item.start)))continue;
  if(content.length<=2000&&isStageDirection(content))ranges.push([item.start,i+1]);
 }
 ranges.sort((a,b)=>a[0]-b[0]||b[1]-a[1]);
 let cursor=0,parts=[];
 for(const [start,end] of ranges){if(start<cursor)continue;parts.push(text.slice(cursor,start));cursor=end;}
 parts.push(text.slice(cursor));text=parts.join('');
 text=text.replace(/(\*{1,3})([^*\n]{1,1000})\1/g,(all,_mark,content)=>isStageDirection(content)?'':all)
  .replace(/^(?:动作|旁白|心理活动|内心独白|场景)\s*[:：][^\n]*(?:\n|$)/gm,'')
  .replace(/^[ \t]*\*{1,3}[ \t]*$/gm,'')
  .replace(/[ \t]+([，。！？；,.!?;])/g,'$1');
 text=text.replace(/\uE110(\d+)\uE111/g,(_all,index)=>protectedParts[Number(index)]);
 return text.replace(/\n[ \t]*\n(?:[ \t]*\n)+/g,'\n\n').trim();
}
