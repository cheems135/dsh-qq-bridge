const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={pending:'准备中',waiting_service:'等待服务',queued:'等待执行',sending:'发送中',started:'执行中',submitted:'已提交',running:'执行中',
  returned:'已返回',sent:'QQ 已接收',generated:'生成完成',failed:'失败',error:'失败',cancelled:'已取消',rejected:'被拒绝',unknown:'待核对',deferred:'暂缓',completed:'完成',silent:'未发送'};
const date=at=>Number(at)>0?new Date(Number(at)).toLocaleString():'时间未记录';
export const capabilityPages={chat:'model',image:'imagegen',speech:'voice',video:'videogen',sing:'apisong'};
// Repair copy/paste markup only. Shell syntax still goes through strict parsing.
export function normalizeRequestExample(value){
  return String(value||'').trim().replace(/^```(?:bash|sh|shell|powershell|cmd|curl|json)?\s*\n?|\n?```$/gi,'')
    .replace(/https?\\?:\/\/[^\s'"<>]+/gi,url=>url.replace(/\\([:./])/g,'$1'))
    .replace(/^[ \t]*\\+(?=--)/gm,'')
    .replace(/\\+\r?\n/g,'\n')
    .replace(/^(?:[ \t]*&#(?:x20|32);)+/gmi,' ');
}
// Bind only a unique, explicitly labelled role. Time and separation controls
// mentioning a voice are not audio uploads, and reference timing stays fixed.
export function inferAudioExampleBindings(fields,kind){
  const candidates={song_audio:[],reference_audio:[],text:[]};
  for(const [index,row]of fields.entries()){
    const name=String(row.fieldName||''),label=String(row.description||row.label||'')+' '+name;
    if(/audio|AUDIO/i.test(name+' '+(row.fieldType||row.type||''))&&!/时间|开始|结束|start|end|duration|分离|separat/i.test(label)){
      if(/音色|参考(?:人声|声音|音频)|reference|ref[_ ]?audio|voice|timbre/i.test(label))candidates.reference_audio.push(index);
      else if(/原曲|歌曲|音乐|music|song|source[_ ]?audio/i.test(label))candidates.song_audio.push(index);
    }
    if(/^(?:text|text_content|input_text|lyrics)$/i.test(name))candidates.text.push(index);
  }
  const bindings={};
  for(const [role,rows]of Object.entries(candidates))if(rows.length===1&&(role!=='text'||kind==='speech'))bindings[rows[0]]='{{'+role+'}}';
  return bindings;
}
// Read examples as data only. Never invoke a shell or preserve Authorization.
export function recognizeServiceRequest(example,kind){
  const text=normalizeRequestExample(example);
  if(!text||text.length>2*1024*1024)throw Error('请粘贴 2MB 以内的请求示例');
  let body,url='';
  if(text.startsWith('{'))body=JSON.parse(text);
  else{
    const match=text.match(/https?:\/\/[^\s'"\\]+/);url=match?.[0]||'';
    const data=text.match(/--(?:data-raw|data-binary|data)\s+(['"])([\s\S]*)/);
    if(!url||!data)throw Error('请提供 JSON 正文或包含 --data-raw 的 cURL 示例');
    // Find the matching shell quote; no command evaluation or substitutions.
    let raw='',i=0,tail=data[2],quote=data[1];
    for(;i<tail.length;i++){if(tail[i]===quote)break;if(quote==='"'&&tail[i]==='\\'&&['"','\\','$','`'].includes(tail[i+1]))i++;raw+=tail[i];}
    if(i===tail.length||tail.slice(i+1).trim().replace(/\\\s*$/,'').trim())throw Error('只接受一条带完整 JSON 正文的请求，不支持命令拼接');
    body=JSON.parse(raw);
  }
  if(!body||typeof body!=='object'||Array.isArray(body))throw Error('请求正文必须是 JSON 对象');
  if(body.nodeInfoList)return {type:'runninghub',url,body};
  if(body.prompt&&typeof body.prompt==='object'||body.nodes||Object.values(body).some(n=>n?.class_type))return {type:'comfyui',url,body:body.prompt&&typeof body.prompt==='object'?body.prompt:body};
  const model=typeof body.model==='string'?body.model:'',voice=typeof body.voice==='string'?body.voice:'';
  if(!model)throw Error('未识别到 model；工作流请使用工作流导入');
  const parsed=url?new URL(url):null;
  if(parsed&&(parsed.username||parsed.password||parsed.search||parsed.hash))throw Error('接口地址不能包含账号、密钥或查询参数');
  const path=parsed?.pathname||'',protocol=/\/responses\/?$/.test(path)?'responses':/\/messages\/?$/.test(path)?'anthropic':'openai';
  return {type:protocol,url,model,voice,fields:Object.keys(body).filter(k=>!/(?:key|token|authorization|secret)/i.test(k)),kind};
}
export function renderServiceSources(value,{compact=false,configure=false}={}){
  if(!value?.items?.length)return '<p class="muted">当前后端未提供来源说明；重载新版后可查看</p>';
  return (value.warning?'<p class="source-notice">'+esc(value.warning)+'</p>':'')+'<div class="service-source-grid">'+value.items.map(row=>{
    const page=configure&&capabilityPages[row.kind],tag=page?'a':'article';
    return '<'+tag+' class="service-source-item"'+(page?' href="#'+page+'" data-go="'+page+'" aria-label="配置'+esc(row.label)+'"':'')+'><b>'+esc(row.label)+' · '+(row.state==='loading'?'读取中':row.backend==='local'?'本地':'API')+'</b><span>'+esc(row.connection)+'</span><span>'+esc(row.model||'具体模型由服务或工作流选择')+'</span><small>'+esc(row.from)+'</small>'+(compact?'':'<small>'+esc(row.note)+'</small><small>'+esc(row.billing)+(row.origin?' · '+esc(row.origin):'')+'</small>')+(page?'<strong class="source-configure">配置'+esc(row.label)+' →</strong>':'')+'</'+tag+'>';
  }).join('')+'</div>';
}
export function paintExecutionRequests(container,requests,records,renderRecord){
  const expanded=new Set([...container.querySelectorAll('details[open][data-request-detail]')].map(el=>el.dataset.requestDetail));
  const key=(chat,persona,id)=>JSON.stringify([chat||'',persona||'',id]);
  const lookup=new Map(records.map((row,index)=>[key(row.chat,row.personaId??row.persona,row.id),{row,index}]));
  const detail=(id,title,body)=>'<details data-request-detail="'+esc(id)+'"'+(expanded.has(id)?' open':'')+'><summary>'+title+'</summary>'+body+'</details>';
  container.innerHTML=requests.length?requests.map(request=>{
    const cost=request.cost||{},amount=Number(cost.estimated)||0;
    const money=cost.priced?'已记录用量估算 '+(amount<0.0001&&amount>0?'<0.0001':amount.toFixed(4))+' 元':'未记录可估算用量';
    const notes=(cost.unpriced?' · '+cost.unpriced+' 次 API 调用缺少费用用量':'');
    const input=typeof request.input==='string'?request.input:JSON.stringify(request.input);
    const summary='<span class="execution-origin">'+esc(date(request.at))+' · '+esc(request.chat||'后台任务')+'</span>'+
      '<span class="execution-result"><strong class="execution-status" data-state="'+esc(request.state)+'">'+esc(request.label)+'</strong>'+
      (cost.priced?'<span class="execution-estimate">'+esc(money)+(cost.unpriced?'（部分）':'')+'</span>':'')+'</span>'+
      (input?'<span class="execution-preview">'+esc(input.slice(0,90))+'</span>':'');
    const steps=request.steps.map(step=>{
      const title=esc(date(step.at))+' · '+esc(step.label)+' · '+esc(statusNames[step.status]||step.status||'已记录');
      if(step.type==='invocation'){
        const found=lookup.get(key(step.chat??request.chat,step.personaId??request.personaId,step.recordId));
        return detail(request.id+':'+step.id,title,found?renderRecord(found.row,found.index):'<p class="muted">单次调用详情已超出保留范围</p>');
      }
      let body=step.text?'<pre class="audit-text">'+esc(step.text)+'</pre>':'';
      if(step.file)body+='<p>结果文件：'+esc(step.file)+'</p>';
      if(step.type==='delivery')body+=step.uploadReceipt?'<p>QQ 已接受文件上传'+(step.uploadReceipt.fileId?' · 文件编号 '+esc(step.uploadReceipt.fileId):'')+'</p>':'<p>QQ 消息编号：'+esc(step.messageId||'尚未收到')+'</p><p>'+esc(step.verification==='observed'?'已从 QQ 消息记录读回；无法据此确认对方已读':'尚未取得 QQ 读回记录')+'</p>';
      if(step.error)body+='<p class="execution-error">'+esc(step.error)+'</p>';
      return detail(request.id+':'+step.id,title,body);
    }).join('');
    return '<article class="execution-request">'+detail(request.id,summary,
      '<p class="muted">'+esc(request.linked?'请求编号：'+request.auditId:'独立记录：缺少所属请求编号，不按时间猜测归属')+'</p>'+
      (input?'<p><b>输入：</b></p><pre class="audit-text">'+esc(input)+'</pre>':'')+
      (request.deliveryReason?'<p>转发记录：'+esc(request.deliveryReason)+'</p>':'')+
      (request.output?detail(request.id+':output','模型输出（以发送回执为准）','<pre class="audit-text">'+esc(request.output)+'</pre>'):'')+
      '<p>'+esc(money+notes)+'</p><p class="muted">'+esc(cost.basis)+'</p>'+
      (request.failedCalls?'<p class="muted">本轮有 '+request.failedCalls+' 条失败或取消的调用，展开步骤可核对是否恢复</p>':'')+
      (request.sources?detail(request.id+':sources','请求开始时的配置来源',renderServiceSources(request.sources,{compact:true})):'<p class="muted">这条历史记录未保存当时的配置来源</p>')+
      '<div class="execution-steps">'+steps+'</div><p class="muted">'+esc(request.coverage)+'</p>')+'</article>';
  }).join(''):'<p class="muted">暂无符合筛选的请求记录</p>';
}
