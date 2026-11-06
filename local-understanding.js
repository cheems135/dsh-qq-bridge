// This candidate is context data only. The original user text remains the
// authority for memory, permissions and every actual tool action.
export function understandingCandidate(result,original,context=''){
 const message=result?.choices?.[0]?.message||result?.message||result;
 if(message?.tool_calls?.length)return '';
 const raw=typeof result==='string'?result:String(message?.content||'');
 try{
  const value=JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g,'')),text=typeof value.meaning==='string'?value.meaning.trim():'';
  if(value.uncertain!==false||!text||text===original||text.length>Math.max(120,original.length*2+40)||/[\r\n<>]/.test(text))return '';
  const available=original+'\n'+context;
  if((text.match(/https?:\/\/\S+|\d{3,}/g)||[]).some(term=>!available.includes(term)))return '';
  const operations=/执行|运行|删除|发送|发布|付款|转账|授权|密码|登录|重置|关机/g;
  if((text.match(operations)||[]).some(term=>!original.includes(term)))return '';
  return text;
 }catch{return '';}
}

export async function understandLocalTurn(messages,{request,model,signal,onProgress=()=>{}}={}){
 const prior=messages.filter(row=>['user','assistant'].includes(row.role)).slice(0,-1).slice(-4).map(row=>({role:row.role,text:typeof row.content==='string'?row.content.slice(0,500):''}));
 if(prior.length<2||request.length>180||!/[\p{Script=Han}]/u.test(request))return '';
 // Clear choices already have an explicit anchor in the preserved dialogue.
 if(/^(?:那就|就选|就|选|要)(?:第)?[一二三四五六七八九十两\d]+个(?:[，。！、,\s]|$)/.test(request))return '';
 const context=JSON.stringify(prior);onProgress({phase:'understanding'});
 const response=await model({messages:[{role:'system',content:'你只做当前聊天的语义理解，不扮演角色、不回复用户、不执行工具。结合真实前文，把当前输入中的指代、明显错别字和谐音还原成一句通顺的实际意思。不评论错字、不添加新事实、不替用户做决定或授权；不能确定则uncertain=true。只输出紧凑JSON：{"meaning":"本轮实际意思","uncertain":false}。'},{role:'user',content:JSON.stringify({context:prior,current:request})}],tools:[],protocol:'只输出包含meaning和uncertain的JSON，不输出思考或解释。',signal,outputTokens:96,purpose:'understanding',onProgress});
 return understandingCandidate(response,request,context);
}
