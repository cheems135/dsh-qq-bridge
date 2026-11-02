// Preserve deliberate chat rhythm without splitting explanations, lists or code.
export function naturalBubbleParts(value,{maxBubbles=0,richInput=false,automaticBreaks=true}={}){
  const text=String(value??'').trim();if(!text)return [];
  const requested=Number(maxBubbles),cap=Number.isFinite(requested)&&requested>0?Math.min(12,Math.round(requested)):Infinity;
  let parts=text.split(/\|\|\|/).map(s=>s.trim()).filter(Boolean);
  // Every line break is an intentional bubble boundary, including when
  // sentence-based splitting is disabled. Keep lists, code, URLs and media
  // commands intact.
  parts=parts.flatMap(part=>{
    const protectedPart=/```|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m.test(part)||/https?:\/\/|\[(?:发送|群发|定时|语音|表情包)[:：\]]|\uE200PIC/.test(part);
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
