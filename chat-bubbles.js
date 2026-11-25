export const QQ_LINE_BREAK_RULE='要另发一条 QQ 消息就直接回车换行，每行一个气泡。不要用竖线或转义字符充当分隔符。';

const blockSyntax=/```|^[ \t]*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m;
const tableSeparator=/^[ \t]*\|?(?:[ \t]*:?-{2,}:?[ \t]*\|)+[ \t]*:?-{2,}:?[ \t]*\|?[ \t]*\r?$/m;

export function normalizeReplyNewlines(value){
  return String(value??'').replace(/\r\n?/g,'\n');
}

function jsonBlock(text){
  if(!/^\s*[\[{]/.test(text))return false;
  try{JSON.parse(text);return true;}catch{return false;}
}

function structuredReply(text){
  return blockSyntax.test(text)||tableSeparator.test(text)||jsonBlock(text);
}

export function stripReplyDividers(value=''){
  const text=String(value);
  if(!/(?:[|｜]{2,}|[‖∥])/.test(text)||tableSeparator.test(text)||jsonBlock(text))return text;
  // Literal code, addresses and action arguments keep their own syntax.
  return text.replace(/(```[\s\S]*?(?:```|$)|`+[^\x60\r\n]+`+|https?:\/\/[^\s<>|｜‖∥]+|[A-Za-z]:[\\/][^\s|｜‖∥]+|\[(?:发送|群发|定时|语音|声音|表情包?|图|图片|照片|设置|查|收藏表情)(?:[:：][^\]]*)?\])|[ \t]*(?:[|｜]{2,}|[‖∥]+)[ \t]*/giu,(_match,literal)=>literal??' ');
}

function replyLines(text){
  const lines=[];
  let start=0;
  // A relay or reminder may itself contain multiple lines of message text.
  for(const match of text.matchAll(/\[(?:发送|群发|定时)[:：][^\]]*\]|\n/g)){
    if(match[0].startsWith('['))continue;
    const line=text.slice(start,match.index).trim();
    if(line)lines.push(line);
    start=match.index+match[0].length;
  }
  const tail=text.slice(start).trim();
  if(tail)lines.push(tail);
  return lines;
}

// A voice declaration owns the following speech line even when the model puts
// blank lines between them. This parses delivery syntax, never chooses speech.
function bindVoiceLine(text){
  if(jsonBlock(text))return text;
  return text.replace(/```[\s\S]*?(?:```|$)|`+[^\x60\r\n]+`+|\[(?:发送|群发|定时)[:：][^\]]*\]|(\[语音(?:[:：][^\]\r\n]{1,20})?\])[ \t]*\n(?:[ \t]*\n)*([^\n]+)/g,(whole,mark,line)=>{
    if(!mark||/^\s*```/.test(line)||/^\s*\[(?:语音|声音|图|图片|照片|视频|表情包|发送|群发|定时|设置|查|收藏表情|skip)(?:[:：\]])/.test(line))return whole;
    return mark+line.trim();
  });
}

function structuredReplyParts(text){
  const parts=[];
  let start=0;
  const append=part=>{
    const block=part.trim();
    if(block)parts.push(...(structuredReply(block)?[block]:replyLines(block)));
  };
  // A media line still has its own delivery when a caption contains a list or code.
  const mediaLines=/```[\s\S]*?(?:```|(?![\s\S]))|\[(?:发送|群发|定时)[:：][^\]]*\]|^[ \t]*(\uE200PIC\d+\uE201|\[(?:图|图片|照片)[:：][^\]\r\n]+\]|\[语音(?:[:：][^\]\r\n]+)?\][^\r\n]*)[ \t]*$/gm;
  for(const match of text.matchAll(mediaLines)){
    if(!match[1])continue;
    append(text.slice(start,match.index));
    parts.push(match[1].trim());
    start=match.index+match[0].length;
  }
  append(text.slice(start));
  return parts;
}

// Preserve deliberate chat rhythm without splitting lists, code or relay bodies.
export function naturalBubbleParts(value,{maxBubbles=0}={}){
  const text=bindVoiceLine(normalizeReplyNewlines(value)).trim();if(!text)return [];
  const requested=Number(maxBubbles),cap=Number.isFinite(requested)&&requested>0?Math.min(12,Math.round(requested)):Infinity;
  const parts=structuredReply(text)?structuredReplyParts(text):replyLines(text);
  const commands=/\[(?:发送|群发|定时|语音|表情包|图|图片|照片)[:：\]]|\uE200PIC/.test(text);
  return commands||parts.length<=cap?parts:[...parts.slice(0,cap-1),parts.slice(cap-1).join('\n')];
}

// An actual sticker image is its own message; QQ's inline face remains with text.
export function stickerMessageGroups(segments=[]){
  const mentions=segments.filter(s=>s.type==='at');const groups=[];let text=[];
  const flush=()=>{if(text.length){groups.push([...mentions,...text]);text=[];}};
  for(const segment of segments){if(segment.type==='at')continue;if(segment.type==='image'){flush();groups.push([...mentions,segment]);}else text.push(segment);}
  flush();return groups;
}

// Discard clear captions or attributed translations before a sticker reply is sent.
function stickerNarration(text){
  const line=text.trim().replace(/^(?:哈哈+|噗|笑死(?:我了)?)[，,、\s]+/u,'');
  const namesImage=/^(?:你(?:发的)?这|这|那[张幅只]|(?:图(?:片)?|画面|表情包)[里中]|它)/u.test(line);
  const gloss=/(?:读懂了|意思(?:就)?是|是不是(?:想表达|在说|替.{1,14}说)|(?:像是|好像|仿佛|就是)在说|(?:替|代替)[^。！？；]{1,12}说(?=[“"「『:：])|就是[“「"]|就是你刚才那句)/u;
  if((namesImage||/^是不是替/u.test(line))&&gloss.test(line))return true;
  const describesPose=/^(?:这(?:张|幅|只|个|位)?|(?:图(?:片)?|画面|表情包)[里中](?:的)?)[^我你，,。！？；]{1,14}?(?:吐着?舌头|伸着?舌头|摇着?尾巴|歪着?头|翻(?:了个)?白眼|瞪着|瞪了|眨着?眼|捂着?脸|张着?嘴|叉着?腰)/u;
  return describesPose.test(line)&&!/(?:逗笑|好笑|可爱|乐了|像我|我也|把我|害我|我倒|我反而|我想|想逗)/u.test(line);
}

function filterStickerSentences(text,omit,breaks){
  const paragraphs=normalizeReplyNewlines(text).split('\n');
  let changed=false;
  const visible=paragraphs.map(paragraph=>{
    const sentences=paragraph.match(/(?:“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|[^。！？!?；])+[。！？!?；]*|[。！？!?；]+/gu)||[];
    return sentences.filter(sentence=>{
      if(!omit(sentence))return true;
      changed=true;
      return false;
    }).join('').trim();
  }).filter(Boolean);
  return changed?visible.join(breaks):text;
}

export function stickerReplyText(text){
  return filterStickerSentences(text,stickerNarration,'\n\n');
}

function attributesStickerArtToSender(sentence){
  const spoken=sentence.replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"/gu,'').trim();
  const claim=/(?:你|您)(?:(?:亲手|自己|刚刚?|刚才|之前|亲自|又|还|也)\s*){0,3}(?:画(?=的|得|了|过|完|出来|这|那|它|姿势|动作|表情|图|画|[一两几三]张)|(?:手绘|绘制|创作|制作)(?=的|得|了|这|那|库存|作品|表情)|的(?:手绘库存|手绘作品|原创表情|画作))|出自你手/u.exec(spoken);
  if(!claim)return false;
  const lead=spoken.slice(0,claim.index);
  if(/(?:不是|分不清是不是|不确定是不是|不能说是|不能确定是|以为是?|误认为是?|误当成|误认成|错当成|误会成)\s*$/u.test(lead))return false;
  const openQuestion=/(?:是不是|(?:这|那)(?:张|幅|个)?(?:表情包?|动图|图)?\s*是|^是)?(?:你|您)(?:(?:自己|亲手)\s*)?(?:画|手绘|绘制|创作|制作)的(?:(?:吗|么|嘛)[？?]*|[？?]+)\s*$/u;
  return !openQuestion.test(spoken);
}

export function stickerAuthorshipReply(text,request=''){
  if(/逐字|原样|照抄|翻译|(?:图[上里中](?:的)?字)|读一下字/u.test(request))return text;
  const grounded=filterStickerSentences(text,attributesStickerArtToSender,'\n');
  if(grounded||grounded===text)return grounded;
  return /作者|出处|来源|谁(?:画|手绘|绘制|创作|做)/u.test(request)?'这张是你发来的表情包，作者我认不出来。':'[skip]';
}
