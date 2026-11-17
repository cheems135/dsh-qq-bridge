import {existsSync,readFileSync,mkdirSync,writeFileSync,renameSync} from 'node:fs';
import {dirname} from 'node:path';

const field=(label,options)=>({label,options:options.map(([id,zh,en])=>({id,zh,en}))});
export const PROMPT_FIELDS={
 voice:{label:'语音表达',fields:{pace:field('语速与停顿',[['context','按语境自然表达','Use a natural pace appropriate to the context'],['relaxed','从容、停顿清楚','Speak at a relaxed pace with clear natural pauses'],['brisk','轻快、吐字清楚','Speak briskly with clear articulation']]),intensity:field('情绪强度',[['context','按语境与人设决定','Follow the context and persona'],['restrained','克制自然','Keep emotional expression subtle and natural'],['expressive','更有情绪变化','Use expressive but natural emotional variation']])}},
 chat:{label:'聊天表达',fields:{tone:field('说话方式',[['persona','沿用人设','Follow the persona'],['casual','自然口语','Use natural conversational language'],['calm','平和直接','Use calm, direct language']]),detail:field('回复详略',[['adaptive','按话题决定','Adapt detail to the topic'],['concise','简洁但保留重点','Be concise while preserving key points'],['detailed','需要时充分解释','Explain thoroughly when useful']])}},
 image:{label:'生图描述',fields:{detail:field('画面描述详略',[['normal','沿用模型模板','Follow the model template'],['concise','减少装饰性细节','Reduce decorative detail'],['detailed','增加有用的空间细节','Include useful spatial detail']]),light:field('未指定时的光线偏好',[['scene','符合时间与场景','Match the time and setting'],['soft','柔和自然','Prefer soft, natural-looking light'],['clear','清晰明快','Prefer clear, bright presentation']])}},
 video:{label:'视频描述',fields:{motion:field('未指定时的动作偏好',[['scene','符合当前场景','Match the scene'],['subtle','细微自然','Prefer subtle natural movement'],['lively','活泼连贯','Prefer lively, coherent movement']]),camera:field('未指定时的镜头偏好',[['original','沿用基础画面','Keep the base composition'],['steady','稳定镜头','Prefer a steady shot'],['gentle','轻微跟随','Prefer gentle tracking']])}}
};
export const OTHER_PROMPT_AREAS=[['视觉理解','图片与视频的观察要求'],['工具规划','搜索、工具选择与多步操作'],['群聊参与','接话判断与说话者区分'],['主动分享','主动聊天与分享感想'],['日程与记忆','计划、整理与检索'],['手账与空间','日记、动态与评论表达'],['等待与结果核对','等待语、失败说明与送达检查']];
export function defaultPromptPreferences(){return Object.fromEntries(Object.entries(PROMPT_FIELDS).map(([kind,group])=>[kind,Object.fromEntries(Object.entries(group.fields).map(([key,spec])=>[key,spec.options[0].id]))]));}
export function normalizePromptPreferences(input=defaultPromptPreferences()){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('请选择有效的中文配置');
 const out=defaultPromptPreferences();
 for(const [kind,values]of Object.entries(input)){
  const group=PROMPT_FIELDS[kind];if(!Object.hasOwn(PROMPT_FIELDS,kind)||!values||typeof values!=='object'||Array.isArray(values))throw Error('未知的提示词类别：'+kind);
  for(const [key,value]of Object.entries(values)){
   if(key==='customText'){
    if(typeof value!=='string'||value.length>4000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw Error('自定义提示词须为不超过 4000 字符的文字');
    if(value.trim())out[kind].customText=value;
    continue;
   }
   if(!Object.hasOwn(group.fields,key)||!group.fields[key].options.some(o=>o.id===value))throw Error('不支持的配置项：'+kind+'.'+key);
   out[kind][key]=value;
  }
 }
 return out;
}
export function promptPreferenceRule(kind,values,language='zh'){
 const normalized=normalizePromptPreferences(values),group=PROMPT_FIELDS[kind];if(!group)return '';
 const selected=Object.entries(group.fields).filter(([key,spec])=>normalized[kind][key]!==spec.options[0].id).map(([key,spec])=>spec.options.find(o=>o.id===normalized[kind][key]));
 const custom=normalized[kind].customText||'';
 if(!selected.length&&!custom)return '';
 const preset=selected.length?(language==='en'?'Presentation preferences, only where the current request leaves a choice; preserve identity, time, task requirements and permissions: '+selected.map(o=>o.en).join('; ')+'.':'【呈现偏好】仅在本轮未明确指定时采用，不改变人设身份、当前时间、任务要求和权限：'+selected.map(o=>o.zh).join('；')+'。'):'';
 const additional=custom?(language==='en'?'Supplementary presentation instructions (original text, not automatically translated); preserve identity, actual time, task requirements and permissions:\n':'【自定义表达补充】保留人设身份、实际时间、当前任务要求与权限，以下为表达补充：\n')+custom:'';
 return [preset,additional].filter(Boolean).join('\n');
}
export function createPromptPreferenceStore(file){
 let data={revision:0,values:defaultPromptPreferences(),history:[]},warning='';
 if(existsSync(file)){
  try{const saved=JSON.parse(readFileSync(file,'utf8'));data={revision:Number(saved.revision)||0,values:normalizePromptPreferences(saved.values),history:Array.isArray(saved.history)?saved.history.slice(-30):[]};}catch{warning='配置文件无法读取，暂用默认设置；原文件尚未改动。';}
 }
 const snapshot=()=>({...structuredClone(data),warning});
 const preview=values=>{values=normalizePromptPreferences(values);return {values,rules:Object.fromEntries(Object.keys(PROMPT_FIELDS).map(k=>[k,{zh:promptPreferenceRule(k,values,'zh'),en:promptPreferenceRule(k,values,'en')}]))};};
 function save(values,expectedRevision){
  if(expectedRevision!==data.revision)throw Error('配置已在其他窗口修改，请先重新读取再保存');
  values=normalizePromptPreferences(values);
  if(JSON.stringify(values)===JSON.stringify(data.values)&&!warning)return snapshot();
  const next={revision:data.revision+1,values,history:[...data.history,{revision:data.revision,at:Date.now(),values:data.values}].slice(-30)};
  mkdirSync(dirname(file),{recursive:true});const tmp=file+'.tmp';writeFileSync(tmp,JSON.stringify(next,null,2),'utf8');renameSync(tmp,file);data=next;warning='';return snapshot();
 }
 return {snapshot,preview,save,restore(revision,expectedRevision){const old=data.history.find(h=>h.revision===revision);if(!old)throw Error('该历史版本已不存在');return save(old.values,expectedRevision);},reset(expectedRevision){return save(defaultPromptPreferences(),expectedRevision);}};
}

export function voicePromptInstructions(base='',values){const rule=promptPreferenceRule('voice',values),text=String(base||'').trim();return rule&&!text.includes(rule)?[text,rule].filter(Boolean).join('\n'):text;}
