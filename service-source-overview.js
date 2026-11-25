// Describes the selected route only. Routing remains owned by serviceSource;
// this function does not probe a provider, load a model or spend any tokens.
const kinds={chat:'聊天',image:'图片',speech:'语音',video:'视频',sing:'唱歌'};
const text=value=>String(value??'').slice(0,300);
function endpoint(value){try{const u=new URL(value);return u.origin;}catch{return '';}}
export function serviceSourceOverview({settings={},connections={},sources={},model={},chat='',desktop=true,voiceEngine='none',localAudio={},now=Date.now()}={}){
  model=model||{};
  const local=settings.localChat||{},profiles=connections.profiles||[],mixed=connections.routes?.enabled===true;
  const fallback=desktop&&local.enabled===true&&local.apiComplement===true;
  const result=Object.entries(kinds).map(([kind,label])=>{
    const source=sources[kind]||'legacy',legacyLocalVoice=kind==='speech'&&source==='legacy'&&voiceEngine==='localai';
    const audio=localAudio[kind],audioLocal=desktop&&audio?.mode==='local';
    const isLocal=source==='local'||legacyLocalVoice||audioLocal,field=kind==='chat'?'chatModel':kind+'Model';
    let selected=source.startsWith('profile:')?profiles.find(p=>p.id===source.slice(8)):null;
    if(!selected&&kind==='chat'&&!isLocal)selected=profiles.find(p=>model.provider==='qq-connection-'+p.id);
    const runningHubVideo=kind==='video'&&source==='legacy'&&settings.videogen?.provider==='runninghub';
    if(!selected&&kind==='video'&&!isLocal&&source==='legacy'&&!runningHubVideo)selected=profiles.find(p=>p.id===settings.videogen?.profileId);
    let connection='',chosen='',origin='',from='',enabled=true,configured=true;
    if(audioLocal){
      const selectedAudio=audio.presets?.find(p=>p.id===audio.workflowId);
      connection='本地 ComfyUI 音频工作流';chosen=text(selectedAudio?.name);origin=endpoint(selectedAudio?.baseUrl);from=kinds[kind]+'配置';configured=!!selectedAudio;
    }else if(isLocal){
      connection=kind==='speech'?'本地语音服务':kind==='chat'?(local.backend==='comfyui'?'ComfyUI 聊天工作流':'本地模型服务'):'本地 ComfyUI';
      const workflow=kind==='chat'?local.chatWorkflow:local.defaultWorkflows?.[kind];
      chosen=kind==='chat'&&local.backend!=='comfyui'?text(local.modelId):text((local.workflowLibrary||[]).find(w=>w.id===workflow)?.name||workflow);
      if(kind==='speech')chosen=text(legacyLocalVoice?settings.voice?.localai?.preset:local.voicePreset)||'在本地服务中选择音色';
      origin=endpoint((legacyLocalVoice?settings.voice?.localai?.baseUrl:kind==='chat'&&local.backend!=='comfyui'?local.modelBaseUrl:'')||local.baseUrl||'http://127.0.0.1:8777');
      from=legacyLocalVoice?'语音设置 → 本地语音':'连接与搭配 → 按能力选择';
      configured=desktop;enabled=kind==='speech'?local.voiceEnabled!==false:kind==='image'?settings.imagegen?.enabled!==false:true;
    }else if(selected){
      connection=text(selected.name)||text(selected.id);chosen=text(kind==='chat'?model.model||selected[field]:selected[field]);origin=endpoint(selected.baseUrl);
      configured=!!chosen&&(kind!=='speech'||!!selected.voice);
      from=source.startsWith('profile:')?'连接与搭配 → '+label:kind==='video'?'视频生成设置':chat&&settings.modelByChat?.[chat]?'当前会话的模型设置':'聊天模型设置';
    }else if(source.startsWith('profile:')){
      connection='连接已不存在';configured=false;from='连接与搭配 → '+label;
    }else if(kind==='chat'){
      connection=text(model.provider)||'宿主默认模型';chosen=text(model.model);configured=!!model.provider&&!!model.model;
      from=chat&&settings.modelByChat?.[chat]?'当前会话的模型设置':'聊天模型设置 / 宿主默认';
    }else if(kind==='image'){
      connection=text(settings.imagegen?.provider)||'siliconflow';chosen=text(settings.imagegen?.model)||'按图片页工作流及本次需求选择';
      origin=endpoint(settings.imagegen?.baseUrl);from='图像生成设置';
      configured=connection==='pollinations'||!!(connection==='runninghub'?settings.imagegen?.runninghub?.apiKey:settings.imagegen?.apiKey);
    }else if(runningHubVideo){
      connection='RunningHub';chosen='MiniMax H3';origin=endpoint(settings.imagegen?.runninghub?.baseUrl||'https://www.runninghub.cn');from='视频生成设置';
      configured=!!settings.imagegen?.runninghub?.apiKey;
    }else if(kind==='speech'){
      connection=voiceEngine==='none'?'尚未选择语音服务':text(voiceEngine);
      chosen=text(voiceEngine==='breeze'?settings.voice?.breeze?.model:voiceEngine==='minimax'?settings.voice?.minimax?.model:'');configured=voiceEngine!=='none';from='语音设置';
    }else if(kind==='sing'){
      const config=settings.voice?.runninghub?.sing||{};
      connection='RunningHub';chosen=text(config.presets?.find(p=>p.id===config.id&&p.mode===config.mode)?.name||config.id);origin=endpoint(settings.imagegen?.runninghub?.baseUrl||'https://www.runninghub.cn');from='唱歌配置';configured=!!config.id&&!!settings.imagegen?.runninghub?.apiKey;enabled=settings.voice?.enabled===true;
    }else{connection='尚未选择视频 API';configured=false;from='视频生成设置';}
    if(kind==='image')enabled=settings.imagegen?.enabled!==false;
    if(kind==='speech')enabled=enabled&&settings.voice?.enabled===true;
    if(kind==='video'&&!isLocal&&source==='legacy')enabled=settings.videogen?.enabled===true;
    return {kind,label,source,backend:isLocal?'local':'api',connection,model:chosen,origin,from,
      state:!enabled?'off':!configured?'incomplete':'selected',
      note:!enabled?'全局开关已关闭；会话覆盖以实际调用为准':!configured?'配置不完整，需补齐后使用':'已选择来源，未在此页面测试服务是否在线',
      billing:isLocal?'本地执行': 'API 可能计费；实际调用见记录'};
  });
  return {at:now,chat,device:desktop?'desktop':'phone',mixed,apiComplement:fallback,apiTaskAssist:fallback&&local.apiTaskAssist===true,
    warning:fallback?'本地聊天已开启 API 补充'+(local.apiTaskAssist?'和任务协作':'')+'，对应调用可能产生费用':mixed?'按能力分别执行；聊天选本地时，其他能力仍可能使用 API':'',
    items:result};
}
