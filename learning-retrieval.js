import {memoryTokens} from './memory-engine.js';
const compact=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'');
const documents=new WeakMap();let lastQuery='',queryTokens=[];
export function learningNames(item){
 const named=[item.name,...item.aliases||[]].filter(v=>typeof v==='string');
 for(const match of String(item.summary||'').matchAll(/[“「『"]([^”」』"]{2,24})[”」』"]/g))named.push(match[1]);
 return [...new Set(named.map(compact).filter(s=>s.length>=2&&s.length<=24))];
}
export function learningMatch(item,query){
 const text=compact(query),names=learningNames(item),named=names.some(name=>text.includes(name))||(text.length>=2&&text.length<=24&&compact(item.summary).includes(text)&&memoryTokens(query).length>0);
 if(query!==lastQuery){lastQuery=query;queryTokens=[...new Set(memoryTokens(query))];}
 const signature=[item.name,...item.aliases||[],item.summary,item.when,item.example].filter(Boolean).join(' ');
 let cached=documents.get(item);if(!cached||cached.signature!==signature){cached={signature,tokens:new Set(memoryTokens(signature))};documents.set(item,cached);}
 const overlap=queryTokens.filter(token=>cached.tokens.has(token));
 // A named concept is useful even in a three-character message. Unnamed
 // recall needs multiple shared terms, rather than a generic common word.
 return {named,score:named?20+overlap.length:overlap.length>=2?overlap.length:0};
}
export function groundedLearningNames(candidate,source){
 const text=compact(source.text),names=[candidate.name,...(Array.isArray(candidate.aliases)?candidate.aliases:[])].filter(v=>typeof v==='string'&&compact(v).length>=2&&compact(v).length<=24&&text.includes(compact(v)));
 return {name:names[0]||'',aliases:[...new Set(names.slice(1))].slice(0,6)};
}
