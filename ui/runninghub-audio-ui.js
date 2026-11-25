import {normalizeRequestExample,recognizeServiceRequest,inferAudioExampleBindings} from './execution-overview.js';
const labels={speech:'语音',sing:'唱歌'};
const engines=[['app','AI 应用（新版 API）'],['app-legacy','AI 应用（旧版 API）'],['workflow','工作流']];
const instances=[['default','Standard'],['lite','Lite'],['plus','Plus']];
const example={speech:[{nodeId:'12',fieldName:'text',fieldValue:'{{text}}'}],sing:[{nodeId:'12',fieldName:'audio',fieldValue:'{{song_audio}}'},{nodeId:'19',fieldName:'audio',fieldValue:'{{reference_audio}}'}]};

function optionList(options,current,esc){
  return options.map(([value,label])=>'<option value="'+value+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>').join('');
}
async function audioFileDuration(file){
  const url=URL.createObjectURL(file),audio=new Audio();
  try{return await new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),5000);audio.onloadedmetadata=()=>{clearTimeout(timer);resolve(Number.isFinite(audio.duration)?audio.duration:null);};audio.onerror=()=>{clearTimeout(timer);resolve(null);};audio.src=url;});}
  finally{audio.removeAttribute('src');URL.revokeObjectURL(url);}
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
  const kinds=root.dataset.rhAudio.split(','),libraryOnly=root.dataset.rhLibraryOnly==='true';
  root.innerHTML=kinds.map(kind=>{
    const config=settings?.[kind]||{};
    const label=labels[kind];
    return '<section class="card" data-rh-kind="'+kind+'"><div data-rh-config><h2>RunningHub '+label+' API</h2>'+
      '<div class="form-two"><label class="field">已保存的工作流<select name="preset"><option value="">当前配置</option>'+optionList((config.presets||[]).map(p=>[p.mode+':'+p.id,p.name||p.id]),"",esc)+'</select></label><label class="field">工作流名称<input name="workflowName" placeholder="给这个工作流起个名字"></label></div>'+
      '<p class="muted">与图像生成共用已保存的 RunningHub API Key。节点 ID 与字段名按你的应用或工作流实际填写。</p>'+
      '<div class="form-two"><label class="field">接口<select name="mode">'+optionList(engines,config.mode,esc)+'</select></label>'+
      '<label class="field">应用或工作流 ID<input name="id" value="'+esc(config.id||'')+'" inputmode="numeric"></label>'+
      '<label class="field">实例<select name="instanceType">'+optionList(instances,config.instanceType,esc)+'</select></label>'+
      '<label class="field">音频输出序号（从 1 开始）<input name="outputIndex" type="number" min="1" max="32" value="'+((config.outputIndex||0)+1)+'"></label></div>'+
      '<label class="field">请求示例 / 节点参数<textarea name="nodes" rows="7" spellcheck="false" placeholder="'+esc(JSON.stringify(example[kind],null,2))+'">'+esc(config.nodeInfoList?.length?JSON.stringify(config.nodeInfoList,null,2):'')+'</textarea></label>'+
      '<div class="btnrow"><button type="button" data-import>识别并导入请求</button><button type="button" data-metadata>读取参数说明</button></div><p class="muted">可粘贴完整 cURL、含 nodeInfoList 的 JSON 或节点数组。导入不会运行命令或提交生成。</p><p data-metadata-status class="muted"></p><div data-bindings></div>'+
      '<label class="field">输出节点 ID（可选）<input name="outputNodeId" value="'+esc(config.outputNodeId||'')+'" placeholder="例如：46，最终混音"></label>'+
      '<p class="muted">可用 {{text}} 填入正文或歌词，{{instructions}} 填入语气提示，{{reference_audio}} 填入参考音色。翻唱用 {{song_audio}} 传入原曲；{{song_start}} / {{song_end}} 随上传前实际裁剪后的片段更新。示例中的节点编号需换成你自己的。</p>'+
      '<label class="field">默认参考音色<input name="referenceAudio" value="'+esc(config.referenceAudio||'')+'"><input data-upload="referenceAudio" aria-label="上传参考音色" type="file" accept="audio/*,.wav,.mp3,.flac"></label>'+
      (kind==='sing'?'<label class="field">默认歌曲素材<input name="songAudio" value="'+esc(config.songAudio||'')+'"><input data-upload="songAudio" aria-label="上传歌曲片段" type="file" accept="audio/*,.wav,.mp3,.flac"></label><button type="button" data-clear-song>清空默认歌曲素材</button>':'')+
      (kind==='sing'?'<label class="field">默认原曲歌名（手动配置时）<input name="songTitle" maxlength="80" value="'+esc(config.songTitle||'')+'" placeholder="这份素材实际是哪首歌"></label><label class="field">原唱 / 版本（可选）<input name="songArtist" maxlength="80" value="'+esc(config.songArtist||'')+'"></label><p class="muted">聊天点歌会自行提取音频、取得歌名并准备原曲，无需在这里手动下载或填写。这里用于手动配置默认素材；换素材时请核对对应歌名。新翻唱自动记录来源与版本，音准以试听反馈为准。</p>':'')+
      '<label class="check-field"><input name="allowLocal" type="checkbox"'+(config.allowLocal?' checked':'')+'>本地聊天也允许使用此云端工作流</label>'+
      (kind==='sing'?'<label class="field">只试前多少秒（留空用工作流默认范围）<input name="clipSeconds" type="number" min="1" step="1" placeholder="例如：30"></label>':'')+
      '<label class="field">'+(kind==='sing'?'试听歌词（歌曲素材翻唱可留空）':'试听台词')+'<textarea name="text" rows="2"></textarea></label>'+
      '<div class="btnrow"><button type="button" id="rhAudio-'+kind+'-save" data-save>保存'+label+'工作流</button><button type="button" data-preview>保存并试听（计费）</button></div>'+
      '<p class="muted" role="status"></p><audio controls preload="metadata" hidden></audio></div>'+
      (kind==='sing'?'<div class="btnrow"><button type="button" data-save-cover disabled>保存这次翻唱</button></div>'+
        '<h3>翻唱库</h3><p class="muted">已确认的版本可按歌名复用；待反馈和已停用的版本不会自动顶替新唱。确认前请核对歌名并试听；双端同步同时保留版本和反馈。</p>'+
        '<label class="field">歌曲或片段名<input name="coverTitle" maxlength="80" placeholder="例如：晴天（副歌）"></label>'+
        '<div data-cover-library></div>':'')+'</section>';
  }).join('');

  for(const card of root.querySelectorAll('[data-rh-kind]')){
    const kind=card.dataset.rhKind;
    if(libraryOnly){card.querySelector('[data-rh-config]').remove();card.insertAdjacentHTML('afterbegin','<h2>翻唱作品</h2><p><button type="button" data-go="apisong">配置唱歌 API</button></p><p class="muted" role="status"></p>');}
    const input=name=>card.querySelector('[name="'+name+'"]');
    const status=card.querySelector('[role="status"]'),audio=card.querySelector('audio');
    const actions=[...card.querySelectorAll('button,input[type=file]')];
    let busy=false,previewJob='',refreshLibrary=async()=>{},nodeMetadata=[],fixedValues=[];
    const run=async(operation)=>{
      if(busy)return;
      busy=true;actions.forEach(el=>el.disabled=true);
      try{await operation();}
      catch(error){status.textContent=error.message;}
      finally{busy=false;actions.forEach(el=>el.disabled=false);const save=card.querySelector('[data-save-cover]');if(save)save.disabled=!previewJob;}
    };
    if(!libraryOnly){
    for(const picker of card.querySelectorAll('[data-upload]'))picker.onchange=()=>run(async()=>{
      const file=picker.files[0];
      if(!file)return;
      if(file.size<=0||file.size>16*1024*1024)throw Error('请上传 16MB 以内的音频');
      status.textContent='正在上传素材到 RunningHub…';
      const duration=await audioFileDuration(file);
      const data=await new Promise((resolve,reject)=>{
        const reader=new FileReader();
        reader.onerror=()=>reject(Error('读取音频失败'));
        reader.onload=()=>resolve(String(reader.result).split(',')[1]);
        reader.readAsDataURL(file);
      });
      try{
        const result=await api('POST','/im-bridge/imagegen/upload',{type:'audio',name:file.name,data});
        input(picker.dataset.upload).value=result.fileName;
        if(picker.dataset.upload==='songAudio'){input('songTitle').value='';input('songArtist').value='';}
        if(picker.dataset.upload==='referenceAudio'&&Number.isFinite(duration)){
          const nodes=JSON.parse(input('nodes').value||'[]');let changed=false;
          nodes.forEach((node,index)=>{
            const label=nodeMetadata[index]?.description||nodeMetadata[index]?.label||'';
            if(/音色|参考|reference|voice/i.test(label)&&/结束|终点|end/i.test(label)&&!String(node.fieldValue).includes('{{')){
              const end=Math.floor(duration),old=Number(node.fieldValue);
              if(end>0&&old>end){node.fieldValue=typeof node.fieldValue==='number'?end:String(end);fixedValues[index]=node.fieldValue;changed=true;}
            }
          });
          if(changed){input('nodes').value=JSON.stringify(nodes,null,2);showBindings(nodes);}
        }
        input(picker.dataset.upload).dispatchEvent(new Event('input',{bubbles:true}));
        status.textContent='素材已上传。保存工作流后可用于试听和聊天。';
      }finally{picker.value='';}
    });
    let imported=null;
    function showBindings(nodes){
      const roles=[['','沿用固定值'],['{{text}}','正文 / 歌词'],['{{instructions}}','语气提示'],['{{song_audio}}','原曲音频'],['{{reference_audio}}','参考音色'],['{{song_start}}','片段起点'],['{{song_end}}','片段终点']];
      const box=card.querySelector('[data-bindings]');
      box.innerHTML='<h3>输入映射与参数</h3>'+nodes.map((node,index)=>{
        const meta=nodeMetadata[index]||{},label=meta.description||meta.label||({'{{song_audio}}':'原曲音频','{{reference_audio}}':'参考音色','{{text}}':'台词 / 歌词'})[node.fieldValue]||'',dynamic=/^\{\{/.test(String(node.fieldValue)),value=dynamic?fixedValues[index]??'':node.fieldValue;
        const bool=typeof value==='boolean'||/^(?:true|false)$/.test(String(value)),numeric=!bool&&value!==''&&Number.isFinite(Number(value));
        return '<div class="rh-node-parameter"><label class="field">'+esc(label?label+' · ':'')+'节点 '+esc(node.nodeId)+' · '+esc(node.fieldName)+'<select data-binding="'+index+'">'+optionList(roles,dynamic?node.fieldValue:'',esc)+'</select></label><label class="'+(bool?'check-field':'field')+'"'+(dynamic?' hidden':'')+' data-fixed-label="'+index+'">'+(bool?'':'固定值')+'<input data-fixed="'+index+'" type="'+(bool?'checkbox':numeric?'number':'text')+'" '+(bool?(String(value)==='true'?'checked':''):'value="'+esc(value)+'"'+(numeric?' step="'+(meta.integer||/第几秒/.test(label)?'1':'any')+'"':''))+'>'+ (bool?'开启':'')+'</label></div>';
      }).join('');
      box.onchange=event=>{
        if(event.target.matches('[data-binding]')){const i=Number(event.target.dataset.binding),role=event.target.value;nodes[i].fieldValue=role||(fixedValues[i]??'');showBindings(nodes);}
        else if(event.target.matches('[data-fixed]')){const i=Number(event.target.dataset.fixed),old=nodes[i].fieldValue;nodes[i].fieldValue=event.target.type==='checkbox'?(typeof old==='boolean'?event.target.checked:String(event.target.checked)):typeof old==='number'?Number(event.target.value):event.target.value;fixedValues[i]=nodes[i].fieldValue;}
        else return;
        input('nodes').value=JSON.stringify(nodes,null,2);input('nodes').dispatchEvent(new Event('input',{bubbles:true}));
      };
    }
    async function importDraft(){
      const example=normalizeRequestExample(input('nodes').value);let metadata=[];
      try{const parsed=recognizeServiceRequest(example,kind);metadata=parsed.body?.nodeInfoList||[];}catch{}
      imported=await api('POST','/im-bridge/voice/workflow-import',{kind,example,config:{...settings?.[kind],id:input('id').value,mode:input('mode').value}});
      const c=imported.config;
      nodeMetadata=c.nodeInfoList.map(n=>(imported.fields?.length?imported.fields:metadata).find(f=>String(f.nodeId)===n.nodeId&&f.fieldName===n.fieldName)||{});
      fixedValues=c.nodeInfoList.map(n=>metadata.find(f=>String(f.nodeId)===n.nodeId&&f.fieldName===n.fieldName)?.fieldValue??n.fieldValue);
      const bindings=inferAudioExampleBindings(nodeMetadata,kind);
      for(const [index,role]of Object.entries(bindings))if(!c.nodeInfoList.some(n=>n.fieldValue===role))c.nodeInfoList[index].fieldValue=role;
      for(const name of ['id','mode','instanceType','outputNodeId'])input(name).value=c[name]||'';
      input('outputIndex').value=(c.outputIndex||0)+1;
      input('nodes').value=JSON.stringify(c.nodeInfoList,null,2);
      showBindings(c.nodeInfoList.map(n=>({...n})));
      const missing=kind==='sing'&&!c.nodeInfoList.some(n=>n.fieldValue==='{{song_audio}}'||n.fieldValue==='{{text}}');
      status.textContent='已识别 '+c.id+'。'+(missing?(imported.warnings||[]).join(' '):'已绑定：'+c.nodeInfoList.map(n=>({'{{song_audio}}':'原曲音频','{{reference_audio}}':'参考音色','{{text}}':'台词 / 歌词'})[n.fieldValue]).filter(Boolean).join('、')+'；固定参数保持示例含义。')+(c.outputNodeId?'输出节点 '+c.outputNodeId+'。':'')+'核对后保存。';
      input('nodes').dispatchEvent(new Event('input',{bubbles:true}));return c;
    }
    root.importExample=async value=>{
      if(busy)throw Error('编辑器正在处理另一项操作，请稍后重试');
      let result,failure;await run(async()=>{try{input('nodes').value=value;result=await importDraft();}catch(e){failure=e;throw e;}});
      if(failure)throw failure;return result;
    };
    async function readMetadata(){
      const target=input('id').value,mode=input('mode').value,notice=card.querySelector('[data-metadata-status]');
      if(!target)return;notice.textContent='正在读取参数说明，不提交生成…';
      try{
        const result=await api('POST','/im-bridge/imagegen/inspect',{target,mode:mode==='workflow'?'workflow':'app'});
        if(!card.isConnected||input('id').value!==target||input('mode').value!==mode)return;
        const nodes=JSON.parse(input('nodes').value);nodeMetadata=nodes.map(n=>(result.fields||[]).find(f=>String(f.nodeId)===n.nodeId&&f.fieldName===n.fieldName)||{});
        if(!card.querySelector('[data-bindings]').contains(document.activeElement))showBindings(nodes);
        notice.textContent='参数说明已读回；当前节点值与音频映射保持不变。';
      }catch(e){if(card.isConnected)notice.textContent='参数说明暂未读到：'+e.message+'。已有配置仍保留，可稍后重试。';}
    }
    card.querySelector('[data-metadata]').onclick=()=>run(readMetadata);
    async function draft(){
      const text=input('nodes').value.trim();
      if(!text.startsWith('['))await importDraft();
      let nodeInfoList;try{nodeInfoList=JSON.parse(input('nodes').value.trim()||'[]');}catch{throw Error('节点数组不是完整 JSON；也可以粘贴完整请求后点击识别。');}
      const outputIndex=Number(input('outputIndex').value)-1;
      if(!Array.isArray(nodeInfoList))throw Error('请先识别请求示例');
      nodeInfoList=nodeInfoList.map(n=>({nodeId:String(n.nodeId||'').trim(),fieldName:String(n.fieldName||'').trim(),fieldValue:n.fieldValue}));
      if(!Number.isInteger(outputIndex)||outputIndex<0||outputIndex>=32)throw Error('音频输出序号必须是 1 到 32');
      return {mode:input('mode').value,id:input('id').value.trim(),instanceType:input('instanceType').value,nodeInfoList,
        outputIndex,outputNodeId:input('outputNodeId').value.trim(),referenceAudio:input('referenceAudio').value,songAudio:input('songAudio')?.value||'',...(kind==='sing'?{songTitle:input('songTitle').value.trim(),songArtist:input('songArtist').value.trim(),songIdentityAudio:input('songTitle').value.trim()?input('songAudio').value:''}:{}),allowLocal:input('allowLocal').checked};
    }
    async function saveDraft(){
      const config=await draft(),old=settings?.[kind]||{},name=input('workflowName').value.trim()||config.id;
      const previous=old.id&&old.nodeInfoList?.length&&!old.presets?.some(p=>p.id===old.id&&p.mode===old.mode)?[{...old,presets:undefined,name:old.id}]:[];
      config.presets=[...(old.presets||[]),...previous].filter(p=>p.id!==config.id||p.mode!==config.mode).concat({...config,name}).slice(-20);
      await api('POST','/im-bridge/settings',{voice:{runninghub:{[kind]:config}}});
      const readback=await api('GET','/im-bridge/settings'),actual=readback.settings?.voice?.runninghub?.[kind];
      if(!actual||['id','mode','outputIndex','outputNodeId','instanceType','referenceAudio','songAudio','songTitle','songArtist','allowLocal'].some(k=>(actual[k]??'')!==(config[k]??''))||JSON.stringify(actual.nodeInfoList)!==JSON.stringify(config.nodeInfoList))throw Error('保存后的实际工作流与要求不一致，请刷新核对；未提交生成。');
      if(settings)settings[kind]=actual;
      input('preset').innerHTML='<option value="">当前配置</option>'+optionList(actual.presets.map(p=>[p.mode+':'+p.id,p.name||p.id]),'',esc);
      status.textContent='已保存并核对：'+actual.id+(actual.outputNodeId?' · 输出节点 '+actual.outputNodeId:'')+'。';
      return actual;
    }
    card.querySelector('[data-import]').onclick=()=>run(importDraft);
    card.querySelector('[data-save]').onclick=()=>run(saveDraft);
    input('preset').onchange=()=>{const preset=settings?.[kind]?.presets?.find(p=>p.mode+':'+p.id===input('preset').value);if(!preset)return;nodeMetadata=[];fixedValues=preset.nodeInfoList.map(n=>/^\{\{/.test(String(n.fieldValue))?'':n.fieldValue);for(const name of ['id','mode','instanceType','outputNodeId','referenceAudio','songAudio','songTitle','songArtist'])if(input(name))input(name).value=preset[name]||'';input('allowLocal').checked=preset.allowLocal===true;input('workflowName').value=preset.name||preset.id;input('outputIndex').value=(preset.outputIndex||0)+1;input('nodes').value=JSON.stringify(preset.nodeInfoList,null,2);showBindings(preset.nodeInfoList.map(n=>({...n})));status.textContent='已载入选择，保存后生效。';};
    if(settings?.[kind]?.nodeInfoList?.length){showBindings(settings[kind].nodeInfoList.map(n=>({...n})));void readMetadata();}
    card.querySelector('[data-preview]').onclick=()=>run(async()=>{
      await saveDraft();
      const seconds=input('clipSeconds')?.value?Number(input('clipSeconds').value):undefined;
      if(seconds!==undefined&&(!Number.isFinite(seconds)||seconds<=0))throw Error('片段秒数必须大于 0');
      status.textContent='已核对配置，正在准备素材并提交 RunningHub…';
      audio.hidden=true;previewJob='';
      let result=await api('POST','/im-bridge/voice/preview',{runningHub:true,performance:kind,text:input('text').value.trim(),seconds});
      result=await waitForAudioPreview(api,result,taskId=>{if(taskId)status.textContent='RunningHub 任务 '+taskId+' 正在生成…';});
      audio.src='/im-bridge/audio?name='+encodeURIComponent(result.name);audio.hidden=false;
      if(kind==='sing')previewJob=result.jobId||'';
      await refreshLibrary();status.textContent='音频已生成，可以试听。';
    });
    }
    if(kind==='sing'){
      input('songAudio')?.addEventListener('input',()=>{input('songTitle').value='';input('songArtist').value='';});
      const library=card.querySelector('[data-cover-library]');
      const call=body=>api('POST','/im-bridge/features/cover-library',body);
      async function loadCovers(){
        const result=await call({action:'list'});
        if(!card.isConnected)return;
        library.innerHTML=(result.covers||[]).map(row=>'<div><p><strong>'+esc(row.title)+'</strong> '+esc(row.artist||'')+' · '+esc(({accepted:'已确认可复用',rejected:'已停用',unreviewed:'待核对歌名与试听'})[row.quality]||'待核对歌名与试听')+'</p><small>'+esc(row.version||'旧版本')+' · '+esc((row.tags||[]).join(' / '))+'</small><br><audio controls preload="none" src="/im-bridge/saved-cover?id='+encodeURIComponent(row.id)+'"></audio><button type="button" data-cover-review="'+esc(row.id)+'" data-quality="accepted">确认歌名与版本可复用</button><button type="button" data-cover-review="'+esc(row.id)+'" data-quality="rejected">停用此版（跑调 / 错歌）</button><button type="button" data-cover-delete="'+esc(row.id)+'">删除已保存版本</button></div>').join('')||
          '<p class="muted">还没有保存的翻唱。</p>';
        if(result.recent?.length)library.insertAdjacentHTML('beforeend','<details><summary>最近生成的翻唱</summary>'+
          result.recent.map(row=>'<div><p>'+esc(row.title||'歌名尚未核对')+' · '+esc(new Date(row.at).toLocaleString())+' · '+esc(row.quality==='rejected'?'已停用':'待试听反馈')+'</p><audio controls preload="none" src="/im-bridge/audio?name='+encodeURIComponent(row.name)+'"></audio> '+
            '<button type="button" data-cover-invocation="'+esc(row.id)+'">核对上方歌名并保存</button><button type="button" data-generated-reject="'+esc(row.id)+'">停用此版（跑调 / 错歌）</button><button type="button" data-generated-delete="'+esc(row.id)+'">删除生成音频</button></div>').join('')+'</details>');
        library.insertAdjacentHTML('beforeend','<h3>已自动取得的原曲</h3>'+((result.sources||[]).slice(0,12).map(row=>'<p><strong>'+esc(row.title)+'</strong> '+esc(row.artist||'')+(row.duration?' · '+esc(Math.round(row.duration)+' 秒'+(row.segment?'（原曲 '+row.segment.start+'–'+row.segment.end+' 秒）':'')):'')+'</p>').join('')||'<p class="muted">点歌时会先尝试取得原曲，成功后在这里显示。</p>'));
      }
      refreshLibrary=loadCovers;
      async function saveCover(source){
        const title=input('coverTitle').value.trim();
        if(!title)throw Error('请先填写歌曲或片段名');
        const result=await call({action:'save',title,...source});
        await loadCovers();
        status.textContent='已保存《'+result.cover.title+'》。';
      }
      card.querySelector('[data-save-cover]').onclick=()=>run(()=>saveCover({jobId:previewJob}));
      if(card.querySelector('[data-clear-song]'))card.querySelector('[data-clear-song]').onclick=()=>run(async()=>{
        const config={...settings?.sing,songAudio:'',songTitle:'',songArtist:'',songIdentityAudio:''};
        await api('POST','/im-bridge/settings',{voice:{runninghub:{sing:config}}});
        input('songAudio').value='';
        input('songTitle').value='';input('songArtist').value='';
        if(settings)settings.sing=config;
        status.textContent='已清空默认歌曲素材。下次点歌会尝试自动取得对应原曲。';
      });
      library.onclick=event=>{
        const button=event.target.closest('button');
        if(!button)return;
        if(button.dataset.coverInvocation)return void run(()=>saveCover({invocationId:button.dataset.coverInvocation}));
        if(button.dataset.coverReview)return void run(async()=>{await call({action:'review',id:button.dataset.coverReview,quality:button.dataset.quality});await loadCovers();status.textContent=button.dataset.quality==='rejected'?'这个版本已停用，不会再作为库存发送。':'已确认这个歌名和版本可以复用。';});
        if(button.dataset.generatedReject)return void run(async()=>{await call({action:'review-generated',invocationId:button.dataset.generatedReject,quality:'rejected',reason:'试听后反馈跑调或错歌'});await loadCovers();status.textContent='这个版本已停用，原始记录仍保留。';});
        const id=button.dataset.coverDelete,generated=button.dataset.generatedDelete;
        if(!id&&!generated)return;
        void run(async()=>{
          if(id)await call({action:'delete',id});
          else await call({action:'delete-generated',invocationId:generated});
          await loadCovers();
          status.textContent='已删除这份音频。';
        });
      };
      void loadCovers().catch(error=>{library.textContent=error.message;});
    }
  }
}
