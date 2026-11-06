import {modelImagePrompt} from './image-studio.js';
import {protectedPromptTokens} from './image-model-prompts.js';
const clone=value=>JSON.parse(JSON.stringify(value));
const linked=value=>Array.isArray(value)&&value.length===2&&['string','number'].includes(typeof value[0])&&Number.isInteger(value[1]);
export function localImageMetadata(spec={}){
 const out={};for(const name of ['promptLanguage','promptModel','fixedPromptMode','triggerWords','note'])if(typeof spec[name]==='string')out[name]=spec[name].slice(0,name==='note'||name==='triggerWords'?4000:100);
 if(spec.discovery&&typeof spec.discovery==='object'&&!Array.isArray(spec.discovery))out.discovery=clone(spec.discovery);
 if(Array.isArray(spec.extraNodes))out.extraNodes=spec.extraNodes.slice(0,80).map(row=>({nodeId:String(row.nodeId||''),fieldName:String(row.fieldName||''),fieldValue:row.fieldValue}));
 return out;
}
export function localImageTemplate(workflow={},graph={}, {language='zh',usesReference=false}={}){
 const discovery=clone(workflow.discovery||{}),fields=[...(discovery.fields||[])];
 for(const [nodeId,node]of Object.entries(graph))for(const [fieldName,value]of Object.entries(node.inputs||{}))if(typeof value==='string'){
  const index=fields.findIndex(row=>String(row.nodeId)===nodeId&&row.fieldName===fieldName);const field={nodeId,fieldName,value};if(index>=0)fields[index]={...fields[index],...field};else fields.push(field);
 }
 // Only a separate, connected Description prefix is inferred automatically.
 // Never treat a variable scene prompt or an unused note as a fixed prefix.
 const active=new Set(),visit=id=>{id=String(id);if(active.has(id)||!graph[id])return;active.add(id);for(const value of Object.values(graph[id].inputs||{}))if(linked(value))visit(value[0]);};
 if(workflow.output?.node)visit(workflow.output.node);else Object.keys(graph).forEach(visit);
 const targets=[...(discovery.prefixTargets||[])];
 const variable=workflow.inputs?.prompt;
 for(const [nodeId,node]of Object.entries(graph))if(active.has(nodeId)&&typeof node.inputs?.text_a==='string'&&/Description\s*:\s*$/i.test(node.inputs.text_a)&&linked(node.inputs.text_b)&&String(node.inputs.text_b[0])===String(variable?.node)&&node.inputs.text_b[1]===0){
  if(!targets.some(t=>String(t.nodeId)===nodeId&&t.fieldName==='text_a'))targets.push({nodeId,fieldName:'text_a'});
 }
 for(const target of targets){
  const nodeId=String(target.nodeId),fieldName=String(target.fieldName);
  if(nodeId===String(variable?.node)&&fieldName===variable?.field)throw Error('固定前缀与本轮画面提示词不能绑定同一字段');
  if(Object.keys(graph).length&&(!active.has(nodeId)||typeof graph[nodeId]?.inputs?.[fieldName]!=='string'))throw Error('固定前缀节点不可用或不在当前输出分支：'+nodeId+'/'+fieldName);
 }
 discovery.fields=fields;discovery.prefixTargets=targets;
 if(targets.length)discovery.reference=targets.map(t=>{const extra=(workflow.extraNodes||[]).find(row=>String(row.nodeId)===String(t.nodeId)&&row.fieldName===t.fieldName);return String(extra?extra.fieldValue:fields.find(f=>String(f.nodeId)===String(t.nodeId)&&f.fieldName===t.fieldName)?.value||'');}).join('\n').slice(0,900);
 return {...localImageMetadata(workflow),name:workflow.name||'',promptLanguage:workflow.promptLanguage||language,personaReference:usesReference,negativeTargets:workflow.inputs?.negativePrompt?.node?[{nodeId:workflow.inputs.negativePrompt.node,fieldName:workflow.inputs.negativePrompt.field}]:[],discovery};
}
export function applyLocalImageFixedPrompts(graph,spec,items=[]){
 if(!items?.length)return graph;
 if(!Array.isArray(items)||items.length>16)throw Error('固定前缀参数无效');
 const template=localImageTemplate(spec,graph),targets=new Map(template.discovery.prefixTargets.map(t=>[String(t.nodeId)+':'+t.fieldName,t]));
 for(const item of items){
  const key=String(item.nodeId)+':'+item.fieldName,target=targets.get(key);
  if(!target)throw Error('固定前缀不能写入未识别字段：'+key);
  const override=(spec.extraNodes||[]).find(row=>String(row.nodeId)===String(target.nodeId)&&row.fieldName===target.fieldName);
  const original=String(override?override.fieldValue:graph[String(target.nodeId)].inputs[target.fieldName]);
  modelImagePrompt(item.prompt,{language:'any',minimum:1});const prompt=String(item.prompt);
  if(!protectedPromptTokens(original).every(token=>prompt.includes(token)))throw Error('固定前缀遗漏已锁定的画师或触发词');
  graph[String(target.nodeId)].inputs[target.fieldName]=prompt;
 }
 return graph;
}
// Keep the shared director rules and this turn's visual facts intact. Only
// optional old dialogue excerpts can shrink for an 8 GB local context window.
export function fitLocalImageBrief(system,user,{window=4096,maxTokens=512}={}){
 let brief;try{brief=JSON.parse(user);}catch{return {user,stats:null};}
 if(!window||!brief||typeof brief!=='object')return {user,stats:null};
 const estimate=value=>Math.ceil(Buffer.byteLength(String(value),'utf8')/3)+8;
 const budget=Math.max(512,window-maxTokens-320),cost=()=>estimate(system)+estimate(JSON.stringify(brief))+32;
 const before=cost();let excerpts=0;
 for(const field of ['recentConversation','appearanceContext']){
  if(!Array.isArray(brief[field]))continue;
  brief[field]=brief[field].map(row=>({...row}));
  for(const row of brief[field]){
   while(cost()>budget&&typeof row.text==='string'&&row.text.length>40){row.text=Array.from(row.text).slice(0,Math.floor(Array.from(row.text).length*.7)).join('');excerpts++;}
   if(cost()>budget&&row.text){row.text='[旧对话按容量省略，不得猜测]';excerpts++;}
  }
 }
 return {user:JSON.stringify(brief),stats:{window,inputBudget:budget,beforeEstimate:before,afterEstimate:cost(),oldDialogueExcerpted:excerpts>0,currentVisualFactsPreserved:true,requiredTooLarge:cost()>budget}};
}
