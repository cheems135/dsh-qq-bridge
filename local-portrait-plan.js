import {localMediaText,localMediaCancelled,resolveLocalMediaTask} from './local-media-task.js';
import {personaCamera,photoComposition} from './image-persona.js';

// Local photo vocabulary only. This describes the subject and camera; it never
// authorizes generation and does not default unrelated pictures to the persona.
export function localPortraitSubject(request=''){
 const raw=String(request).trim(),text=localMediaText(raw);
 if(/^(?:他说|她说|引用|转发|例如|假如|教程)/.test(raw)||localMediaCancelled(text,'image'))return false;
 if(/(?:不要|别|避免|无需|禁止|不需要|不是).{0,5}(?:人物|人像|人脸|角色|你|自拍)|只(?:要|画|拍).{0,3}(?:风景|食物|景色|静物)|其他人|别人|另一个人|另一位|新角色|原创角色|我的(?:朋友|同事)|(?:看|分析|描述).{0,6}(?:照片|相片|图片)(?:里|中)|提示词|报错|教程|代码/.test(text))return false;
 return /(?:你(?:的|本人|自己)(?:现在|今天|此刻)?(?:照片|相片|近照|生活照|日常照|自拍|穿搭照|头像|肖像|全身照|半身照|样子))|你(?:在|正在|现在|今天|穿着|坐在|站在).{0,24}(?:自拍|相片|照片|近照|生活照|日常照)|(?:看|拍|发).{0,8}你.{0,5}(?:穿搭|打扮)|(?:^|[，,。！？!?\s])(?:来|拍|发|给我|生成|我想看|想看|看看|看下).{0,8}(?:你(?:的)?)?自拍/.test(text);
}

// Only a real human's recent photo request can supply an omitted subject.
// An assistant promise, persona card or a different person's group message
// cannot turn an otherwise unspecified picture into a character portrait.
export function resolveLocalPhotoSubject(request='',{history=[]}={}){
 const raw=String(request).trim(),text=localMediaText(raw).replace(/\s+/g,'');
 const vague=value=>{
  if(!value||value.length>160)return false;
  let rest=value,last;do{last=rest;rest=rest.replace(/^(?:那|就|请|麻烦|帮我|给我|让我|你|能不能|可不可以|可以|再|重新|继续|现在|快点|求求你了?)/,'').replace(/(?:给我看看|让我看看|给我看|让我看|好不好|求求你了?|拜托|看看|看下|瞅瞅|一下|一遍|给我|让我|看|嘛|吧|呀|啦|哦|呗|了|[~～。.!！?？])$/,'');}while(rest!==last);
  return /^(?:拍|发|来|画|生成|做|弄)(?:一|1)?(?:张|幅|个)?(?:图(?:片)?|照片|相片)?$/.test(rest)||/^(?:图片|照片|相片)(?:发|给)我$/.test(rest);
 };
 if(localMediaCancelled(text,'image')||!vague(text))return {request:raw,source:'current',ambiguous:false};
 const prior=history.filter(r=>r.role==='user'&&!r._localReceipt).map(r=>typeof r.content==='string'?r.content:'').filter(Boolean);
 if(prior.at(-1)===raw)prior.pop();
 let skipped=0;
 for(const previous of prior.slice(-3).reverse()){
  if(/^(?:嗯|好|好的|行|可以|对|喜欢|来吧|继续)[嘛吧呀啦哦~～。！!\s]*$/.test(previous)||vague(localMediaText(previous).replace(/\s+/g,''))){skipped++;continue;}
  const task=resolveLocalMediaTask(previous);
  if(task.image&&!task.ambiguous)return {request:previous+'\n本轮要求：'+raw,source:'recent-human-photo',ambiguous:false,skipped};
  break;
 }
 return {request:raw,source:'needs-subject',ambiguous:true};
}

export function applyLocalPortraitPlan(request,plan){
 if(!plan||!localPortraitSubject(request))return plan;
 const view=photoComposition({request,subject:request,ownPortrait:true,cameraPlan:personaCamera(request,true)});
 // A rear-facing view shows the scene, not the camera holder's identity.
 const ownPortrait=view.camera!=='rear';
 const camera={camera:view.camera,opticalCamera:view.opticalCamera,framing:view.framing,cameraEnglish:[view.english,view.framingEnglish].filter(Boolean).join(' '),cameraChinese:[view.chinese,view.framingChinese].filter(Boolean).join(' '),cameraNegative:[view.negative,view.framingNegative].filter(Boolean).join(', '),cameraNegativeChinese:[view.negativeChinese,view.framingNegativeChinese].filter(Boolean).join('，')};
 return {...plan,...camera,ownPortrait,personish:ownPortrait,portraitSource:'local_explicit_portrait',prompt:plan.prompt+'\n本轮角色照片主体与镜头：'+(ownPortrait?'当前角色本人。':'')+camera.cameraChinese};
}

export function lockLocalPortraitCamera(prompt,plan,language){
 if(!plan?.ownPortrait||!['front','mirror'].includes(plan.camera))return prompt;
 const view=photoComposition({request:plan.camera==='mirror'?'对镜自拍':'前置自拍',ownPortrait:true,cameraPlan:personaCamera(plan.camera==='mirror'?'对镜自拍':'前置自拍',true)});
 const constraint=language==='zh'?plan.cameraChinese||view.chinese:plan.cameraEnglish||view.english;
 return !constraint||prompt.includes(constraint)?prompt:prompt+'\n'+constraint;
}
