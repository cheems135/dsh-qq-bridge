// Read-only feeds3 fallback. Only exact, observed post and root comment IDs
// can become reply targets; embedded previews are not a full comment history.
const decode=s=>String(s||'').replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi,(_,v)=>{
 if(v[0]==='#'){const n=v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1));return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}
 return {amp:'&',quot:'"',apos:"'",lt:'<',gt:'>',nbsp:' '}[v.toLowerCase()];
});
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3])]));
const text=html=>decode(String(html).replace(/<script\b[^]*?<\/script\s*>|<style\b[^]*?<\/style\s*>/gi,'').replace(/<img\b[^>]*>/gi,tag=>attrs(tag).alt||'').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim();
export function feedsComments(value,{tid,uin}){
 const entries=value.data?.data||value.data?.feeds||[];const rows=[],seen=new Set();let matched=false;
 for(const entry of Array.isArray(entries)?entries:[]){
  const html=String(entry.html||'');if(html.length>2*1024*1024)continue;
  const markers=[...html.matchAll(/<[^>]+\bname\s*=\s*["']feed_data["'][^>]*>/gi)].map(m=>attrs(m[0]));
  // Ambiguous multi-post fragments are deliberately excluded.
  if(markers.length!==1||markers[0]['data-uin']!==String(uin)||markers[0]['data-tid']!==String(tid))continue;matched=true;
  const starts=[...html.matchAll(/<li\b[^>]*\bdata-type\s*=\s*["'](?:commentroot|replyroot)["'][^>]*>/gi)];
  for(let i=0;i<starts.length;i++){
   const a=attrs(starts[i][0]);if(a['data-type']!=='commentroot')continue;
   const id=a['data-tid'],author=a['data-uin'];if(!/^\d{1,30}$/.test(id||'')||!/^\d{5,20}$/.test(author||'')||seen.has(id))continue;
   const body=html.slice(starts[i].index+starts[i][0].length,starts[i+1]?.index??html.length);
   const content=body.match(/<div\b[^>]*class\s*=\s*["'][^"']*\bcomments-content\b[^"']*["'][^>]*>([^]*?)<\/div\s*>/i)?.[1];if(content===undefined)continue;
   const plain=text(content),name=a['data-nick']||'';let message=plain;
   if(name&&message.startsWith(name))message=message.slice(name.length).replace(/^\s*[:：]\s*/,'');
   if(!message)continue;seen.add(id);rows.push({id,uin:author,name:name.slice(0,80),text:message.slice(0,1500),at:0,source:'feeds3-preview'});
  }
 }
 return {matched,rows,coverage:'空间动态流实际内嵌的一级评论预览，可能不含全部评论与楼中楼；未出现不等于不存在'};
}
