import {randomUUID} from 'node:crypto';
const rawRequest=value=>String(value||'').split(/\n\[引用消息\]/)[0].trim();
export function localGroupSendRequest(value=''){
 const text=rawRequest(value);
 if(/^(?:你|她|他)?(?:刚才|刚刚|之前|上次|记得|有没有|是否|是不是|去过)|(?:发了什么|说了什么|发过什么|说过什么)/.test(text)&&!/(?:现在重新|重新去|再去|再发一次)/.test(text))return false;
 if(/^(?:例如|假如|引用|他说|她说)|(?:不要|不用|别|无需|先别|停止|取消).{0,12}(?:群|发|冒泡)|(?:为什么|怎么|如何).{0,12}(?:不能|没有|没|功能|实现)|(?:要求|让).{0,3}她/.test(text))return false;
 return /(?:去|到|在|向|往|给).{0,24}(?:群里|群聊|群中|群内|群(?:号)?\s*[:：]?\s*\d{5,}|(?:这个|那个|指定的?)群|\d{5,}\s*群)[\s\S]{0,60}(?:冒(?:个|一下)?泡?|发(?:个|条|一条|一下|一)?(?:消息|话|言|句)|说(?:句话|一声|一下|一句)|打(?:个)?招呼)|(?:帮我|替我).{0,8}(?:发|说).{0,20}(?:群里|群聊|群内)/.test(text);
}
export async function executeLocalGroupSend({request,messages,tools,model,signal,onProgress=()=>{}}){
 const receipts=[],attachments=[];let execution=null;
 const call=async args=>{
  signal?.throwIfAborted();const id=randomUUID();onProgress({phase:'invocation',invocation:{id,tool:'bridge_tools',arguments:{action:'call',name:'bridge_life_qq',arguments:args},status:'started'}});
  try{const value=await tools.bridge_tools.execute({action:'call',name:'bridge_life_qq',arguments:args},{signal});signal?.throwIfAborted();if(value?.ok===false)throw Error(value.error||'QQ工具没有完成');receipts.push({tool:'bridge_tools',routedTool:'bridge_life_qq',ok:true,informational:args.action==='targets',data:value});onProgress({phase:'invocation',invocation:{id,tool:'bridge_tools',arguments:{action:'call',name:'bridge_life_qq',arguments:args},status:'returned',result:value}});return value;}
  catch(error){onProgress({phase:'invocation',invocation:{id,tool:'bridge_tools',arguments:{action:'call',name:'bridge_life_qq',arguments:args},status:'failed',error:String(error.message)}});throw error;}
 };
 const finish=text=>({text,receipts,attachments,execution,toolRounds:0,mediaCount:0});
 if(!tools.bridge_tools)return finish('这次没有接上群消息发送工具，还没往群里发。');
 const listing=await call({action:'targets'}),groups=(listing.targets||[]).filter(t=>/^group:\d+$/.test(t.key||''));
 const text=rawRequest(request),numbers=[...text.matchAll(/(?<!\d)(\d{5,20})(?!\d)/g)].map(m=>'group:'+m[1]),known=numbers.filter(key=>groups.some(g=>g.key===key)),ids=[...new Set(known.length?known:numbers)];
 const named=groups.filter(g=>g.name&&g.name!=='已允许群聊'&&text.includes(g.name));
 const selected=ids.length===1?groups.find(g=>g.key===ids[0]):named.length===1?named[0]:!ids.length&&!named.length&&groups.length===1?groups[0]:null;
 if(!selected)return finish(!groups.length?'现在没有可发送的已允许群聊，这条还没发出去。先在群聊白名单里开启目标群吧。':ids.length?'你指定的群不在当前允许发送的群列表里，这条还没发。':'你想让我去哪个群冒泡？告诉我群名或群号，我再发；现在还没有发出去。');
 const quoted=text.match(/(?:发|说)(?:送)?(?:一|个|条|句|消息|内容|文字|是|为|：|:|\s){0,8}[“「"]([^”」"\n]{1,1200})[”」"]/);
 const generated=quoted?quoted[1]:await model({messages:[...messages.filter(m=>m.role==='system'),{role:'system',content:'当前任务是为指定QQ群写实际要发送的一条群消息。只输出发给群友的正文，用人设平常说话语气；不对私聊用户汇报、不声称已发送、不编造群友反应、不泄露私聊亲密内容或私人资料。用户指定原文时保留原文。不要动作旁白、JSON或工具调用。'},{role:'user',content:JSON.stringify({request:text,target:selected.name||selected.key})}],tools:[],protocol:'只输出准备实际发到群里的消息正文。',purpose:'qq-send-content',outputTokens:200,signal,onProgress});
 const message=generated?.choices?.[0]?.message||generated?.message||generated;
 let body=typeof generated==='string'?generated:String(message?.content||'');
 // No group history or external source was read in this send-only path.
 // A vague greeting must not invent other members, events or recent browsing.
 if(/(?:我|这就|现在就).{0,10}去群|(?:刚|已经|刚才|刚刚).{0,8}(?:看到|看见|听说|听到)|群里.{0,12}(?:有人|大家|群友).{0,12}(?:说|问|聊)|(?:早上好|大家早|早安|晚安)|今天.{0,16}(?:新闻|活动|开业)|听说/.test(body)){if(/冒(?:个)?泡|打(?:个)?招呼/.test(text))body='来冒个泡，大家在聊什么呀？';else throw Error('群消息包含没有读取依据的群友或活动信息，这次没有发送');}
 if(message?.tool_calls?.length||!body.trim()||body.length>1200||/<think|```|[{}]|(?:已经|刚才).{0,8}(?:发|群)|群友.{0,8}(?:说|问|回复)/.test(body))throw Error('群消息正文没有整理成功，这次没有发送');
 if(/[（(][^）)]{0,100}(?:动作|脸红|眨眼|转身|轻笑|心虚|扭过头)[^）)]*[）)]/.test(body))throw Error('群消息正文含动作旁白，这次没有发送');
 execution={target:selected.key,name:selected.name||'',text:body.trim(),status:'not-submitted',verified:false};
 const sent=await call({action:'send',target:selected.key,text:body.trim()});
 if(!sent.deliveryId)throw Error('群消息发送没有取得任务编号，不能确认发出');
 execution.deliveryId=sent.deliveryId;execution.deliveryIds=sent.deliveryIds||[sent.deliveryId];execution.status='pending';
 const status=await call({action:'status',deliveryId:sent.deliveryId});
 execution.status=status.status||'unknown';execution.verified=status.verified===true;
 if(status.status==='sent')return finish(status.verified?'这条群消息已经发出，也在目标群的记录里核对到了。群友有没有看到或回复，目前还不知道。':'QQ 已确认接收这条群消息，群里的读回核对还在进行。还不能说群友已经看到。');
 if(status.status==='failed')return finish('这条群消息发送失败了，还没成功发出去。原因留在调用记录里了。');
 return finish('这条群消息已经提交到发送队列，还没拿到 QQ 的发送确认；我现在不能说已经发出。');
}
