import {parseRunningHubExample} from './image-studio.js';
import {normalizeRunningHubAudio} from './runninghub-audio.js';
import {inferAudioExampleBindings} from './ui/execution-overview.js';

// This is data parsing only. A pasted example is never executed as a command.
export function importRunningHubAudio(example,kind,existing={}){
 if(!['speech','sing'].includes(kind))throw Error('请选择语音或唱歌');
 const text=String(example||'').trim();let info;
 if(/^\s*[\[{]/.test(text)){
  let body;try{body=JSON.parse(text);}catch{throw Error('节点参数不是完整 JSON');}
  if(Array.isArray(body))body={nodeInfoList:body};
  const id=String(body.webappId||body.workflowId||body.id||existing.id||'');
  if(!/^\d{8,24}$/.test(id))throw Error('请填写应用 ID，或粘贴带地址的完整 cURL');
  const mode=body.workflowId?'workflow':existing.mode==='workflow'?'workflow':'ai-app';
  info=parseRunningHubExample('curl --request POST https://www.runninghub.cn/openapi/v2/run/'+(mode==='workflow'?'workflow':'ai-app')+'/'+id+' --data-raw '+JSON.stringify(JSON.stringify(body)));
 }else info=parseRunningHubExample(text);
 const nodes=info.fields.map(row=>({nodeId:String(row.nodeId),fieldName:row.fieldName,fieldValue:row.value}));
 if(!nodes.length)throw Error('请求示例没有可导入的节点参数');
 const targetId=info.targetId||info.id||existing.id;
 let config={...existing,id:targetId,...(targetId!==existing.id?{outputNodeId:'',outputIndex:0}:{}),mode:info.mode==='workflow'?'workflow':info.submitProtocol==='legacy'?'app-legacy':'app',instanceType:info.instanceType,nodeInfoList:nodes};
 const warnings=[];
 // This preset is based on the inspected graph: 23 -> prompt, 45 -> target,
 // 46 -> final mix with accompaniment. Other workflows require explicit binding.
 if(kind==='sing'&&config.id==='2055815336380911617'&&nodes.some(n=>n.nodeId==='23'&&n.fieldName==='audio')&&nodes.some(n=>n.nodeId==='45'&&n.fieldName==='audio')){
  const mapped={'23:audio':'{{reference_audio}}','45:audio':'{{song_audio}}','57:start_time':'{{song_start}}','57:end_time':'{{song_end}}'};
  config.nodeInfoList=nodes.map(n=>({...n,fieldValue:mapped[n.nodeId+':'+n.fieldName]||n.fieldValue}));
  config.outputNodeId='46';config.outputIndex=1;
 }else{
  const bindings=inferAudioExampleBindings(info.fields,kind);
  for(const [index,role]of Object.entries(bindings))if(!nodes.some(n=>n.fieldValue===role))nodes[index].fieldValue=role;
  if(!nodes.some(n=>n.fieldValue===(kind==='speech'?'{{text}}':'{{song_audio}}')))
   warnings.push(kind==='sing'?'请在下方选择哪个音频节点接收原曲，哪个接收参考音色。':'请在下方选择接收台词的节点。');
 }
 config=normalizeRunningHubAudio({[kind]:config})[kind];
 return {ok:true,config,warnings,fields:info.fields,bindings:config.nodeInfoList.filter(n=>/^\{\{/.test(String(n.fieldValue)))};
}
