// Transport helpers only: prompts, permissions and delivery stay with the host.
export const HOST_MEDIA_PARAMETERS={
  image:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:12000},negativePrompt:{type:'string',maxLength:8000},seed:{type:'integer'},workflowId:{type:'string'}},required:['prompt'],additionalProperties:false},
  speech:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:3000},emotion:{type:'string'},final:{type:'boolean'}},required:['text'],additionalProperties:false},
};
export function mixedHostMediaTools({image,speech}={}){
  return Object.fromEntries([['image',image],['speech',speech]].filter(([,execute])=>typeof execute==='function').map(([kind,execute])=>['bridge_media_'+kind,{kind:'data',repeatable:false,description:'本轮已明确选择的'+(kind==='image'?'图片':'语音')+'来源；执行后必须返回实际媒体文件。',parameters:HOST_MEDIA_PARAMETERS[kind],execute}]));
}
export function gatewayMediaOverrides(externalTools={},beforeMedia){
  const result={};for(const kind of ['image','speech']){
    const tool=externalTools['bridge_media_'+kind];if(!tool)continue;
    result[kind]={execute:async(args,options)=>{if(beforeMedia)await beforeMedia(kind,args,options);const value=await tool.execute(args,options);return value&&Array.isArray(value.attachments)?{...value,media:value.media||value.attachments}:value;}};
  }return result;
}
export function withoutInternalMediaTools(tools={}){return Object.fromEntries(Object.entries(tools).filter(([name])=>!/^bridge_media_|^bridge_model_complete$/.test(name)));}
