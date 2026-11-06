import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {mediaWorkflowSpecs,chatWorkflowSpec} from './local-config.js';

const state=(supported,reason,evidence='configuration')=>({supported,reason,evidence});
const parse=value=>{try{return JSON.parse(String(value).trim().replace(/^```(?:json)?\s*|\s*```$/g,''));}catch{return null;}};
export function createCapabilityDetector({getConfig,root,workDir,probe,services=async()=>({}),now=()=>Date.now()}={}){
 let cached=null,running=null;
 const file=join(workDir,'model-capabilities-'+createHash('sha256').update(String(root)).digest('hex').slice(0,12)+'.json');
 function safeChat(){try{return chatWorkflowSpec(getConfig(),'chat');}catch{return null;}}
 function identity(){const c=getConfig(),files=[safeChat(),c.workflows?.caption,...mediaWorkflowSpecs(c)].filter(Boolean).map(spec=>{try{return createHash('sha256').update(readFileSync(resolve(root,spec.file))).digest('hex');}catch{return 'missing';}});return createHash('sha256').update(JSON.stringify([c.backend,c.modelBaseUrl,c.modelId,c.comfyUrl,c.chatWorkflow,c.visionMode,c.voiceEnabled,c.memoryProfile,c.maxTokens,files])).digest('hex');}
 function load(){const id=identity();if(cached?.fingerprint===id&&now()-cached.checkedAt<86400000)return cached;try{const value=JSON.parse(readFileSync(file,'utf8'));if(value.fingerprint===id&&now()-value.checkedAt<86400000)return cached=value;}catch{}return null;}
 function save(value){cached=value;mkdirSync(workDir,{recursive:true});writeFileSync(file+'.tmp',JSON.stringify(value,null,2));renameSync(file+'.tmp',file);}
 function base(){const c=getConfig(),chat=safeChat();let contextWindow=4096;try{const graph=JSON.parse(readFileSync(resolve(root,chat.file)));const sizes=Object.values(graph).filter(n=>n.class_type==='QwenTE_ModelLoader').map(n=>Number(n.inputs?.['上下文长度'])).filter(n=>n>=1024);if(sizes.length)contextWindow=Math.min(...sizes);}catch{}
  if(c.memoryProfile==='8gb')contextWindow=Math.min(4096,contextWindow);
  return {fingerprint:identity(),checkedAt:now(),model:c.backend==='comfyui'?c.chatWorkflow:c.modelId,backend:c.backend,status:'pending',contextWindow,maxOutputTokens:c.maxTokens,features:{text:state(null,'等待短文本实测','pending'),json:state(null,'等待结构化输出实测','pending'),tools:state(null,'等待工具协议实测','pending'),vision:state(c.visionMode==='off'?false:null,c.visionMode==='off'?'本地看图已关闭':'等待视觉实测','pending'),native:state(false,'本地尚未接入宿主原生工具流程'),special:state(false,'本地尚未接入此特殊流程')}};
 }
 async function snapshot(){const value=structuredClone(load()||base()),service=await services();value.busy=service.busy===true;value.serviceReachable=service.reachable!==false;if(service.reachable===false)value.status='unavailable';
  for(const kind of ['image','video']){const specs=mediaWorkflowSpecs(getConfig()).filter(row=>row.kind===kind);const valid=specs.some(spec=>{try{const graph=JSON.parse(readFileSync(resolve(root,spec.file),'utf8'));return !!graph[spec.inputs?.prompt?.node]?.inputs&&spec.inputs.prompt.field in graph[spec.inputs.prompt.node].inputs&&!!graph[spec.output?.node];}catch{return false;}});value.features[kind]=state(service.reachable!==false&&valid,valid?'本地工作流文件及输入输出已登记；未进行媒体生成实测':'没有可用的本地'+(kind==='image'?'图片':'视频')+'工作流','workflow');}
  value.features.speech=state(getConfig().voiceEnabled&&service.voice===true,getConfig().voiceEnabled&&service.voice?'本地语音服务可连接':'本地语音服务未就绪','service');return value;
 }
 async function detect({vision=false,force=false}={}){
  if(running){const value=await running;if(vision&&getConfig().visionMode!=='off'&&typeof value.features.vision?.supported!=='boolean'&&!value.busy&&value.serviceReachable)return detect({vision});return value;}
  running=(async()=>{
   const before=await snapshot();if(before.busy||!before.serviceReachable)return before;
   if(!force&&before.status==='ready'&&(!vision||typeof before.features.vision?.supported==='boolean'))return before;
   const id=before.fingerprint,value=load()||base();
   try{
    if(force||value.status!=='ready'){
     const nonce=randomUUID(),result=await probe({kind:'protocol',nonce}),message=result?.choices?.[0]?.message||result?.message||result,content=typeof result==='string'?result:String(message.content||'');
     const json=parse(content),calls=message?.tool_calls||[],native=calls.some(call=>{const args=typeof call.function?.arguments==='string'?parse(call.function.arguments):call.function?.arguments;return call.function?.name==='capability_ping'&&args?.nonce===nonce;});
     const strict=json?.action==='capability_ping'&&json.arguments?.nonce===nonce;
     value.features.text=state(!!content.trim()||native,'已执行短文本测试','probe');value.features.json=state(!!json||native,json||native?'已返回可解析的结构化结果':'未通过结构化输出测试','probe');value.features.tools=state(strict||native,strict||native?'已通过带随机校验值的工具协议测试':'未通过工具协议测试','probe');value.status='ready';
    }
    if(vision&&getConfig().visionMode!=='off'){
     try{const result=String(await probe({kind:'vision'}));value.features.vision=state(/红|red/i.test(result)&&!/蓝|绿|黑|blue|green|black/i.test(result),'已使用受控色块进行本机视觉测试','probe');}catch{value.features.vision=state(false,'本机视觉测试未完成，本轮不会使用云端看图','probe');}
    }
   }catch(error){if(error?.name==='AbortError')throw error;value.status='unavailable';value.features.text=state(false,'本地短文本测试未完成','probe');}
   value.checkedAt=now();if(identity()===id)save(value);return snapshot();
  })().finally(()=>running=null);return running;
 }
 return {snapshot,detect,invalidate(){cached=null;},identity};
}
