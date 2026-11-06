// Local-only decoding. Do not change the shared/API image director.
export function localPromptObject(response,{review=false}={}){
 const message=response?.choices?.[0]?.message||response?.message||response;
 if(message?.refusal||response?.choices?.[0]?.finish_reason==='content_filter')throw Object.assign(Error('模型没有提供可用的图片提示词，本次未提交工作流'),{code:'LOCAL_PROMPT_REFUSED'});
 if(message?.tool_calls?.length)throw Error('画面提示词准备返回了工具调用，未执行');
 const content=typeof response==='string'?response:message?.content;
 const text=Array.isArray(content)?content.filter(p=>p?.type==='text').map(p=>p.text||'').join(''):String(content||'');
 if(!text.trim())throw Error('模型没有返回提示词正文，尚未提交工作流');
 if(text.length>16000)throw Error('模型提示词超过16000字，未截断或提交');
 const clean=s=>s.trim().replace(/^```(?:json|text)?\s*|\s*```$/g,'');
 let parsed=JSON.parse(clean(text));
 if(typeof parsed==='string'){
  const inner=clean(parsed);try{parsed=JSON.parse(inner);}catch{parsed=review?parsed:{prompt:inner};}
 }
 if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed.action||parsed.tool_calls)throw Error('提示词返回结构不正确，未作为工具执行');
 if(!review){
  if(/^(?:抱歉|很抱歉|对不起|我(?:无法|不能)(?:帮助|协助|提供)|sorry\b|i(?:'m| am)? sorry\b|i (?:cannot|can't|am unable to) (?:help|assist|provide|generate))/i.test(String(parsed.prompt||'')))throw Object.assign(Error('模型没有提供可用的图片提示词，本次未提交工作流'),{code:'LOCAL_PROMPT_REFUSED'});
  parsed={...parsed};
  for(const key of ['prompt','style','negativePrompt','referenceIdentity'])if(typeof parsed[key]==='string')parsed[key]=parsed[key].trim();
  if(/^(?:none|null|n\/a|无|无需|没有|不需要)$/i.test(parsed.negativePrompt||''))parsed.negativePrompt='';
 }
 return {value:parsed,raw:text};
}
export function localPromptLanguageMismatch(value,language,characterName=''){
 const body=['prompt','style','negativePrompt'].map(key=>String(value?.[key]||'')).join(' ').split(characterName||'\u0000').join(language==='en'?'She':characterName);
 if(!body.trim())return false;
 return language==='en'?/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(body):!/[\p{Script=Han}]/u.test(body);
}
