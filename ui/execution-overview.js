const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statusNames={pending:'准备中',waiting_service:'等待服务',queued:'等待执行',sending:'发送中',started:'执行中',submitted:'已提交',running:'执行中',
  returned:'已返回',sent:'QQ 已接收',generated:'生成完成',failed:'失败',error:'失败',cancelled:'已取消',rejected:'被拒绝',unknown:'待核对',deferred:'暂缓',completed:'完成',silent:'未发送'};
const date=at=>Number(at)>0?new Date(Number(at)).toLocaleString():'时间未记录';
export function renderServiceSources(value,{compact=false}={}){
  if(!value?.items?.length)return '<p class="muted">当前后端未提供来源说明；重载新版后可查看</p>';
  return (value.warning?'<p class="source-notice">'+esc(value.warning)+'</p>':'')+'<div class="service-source-grid">'+value.items.map(row=>'<article class="service-source-item"><b>'+esc(row.label)+' · '+(row.backend==='local'?'本地':'API')+'</b><span>'+esc(row.connection)+'</span><span>'+esc(row.model||'具体模型由服务或工作流选择')+'</span><small>'+esc(row.from)+'</small>'+(compact?'':'<small>'+esc(row.note)+'</small><small>'+esc(row.billing)+(row.origin?' · '+esc(row.origin):'')+'</small>')+'</article>').join('')+'</div>';
}
export function paintExecutionRequests(container,requests,records,renderRecord){
  const expanded=new Set([...container.querySelectorAll('details[open][data-request-detail]')].map(el=>el.dataset.requestDetail));
  const lookup=new Map(records.map((row,index)=>[row.id,{row,index}]));
  const detail=(id,title,body)=>'<details data-request-detail="'+esc(id)+'"'+(expanded.has(id)?' open':'')+'><summary>'+title+'</summary>'+body+'</details>';
  container.innerHTML=requests.length?requests.map(request=>{
    const cost=request.cost||{},amount=Number(cost.estimated)||0;
    const money=cost.priced?'已记录用量估算 '+(amount<0.0001&&amount>0?'<0.0001':amount.toFixed(4))+' 元':'未记录可估算用量';
    const notes=(cost.unpriced?' · '+cost.unpriced+' 次 API 调用缺少费用用量':'');
    const input=typeof request.input==='string'?request.input:JSON.stringify(request.input);
    const summary='<span>'+esc(date(request.at))+' · '+esc(request.chat||'后台任务')+'</span><strong class="execution-status">'+esc(request.label)+'</strong>'+(input?'<span class="execution-preview">'+esc(input.slice(0,90))+'</span>':'');
    const steps=request.steps.map(step=>{
      const title=esc(date(step.at))+' · '+esc(step.label)+' · '+esc(statusNames[step.status]||step.status||'已记录');
      if(step.type==='invocation'){
        const found=lookup.get(step.recordId);
        return detail(request.id+':'+step.id,title,found?renderRecord(found.row,found.index):'<p class="muted">单次调用详情已超出保留范围</p>');
      }
      let body=step.text?'<pre class="audit-text">'+esc(step.text)+'</pre>':'';
      if(step.file)body+='<p>结果文件：'+esc(step.file)+'</p>';
      if(step.type==='delivery')body+='<p>QQ 消息编号：'+esc(step.messageId||'尚未收到')+'</p><p>'+esc(step.verification==='observed'?'已从 QQ 消息记录读回；无法据此确认对方已读':'尚未取得 QQ 读回记录')+'</p>';
      if(step.error)body+='<p class="execution-error">'+esc(step.error)+'</p>';
      return detail(request.id+':'+step.id,title,body);
    }).join('');
    return '<article class="execution-request">'+detail(request.id,summary,
      '<p class="muted">'+esc(request.linked?'请求编号：'+request.auditId:'独立记录：缺少所属请求编号，不按时间猜测归属')+'</p>'+
      (input?'<p><b>输入：</b></p><pre class="audit-text">'+esc(input)+'</pre>':'')+
      (request.output?detail(request.id+':output','模型输出（以发送回执为准）','<pre class="audit-text">'+esc(request.output)+'</pre>'):'')+
      '<p>'+esc(money+notes)+'</p><p class="muted">'+esc(cost.basis)+'</p>'+
      (request.failedCalls?'<p class="muted">本轮有 '+request.failedCalls+' 条失败或取消的调用，展开步骤可核对是否恢复</p>':'')+
      (request.sources?detail(request.id+':sources','请求开始时的配置来源',renderServiceSources(request.sources,{compact:true})):'<p class="muted">这条历史记录未保存当时的配置来源</p>')+
      '<div class="execution-steps">'+steps+'</div><p class="muted">'+esc(request.coverage)+'</p>')+'</article>';
  }).join(''):'<p class="muted">暂无符合筛选的请求记录</p>';
}
