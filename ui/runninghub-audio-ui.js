const labels={speech:'语音',sing:'唱歌'};
const engines=[['app','AI 应用（新版 API）'],['app-legacy','AI 应用（旧版 API）'],['workflow','工作流']];
const instances=[['default','Standard'],['lite','Lite'],['plus','Plus']];
const example={speech:[{nodeId:'12',fieldName:'text',fieldValue:'{{text}}'}],sing:[{nodeId:'12',fieldName:'audio',fieldValue:'{{song_audio}}'},{nodeId:'19',fieldName:'audio',fieldValue:'{{reference_audio}}'}]};

function optionList(options,current,esc){
  return options.map(([value,label])=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>').join('');
}

export async function waitForAudioPreview(api,preview,progress=()=>{}){
  while(preview.jobId&&preview.status==='running'){
    progress(preview.taskId);
    await new Promise(resolve=>setTimeout(resolve,2500));
    preview=await api('POST','/im-bridge/voice/preview',{action:'status',jobId:preview.jobId});
  }
  if(preview.status==='failed')throw Error(preview.error||'RunningHub 试听失败');
  return preview;
}

export function mountRunningHubAudio(root,{settings,api,esc}){
  const kinds=root.dataset.rhAudio.split(',');
  root.innerHTML=kinds.map(kind=>{
    const config=settings?.[kind]||{};
    const label=labels[kind];
    return '<section class="card" data-rh-kind="'+kind+'"><h2>RunningHub '+label+'</h2>'+
      '<p class="muted">与图像生成共用已保存的 RunningHub API Key。节点 ID 与字段名按你的应用或工作流实际填写。</p>'+
      '<div class="form-two"><label class="field">接口<select name="mode">'+optionList(engines,config.mode,esc)+'</select></label>'+
      '<label class="field">应用或工作流 ID<input name="id" value="'+esc(config.id||'')+'" inputmode="numeric"></label>'+
      '<label class="field">实例<select name="instanceType">'+optionList(instances,config.instanceType,esc)+'</select></label>'+
      '<label class="field">音频输出序号（从 1 开始）<input name="outputIndex" type="number" min="1" max="32" value="'+((config.outputIndex||0)+1)+'"></label></div>'+
      '<label class="field">节点参数 JSON<textarea name="nodes" rows="7" spellcheck="false" placeholder="'+esc(JSON.stringify(example[kind],null,2))+'">'+esc(config.nodeInfoList?.length?JSON.stringify(config.nodeInfoList,null,2):'')+'</textarea></label>'+
      '<p class="muted">可用 {{text}} 填入正文或歌词，{{instructions}} 填入语气提示，{{reference_audio}} 填入参考音色。翻唱用 {{song_audio}} 传入歌曲片段。示例中的节点编号需换成你自己的。</p>'+
      '<label class="field">默认参考音色<input name="referenceAudio" value="'+esc(config.referenceAudio||'')+'"><input data-upload="referenceAudio" aria-label="上传参考音色" type="file" accept="audio/*,.wav,.mp3,.flac"></label>'+
      (kind==='sing'?'<label class="field">默认歌曲素材<input name="songAudio" value="'+esc(config.songAudio||'')+'"><input data-upload="songAudio" aria-label="上传歌曲片段" type="file" accept="audio/*,.wav,.mp3,.flac"></label>':'')+
      '<label class="check-field"><input name="allowLocal" type="checkbox"'+(config.allowLocal?' checked':'')+'>本地聊天也允许使用此云端工作流</label>'+
      '<label class="field">'+(kind==='sing'?'试听歌词（歌曲素材翻唱可留空）':'试听台词')+'<textarea name="text" rows="2"></textarea></label>'+
      '<div class="btnrow"><button type="button" data-save>保存'+label+'工作流</button><button type="button" data-preview>用已保存配置试听（计费）</button></div>'+
      '<p class="muted" role="status"></p><audio controls preload="metadata" hidden></audio></section>';
  }).join('');

  for(const card of root.querySelectorAll('[data-rh-kind]')){
    const kind=card.dataset.rhKind;
    const input=name=>card.querySelector('[name="'+name+'"]');
    const status=card.querySelector('[role="status"]'),audio=card.querySelector('audio');
    const actions=[...card.querySelectorAll('button,input[type=file]')];
    let busy=false;
    const run=async(operation)=>{
      if(busy)return;
      busy=true;actions.forEach(el=>el.disabled=true);
      try{await operation();}
      catch(error){status.textContent=error.message;}
      finally{busy=false;actions.forEach(el=>el.disabled=false);}
    };
    for(const picker of card.querySelectorAll('[data-upload]'))picker.onchange=()=>run(async()=>{
      const file=picker.files[0];
      if(!file)return;
      if(file.size<=0||file.size>16*1024*1024)throw Error('请上传 16MB 以内的音频');
      status.textContent='正在上传素材到 RunningHub…';
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(Error('读取音频失败'));
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(file);
      });
      try{
        const result=await api('POST','/im-bridge/imagegen/upload',{type:'audio',name:file.name,data});
        input(picker.dataset.upload).value=result.fileName;
        status.textContent='素材已上传。保存工作流后可用于试听和聊天。';
      }finally{picker.value='';}
    });
    function draft(){
      const nodeInfoList=JSON.parse(input('nodes').value.trim()||'[]');
      const outputIndex=Number(input('outputIndex').value)-1;
      if(!Array.isArray(nodeInfoList))throw Error('节点参数必须是 nodeInfoList 数组');
      if(!Number.isInteger(outputIndex)||outputIndex<0||outputIndex>=32)throw Error('音频输出序号必须是 1 到 32');
      return {mode:input('mode').value,id:input('id').value,instanceType:input('instanceType').value,nodeInfoList,
        outputIndex,referenceAudio:input('referenceAudio').value,songAudio:input('songAudio')?.value||'',allowLocal:input('allowLocal').checked};
    }
    card.querySelector('[data-save]').onclick=()=>run(async()=>{
      const config=draft();
      await api('POST','/im-bridge/settings',{voice:{runninghub:{[kind]:config}}});
      if(settings)settings[kind]=config;
      status.textContent='工作流已保存。';
    });
    card.querySelector('[data-preview]').onclick=()=>run(async()=>{
      status.textContent='正在提交 RunningHub，等待音频生成…';
      audio.hidden=true;
      let result=await api('POST','/im-bridge/voice/preview',{runningHub:true,performance:kind,text:input('text').value.trim()});
      result=await waitForAudioPreview(api,result,taskId=>{if(taskId)status.textContent='RunningHub 已提交，任务 '+taskId+' 正在生成…';});
      audio.src='/im-bridge/audio?name='+encodeURIComponent(result.name);
      audio.hidden=false;
      status.textContent='音频已生成，可以试听。';
    });
  }
}
