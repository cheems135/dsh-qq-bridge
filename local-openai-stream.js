export async function readOpenAIStream(response,{onText=()=>{},signal}={}){
 let pending='',content='',size=0,finished=false;const calls=[];const decoder=new TextDecoder();
 const line=value=>{
  if(!value.startsWith('data:'))return;const data=value.slice(5).trim();if(!data)return;if(data==='[DONE]'){finished=true;return;}
  const item=JSON.parse(data);if(item.error)throw Error(String(item.error.message||'模型流式返回异常'));
  const choice=item.choices?.[0];if(!choice)return;if(choice.finish_reason)finished=true;
  const delta=choice.delta||{};
  if(typeof delta.content==='string'){content+=delta.content;onText(delta.content);}
  for(const call of delta.tool_calls||[]){const index=Number(call.index)||0;if(index<0||index>23)throw Error('模型返回的工具数量过多');const row=calls[index]||={id:'',type:'function',function:{name:'',arguments:''}};if(call.id)row.id=call.id;if(call.function?.name)row.function.name+=call.function.name;if(call.function?.arguments)row.function.arguments+=call.function.arguments;}
 };
 for await(const chunk of response.body){if(signal?.aborted)throw signal.reason;size+=chunk.length;if(size>1024*1024)throw Error('模型流式回复过大');pending+=decoder.decode(chunk,{stream:true});let index;while((index=pending.indexOf('\n'))>=0){line(pending.slice(0,index).replace(/\r$/,''));pending=pending.slice(index+1);}}
 pending+=decoder.decode();if(pending.trim())line(pending.trim());if(!finished)throw Error('模型连接中断，流式回复未完整结束');
 return {choices:[{message:{role:'assistant',content,...(calls.length?{tool_calls:calls.filter(Boolean)}:{})},finish_reason:'stop'}]};
}
