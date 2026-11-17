// Repair only the router envelope. Business arguments are still checked against
// the exact tool schema and execute under the original conversation scope.
const readAliases=new Set(['bridge_search','bridge_read','bridge_context','bridge_capabilities']);
export function normalizeRouterArguments(name,value){
 if(name!=='bridge_tools'||!value||typeof value!=='object')return value;
 let args=value;
 if(readAliases.has(value.action)){
  if(value.name&&value.name!==value.action)throw Error('路由工具名冲突，请只指定一个真实工具');
  args={...value,action:'call',name:value.action};
 }else if(!Object.hasOwn(value,'action')&&readAliases.has(value.name)&&value.arguments&&typeof value.arguments==='object')args={...value,action:'call'};
 if(args.action!=='call'||typeof args.name!=='string')return args;
 const extra=Object.keys(args).filter(k=>!['action','name','arguments'].includes(k));
 if(!extra.length)return args;
 if(Object.hasOwn(args,'arguments'))throw Error('工具参数同时出现在路由层与 arguments 内，请按 schema 只放入 arguments');
 return {action:'call',name:args.name,arguments:Object.fromEntries(extra.map(k=>[k,args[k]]))};
}
export function directRouterTool(available,args){
 if(!['call','schema'].includes(args?.action)||!/^bridge_[A-Za-z0-9_]+$/.test(args?.name||'')||args.name==='bridge_tools')return null;
 const tool=Object.hasOwn(available,args.name)?available[args.name]:null;
 return tool?.kind==='data'&&tool.parameters?tool:null;
}
export function normalizeContextArguments(name,value){
 // This tool only reads the already scoped context. A supplied topic/query
 // unambiguously means get; never infer actions for write or device tools.
 if(name==='bridge_context'&&!Object.hasOwn(value,'action')&&Object.keys(value).every(k=>['topics','query'].includes(k))&&(Array.isArray(value.topics)||typeof value.query==='string'))return {action:'get',...value};
 return value;
}
