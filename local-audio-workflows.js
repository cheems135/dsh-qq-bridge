import {readFileSync,existsSync,mkdirSync,writeFileSync,statSync,renameSync} from 'node:fs';
import {join,basename,extname} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {convertUiWorkflow} from './workflow-inspector.js';
import {createComfyRuntime} from './comfyui-runtime.js';

const kinds=new Set(['speech','sing']);
const clone=value=>structuredClone(value);
export function localAudioUrl(value){
  const u=new URL(value||'http://127.0.0.1:8188');
  if(!['http:','https:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.search||u.hash)throw Error('本地音频只接受不含凭据的本机回环地址');
  return u.href.replace(/\/$/,'');
}
export function inspectLocalAudioWorkflow(value,kind,objectInfo={}){
  if(!kinds.has(kind))throw Error('请选择语音或唱歌');
  const graph=typeof value==='string'?JSON.parse(value):value;
  const converted=Array.isArray(graph?.nodes)?convertUiWorkflow(graph,objectInfo):{api:graph?.prompt||graph,errors:[],warnings:[]};
  if(converted.errors.length)throw Error(converted.errors.join('；'));
  const api=converted.api;
  if(!api||Array.isArray(api)||!Object.keys(api).length||Object.keys(api).length>3000)throw Error('没有可运行的 ComfyUI 节点');
  const candidates={text:[],song_audio:[],reference_audio:[],song_start:[],song_end:[]},outputs=[];
  for(const [node,n] of Object.entries(api)){
    if(!n?.class_type||!n.inputs||typeof n.inputs!=='object')throw Error('无效节点：'+node);
    if(/(?:Save|Preview).*Audio|Audio.*(?:Save|Output)/i.test(n.class_type))outputs.push({node,field:'audio',kind:'audio',label:n._meta?.title||n.class_type});
    for(const [field,v] of Object.entries(n.inputs)){
      if(Array.isArray(v)&&v.length===2&&Number.isInteger(v[1])){if(!api[String(v[0])])throw Error('节点引用不存在：'+node);continue;}
      const entry={node,field,label:(n._meta?.title||n.class_type)+' · '+field};
      if(/^(?:text|lyrics|prompt|text_content)$/.test(field))candidates.text.push(entry);
      if(/audio|song|reference|voice/i.test(field+' '+n.class_type)&&typeof v==='string'&&(/\.(?:wav|mp3|flac|ogg|m4a)$/i.test(v)||/load|upload/i.test(n.class_type)&&/^(?:audio|audio_file|file|filename)$/.test(field))){
        candidates[/reference|ref_audio|voice|参考|音色/i.test(field+' '+(n._meta?.title||''))?'reference_audio':'song_audio'].push(entry);
      }
      if(/^(?:start_time|start_seconds)$/.test(field))candidates.song_start.push(entry);
      if(/^(?:end_time|end_seconds|duration)$/.test(field))candidates.song_end.push(entry);
    }
  }
  if(!outputs.length)throw Error('未找到保存音频的输出节点，请使用 SaveAudio 节点并重新导入');
  const inputs=Object.fromEntries(Object.entries(candidates).map(([k,rows])=>[k,rows.length===1?{node:rows[0].node,field:rows[0].field}:{}]));
  return {api,candidates,inputs,outputs,warnings:converted.warnings||[],output:outputs.length===1?outputs[0]:null};
}
export function createLocalAudioWorkflows({directory,mediaDir,getComfyUrl=()=>'',fetchImpl=fetch}={}){
  mkdirSync(directory,{recursive:true});
  const stateFile=join(directory,'config.json'),inspections=new Map();let state={version:1,speech:{mode:'api',presets:[]},sing:{mode:'api',presets:[]}},loadError='';
  try{if(existsSync(stateFile)){
    const loaded=JSON.parse(readFileSync(stateFile,'utf8'));
    for(const kind of kinds)if(!loaded[kind]||!Array.isArray(loaded[kind].presets)||!['api','local'].includes(loaded[kind].mode))throw Error('invalid configuration');
    state=loaded;
  }}catch{loadError='本地音频配置损坏，保留原文件，未覆盖；本地音频暂停，QQ 桥接可继续运行';}
  const save=()=>{writeFileSync(stateFile+'.tmp',JSON.stringify(state,null,2));renameSync(stateFile+'.tmp',stateFile);};
  const snapshot=()=>({...clone(state),...(loadError?{error:loadError}: {})});
  const current=kind=>state[kind]?.presets?.find(p=>p.id===state[kind].workflowId);
  let runningConfig=null,active=0;
  const runtime=createComfyRuntime({root:directory,fetchImpl,getConfig:()=>runningConfig});
  let chain=Promise.resolve();
  async function action(input){
    if(loadError)throw Error(loadError);
    const kind=input.kind;if(!kinds.has(kind))throw Error('请选择语音或唱歌');
    if(input.action==='inspect'){
      const url=localAudioUrl(input.baseUrl||getComfyUrl());let info={};
      if(Array.isArray((typeof input.workflow==='string'?JSON.parse(input.workflow):input.workflow)?.nodes)){
        const r=await fetchImpl(url+'/object_info',{signal:AbortSignal.timeout(15000),redirect:'error'});if(!r.ok)throw Error('无法读取 ComfyUI 节点定义');info=await r.json();
      }
      const analysis=inspectLocalAudioWorkflow(input.workflow,kind,info),token=randomUUID();
      for(const [key,row] of inspections)if(Date.now()-row.at>900000)inspections.delete(key);
      if(inspections.size>=20)throw Error('识别结果过多，请保存或稍后重试');
      inspections.set(token,{...analysis,kind,baseUrl:url,at:Date.now()});
      return {ok:true,token,...analysis,api:undefined};
    }
    if(input.action==='import'){
      const found=inspections.get(input.token);if(!found||found.kind!==kind||Date.now()-found.at>900000)throw Error('识别结果已过期，请重新导入');
      const output=input.output||found.output,inputs=input.inputs||found.inputs;
      if(!found.outputs.some(o=>o.node===output?.node&&o.field===output?.field))throw Error('请选择识别出的音频输出');
      const ancestors=new Set(),visit=id=>{if(ancestors.has(id))return;ancestors.add(id);for(const v of Object.values(found.api[id]?.inputs||{}))if(Array.isArray(v)&&v.length===2&&Number.isInteger(v[1]))visit(String(v[0]));};visit(output.node);
      for(const [key,map]of Object.entries(inputs))if(map?.node&&(!Object.hasOwn(candidatesFor(found,key),map.node+':'+map.field)||!ancestors.has(map.node)))throw Error('输入映射不在所选输出路径：'+key);
      if(kind==='speech'&&!inputs.text?.node)throw Error('请选择台词输入');
      const id='audio-'+randomUUID().slice(0,12),file=id+'.json',graph=Object.fromEntries(Object.entries(found.api).filter(([id])=>ancestors.has(id)));
      writeFileSync(join(directory,file),JSON.stringify(graph));
      const entry={id,name:String(input.name||'本地'+(kind==='sing'?'唱歌':'语音')).slice(0,100),baseUrl:found.baseUrl,file,inputs,output,timeoutMs:900000,fingerprint:createHash('sha256').update(JSON.stringify(graph)).digest('hex')};
      if((state[kind].presets||[]).length>=30)throw Error('最多保留30条本地音频工作流');
      state[kind].presets=[...(state[kind].presets||[]),entry];save();inspections.delete(input.token);return {ok:true,entry,state:snapshot()};
    }
    if(input.action==='select'){
      if(active)throw Error('本地音频任务正在运行，完成后再切换来源');
      if(!['api','local'].includes(input.mode))throw Error('请选择本地或 API');
      const entry=state[kind].presets?.find(p=>p.id===input.workflowId);
      if(input.mode==='local'&&!entry)throw Error('请先导入并选择本地音频工作流');
      const old=state[kind];state[kind]={...old,mode:input.mode,...(entry?{workflowId:entry.id}: {})};try{save();}catch(e){state[kind]=old;throw e;}
      return {ok:true,state:snapshot()};
    }
    if(input.action==='upload'){
      const bytes=Buffer.from(String(input.data||''),'base64');if(!bytes.length||bytes.length>16*1024*1024)throw Error('请选择16MB以内的音频');
      const ext=extname(basename(input.name||'')).toLowerCase();if(!['.wav','.mp3','.flac','.ogg','.m4a'].includes(ext))throw Error('不支持的音频格式');
      if(!['song_audio','reference_audio'].includes(input.role))throw Error('请选择原曲或参考音色');
      const name=randomUUID()+ext;writeFileSync(join(directory,name),bytes);state[kind][input.role]=name;save();return {ok:true,state:snapshot()};
    }
    throw Error('未知本地音频操作');
  }
  function candidatesFor(found,key){return Object.fromEntries((found.candidates[key]||[]).map(row=>[row.node+':'+row.field,true]));}
  async function render(kind,args={},options={}){
    if(loadError)throw Error(loadError);
    const config=clone(state[kind]),entry=clone(current(kind));if(config.mode!=='local'||!entry)throw Error('未选择本地音频工作流');
    const execute=async()=>{
      const baseUrl=localAudioUrl(entry.baseUrl),params={};
      for(const role of ['song_audio','reference_audio'])if(entry.inputs[role]?.node){
        const file=options.files?.[role]||config[role]&&join(directory,basename(config[role]));
        if(!file||!existsSync(file)||statSync(file).size>32*1024*1024)throw Error('缺少本地'+(role==='song_audio'?'原曲':'参考音色'));
        const data=new FormData();data.append('image',new Blob([readFileSync(file)]),basename(file));data.append('type','input');
        const r=await fetchImpl(baseUrl+'/upload/image',{method:'POST',body:data,signal:options.signal,redirect:'error'});if(!r.ok)throw Error('ComfyUI 音频上传失败：'+r.status);
        const uploaded=await r.json();if(!uploaded.name)throw Error('ComfyUI 没有返回上传文件名');params[role]=(uploaded.subfolder?uploaded.subfolder+'/':'')+uploaded.name;
      }
      params.text=String(args.text||'');
      if(Number.isFinite(options.duration)&&options.duration>0){
        const graph=JSON.parse(readFileSync(join(directory,entry.file),'utf8'));
        for(const [key,seconds]of [['song_start',0],['song_end',options.duration]])if(entry.inputs[key]?.node){
          const map=entry.inputs[key],old=graph[map.node].inputs[map.field];
          params[key]=typeof old==='number'?seconds:typeof old==='string'&&old.includes(':')?Math.floor(seconds/60)+':'+String(Math.floor(seconds%60)).padStart(2,'0'):String(seconds);
        }
      }
      runningConfig={baseUrl,mediaDir:typeof mediaDir==='function'?mediaDir():mediaDir,memoryProfile:'workflow',workflows:{audio:entry}};
      const result=await runtime.run('audio',{params},{signal:options.signal});
      const file=result.media?.find(m=>m.kind==='audio')?.file;if(!file)throw Error('工作流没有返回可用音频');return file;
    };
    active++;const promise=chain.then(execute,execute).finally(()=>{active--;});chain=promise.catch(()=>{});return promise;
  }
  return {snapshot,action,render,isLocal:kind=>state[kind]?.mode==='local',current};
}
