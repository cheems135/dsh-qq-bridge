export function videoConfig(value={}){
 const seconds=Number(value.seconds??8);if(!Number.isFinite(seconds)||seconds<=0)throw Error('视频时长需要是大于零的秒数');
 const size=String(value.size||'720x1280');if(!/^\d{2,5}x\d{2,5}$/.test(size))throw Error('视频尺寸请填写宽x高，例如720x1280');
 return {enabled:value.enabled===true,profileId:String(value.profileId||''),seconds,size,action:String(value.action||''),cameraMotion:String(value.cameraMotion||'')};
}
export function buildVideoPrompt(base,{seconds=8,action='',cameraMotion='',language='zh'}={}){
 if(!String(base||'').trim())throw Error('视频需要保留完整的生图基础提示词');
 seconds=Number(seconds);if(!Number.isFinite(seconds)||seconds<=0)throw Error('视频时长需要是大于零的秒数');
 const a=Math.round(seconds/3*100)/100,b=Math.round(seconds*2/3*100)/100;
 return String(base)+(language==='en'?
 `\n\n[Video continuity and timeline]\nDuration: ${seconds} seconds. Create a continuous moving shot, not a still image or slideshow.\n0–${a}s: establish the subject, current outfit, headwear and scheduled environment from the base prompt.\n${a}–${b}s: perform the requested actions smoothly.\n${b}–${seconds}s: naturally settle the movement and finish the shot.\nRequested motion / specific timing (takes priority over the generic timeline): ${action||'Natural subtle expression, breathing and environmental movement matching the scene.'}\nCamera movement: ${cameraMotion||'Steady composition; gentle tracking only when the subject moves.'}\nKeep the reference identity, face, hair, current clothing, matching headwear, visual style and schedule scene consistent in every frame. Preserve the base scene detail and background; do not replace it with an empty backdrop. Only explicit requested actions may change the scene or clothing. Preserve camera viewpoint from the base prompt; do not turn a selfie into a detached observer shot. No flicker, morphing, duplicated limbs, spontaneous wardrobe changes or text overlays.`:
 `\n\n【视频时序与连续动作】\n总时长：${seconds}秒。生成连续运动画面，不是静态图片或幻灯片。\n0–${a}秒：建立基础提示词中的人物、当前服装、头饰与日程场景。\n${a}–${b}秒：自然、连贯地完成要求的动作。\n${b}–${seconds}秒：动作自然收尾，画面保持连续。\n具体动作及指定时间（优先于上述通用时序）：${action||'符合当前场景的自然表情、呼吸与细微动作，环境轻微变化。'}\n镜头运动：${cameraMotion||'保持原有构图；人物移动时才轻微跟随。'}\n逐帧保持参考人物身份、五官发型、当前服装及配套头饰、画风、日程场景一致；保留基础提示词中的环境和背景细节，不变成空背景。仅明确要求的动作可以改变场景或服装。沿用基础提示词的视角，自拍不能变成旁观拍摄。避免闪烁、变脸、肢体重复、无故换装与文字水印。`);
}
