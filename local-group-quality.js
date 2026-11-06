import {requestedFormatting} from './local-reply.js';
import {repeatRequested} from './local-repetition.js';
export function localGroupReplyRisk(value,{request=''}={}){
 const text=String(value||'');
 if(requestedFormatting(request)||repeatRequested(request))return null;
 for(const c of text)if(c.length===1&&c.charCodeAt(0)>=0xd800&&c.charCodeAt(0)<=0xdfff)return {kind:'invalid-unicode',score:1};
 const replacement=(text.match(/\ufffd/g)||[]).length;
 if(replacement>=2&&!String(request).includes('\ufffd'))return {kind:'invalid-unicode',score:replacement};
 if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))return {kind:'control-characters',score:1};
 if(/<\|[^>\n]{1,80}\|>|<\/?think\b|\[(?:bridge_[A-Za-z0-9_]+)\]/i.test(text))return {kind:'internal-markers',score:1};
 const plain=s=>s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const cleaned=text.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/gm,'');
 const clauses=cleaned.split(/[。！？!?；;\n]+/).map(plain).filter(s=>s.length>=8);
 const counts=new Map();for(const clause of clauses)counts.set(clause,(counts.get(clause)||0)+1);
 const total=plain(cleaned).length;
 for(const [clause,n]of counts)if((n>=3||n>=2&&clause.length>=10)&&clause.length*n>=total*.6)return {kind:'generation-loop',score:n};
 // A long loop without sentence punctuation can also fill the output window.
 if(text.length<=80&&/^[哈呵嘿嘻啊哦嗯啦喵呜，。!?！？~～\s]+$/u.test(text))return null;
 if(/(.{8,100}?)\1{3,}/u.test(text.replace(/\s+/g,'')))return {kind:'generation-loop',score:4};
 return null;
}
