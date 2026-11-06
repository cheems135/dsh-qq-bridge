// Mobile keeps the shared API features but never starts inference services.
export const mobileApiMessage='手机版仅支持 API，请在“连接与搭配”选择 API 来源；本地模型和本地生成服务只在电脑版使用。';
const apiTypes=new Set(['openai','anthropic','responses','runninghub']);
export function apiOnlySettings(value={},apiOnly=true){
 if(!apiOnly)return value;
 return {...value,localChat:{...value.localChat,enabled:false,apiComplement:false,initiativeEnabled:false},comfyui:{...value.comfyui,enabled:false,localVoiceDir:''},agency:{...value.agency,desktop:false,workspace:'internal'},voice:{...value.voice,...(value.voice?.engine==='localai'?{engine:'none',enabled:false}:{})}};
}
export function apiOnlyConnections(value={},apiOnly=true){
 if(!apiOnly)return value;
 const profiles=Array.isArray(value.profiles)?value.profiles:[],routes={enabled:false,chat:'host',image:'legacy',speech:'legacy',...value.routes};
 for(const kind of ['chat','image','speech']){
  const p=profiles.find(p=>'profile:'+p.id===routes[kind]);
  if(routes[kind]==='local'||p&&!apiTypes.has(p.type))routes[kind]=kind==='chat'?'host':'legacy';
 }
 return {...value,routes,legacyLocalEnabled:false,legacyApiComplement:false};
}
export function assertMobileConnection(type,apiOnly){if(apiOnly&&type&&type!=='auto'&&!apiTypes.has(type))throw Error(mobileApiMessage);}
export function apiOnlyServices(services,apiOnly=true){
 if(!apiOnly)return services;
 const {comfyui,workspace,recharge,...portable}=services;
 return portable;
}
