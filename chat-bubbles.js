// Preserve deliberate chat rhythm without splitting explanations, lists or code.
export function naturalBubbleParts(value,{maxBubbles=3,richInput=false}={}){
  const text=String(value??'').trim();if(!text)return [];
  const cap=Math.min(4,Math.max(1,Math.round(Number(maxBubbles)||1)));
  let parts=text.split(/\|\|\|/).map(s=>s.trim()).filter(Boolean);
  const commands=/\[(?:发送|群发|定时|语音|表情包)[:：\]]|\uE200PIC/.test(text);
  const structured=/```|^\s*(?:#{1,6}\s|[-*•]\s|\d+[.)、]\s?)/m.test(text)||/https?:\/\//i.test(text);
  if(parts.length===1&&cap>1&&!commands&&!structured&&text.length<=500){
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
