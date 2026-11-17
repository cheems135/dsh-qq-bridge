// Literal relevance is evidence of a match, never proof of factual accuracy.
// The page title and query echo are excluded so a search form cannot validate itself.
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
export function searchAnchors(query){
 const words=String(query||'').replace(/这个梗|什么梗|是什么意思|是什么梗|帮我|搜索一下|搜索|查询|查找|官方|新手|入门|教程|网站|梗/g,' ').match(/[\p{Script=Han}]{2,}|[a-zA-Z][a-zA-Z0-9+#.-]{2,}/gu)||[];
 return [...new Set(words.map(normalize).filter(w=>w.length>=2))];
}
export function checkSearchEvidence(result,query){
 if(result?.ok===false)return result;
 const anchors=searchAnchors(query),links=Array.isArray(result?.links)?result.links:[];
 const body=String(result?.text||result?.body||result?.excerpt||'').split('\n').filter(line=>normalize(line)!==normalize(query)).join('\n');
 const evidence=normalize([body,...links.map(l=>[l.title,l.description,l.snippet].filter(Boolean).join(' '))].join('\n'));
 if(!anchors.length||!links.length)return {...result,relevance:{status:'unverified',anchors,coverage:'词面证据不足，不能确认找到指定信息'}};
 const matched=anchors.filter(a=>evidence.includes(a));
 // For a long continuous Chinese question, adjacent pairs provide a weak clue;
 // only a completely unrelated page is rejected. Do not require exact phrasing.
 const partial=anchors.some(a=>a.length>=8&&[...a].slice(0,-1).some((_,i)=>evidence.includes(a.slice(i,i+2))));
 if(matched.length||partial)return {...result,relevance:{status:matched.length?'literal-match':'partial',anchors,matched,coverage:'只核对词面相关性；摘要不等于全文，仍需核对来源，不能擅自纠正用户原词'}};
 const relevance={status:'unrelated',query,anchors,title:String(result?.title||''),links:links.slice(0,10),excerpt:body.slice(0,1800)};
 throw Object.assign(Error('SEARCH_UNRELATED：搜索页面返回的内容与“'+String(query)+'”没有匹配，尚未找到指定信息，不能据此说用户打错字或编造解释。'),{code:'SEARCH_UNRELATED',evidence:relevance});
}
export function quotedSearchRetry(query){
 const anchors=searchAnchors(query);if(anchors.length!==1||/["“”]/.test(query))return '';
 const anchor=anchors[0];if(anchor.length>80)return '';
 const original=String(query).match(new RegExp(anchor,'iu'))?.[0]||anchor;
 const quoted='"'+original+'"'+(/梗/.test(query)?' 梗':'');return quoted===query?'':quoted;
}
