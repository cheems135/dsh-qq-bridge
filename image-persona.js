export const HEADWEAR_RULE_ZH='换装时把可摘戴头饰一起搭配：发箍、发带、帽子、头巾、发夹和蝴蝶结等应按新服装及当前场景更换，或合理摘除，不默认保留参考图或旧穿搭的头饰；用户本轮明确指定保留的优先。特殊耳形、角等身体特征属于身份，不能当头饰摘除或更换。';
export const HEADWEAR_RULE_EN='When the outfit changes, coordinate removable headwear with the new outfit and scene: change or remove the old headband, hat, hair ribbon, veil or hair clips instead of automatically copying them from the reference or previous outfit. Explicit current requests to retain or select a headpiece take priority. Anatomical ears, horns and other species features are identity, not removable headwear.';
// Pure routing and camera rules. No chat history, credentials or image bytes here.
export const IMAGE_STYLES = ['auto','anime','realistic','illustration','watercolor','oil','pixel','ink','chibi'];
const rules = [
  ['watercolor', /水彩|watercolou?r/i], ['oil', /油画|oil painting/i],
  ['pixel', /像素|pixel art/i], ['ink', /水墨|ink painting/i], ['chibi', /Q版|chibi/i],
  ['anime', /二次元|动漫|动画风|赛璐璐|\banim[ae]\b|cel.?shad/i],
  ['realistic', /写实|真实风格|摄影|实拍|真人|生活照|真实照片|photograph|photoreal|realistic/i],
  ['illustration', /手绘|插画|illustration|漫画|comic/i],
];
export function visualStyles(value='') {
  const text=String(value);
  return rules.filter(([,re])=>[...text.matchAll(new RegExp(re.source,'gi'))].some(m=>!/(?:不要|避免|禁止|不是|不用|非)[^，,。；;!?！？\n]{0,6}$/.test(text.slice(Math.max(0,m.index-12),m.index)))).map(([tag])=>tag);
}
/** Recognize a third-person caption of the current character without treating every girl as her. */
export function matchesPersonaSubject(request,{name='',appearance=''}={}) {
  const text=String(request||''),look=String(appearance||'');
  if(/另一个|另一位|其他(?:人|角色)|陌生(?:人|女孩|少女)|路人|新(?:的)?角色|原创角色|不(?:是|用|要).{0,5}(?:当前角色|人设|参考图)|(?:我|我的)(?:朋友|同事)|\b(?:another|different|original|new)\s+(?:character|girl|woman|person)\b/i.test(text))return false;
  const positive=(value,pattern)=>[...value.matchAll(new RegExp(pattern.source,'gi'))].some(m=>!/(?:不是|不要|没有|不带|无|not |without )[^，,。；;!?！？\n]{0,4}$/i.test(value.slice(Math.max(0,m.index-12),m.index)));
  const label=String(name||'').trim();
  if(label.length>=2&&text.includes(label)&&!['默认角色','自定义角色','default'].includes(label))return true;
  if(!/少女|女孩|女性|女人|少年|男孩|男性|男人|角色|\b(?:girl|woman|boy|man|character)\b/i.test(text))return false;
  // Species-shaped ears/tails are much more distinctive than clothing or a single hair color.
  const species=[[/鲸鱼|whale/i,/鲸鱼(?:耳|尾|鳍|少女|女孩)|whale[- ]?(?:eared|tailed|girl)/i],[/猫|cat/i,/猫(?:耳|尾|娘)|cat[- ]?(?:eared|tailed|girl)/i],[/兔|rabbit|bunny/i,/兔(?:子)?(?:耳|尾|娘)|(?:rabbit|bunny)[- ]?(?:eared|girl)/i],[/狐|fox/i,/狐(?:狸)?(?:耳|尾|娘)|fox[- ]?(?:eared|tailed|girl)/i],[/精灵|elf|elven/i,/精灵(?:耳|少女|女孩)|\b(?:elf|elven)\b/i],[/龙|dragon/i,/龙(?:角|尾|娘)|dragon[- ]?(?:horned|tailed|girl)/i]];
  if(species.some(([identity,caption])=>positive(look,identity)&&positive(text,caption)))return true;
  const colors=[['蓝','blue'],['银','silver'],['白','white'],['黑','black'],['红','red'],['粉','pink'],['紫','purple'],['绿','green'],['金','blond(?:e)?'],['棕','brown']];
  const shared=kind=>colors.some(([zh,en])=>{const pattern=new RegExp(kind==='hair'?`${zh}(?:色(?:的)?)?(?:头)?发|${en}[- ]haired|${en} hair`:`${zh}(?:色(?:的)?)?(?:瞳|眼)|${en}[- ]eyed|${en} eyes`,'i');return positive(text,pattern)&&positive(look,pattern)});
  return shared('hair')&&shared('eyes');
}
export function personaCamera(text, ownPortrait) {
  text=String(text);
  const positive=re=>{for(const m of text.matchAll(new RegExp(re.source,'gi')))if(!/(?:不要|避免|禁止|不用|别|不是|不需要|no |not )[^，,。；;!?！？\n]{0,5}$/i.test(text.slice(Math.max(0,m.index-14),m.index)))return true;return false;};
  const rear=positive(/后置|后镜|后摄|rear.?camera|first.person|第一人称|我的视角|你的视角|眼前/);
  const mirror=positive(/对镜|镜子.{0,5}自拍|mirror selfie/);
  const external=positive(/第三人称|他拍|别人.{0,4}(?:拍|镜头)|摄影师|third.person|taken by (?:someone|a friend)/);
  const front=/(?:前置|前镜|前摄|front.?camera|自拍|selfie)/i.test(text)&&!/(?:不要|别|避免|不需要).{0,3}(?:自拍|selfie)/i.test(text);
  const noSelf=/(?:不要|别|避免|不需要).{0,3}(?:自拍|selfie)/i.test(text);
  const camera=external?'external':mirror?'mirror':rear?'rear':(front||ownPortrait&&!noSelf)?'front':'scene';
  const english={
    front:'Direct front-facing selfie lens view, showing the character herself from the capturing lens with intimate natural perspective. The capturing device and its support stay entirely outside the image; an arm may extend toward the lens and exit the frame. Preserve the scene-appropriate pose, gaze and contact with nearby objects rather than posing her for an external observer.',
    rear:'First-person rear-facing lens view of what the character sees, with natural everyday framing. The capturing device stays entirely outside the image; the camera holder also remains outside the frame except any explicitly requested hands.',
    mirror:'Rear-camera mirror selfie taken by the character herself, with the phone visible only in the mirror reflection and physically coherent reflected perspective.',
    external:'Externally observed view, as explicitly requested.',scene:'',
  }[camera];
  const chinese={
    front:'前置自拍成片视角，画面直接来自角色自己的自拍镜头，保留近距离自然透视。拍摄设备与支架始终在画外，手臂可朝镜头方向伸出画面；保持应景姿态、视线以及身体与枕头等环境物件的接触，不画成旁观者拍她自拍。',
    rear:'后置第一人称成片视角，画面就是角色眼前所见，保持日常自然取景；拍摄设备始终在画外，除明确要求露出的手之外，拍摄者本人也不入镜。',
    mirror:'后置摄像头对镜自拍，由角色自己举手机拍摄，手机仅出现在镜面反射中，反射透视自然合理。',
    external:'按要求采用他人观察视角。',scene:'',
  }[camera];
  const negative={front:'visible phone, smartphone, camera body in frame, selfie stick, mirror selfie, third-person photographer view, distant full-body observer shot',rear:'visible phone, smartphone, camera body in frame, selfie stick, camera holder portrait, third-person observer view, selfie',mirror:'external photographer view',external:'',scene:''}[camera];
  const negativeChinese={front:'手机入镜，智能手机，相机机身入镜，自拍杆，对镜自拍，第三人称旁观者视角，远处全身观察者构图',rear:'手机入镜，智能手机，相机机身入镜，自拍杆，拍摄者本人的肖像，第三人称旁观者视角，自拍',mirror:'他人从外部拍摄的视角',external:'',scene:''}[camera];
  return {camera,english,chinese,negative,negativeChinese};
}
const auxiliaryImage=/mask|蒙版|遮罩|背景|background|pose|姿态|depth|深度|style.?ref|风格参考/i;
/** Explicit requests win; unspecified everyday photos vary within their context. */
export function photoComposition({request='',subject='',cameraPlan,ownPortrait=false,recent=[]}={}){
 const positive=(text,re)=>[...String(text).matchAll(new RegExp(re.source,'gi'))].some(m=>!/(?:不要|别|避免|不用|不是|不需要|no |not )[^，,。；;!?！？\n]{0,5}$/i.test(String(text).slice(Math.max(0,m.index-14),m.index)));
 let view=cameraPlan||personaCamera(request||subject,ownPortrait);
 const explicitCamera=positive(request,/前置|前镜|前摄|自拍|对镜|后置|后摄|后镜|他拍|第三人称|selfie|camera|mirror/);
 const seePerson=positive(request,/脸|长相|样子|本人|全身|半身|穿搭|看看你(?:[，,。！!？?\s]|$)|看一眼你/);
 const viewOnly=positive(request,/窗外|眼前|周围|桌面|风景|景色|手里的|手中|正在吃|正在喝/);
 const activity=/在干嘛|做什么|忙什么|正在做|手边|日常|此刻/.test(request);
 if(!explicitCamera&&!seePerson&&(viewOnly||ownPortrait&&activity&&recent.at(-1)?.camera==='front'))view=personaCamera('后置',false);
 let framing='scene';
 if(view.camera==='rear')framing=positive(request,/特写|近景|细节|手里|手中|杯|食物/)?'detail':'scene';
 else if(ownPortrait||['front','mirror','external'].includes(view.camera)){
   if(positive(request,/全身|从头到脚|head.to.toe|full.body/))framing='full';
   else if(positive(request,/半身|上半身|腰部以上|胸像|upper.body|half.body|waist.up|bust shot/))framing='upper';
   else if(positive(request,/人脸|脸部|只看脸|近脸|大头|特写|近景|close.up|face portrait|headshot/))framing='face';
   else if(/穿搭|衣服|换装|outfit/.test(request))framing='upper';
   else framing=[...recent].reverse().find(item=>['face','upper'].includes(item.framing))?.framing==='upper'?'face':'upper';
 }
 const english={face:'Close-up face framing: frame the head and shoulders, with the face filling most of the image; the crop ends above the chest.',upper:'Upper-body composition: frame the head through the waist, with the crop ending around the waist; emphasize expression and natural nearby gestures.',full:'Full-body composition, showing the person from head to toe.',detail:'Close view of the requested object or explicitly requested hands from the camera holder\'s perspective.',scene:'Frame the surroundings and objects in front of the camera, following the current subject.'}[framing];
 const chinese={face:'近脸特写，画面取头部和肩膀，脸占主要区域，下缘裁在胸部以上。',upper:'半身构图，取头部到腰部附近，突出表情和近处自然动作，下缘裁在腰部附近。',full:'全身构图，从头到脚完整呈现人物。',detail:'从拍摄者眼前视角拍所要求的物件或明确要求露出的手的近景。',scene:'按本次主体拍眼前的环境与物件。'}[framing];
 const negative=['face','upper'].includes(framing)?'full-body, head-to-toe, distant wide shot':framing==='full'?'cropped head, cropped feet':'';
 const negativeChinese=['face','upper'].includes(framing)?'全身构图，从头到脚，远景':framing==='full'?'头部被裁切，脚被裁切':'';
 if(view.camera==='front'&&framing==='full')view={...view,english:'Ultra-wide-angle front-facing full-body selfie captured from an outstretched arm, with a believable downward handheld angle and enough field of view to include the head and feet. Natural nearby proportions and perspective remain coherent; this is not a distant photographer or tripod view. The recording device remains completely outside the image.',chinese:'前置超广角全身自拍，由本人伸臂取景、合理向下俯拍，以足够广的视野让头脚入镜，保留近处手持透视和连贯身体比例；不是远处摄影师或三脚架旁拍，拍摄设备始终在画外。'};
 return {...view,opticalCamera:view.camera==='mirror'?'rear':view.camera,framing,framingEnglish:english,framingChinese:chinese,framingNegative:negative,framingNegativeChinese:negativeChinese};
}
export function photoScheduleContext(scene,request=''){
 if(!scene)return null;
 const parts=/^\s*(?:他说|她说|引用|例如|假如)/.test(String(request))?[]:String(request).split(/[，,。！？!?；;\n]/).filter(s=>!/^\s*(?:他说|她说|引用|例如|假如)/.test(s));
 const positive=(value,re)=>[...value.matchAll(new RegExp(re.source,'gi'))].some(m=>!/(?:不要|别|不用|无需|不能|禁止|不许|not |no )[^，,。;；!?！？]{0,8}$/i.test(value.slice(Math.max(0,m.index-18),m.index)));
 const outfit=parts.some(s=>!/^\s*(?:我|他|她|朋友|同事)(?:今天|现在|刚刚)?(?:穿|戴)/.test(s)&&!/穿(?:着)?(?:什么|啥|的衣服)/.test(s)&&positive(s,/(?:换(?:成|上|件|条|一)|改穿|穿上|让你穿|你(?:能不能|可以|给我)?穿|看你穿|戴上|脱掉|换装|(?:自拍|照片|画|拍).{0,15}(?:穿着|身穿)|穿(?:着)?[^，,。；;]{0,10}(?:睡衣|衬衫|裙|长裤|短裤|毛衣|外套|卫衣|礼服|婚纱)|\b(?:wear|change into|put on)\b)/i));
 const location=parts.some(s=>!/^\s*(?:我|他|她|朋友|同事)(?:今天|现在|刚刚|刚才)?在/.test(s)&&positive(s,/(?:换(?:个|一?个|到|成).{0,8}(?:场景|地方|背景|房间)|背景(?:改|换|设|是|为)|(?:去|到|在|拍|画|想看).{0,16}(?:海边|沙滩|雪山|森林|公园|卧室|床上|浴室|厨房|客厅|阳台|街头|街上|咖啡店|咖啡馆|学校|教室|办公室|书房|工作室|游泳池|温泉|花园|夜市)|\b(?:at the beach|in the forest|change (?:the )?(?:scene|background)|in a cafe)\b)/i)&&!/(?:在哪|在哪里|在什么地方|你在干嘛)/.test(s));
 const {date,phase,start,end,activity,mood,location:place,outfit:clothes}=scene;
 return {date,phase,start,end,activity,mood,location:place||'',outfit:clothes||'',simulated:true,override:{outfit,location},currentHumanRequest:String(request).slice(0,1000)};
}
/** Rephrase the recording action as the resulting view; retain pose and scenery. */
export function normalizeSelfieScene(value,camera){
 const text=String(value??'');if(!['front','rear'].includes(camera))return text;
 const gesture=camera==='front'?'朝画外自拍镜头伸出手臂':'从本人眼前视角取景';
 const gestureEnglish=camera==='front'?'extends an arm toward the out-of-frame capturing lens':'frames the scene from the camera holder\'s point of view';
 return text
  .replace(/(?:不要|别|避免|不能|不应|不得|无需|不需要)(?:再|让她|让角色)?(?:举着|拿着|握着|手持|举|拿)(?:一部)?手机(?:前置)?(?:自拍|拍照)?/g,'拍摄设备始终留在画外')
  .replace(/(?:手[里中])?(?:举着|拿着|握着|托着|捧着|持着|举起|拿起|手持|举|拿|握)(?:一(?:部|台|只))?(?:智能手机|手机)(?:在?(?:脸前|脸上方|头顶|面前|眼前))?(?:前置)?(?:自拍|拍照)?/g,gesture)
  .replace(/(?:手机|智能手机)(?:屏幕)?(?:的)?(?:光线|光亮|光|亮光)/g,'画外柔光')
  .replace(/\b(?:hold(?:s|ing)?|rais(?:e[sd]?|ing)|lift(?:s|ing)?|grip(?:s|ping)?)\s+(?:(?:a|her|his|the)\s+)?(?:smart\s?phone|cell\s?phone|mobile\s?phone|phone)(?:\s+(?:above|over|in front of|near)\s+(?:her|his|the)\s+(?:face|head|eyes))?(?:\s+with\s+(?:one|her|his)\s+hand)?/gi,gestureEnglish)
  .replace(/\b(?:phone|smartphone)(?:\s+screen)?(?:'s)?\s+(?:light|glow)/gi,'soft off-frame light')
  .replace(/(?:前置手机|手机前置)/g,'前置')
  .replace(/\b(?:front[- ]facing\s+)?phone\s+(?:camera|selfie)/gi,'selfie lens')
  .replace(/手机(?:自拍|拍照)/g,'自拍');
}
/** Validate positive scene prose only; negative prompts deliberately name exclusions. */
export function selfieDeviceConflict(value,camera){
 if(!['front','rear'].includes(camera))return false;
 const text=String(value??'');
 for(const match of text.matchAll(/智能手机|手机|自拍杆|\b(?:smart\s?phone|cell\s?phone|mobile\s?phone|phone|selfie stick)\b/gi)){
  const before=text.slice(Math.max(0,match.index-55),match.index),after=text.slice(match.index+match[0].length,match.index+match[0].length+85);
  if(/\b(?:no|without|exclude|avoid)\b[^,.!?;\n]{0,50}$/i.test(before))continue;
  if(/(?:不要|不画|不显示|不露出|没有|禁止|避免|不得|无需)[^，,。.!?；;\n]{0,12}$|\b(?:no|without|exclude|avoid|invisible|off.frame|out.of.frame)\s+(?:(?:visible|any|a|the|recording|capturing)\s+)*$/i.test(before))continue;
  if(/^(?:始终|完全|保持|应|必须|都|均|等拍摄设备|和拍摄设备|等)?(?:在画外|不入镜|不出现|不露出|不可见)|^\s+(?:(?:is|are|stays?|remains?|must|should|kept|completely|entirely)\s+)*(?:out(?:side)?[ -](?:of[ -])?(?:the[ -])?(?:frame|image|shot)|off[ -]frame|invisible|not visible)/i.test(after))continue;
  if(/^\s+(?:camera|selfie|screen(?:'s)?\s+(?:light|glow)|light|glow)\b/i.test(after)||/^(?:前置|自拍|屏幕(?:的)?光|光)/.test(after))continue;
  const clause=after.split(/[,，。;；\n]/)[0];
  if(!/\bvisible\s*$|看见|看得到|看到|可见/.test(before.slice(-15))&&!/\bvisible\b|foreground|in[ -]frame|入镜|画面内|前景|露出/i.test(clause)&&/(?:outside|out of|off|beyond)\s+(?:the\s+)?(?:frame|image|shot|composition|picture|field of view)|(?:置于|保持在|藏在|隐藏在|留在|放在)?画外|不入镜|不会出现在画面/i.test(clause))continue;
  return true;
 }
 return false;
}
function numberedImage(field) {
  for(const value of [field.label,field.fieldName]){const m=String(value||'').trim().match(/^(?:image|input_image|reference_image|图片|输入图片|参考图)[ _-]?(\d+)$/i);if(m)return Number(m[1]);}
  return null;
}
export function referenceInput(entry) {
  if(entry.referenceMode==='off')return null;
  const fields=entry.discovery?.fields||[];
  const images=fields.filter(f=>f.type==='IMAGE'&&!auxiliaryImage.test([f.fieldName,f.label,f.nodeName].join(' ')));
  if(entry.referenceTarget?.nodeId){
    const target=entry.referenceTarget;
    if(fields.length&&!fields.some(f=>f.nodeId===target.nodeId&&f.fieldName===target.fieldName&&f.type==='IMAGE'))return null;
    if((entry.promptTargets||[]).some(t=>t.nodeId===target.nodeId&&t.fieldName===target.fieldName))return null;
    return {nodeId:target.nodeId,fieldName:target.fieldName};
  }
  const identity=images.filter(f=>/角色|人设|人物参考|人脸|身份|character|identity|face|person.?ref/i.test([f.fieldName,f.label,f.nodeName].join(' ')));
  const first=images.filter(f=>numberedImage(f)===1);
  const selected=first.length===1?first[0]:identity.length===1?identity[0]:images.length===1?images[0]:null;
  return selected?{nodeId:selected.nodeId,fieldName:selected.fieldName}:null;
}
/** Bind only empty inputs. Explicit uploads always win; auxiliary images are never duplicated. */
const sameImageSlot=(a,b)=>String(a?.nodeId)===String(b?.nodeId)&&a?.fieldName===b?.fieldName;
export function referenceBindings(entry) {
  const primary=referenceInput(entry);if(!primary)return [];
  // One identity reference occupies one input. Other edit materials are explicit.
  if((entry.extraNodes||[]).some(n=>sameImageSlot(n,primary)&&String(n.fieldValue??'').trim()))return [];
  return [{nodeId:primary.nodeId,fieldName:primary.fieldName}];
}
/** A persona identity is supplied once. Never duplicate it into another slot. */
export function referenceReuseBindings(entry) {
  return [];
}
/** Explicitly clear unused secondary inputs, including provider example defaults. */
export function emptyReferenceInputs(entry) {
  if(entry.referenceMode==='off')return [];
  const primary=referenceInput(entry);if(!primary)return [];
  return (entry.discovery?.fields||[]).filter(field=>field.type==='IMAGE'&&!auxiliaryImage.test([field.fieldName,field.label,field.nodeName].join(' '))&&!sameImageSlot(field,primary)&&!(entry.extraNodes||[]).some(extra=>sameImageSlot(extra,field)&&String(extra.fieldValue??'').trim())).map(field=>({nodeId:field.nodeId,fieldName:field.fieldName}));
}
export function routePersonaWorkflow(config,{selector='',styles=[],hasReference=false}={}) {
  const list=(config.workflows||[]).filter(w=>w.mode==='app'?w.webappId:w.workflowId);
  if(selector){const matches=list.filter(w=>[w.id,w.name,w.mode==='app'?w.webappId:w.workflowId].includes(selector));if(matches.length!==1)throw Error('未找到唯一的已配置工作流');return matches[0].id;}
  const score=w=>{
    const tags=w.style&&w.style!=='auto'?[w.style]:visualStyles([w.name,w.note,w.discovery?.title].join(' '));
    const match=styles.some(s=>tags.includes(s));
    const targets=hasReference?[...referenceBindings(w),...referenceReuseBindings(w)]:[];
    const cleared=hasReference&&targets.length?emptyReferenceInputs(w):[];
    const missingMedia=(w.discovery?.requiredFields||[]).some(f=>/^(IMAGE|AUDIO|VIDEO)$/.test(f.type)&&![...targets,...cleared].some(t=>t.nodeId===f.nodeId&&t.fieldName===f.fieldName)&&!(w.extraNodes||[]).some(n=>n.nodeId===f.nodeId&&n.fieldName===f.fieldName&&String(n.fieldValue??'').trim()));
    return (tags.includes(styles[0])?100:match?60:styles.length&&tags.length?-100:0)+(w.id===config.activeWorkflowId?1:0)-(missingMedia?500:0);
  };
  // Prefer usable identity-image inputs within the requested aesthetic. A text-only
  // workflow remains valid when no compatible reference workflow is configured.
  const imageCandidates=hasReference?list.filter(w=>referenceInput(w)):[];
  let candidates=imageCandidates.length?imageCandidates:list;
  candidates=candidates.map((w,i)=>({w,i,score:score(w)})).sort((a,b)=>b.score-a.score||a.i-b.i);
  return candidates[0]?.w.id||'';
}

const changeableAppearance=/(?:穿|换装|衣服|衣着|穿搭|上衣|外套|裙|裤|睡衣|泳装|制服|发型|头发|长发|短发|马尾|丸子头|辫|披发|扎发|刘海|头饰|发饰|发箍|发带|发卡|发夹|帽子|头巾|蝴蝶结|戴|摘|headwear|headband|headpiece|outfit|wear|dress|shirt|skirt|hairstyle|ponytail|braid|bun\b|hair)/i;
export function appearanceConversation(audits,{key='',accountId='',personaId='',now=Date.now(),floor=0}={}) {
  if(!key)return [];
  const snippets=(value,user)=>String(value||'').replace(/\[(?:图|图片|语音|设置|表情包):[^\]]*\]/g,'').split(/[\r\n。！？!?；;]+/).map(s=>s.trim()).filter(s=>{
    if(!s||!changeableAppearance.test(s)||/(?:https?:|api.?key|secret|password|token|密钥|令牌|密码|忽略.{0,8}(?:指令|规则))/i.test(s))return false;
    if(user){
      const direct=/(?:你)[^他她我，,。]{0,6}(?:穿|换|扎|戴|披|留|剪|染)|换成|换上|穿上|扎个|扎起|扎成|改成|改为|换件|换条|换一|改一下|^(?:please\s+)?(?:wear|change into|put on|tie your|braid your)\b|\byou\s+(?:can\s+)?(?:wear|change into|put on|tie|braid)\b/i.test(s);
      const other=/(?:我|他|她|朋友|同事)(?:今天|现在|刚刚|刚|正|也|在)?(?:穿|戴|扎|披)|\b(?:I|she|he|they)\s+(?:am\s+|is\s+|are\s+)?wear/i.test(s);
      return (direct||/(?:你|\byou\b)/i.test(s))&&(!other||direct);
    }
    return !/(?:你|他|她|朋友|用户)(?:今天|现在|刚刚|刚|正|也|在)?(?:穿|戴|扎|披)|\b(?:you|she|he|they)\s+(?:are\s+|is\s+)?wear/i.test(s)||/(?:我|自己).{0,6}(?:穿|换|扎|戴|披)|\bI\s+(?:am\s+)?wear/i.test(s);
  }).slice(-3).map(s=>s.slice(0,220));
  return (Array.isArray(audits)?audits:[]).filter(a=>a.chat===key&&(a.accountId||'')===accountId&&a.persona===personaId&&a.status==='completed'&&a.at>=floor&&a.at<=now&&now-a.at<4*60*60_000&&!a.humanism&&!a.links?.length&&!a.references?.length&&!a.videos?.length).slice(-12).flatMap(a=>[
    ...snippets(a.userWords,true).map(text=>({source:'user-request',text})),
    ...snippets(a.answer,false).map(text=>({source:'character-dialogue',text})),
  ]).slice(-8);
}

export function referencePromptPrefix(language='zh', look='', reuse=false, name='当前角色') {
    const characterName=String(name||'当前角色').replace(/[\r\n，,。；;：:]/g,' ').trim().slice(0,80);
    // A few stable visible traits identify her; never repeat the full design sheet.
    const parts=String(look||'').split(/[，,。；;\n]+/).map(s=>s.trim()).filter(s=>s&&!/(?:尾|穿|衣|裙|裤|鞋|袜|背景|站|全身|头饰|发饰|发箍|发带|发卡|发夹|帽子|头巾|蝴蝶结|王冠|皇冠|tail|outfit|dress|shirt|skirt|trousers|background|standing|full.body|headband|headwear|headdress|headpiece|hair[ -]?(?:clip|ribbon|bow)|hat\b|bonnet|veil|crown)/i.test(s));
    let subject='';for(const part of parts){if((subject+part).length>(language==='zh'?90:200))continue;subject+=(subject?(language==='zh'?'，':', '):'')+part;if(subject.length>(language==='zh'?45:110))break;}
    if(language==='zh')return '参考图为人设图，她的名字叫'+characterName+'，'+(subject?subject+'。':'')+'仅保留取景内可见的脸、发色和特殊耳形；重新绘制下面的服装、头饰、动作和背景。'+HEADWEAR_RULE_ZH;
    if(/[\u4e00-\u9fff]/.test(subject))subject='';
    return 'The reference image is the character design sheet; her name is '+characterName+'. '+(subject?subject+'. ':'')+'Keep her face, hair color and distinctive ear shape within the crop; redraw the outfit, headwear, pose and setting below. '+HEADWEAR_RULE_EN;
  }
