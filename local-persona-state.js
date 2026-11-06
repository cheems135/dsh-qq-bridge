import {createHash} from 'node:crypto';
const colorPattern='(?:蓝黑|黑白|粉白|浅蓝|深蓝|浅粉|淡粉|浅紫|米白|乳白|纯白|白|粉|蓝|黑|红|紫|绿|黄|灰|棕|橙)色';
const garmentPattern='(?:连衣裙|衣服|衣着|穿着|穿的|上衣|裙子|外套|衬衫|卫衣|睡衣|服装|毛衣|T恤|t恤|裤子)';
const clothes=new RegExp(garmentPattern);
const otherObjects=/(?:头发|头饰|发色|眼睛|瞳|鞋|背景|天空|花|窗帘|窗户|桌|墙|包包|帽子|手机|头绳)/;
function clothingColors(value,{bare=false}={}){
 const text=String(value||''),found=[];
 for(const part of text.matchAll(/[^，,。！？!?；;\n]+/g)){
  const clause=part[0],nouns=[...clause.matchAll(new RegExp(garmentPattern,'g'))];
  for(const match of clause.matchAll(new RegExp(colorPattern,'g'))){
   const distance=n=>Math.min(Math.abs(n.index-match.index-match[0].length),Math.abs(match.index-n.index-n[0].length));
   const noun=nouns.map(n=>({n,d:distance(n)})).sort((a,b)=>a.d-b.d)[0]?.n;
   const closerObject=[...clause.matchAll(new RegExp(otherObjects.source,'g'))].some(n=>!noun||distance(n)<distance(noun));
   const span=noun?clause.slice(Math.min(noun.index,match.index),Math.max(noun.index+noun[0].length,match.index+match[0].length)):clause;
   const belongs=noun&&!closerObject&&span.length<=36&&!otherObjects.test(span)&&!/(?:你|他|她|别人|旁边的人)(?:的)?[^，,。]{0,6}$/.test(clause.slice(0,noun.index));
   if(belongs||bare&&!nouns.length&&clause.trim().length<=18&&!otherObjects.test(clause)&&!/(?:你|他|她|别人)的/.test(clause))found.push({color:match[0],garment:noun?.[0]||'',index:part.index+match.index,length:match[0].length});
  }
 }
 return found;
}
export function outfitColor(text=''){return clothingColors(text)[0]?.color||'';}
export function asksOutfit(text=''){return clothes.test(text)&&/(?:什么|啥|哪|颜色|色的|色呀|色啊|色呢|穿着)/.test(text)&&!/(?:帮我|给我|为我).{0,6}(?:买|挑|选)|你觉得我|我的衣服|昨天|前天|上次|以前|之前穿/.test(text);}
export function personaStateId(account,persona){return createHash('sha256').update(JSON.stringify([account||'',persona.id||'',persona.prompt||'',persona.preset||''])).digest('hex');}
export function sharedPersonaOutfit({stored,day,scene={},history=[],request='',owner=false,baseline=''}={}){
 let next=stored?.day===day&&stored.outfit?{...stored}:null;
 const outfit=String(scene.outfit||'').trim().slice(0,200),reliable=outfit&&!/^(?:沿用|保持|同前|同上|不变|未定|待定|未知|默认|当前角色形象)/.test(outfit);
 const sceneKey=reliable?createHash('sha256').update(JSON.stringify([scene.date||day,scene.phase||'',scene.start??'',scene.requestId||'',outfit])).digest('hex'):'';
 // Bind old records once; a later schedule slot or wardrobe edit can replace
 // the shared state, while unchanged scenes do not overwrite confirmed replies.
 if(next&&sceneKey&&(next.sceneKey&&next.sceneKey!==sceneKey||!next.sceneKey&&next.source==='schedule'&&next.outfit!==outfit))next={day,outfit,source:'schedule'};
 const explicit=owner&&/(?:换上|换成|穿上|改穿|穿)/.test(request)&&!/(?:不要|别|不想|不许).{0,5}(?:穿|换)|(?:如果|假如|假设|要是)/.test(request)?String(request).match(new RegExp(colorPattern+'.{0,12}'+garmentPattern))?.[0]:'';
 if(explicit)next={day,outfit:explicit,source:'owner-request'};
 if(!next){
  const recent=[...history].sort((a,b)=>Number(String(b.chat).startsWith('private:'))-Number(String(a.chat).startsWith('private:'))||b.time-a.time).find(r=>r.dir==='out'&&(!r.delivery||r.delivery==='sent')&&asksOutfit(r.request||'')&&clothingColors(r.text,{bare:true}).length);
  if(recent)next={day,outfit:clothingColors(recent.text,{bare:true})[0].color+'的衣服',source:'recent-confirmed-reply'};
  else if(reliable)next={day,outfit,source:'schedule'};
  else if(outfitColor(baseline))next={day,outfit:outfitColor(baseline)+'的衣服',source:'persona'};
 }
 if(next&&sceneKey)next.sceneKey=sceneKey;
 return next||{day,outfit:'',source:'unknown'};
}
export function personaStateHint(state){return '【角色当前衣着：私聊和群聊共用，同一时刻以此为准】'+(state.outfit?'当前衣着：'+state.outfit+'。除本人明确要求换装或新的可靠状态，不因换群、换说话对象或旧聊天改色；不复述来源和私聊。':'当前衣着颜色未确认。可以自然说还没定，不猜颜色、不把人设参考图当今天穿着。');}
export function alignOutfitReply(reply,request,state){
 if(!asksOutfit(request))return reply;
 const expected=clothingColors(state?.outfit||'',{bare:true});if(!expected.length)return reply;
 const matches=clothingColors(reply,{bare:true});let text=String(reply);
 for(const match of matches.reverse()){
  const exact=expected.find(e=>e.garment&&e.garment===match.garment),generic=/^(?:衣服|衣着|穿着|穿的|服装)?$/.test(match.garment);
  const replacement=exact?.color||(expected.length===1&&(generic||/^(?:衣服|衣着|穿着|穿的|服装)?$/.test(expected[0].garment))?expected[0].color:'');
  if(replacement&&replacement!==match.color)text=text.slice(0,match.index)+replacement+text.slice(match.index+match.length);
 }
 return text;
}
