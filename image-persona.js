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
    front:'Front-facing phone selfie, taken by the character herself at arm\'s length, looking into the lens, intimate near-camera framing with natural handheld perspective.',
    rear:'First-person rear-facing phone camera view of what the character sees, handheld everyday framing; the camera holder remains outside the frame except any explicitly requested hands.',
    mirror:'Mirror selfie taken by the character herself, phone visible in the reflection, physically coherent reflected perspective.',
    external:'Externally observed view, as explicitly requested.',scene:'',
  }[camera];
  const negative={front:'third-person photographer view, distant full-body observer shot',rear:'camera holder portrait, third-person observer view, selfie',mirror:'external photographer view',external:'',scene:''}[camera];
  return {camera,english,negative};
}
const auxiliaryImage=/mask|蒙版|遮罩|背景|background|pose|姿态|depth|深度|style.?ref|风格参考/i;
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
  const selected=identity.length===1?identity[0]:images.length===1?images[0]:first.length===1?first[0]:null;
  return selected?{nodeId:selected.nodeId,fieldName:selected.fieldName}:null;
}
/** Bind only empty inputs. Explicit uploads always win; auxiliary images are never duplicated. */
export function referenceBindings(entry) {
  const primary=referenceInput(entry);if(!primary)return [];
  const same=(a,b)=>String(a.nodeId)===String(b.nodeId)&&a.fieldName===b.fieldName;
  const fields=entry.discovery?.fields||[],required=entry.discovery?.requiredFields||[];
  const additional=entry.referenceReuseMissing===false?[]:fields.filter(f=>f.type==='IMAGE'&&numberedImage(f)!==null&&!same(f,primary)&&!auxiliaryImage.test([f.fieldName,f.label,f.nodeName].join(' '))&&required.some(r=>same(r,f)));
  return [primary,...additional].filter(f=>!(entry.extraNodes||[]).some(n=>same(n,f)&&String(n.fieldValue??'').trim())).map(({nodeId,fieldName})=>({nodeId,fieldName}));
}
export function routePersonaWorkflow(config,{selector='',styles=[],hasReference=false}={}) {
  const list=(config.workflows||[]).filter(w=>w.mode==='app'?w.webappId:w.workflowId);
  if(selector){const matches=list.filter(w=>[w.id,w.name,w.mode==='app'?w.webappId:w.workflowId].includes(selector));if(matches.length!==1)throw Error('未找到唯一的已配置工作流');return matches[0].id;}
  const score=w=>{
    const tags=w.style&&w.style!=='auto'?[w.style]:visualStyles([w.name,w.note,w.discovery?.title].join(' '));
    const match=styles.some(s=>tags.includes(s));
    const targets=hasReference?referenceBindings(w):[];
    const missingMedia=(w.discovery?.requiredFields||[]).some(f=>/^(IMAGE|AUDIO|VIDEO)$/.test(f.type)&&!targets.some(t=>t.nodeId===f.nodeId&&t.fieldName===f.fieldName)&&!(w.extraNodes||[]).some(n=>n.nodeId===f.nodeId&&n.fieldName===f.fieldName&&String(n.fieldValue??'').trim()));
    return (tags.includes(styles[0])?100:match?60:styles.length&&tags.length?-100:0)+(w.id===config.activeWorkflowId?1:0)-(missingMedia?500:0);
  };
  // Prefer usable identity-image inputs within the requested aesthetic. A text-only
  // workflow remains valid when no compatible reference workflow is configured.
  const imageCandidates=hasReference?list.filter(w=>referenceInput(w)&&score(w)>=0):[];
  let candidates=imageCandidates.length?imageCandidates:list;
  candidates=candidates.map((w,i)=>({w,i,score:score(w)})).sort((a,b)=>b.score-a.score||a.i-b.i);
  return candidates[0]?.w.id||'';
}

const changeableAppearance=/(?:穿|换装|衣服|衣着|穿搭|上衣|外套|裙|裤|睡衣|泳装|制服|发型|头发|长发|短发|马尾|丸子头|辫|披发|扎发|刘海|戴|摘|outfit|wear|dress|shirt|skirt|hairstyle|ponytail|braid|bun\b|hair)/i;
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
