import {createHash} from 'node:crypto';

const generation=/temperature|温度|随机度|token|length|长度|轮数|steps?|步数|cfg|guidance|width|height|宽|高|frames?|帧|fps|top[_ ]?[pk]|min[_ ]?p|penalty|惩罚|seed|种子|n_ctx|context|上下文|gpu.*layers?|GPU层数|思考|think|Flash Attention|KV缓存|sampler|采样|scheduler|调度|denoise|strength|强度|batch|批次/i;
const forbidden=new Set(['__proto__','constructor','prototype']);
const address=(node,field)=>String(node)+'\0'+String(field);
export function normalizeParameterOverrides(rows=[]){
 if(!Array.isArray(rows)||rows.length>96)throw Error('工作流参数应是最多96项的列表');
 const seen=new Set();return rows.map(row=>{
  const node=String(row?.node||''),field=String(row?.field||''),value=row?.value;
  if(!node||node.length>100||!field||field.length>128||forbidden.has(field)||forbidden.has(node)||seen.has(address(node,field)))throw Error('工作流参数节点或字段无效、重复');
  if(!['number','boolean','string'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>200)throw Error('工作流参数只能是有限数字、开关或选项');
  seen.add(address(node,field));return {node,field,value};
 });
}
function protectedFields(spec){return new Set(['prompt','negativePrompt','image','images','imageEnabled','system','history','requestId'].map(key=>spec.inputs?.[key]).filter(b=>b?.node).map(b=>address(b.node,b.field)));}
export function describeWorkflowParameters(api,info,spec){
 const reachable=new Set(),visit=id=>{id=String(id);if(reachable.has(id)||!api[id])return;reachable.add(id);for(const v of Object.values(api[id].inputs||{}))if(Array.isArray(v)&&v.length===2&&Number.isInteger(v[1]))visit(v[0]);};visit(spec.output?.node);
 const protectedSet=protectedFields(spec),overrides=normalizeParameterOverrides(spec.parameterOverrides),parameters=[];
 for(const [node,item]of Object.entries(api)){
  if(!reachable.has(node))continue;
  const schema=info[item.class_type]?.input||{};
  for(const [field,value]of Object.entries(item.inputs||{})){
   if(protectedSet.has(address(node,field))||!generation.test(field==='value'?String(item._meta?.title||''):field))continue;
   const definition=schema.required?.[field]||schema.optional?.[field];if(!definition||Array.isArray(value)||value===null)continue;
   const [raw,limits={}]=definition,type=Array.isArray(raw)?'enum':raw==='BOOLEAN'?'boolean':raw==='INT'?'integer':raw==='FLOAT'?'number':'';
   if(!type||type==='enum'&&(raw.length>128||raw.some(v=>typeof v!=='string')))continue;
   const mapping=Object.entries(spec.inputs||{}).find(([key,b])=>['temperature','maxTokens'].includes(key)&&address(b.node,b.field)===address(node,field));
   const override=overrides.find(row=>address(row.node,row.field)===address(node,field));
   parameters.push({node,field,nodeLabel:item._meta?.title||item.class_type,type,defaultValue:value,value:override?override.value:value,overridden:!!override,...(mapping?{managedBy:mapping[0]}:{}),...(type==='enum'?{options:raw}:{}),...Object.fromEntries(['min','max','step'].filter(k=>typeof limits[k]==='number'&&Number.isFinite(limits[k])).map(k=>[k,limits[k]]))});
  }
 }
 const fingerprint=createHash('sha256').update(JSON.stringify({api,parameters})).digest('hex');
 return {parameters,fingerprint};
}
export function validateParameterOverrides(rows,description){
 return normalizeParameterOverrides(rows).map(row=>{
  const p=description.parameters.find(p=>p.node===row.node&&p.field===row.field);
  if(!p||p.managedBy)throw Error('参数不在当前工作流可调节项中：'+row.field);
  const v=row.value;
  if(p.type==='boolean'?typeof v!=='boolean':p.type==='enum'?!p.options.includes(v):typeof v!=='number'||!Number.isFinite(v)||p.type==='integer'&&!Number.isSafeInteger(v)||p.min!==undefined&&v<p.min||p.max!==undefined&&v>p.max)throw Error('参数类型或范围不正确：'+row.field);
  return row;
 });
}
export function applyWorkflowParameters(api,spec){
 const protectedSet=protectedFields(spec);
 for(const row of normalizeParameterOverrides(spec.parameterOverrides)){
  const item=api[row.node],value=item?.inputs?.[row.field];
  if(!item||!Object.hasOwn(item.inputs||{},row.field)||protectedSet.has(address(row.node,row.field))||Array.isArray(value)||typeof value!==typeof row.value||!generation.test(row.field==='value'?String(item._meta?.title||''):row.field))throw Error('保存的工作流参数已失效，请重新读取：'+row.field);
  item.inputs[row.field]=row.value;
 }
 return api;
}
