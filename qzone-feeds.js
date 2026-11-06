// Read-only feeds3 fallback. Only exact, observed post and root comment IDs
// can become reply targets; embedded previews are not a full comment history.
const decode=s=>String(s||'').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,v)=>{
 if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
 return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[v.toLowerCase()];
});
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3])]));
const text=html=>decode(String(html).replace(/<script\b[^]*?<\/script\s*>|<style\b[^]*?<\/style\s*>/gi,'').replace(/<br\s*\/?>/gi,' ').replace(/<img\b[^>]*>/gi,tag=>attrs(tag).alt||'').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
const classList=tag=>[...tag.matchAll(/\bclass\s*=\s*["']([^"']*)["']/gi)].flatMap(m=>m[1].split(/\s+/)).filter(Boolean);
function elementAt(html,start,tag){
 const tags=new RegExp(`<\\/?${tag}\\b[^>]*>`,'gi');tags.lastIndex=start;let depth=0;
 for(let match;(match=tags.exec(html));){
  if(match[0][1]==='/')depth-=1;else depth+=1;
  if(depth===0)return{html:html.slice(start,tags.lastIndex),end:tags.lastIndex};
 }
 return null;
}
function postBody(html,marker){
 const start=marker.index+marker[0].length,boundaries=[
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:f-single-foot|mod-comments|mod-commnets|comments-box|comments-list)\b[^"']*["'][^>]*>/gi,
  /<ul\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:comments-list|comments-box)\b[^"']*["'][^>]*>/gi,
  /<li\b[^>]*\bdata-type\s*=\s*["'](?:commentroot|replyroot)["'][^>]*>/gi,
 ];
 let end=html.length;
 for(const pattern of boundaries)for(const match of html.matchAll(pattern))if(match.index>=start)end=Math.min(end,match.index);
 return html.slice(start,end);
}
function postInfo(body){
 // Compact wupfeed cards put the real post in txt-box-title; f-info may
 // instead be a like-event label. Only this exact post fragment is inspected.
 for(const match of body.matchAll(/<p\b[^>]*>/gi)){
  if(!classList(match[0]).includes('txt-box-title'))continue;
  const element=elementAt(body,match.index,'p');if(!element)return '';
  let inner=element.html.slice(match[0].length).replace(/<\/p\s*>$/i,'');
  inner=inner.replace(/^\s*<a\b[^>]*class\s*=\s*["'][^"']*\bnickname\b[^"']*["'][^>]*>[^]*?<\/a>\s*(?:<span\b[^>]*>[^]*?<\/span>)?\s*(?:[:：])?\s*(?:<br\s*\/?>)?/i,'');
  return inner.replace(/^\s*[:：]\s*/,'');
 }
 for(const match of body.matchAll(/<div\b[^>]*>/gi)){
  if(!classList(match[0]).includes('f-info'))continue;
  return elementAt(body,match.index,'div')?.html??'';
 }
 return '';
}

function postImageCount(body){
 let count=0,unknown=false,sawBox=false,coveredUntil=-1;
 for(const match of body.matchAll(/<div\b[^>]*>/gi)){
  if(match.index<coveredUntil||!classList(match[0]).includes('img-box'))continue;
  sawBox=true;const box=elementAt(body,match.index,'div');if(!box){unknown=true;continue;}coveredUntil=box.end;
  const anchors=[...box.html.matchAll(/<a\b[^>]*>/gi)].filter(item=>classList(item[0]).includes('img-item'));
  if(!anchors.length){unknown=true;continue;}
  for(const anchor of anchors){
   const item=elementAt(box.html,anchor.index,'a');
   if(!item||!/<img\b[^>]*>/i.test(item.html))unknown=true;
   else count+=1;
  }
 }
 if(!sawBox&&/<a\b[^>]*\bclass\s*=\s*["'][^"']*\bimg-item\b[^"']*["'][^>]*>/i.test(body))unknown=true;
 return unknown?null:count;
}
export function feedsComments(value,{tid,uin,includeReplies=false}){
 const entries=value.data?.data||value.data?.feeds||[];const rows=[],seen=new Set();let matched=false;
 for(const entry of Array.isArray(entries)?entries:[]){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||typeof entry.html!=='string')continue;
  const html=entry.html;if(html.length>2*1024*1024)continue;
  const markers=[...html.matchAll(/<[^>]+\bname\s*=\s*["']feed_data["'][^>]*>/gi)].map(m=>attrs(m[0]));
  // Ambiguous multi-post fragments are deliberately excluded.
  if(markers.length!==1||markers[0]['data-uin']!==String(uin)||markers[0]['data-tid']!==String(tid))continue;matched=true;
  const starts=[...html.matchAll(/<li\b[^>]*\bdata-type\s*=\s*["'](?:commentroot|replyroot)["'][^>]*>/gi)];
  let parent=null;
  for(let i=0;i<starts.length;i++){
   const a=attrs(starts[i][0]),reply=a['data-type']==='replyroot';
   if(!reply)parent=/^\d{1,30}$/.test(a['data-tid']||'')&&/^\d{5,20}$/.test(a['data-uin']||'')?{id:a['data-tid'],uin:a['data-uin']}:null;
   if(reply&&(!includeReplies||!parent))continue;
   const id=a['data-tid'],author=a['data-uin'];if(!/^\d{1,30}$/.test(id||'')||!/^\d{5,20}$/.test(author||'')||seen.has([id,author,reply?parent?.id:'root'].join(':')))continue;
   const body=html.slice(starts[i].index+starts[i][0].length,starts[i+1]?.index??html.length);
   const contentWithControls=body.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bcomments-content\b[^"']*["'][^>]*>([^]*?)<\/div\s*>/i)?.[1];if(contentWithControls===undefined)continue;
   const content=contentWithControls.split(/<div\b[^>]*class\s*=\s*["'][^"']*\bcomments-op\b[^"']*["'][^>]*>/i)[0];
   const bodyText=content.replace(/^(?:\s|&nbsp;)*<a\b[^>]*>[^]*?<\/a>(?:(?:\s|&nbsp;)*(?:回复|回覆)(?:\s|&nbsp;)*<a\b[^>]*>[^]*?<\/a>)?(?:\s|&nbsp;)*(?:[:：]|&#0*58;|&#x0*3a;)(?:\s|&nbsp;)*/i,'');
   const plain=text(bodyText),name=a['data-nick']||'';let message=plain;
   if(name&&message.startsWith(name)){
    message=message.slice(name.length).trimStart();
    message=message.replace(/^(?:回复|回覆)\s+.{1,120}?\s*[:：]\s*/,'').replace(/^[:：]\s*/,'');
   }
   if(!message)continue;seen.add([id,author,reply?parent?.id:'root'].join(':'));rows.push({id,uin:author,name:name.slice(0,80),text:message.slice(0,1500),at:0,source:'feeds3-preview',...(includeReplies?{depth:reply?1:0,parentId:reply?parent.id:null,parentUin:reply?parent.uin:null}: {})});
  }
 }
 return {matched,rows,coverage:'空间动态流实际内嵌的一级评论预览，可能不含全部评论与楼中楼；未出现不等于不存在'};
}

export function feedsPost(value,{tid,uin}){
 for(const entry of Array.isArray(value?.data?.data)?value.data.data:[]){
  if(!entry||typeof entry.html!=='string'||entry.html.length>2*1024*1024)continue;
  const markers=[...entry.html.matchAll(/<[^>]+\bname\s*=\s*["']feed_data["'][^>]*>/gi)];
  if(markers.length!==1)continue;
  const marker=attrs(markers[0][0]);
  if(marker['data-uin']!==String(uin)||marker['data-tid']!==String(tid))continue;
  const body=postBody(entry.html,markers[0]);
  return {matched:true,text:text(postInfo(body)),imageCount:postImageCount(body),coverage:'已在当前账号自己的空间动态流读回该动态；不代表对方已收到或读过'};
 }
 return {matched:false,text:'',imageCount:null,coverage:'当前空间列表尚未覆盖目标动态，不能据此判定发布失败'};
}
