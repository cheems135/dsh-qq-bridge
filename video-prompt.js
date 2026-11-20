import {promptPreferenceRule} from './prompt-preferences.js';
export const RUNNINGHUB_VIDEO_APP='2085597941657587714';
export const RUNNINGHUB_VIDEO_RATIOS=['1:1','3:2','4:3','16:9','2:3','3:4','9:16'];
export function videoConfig(value={}){
 const provider=value.provider==='runninghub'?'runninghub':'connection';
 const seconds=Number(value.seconds??(provider==='runninghub'?10:8));if(!Number.isFinite(seconds)||seconds<=0)throw Error('视频时长需要是大于零的秒数');
 const size=String(value.size||'720x1280');if(!/^\d{2,5}x\d{2,5}$/.test(size))throw Error('视频尺寸请填写宽x高，例如720x1280');
 const aspectRatio=String(value.aspectRatio||'9:16');
 if(provider==='runninghub'&&(!Number.isInteger(seconds)||seconds<10||seconds>15||!RUNNINGHUB_VIDEO_RATIOS.includes(aspectRatio)))throw Error('此 RunningHub 视频应用使用 10–15 秒整数时长与列表中的画幅');
 return {enabled:value.enabled===true,provider,profileId:String(value.profileId||''),seconds,size,aspectRatio,action:String(value.action||''),cameraMotion:String(value.cameraMotion||'')};
}
export function videoParameters(request,args,config,provider){
 const explicit=String(request||args.prompt||'');
 const secondsExplicit=explicit.match(/(?:总时长|时长|总共|全长|duration[:：]?)\s*(\d+(?:\.\d+)?)\s*(?:秒|seconds?\b)/i)
  ||[...explicit.matchAll(/(\d+(?:\.\d+)?)\s*(?:秒(?:钟)?|seconds?\b)\s*(?:的?\s*(?:视频|短片|片段|video|clip)|[,，。！.!]|$)/gi)]
   .find(m=>!/(?:第|前|后|在|到|从|至|[-–—])\s*$/.test(explicit.slice(0,m.index)));
 const seconds=Number(secondsExplicit?.[1]??args.seconds??config.seconds);
 const aspectPattern=/(?<![\d:：])(?:比例[：:\s]+|画幅[：:\s]+)?(1:1|3:2|4:3|16:9|2:3|3:4|9:16)(?![\d:：])/;
 const sizePattern=/(?<!\d)(\d{2,5})\s*[xX×]\s*(\d{2,5})(?!\d)/;
 const ratioMatch=explicit.replace(/：(?=\d)/g,':').match(aspectPattern),sizeMatch=explicit.match(sizePattern);
 const aspectRequested=ratioMatch?.[1]||String(args.aspectRatio||'');
 const sizeRequested=sizeMatch?sizeMatch[1]+'x'+sizeMatch[2]:String(args.size||'');
 if(!Number.isFinite(seconds)||seconds<=0)throw Error('视频时长需要是大于零的秒数');
 if(provider==='runninghub'){
  if(sizeRequested)throw Error('此 RunningHub 视频应用使用内置分辨率档位，请指定画幅比例，无需填写像素尺寸');
  const aspectRatio=aspectRequested||config.aspectRatio;
  if(!Number.isInteger(seconds)||seconds<10||seconds>15||!RUNNINGHUB_VIDEO_RATIOS.includes(aspectRatio))throw Error('此 RunningHub 视频应用使用 10–15 秒整数时长与列表中的画幅');
  return {seconds,aspectRatio,size:''};
 }
 if(sizeRequested&&!/^\d{2,5}x\d{2,5}$/.test(sizeRequested))throw Error('视频尺寸请填写宽x高');
 let size=sizeRequested||config.size;
 if(aspectRequested){
  if(!RUNNINGHUB_VIDEO_RATIOS.includes(aspectRequested))throw Error('请填写有效的视频画幅，例如 16:9 或 9:16');
  const [rw,rh]=aspectRequested.split(':').map(Number),[w,h]=size.split('x').map(Number);
  if(sizeRequested&&w*rh!==h*rw)throw Error('视频像素尺寸和画幅比例不一致');
  if(!sizeRequested&&w*rh!==h*rw){
   if(h*rh===w*rw)size=h+'x'+w;
   else{const scale=Math.max(8,Math.round(Math.min(w,h)/Math.min(rw,rh)/8)*8);size=rw*scale+'x'+rh*scale;}
  }
 }
 return {seconds,size,aspectRatio:aspectRequested};
}
export function buildVideoPrompt(base,{seconds=8,action='',cameraMotion='',language='zh',promptPreferences,aspectRatio='',reference=false}={}){
 if(!String(base||'').trim())throw Error('视频需要保留完整的生图基础提示词');
 seconds=Number(seconds);if(!Number.isFinite(seconds)||seconds<=0)throw Error('视频时长需要是大于零的秒数');
 const a=Math.round(seconds/3*100)/100,b=Math.round(seconds*2/3*100)/100;
 const direction=language==='en'?
  [reference?'Use @图片1 for the character’s identity, face, and hair. Follow the scene and outfit specified below.':'',aspectRatio?'Frame the shot at '+aspectRatio+'.':'','Preserve requested dialogue, sound, and silence. Place each cue in the timeline.']:
  [reference?'@图片1 是本轮角色的身份参考。保留其五官、发型和辨识特征，服装、场景及构图按本轮脚本。':'',aspectRatio?'使用 '+aspectRatio+' 画幅。':'','按要求安排台词、环境声或静音，并与时间轴上的动作对齐。'];
 const pref=promptPreferenceRule('video',promptPreferences,language);
 const guidance=direction.filter(Boolean).join('\n');
 return (reference?guidance+'\n':'')+String(base)+(pref?'\n'+pref:'')+(!reference?'\n'+guidance:'')+(language==='en'?
 `\n\n[Video continuity and timeline]\nDuration: ${seconds} seconds. Create a continuous moving shot, not a still image or slideshow.\n0–${a}s: establish the subject, current outfit, headwear and scheduled environment from the base prompt.\n${a}–${b}s: perform the requested actions smoothly.\n${b}–${seconds}s: naturally settle the movement and finish the shot.\nRequested motion / specific timing (takes priority over the generic timeline): ${action||'Natural subtle expression, breathing and environmental movement matching the scene.'}\nCamera movement: ${cameraMotion||'Steady composition; gentle tracking only when the subject moves.'}\nKeep the reference identity, face, hair, current clothing, matching headwear, visual style and schedule scene consistent in every frame. Preserve the base scene detail and background; do not replace it with an empty backdrop. Only explicit requested actions may change the scene or clothing. Preserve camera viewpoint from the base prompt; do not turn a selfie into a detached observer shot. No flicker, morphing, duplicated limbs, spontaneous wardrobe changes or text overlays.`:
 `\n\n【视频时序与连续动作】\n总时长：${seconds}秒。生成连续运动画面，不是静态图片或幻灯片。\n0–${a}秒：建立基础提示词中的人物、当前服装、头饰与日程场景。\n${a}–${b}秒：自然、连贯地完成要求的动作。\n${b}–${seconds}秒：动作自然收尾，画面保持连续。\n具体动作及指定时间（优先于上述通用时序）：${action||'符合当前场景的自然表情、呼吸与细微动作，环境轻微变化。'}\n镜头运动：${cameraMotion||'保持原有构图；人物移动时才轻微跟随。'}\n逐帧保持参考人物身份、五官发型、当前服装及配套头饰、画风、日程场景一致；保留基础提示词中的环境和背景细节，不变成空背景。仅明确要求的动作可以改变场景或服装。沿用基础提示词的视角，自拍不能变成旁观拍摄。避免闪烁、变脸、肢体重复、无故换装与文字水印。`);
}
