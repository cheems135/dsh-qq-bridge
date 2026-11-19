// Preserve deliberate chat rhythm without splitting explanations, lists or code.
export function naturalBubbleParts(value,{maxBubbles=0,richInput=false,automaticBreaks=true}={}){
  const text=String(value??'').trim();if(!text)return [];
  const requested=Number(maxBubbles),cap=Number.isFinite(requested)&&requested>0?Math.min(12,Math.round(requested)):Infinity;
  let parts=text.split(/\|\|\|/).map(s=>s.trim()).filter(Boolean);
  // Every line break is an intentional bubble boundary, including when
  // sentence-based splitting is disabled. Keep lists, code, URLs and media
  // commands intact.
  parts=parts.flatMap(part=>{
    const protectedPart=/```|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m.test(part)||/https?:\/\/|\[(?:发送|群发|定时|语音)[:：\]]|\uE200PIC/.test(part);
    return protectedPart?[part]:part.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  });
  const commands=/\[(?:发送|群发|定时|语音|表情包)[:：\]]|\uE200PIC/.test(text);
  const structured=/```|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m.test(text)||/https?:\/\//i.test(text);
  if(automaticBreaks&&parts.length===1&&cap>1&&!commands&&!structured&&text.length<=500){
    const lines=text.split(/\n+/).map(s=>s.trim()).filter(Boolean);
    if(lines.length>1&&lines.every(s=>s.length<=140))parts=lines;
    else if(richInput&&text.length<=240){
      const sentences=text.match(/[^。！？!?]+[。！？!?]+[”’"」』]*|[^。！？!?]+$/gu)||[text];
      if(sentences.length>1&&sentences.length<=6&&sentences.every(s=>s.length<=100))parts=sentences.map(s=>s.trim()).filter(Boolean);
    }
  }
  if(commands)return parts;
  return parts.length<=cap?parts:[...parts.slice(0,cap-1),parts.slice(cap-1).join('\n')];
}

// An actual sticker image is its own message; QQ's inline face remains with text.
export function stickerMessageGroups(segments=[]){
  const mentions=segments.filter(s=>s.type==='at');const groups=[];let text=[];
  const flush=()=>{if(text.length){groups.push([...mentions,...text]);text=[];}};
  for(const segment of segments){if(segment.type==='at')continue;if(segment.type==='image'){flush();groups.push([...mentions,segment]);}else text.push(segment);}
  flush();return groups;
}

// Sharing preserves each URL verbatim while allowing the surrounding speech
// to keep its deliberate paragraphs and conversational pauses.
export function shareBubbleParts(value){
 const text=String(value??'').trim();if(!text)return [];
 if(/```|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m.test(text))return naturalBubbleParts(text,{automaticBreaks:false});
 const result=[];
 for(const fragment of text.split(/(https?:\/\/[^\s<>]+)/gi)){
  if(!fragment.trim())continue;
  if(/^https?:\/\//i.test(fragment)){result.push(fragment);continue;}
  for(const paragraph of naturalBubbleParts(fragment,{automaticBreaks:false})){
   const sentences=paragraph.match(/[^。！？!?]+[。！？!?]+[”’"」』]*|[^。！？!?]+$/gu)||[paragraph];
   let current='',count=0;
   for(const sentence of sentences){if(current&&(current.length+sentence.length>120||count>=2)){result.push(current.trim());current='';count=0;}current+=sentence;count++;}
   if(current.trim())result.push(current.trim());
  }
 }
 return result;
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

export function stickerReplyText(text){
  const paragraphs=String(text??'').split(/\s*\|\|\|\s*|\r?\n/u);
  let changed=false;
  const visible=paragraphs.map(paragraph=>{
    const sentences=paragraph.match(/(?:“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|[^。！？!?；])+[。！？!?；]*|[。！？!?；]+/gu)||[];
    return sentences.filter(sentence=>{
      if(!stickerNarration(sentence))return true;
      changed=true;
      return false;
    }).join('').trim();
  }).filter(Boolean);
  return changed?visible.join('\n\n'):text;
}
