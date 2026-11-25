import {setTimeout as wait} from 'node:timers/promises';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,renameSync,unlinkSync} from 'node:fs';
import {runningHubSubmission,runningHubTaskId} from './image-api-contract.js';
import {publicGet} from './bridge-features.js';

const maxAudioBytes=32*1024*1024;
const inputToken=/^\{\{(text|instructions|song_audio|reference_audio|song_start|song_end)\}\}$/;
const audioName=/^(?:api\/)?[\w./-]{1,500}$/;
const field=value=>String(value??'').trim();

export function singingWorkflowKey(config={}){
 return createHash('sha256').update(JSON.stringify({id:config.id||'',mode:config.mode||'app',instanceType:config.instanceType||'default',outputIndex:config.outputIndex||0,outputNodeId:config.outputNodeId||'',referenceAudio:config.referenceAudio||'',nodes:[...(config.nodeInfoList||[])].sort((a,b)=>(a.nodeId+':'+a.fieldName).localeCompare(b.nodeId+':'+b.fieldName))})).digest('hex');
}
export function songTime(seconds=0){const value=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(value/60)+':'+String(value%60).padStart(2,'0');}
export function singingAudioTiming(source){return Number(source?.duration)>0?{song_start:'0:00',song_end:songTime(source.duration)}:{};}

export function normalizeRunningHubAudio(input={},includePresets=true){
  return Object.fromEntries(['speech','sing'].map(kind=>{
    const raw=input?.[kind]||{};
    return [kind,{
      mode:['app','app-legacy','workflow'].includes(raw.mode)?raw.mode:'app',
      id:field(raw.id).slice(0,80),
      instanceType:['default','lite','plus'].includes(raw.instanceType)?raw.instanceType:'default',
      nodeInfoList:Array.isArray(raw.nodeInfoList)?raw.nodeInfoList.slice(0,64).map(node=>({
        nodeId:field(node?.nodeId),fieldName:field(node?.fieldName),fieldValue:node?.fieldValue
      })):[],
      referenceAudio:field(raw.referenceAudio).slice(0,500),
      songAudio:kind==='sing'?field(raw.songAudio).slice(0,500):'',
      ...(kind==='sing'?{songTitle:field(raw.songTitle).slice(0,80),songArtist:field(raw.songArtist).slice(0,80),songIdentityAudio:field(raw.songIdentityAudio).slice(0,500)}:{}),
      outputIndex:Number.isInteger(raw.outputIndex)&&raw.outputIndex>=0&&raw.outputIndex<32?raw.outputIndex:0,
      outputNodeId:field(raw.outputNodeId).slice(0,80),
      allowLocal:raw.allowLocal===true,
      ...(includePresets?{presets:(Array.isArray(raw.presets)?raw.presets:[]).slice(-20).map(p=>({name:field(p.name||p.id).slice(0,80),...normalizeRunningHubAudio({[kind]:p},false)[kind]}))}:{}),
    }];
  }));
}

export function isRunningHubCover(config){
  const inputs=config?.nodeInfoList?.map(node=>node.fieldValue)||[];
  return inputs.includes('{{song_audio}}')&&!inputs.includes('{{text}}');
}

export function runningHubAudioNodes(config,kind,inputs={}, {requireValues=true}={}){
  if(!/^\d{8,24}$/.test(config.id))throw Error('请填写 RunningHub AI 应用或工作流的数字 ID');
  const nodes=config.nodeInfoList;
  if(!nodes.length)throw Error('请填写此应用或工作流实际的 nodeInfoList');
  const used=new Set(),targets=new Set();
  const resolved=nodes.map(({nodeId,fieldName,fieldValue})=>{
    if(!/^[\w:-]{1,80}$/.test(nodeId)||!fieldName||fieldName.length>120||/[\x00-\x1f]/.test(fieldName))throw Error('RunningHub 节点的 ID 或字段名无效');
    const target=JSON.stringify([nodeId,fieldName]);
    if(targets.has(target))throw Error('同一个 RunningHub 节点字段不能配置两次');
    targets.add(target);
    if(!['string','number','boolean'].includes(typeof fieldValue)||typeof fieldValue==='string'&&fieldValue.length>8000||typeof fieldValue==='number'&&!Number.isFinite(fieldValue))throw Error('节点值需要文本、有限数字或布尔值');
    const token=typeof fieldValue==='string'&&inputToken.exec(fieldValue)?.[1];
    if(!token){
      if(typeof fieldValue==='string'&&fieldValue.includes('{{'))throw Error('动态参数必须独占整个节点值');
      return {nodeId,fieldName,fieldValue};
    }
    used.add(token);
    const value=inputs[token]||(token==='reference_audio'?config.referenceAudio:token==='song_audio'?config.songAudio:token==='song_start'?'0:00':token==='song_end'?'1:00':'');
    if(requireValues&&((token==='song_audio'||token==='reference_audio')?!audioName.test(value)||value.split('/').some(part=>part==='..'):token==='text'&&!String(value).trim())){
      throw Error(token==='text'?'请填写要说的正文或要唱的歌词':token==='song_audio'?'请先上传歌曲片段，或配置默认歌曲素材':'请先上传参考音色');
    }
    return {nodeId,fieldName,fieldValue:value};
  });
  if(kind==='speech'&&!used.has('text')||kind==='sing'&&!used.has('text')&&!used.has('song_audio'))throw Error(kind==='speech'?'语音工作流需要一个 {{text}} 节点':'唱歌工作流需要 {{song_audio}} 或 {{text}} 节点');
  return resolved;
}

export function validateRunningHubAudio(input){
  const config=normalizeRunningHubAudio(input);
  for(const kind of ['speech','sing'])if(config[kind].id||config[kind].nodeInfoList.length){
    runningHubAudioNodes(config[kind],kind,{}, {requireValues:false});
    for(const name of [config[kind].songAudio,config[kind].referenceAudio])if(name&&(!audioName.test(name)||name.split('/').includes('..')))throw Error('请使用 RunningHub 上传返回的素材名');
  }
  return config;
}

const outputType=/^(?:audio(?:\/[^;]+)?|mp3|mpeg|wav|wave|x-wav|flac|x-flac|ogg|opus|m4a|aac|webm)$/i;
function audioOutputs(value){
  const rows=value?.results??value?.data?.results??value?.data??[];
  return Array.isArray(rows)?rows.filter(row=>{
    const url=row?.url||row?.fileUrl;
    return typeof url==='string'&&(outputType.test(row.fileType||row.outputType||row.type||'')||/\.(?:wav|mp3|flac|ogg|opus|m4a|aac|webm)(?:[?#]|$)/i.test(url));
  }).map(row=>({url:row.url||row.fileUrl,nodeId:field(row.nodeId??row.node_id)})):[];
}

async function download(url,signal,fetchImpl){
  let target=new URL(url),response;
  for(let redirects=0;redirects<=6;redirects++){
    if(!['http:','https:'].includes(target.protocol)||target.username||target.password)throw Error('音频下载地址无效');
    // Public downloads use DNS-pinned validation on every hop; no API key or
    // browser credentials are forwarded to a CDN or redirect destination.
    if(fetchImpl===fetch){const data=await publicGet(target.href,{signal,binary:true,maxBytes:maxAudioBytes,timeoutMs:60000});response=new Response(data.bytes||null,{status:data.status,headers:{...data.headers,...(data.location?{location:data.location}:{})}});}
    else response=await fetchImpl(target,{signal,redirect:'manual'});
    if(![301,302,303,307,308].includes(response.status))break;
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location||redirects===6)throw Error('音频下载跳转无效或次数过多');target=new URL(location,target);
  }
  if(!response.ok||!response.body||Number(response.headers.get('content-length'))>maxAudioBytes)throw Error('音频下载失败或超过 32MB');
  const reader=response.body.getReader(),chunks=[];
  let length=0;
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      length+=value.length;
      if(length>maxAudioBytes)throw Error('音频超过 32MB');
      chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  const bytes=Buffer.concat(chunks,length);
  const wav=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE';
  const mp3=bytes.toString('ascii',0,3)==='ID3'||bytes.length>2&&bytes[0]===0xff&&(bytes[1]&0xe0)===0xe0;
  const flac=bytes.toString('ascii',0,4)==='fLaC'&&length>=42&&(bytes[4]&127)===0&&bytes.readUIntBE(5,3)===34;
  const ogg=bytes.toString('ascii',0,4)==='OggS',m4a=bytes.toString('ascii',4,8)==='ftyp',webm=bytes.subarray(0,4).toString('hex')==='1a45dfa3';
  const aac=length>2&&bytes[0]===255&&(bytes[1]&246)===240;
  if(length<256||!wav&&!mp3&&!flac&&!ogg&&!m4a&&!webm&&!aac)throw Error('产物不是可识别的音频文件');
  return {bytes,extension:wav?'wav':flac?'flac':ogg?'ogg':m4a?'m4a':webm?'webm':aac?'aac':'mp3'};
}

export async function renderRunningHubAudio({config,kind,inputs,apiConfig,request,signal,assertCurrent=()=>{},onTask=()=>{},fetchImpl=fetch,poll=wait}){
  if(!apiConfig?.apiKey)throw Error('请先在图像生成页保存共用的 RunningHub API Key');
  const nodes=runningHubAudioNodes(config,kind,inputs);
  const legacy=config.mode==='app-legacy';
  const workflow={...apiConfig,mode:config.mode==='workflow'?'workflow':'app',webappId:config.id,workflowId:config.id,instanceType:config.instanceType,discovery:{submitProtocol:legacy?'legacy':'v2'}};
  const submission=runningHubSubmission(workflow,nodes);
  const deadline=AbortSignal.any([AbortSignal.timeout(12*60_000),...(signal?[signal]:[])]);
  const check=()=>{deadline.throwIfAborted();assertCurrent();};
  check();
  let taskId;
  try{
    const created=await request(workflow,submission.path,submission.payload,'POST',{signal:deadline});
    taskId=runningHubTaskId(created);
    if(!/^\d+$/.test(taskId))throw Object.assign(Error('RunningHub 未返回有效任务编号，请在平台核对提交记录'),{deliveryUnknown:true});
    onTask(taskId);
    for(;;){
      await poll(3500,undefined,{signal:deadline});
      check();
      const state=legacy
        ?await request(workflow,'/task/openapi/status',{apiKey:apiConfig.apiKey,taskId},'POST',{signal:deadline,acceptTaskFailure:true})
        :await request(workflow,'/openapi/v2/query',{taskId},'POST',{signal:deadline,acceptTaskFailure:true});
      const status=String(state.status??state.data?.status??state.data??'').toUpperCase();
      if(['FAILED','ERROR','CANCELLED','CANCELED'].includes(status)){
        const detail=state.failedReason||state.data?.failedReason||{};
        const reason=[detail.node_name,detail.exception_message||state.errorMessage||state.data?.errorMessage]
          .filter(value=>typeof value==='string'&&value).join(' · ').split(apiConfig.apiKey).join('[已隐藏]').replace(/https?:\/\/\S+/g,'[已隐藏]').slice(0,120);
        throw Object.assign(Error('RunningHub 音频任务'+(status.startsWith('CANCEL')?'已取消':'失败')+(reason?'：'+reason:'')),{taskFailed:true});
      }
      if(status!=='SUCCESS')continue;
      check();
      const urls=audioOutputs(state);
      const outputs=urls.length?urls:audioOutputs(await request(workflow,'/task/openapi/outputs',{apiKey:apiConfig.apiKey,taskId},'POST',{signal:deadline}));
      const selected=config.outputNodeId&&outputs.some(row=>row.nodeId)
        ?outputs.find(row=>row.nodeId===config.outputNodeId):outputs[config.outputIndex];
      if(!selected)throw Error('所选音频输出不存在，请核对输出节点 '+(config.outputNodeId||'未指定')+' 与序号');
      check();
      const result=await download(selected.url,deadline,fetchImpl);
      check();
      return {...result,taskId,outputNodeId:selected.nodeId||config.outputNodeId||'',outputSelection:selected.nodeId?'node':'index'};
    }
  }catch(error){
    if(taskId)throw Object.assign(Error('RunningHub 任务 '+taskId+'：'+String(error.message).slice(0,170)),{taskId,deliveryUnknown:!error.taskFailed,nonRetryable:true});
    throw error;
  }
}

export async function writeRunningHubFlacAsWav(bytes,file,{ffmpegPath,signal}={}){
  const ffmpeg=ffmpegPath&&existsSync(ffmpegPath)?ffmpegPath:'ffmpeg';
  const temp=file+'.partial';
  const deadline=AbortSignal.any([AbortSignal.timeout(60000),...(signal?[signal]:[])]);
  try{
    await new Promise((resolve,reject)=>{
      const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-n','-f','flac','-i','pipe:0','-map','0:a:0','-c:a','pcm_s16le','-f','wav',temp],
        {windowsHide:true,stdio:['pipe','ignore','ignore'],signal:deadline});
      child.once('error',reject);
      child.once('close',code=>code===0?resolve():reject(Error('FLAC 解码未完成')));
      child.stdin.on('error',()=>{});
      child.stdin.end(bytes);
    });
    deadline.throwIfAborted();
    renameSync(temp,file);
  }catch(error){
    if(error.code==='ENOENT')throw Error('未找到 FFmpeg，无法把 RunningHub 的 FLAC 转成 QQ 可用的 WAV');
    throw error;
  }finally{try{unlinkSync(temp);}catch{}}
}

export function createRunningHubAudioPreviews({scope,now=Date.now,retentionMs=30*60_000,makeId}){
  const jobs=new Map();
  function prune(){
    for(const [id,job] of jobs)if(job.status!=='running'&&now()-job.finishedAt>=retentionMs)jobs.delete(id);
  }
  function result(job){
    const {id,status,taskId,name,error,performance}=job;
    return {jobId:id,status,taskId,name,error,performance,engine:'runninghub',label:'RunningHub'};
  }
  function start(key,performance,execute){
    prune();
    if([...jobs.values()].filter(job=>job.status==='running').length>=4)throw Error('正在试听的 RunningHub 任务过多');
    const controller=new AbortController();
    const job={id:makeId(),key,scope:scope(key),status:'running',controller,performance};
    jobs.set(job.id,job);
    void (async()=>{
      try{
        const name=await execute({signal:controller.signal,onTask:id=>{job.taskId=id;}});
        controller.signal.throwIfAborted();
        if(job.scope!==scope(key))throw Error('试听期间账号或人设已变化');
        job.name=name;
        job.status='succeeded';
      }catch(error){
        job.status='failed';
        job.error=String(error.message||error).slice(0,220);
      }finally{job.finishedAt=now();}
    })();
    return result(job);
  }
  function status(id){
    prune();
    const job=jobs.get(id);
    if(!job||job.scope!==scope(job.key))throw Error('试听记录已过期或账号已变化；若已提交，请按原任务编号核对');
    return result(job);
  }
  function close(){
    for(const job of jobs.values())job.controller.abort();
    jobs.clear();
  }
  return {start,status,close};
}
