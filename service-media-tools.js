// Transport helpers only: prompts, permissions and delivery stay with the host.
export const HOST_MEDIA_PARAMETERS={
  image:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:12000},negativePrompt:{type:'string',maxLength:8000},seed:{type:'integer'},workflowId:{type:'string'},aspectRatio:{type:'string',description:'按本轮构图选择画幅，例如 4:3'},size:{type:'string',description:'明确要求像素时填宽x高，示例 1024x768'}},required:['prompt'],additionalProperties:false},
  video:{type:'object',properties:{prompt:{type:'string',minLength:1,maxLength:12000},seconds:{type:'number',description:'完整视频时长'},aspectRatio:{type:'string',description:'按本轮构图选择画幅，例如 16:9'},size:{type:'string',description:'兼容视频 API 的宽x高，RunningHub 不填写此字段'},actionPrompt:{type:'string',description:'按秒安排具体动作、镜头、台词与声音'},cameraMotion:{type:'string'}},required:['prompt'],additionalProperties:false},
  speech:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:3000},emotion:{type:'string'},final:{type:'boolean'}},required:['text'],additionalProperties:false},
};
export function mixedHostMediaTools({image,speech,video}={}){
  return Object.fromEntries([['image',image],['speech',speech],['video',video]].filter(([,execute])=>typeof execute==='function').map(([kind,execute])=>['bridge_media_'+kind,{kind:'data',repeatable:false,description:'本轮已明确选择的'+(kind==='image'?'图片':kind==='video'?'视频':'语音')+'来源；执行后必须返回实际媒体文件。',parameters:HOST_MEDIA_PARAMETERS[kind],execute}]));
}
export function gatewayMediaOverrides(externalTools={},beforeMedia){
  const result={};for(const kind of ['image','speech','video']){
    const tool=externalTools['bridge_media_'+kind];if(!tool)continue;
    result[kind]={execute:async(args,options)=>{if(beforeMedia)await beforeMedia(kind,args,options);const value=await tool.execute(args,options);return value&&Array.isArray(value.attachments)?{...value,media:value.media||value.attachments}:value;}};
  }return result;
}
export function withoutInternalMediaTools(tools={}){return Object.fromEntries(Object.entries(tools).filter(([name])=>!/^bridge_media_|^bridge_model_complete$/.test(name)));}
