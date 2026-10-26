// Prompt dialects are separate from picture style. An anime picture may be made
// by a prose-oriented model; a request example does not prove its hidden model.
export const PROMPT_MODELS = {
  'qwen-image-edit':{label:'Qwen Image 图像编辑（具体版本以工作流为准）',format:'natural',negative:'workflow',guidance:'Write clear English editing instructions, around 80-160 words, grounded in the supplied image inputs. State the requested changes, then what must remain consistent. For a new character scene, preserve facial identity and stable distinguishing features while changing clothing, hairstyle, pose, camera and environment as requested. For a local edit, preserve all unrequested content. Reusing the same reference in multiple input slots does not mean multiple people: preserve the requested subject count. Do not hallucinate image contents you have not seen. Avoid Danbooru tags, score tags and SD-style weights.'},
  generic:{label:'通用 / 未确认模型',format:'natural',negative:'workflow',guidance:'Use clear English visual prose, about 80-150 words. Do not assume a model family, add score tags, or invent special syntax.'},
  anima:{label:'Anima（版本未确认）',format:'hybrid',negative:'workflow',guidance:'Use Anima-compatible lowercase visual tags with spaces, followed by two concrete English sentences describing composition and relationships. Use only a few relevant tags; no invented character names. Keep artist triggers in the fixed prefix. Omit score tags because the version is not confirmed.'},
  'anima-base':{label:'Anima Base',format:'hybrid',negative:'workflow',guidance:'Use ordered quality tags, subject counts, identity and general visual tags, then at least two sentences for spatial relationships and expression. Lowercase tags with spaces. A concise quality prefix is appropriate; avoid stacking competing scores.'},
  'anima-aesthetic':{label:'Anima Aesthetic',format:'hybrid',negative:'workflow',guidance:'Use a concise tag-and-caption combination. Describe the actual composition, expression, materials and color relationships. Do not use score_* tags. Quality tags are optional; avoid forcing a generic glossy finish.'},
  'anima-turbo':{label:'Anima Turbo',format:'hybrid',negative:'workflow',guidance:'Use compact visual tags plus at least two clear descriptive sentences. Favor readable action, framing and a few coherent details over repeated quality labels. Keep the requested hairstyle and clothing explicit.'},
  'z-image':{label:'Z-Image（版本未确认）',format:'natural',negative:'workflow',guidance:'Write detailed connected English prose, about 140-220 words, explaining subject, action, spatial layout, light, texture and color. Avoid Danbooru tags, score tags and prompt weights. The variant is unknown: do not assume whether its negative input is effective.'},
  'z-image-turbo':{label:'Z-Image Turbo',format:'natural',negative:'none',guidance:'Write detailed English prose, about 140-220 words. Prioritize visible subject/action, composition, physical lighting, textures and precise spatial relations. Express exclusions as desired positive outcomes. Do not generate a negative prompt: this distilled model does not use one. Avoid score tags and SD-style weight syntax.'},
  'z-image-base':{label:'Z-Image Base',format:'natural',negative:'workflow',guidance:'Write detailed visual English prose, about 140-220 words. Use a focused negative prompt only when the workflow exposes a negative input. Avoid unsupported score tags and inherited anime-quality boilerplate.'},
  flux:{label:'FLUX',format:'natural',negative:'none',guidance:'Write concrete natural English, about 100-180 words, with subject/action first, then environment, composition, materials and lighting. Describe wanted outcomes instead of negative prompts. No Danbooru scores or SD-style weights.'},
  'flux2-klein':{label:'FLUX.2 Klein',format:'natural',negative:'none',guidance:'Use narrative English, about 120-200 words. Include explicit composition, lighting and environmental context; this model has no prompt upsampling. For an image reference, state the requested change and what identity should remain. Use positive descriptions, no negative prompt or score tags.'},
};
const clean=(value,max=400)=>String(value??'').replace(/[\u0000-\u001f]/g,' ').replace(/https?:\/\/\S+/gi,'').trim().slice(0,max);
export function normalizePromptModel(value){return Object.hasOwn(PROMPT_MODELS,value)?value:'auto';}
function modelId(value){
  const text=String(value||'').toLowerCase().replaceAll('_','-');
  if(/qwen.{0,30}(?:edit|图像编辑)|(?:edit|图像编辑).{0,20}qwen/.test(text))return 'qwen-image-edit';
  if(/\banima(?:[\s_.-]*(?:base|aesthetic|turbo))?\b/.test(text))return /aesthetic/.test(text)?'anima-aesthetic':/turbo/.test(text)?'anima-turbo':/base/.test(text)?'anima-base':'anima';
  if(/z[\s_.-]*image|zimage/.test(text))return /turbo/.test(text)?'z-image-turbo':/\bbase\b/.test(text)?'z-image-base':'z-image';
  if(/flux[\s_.-]*2.*klein|flux.*klein/.test(text))return 'flux2-klein';
  if(/\bflux(?:[\s_.-]*[12])?\b/.test(text))return 'flux';
  return '';
}
export function promptModelEvidence(fields=[],extra=[]) {
  return [...fields.filter(f=>/^(?:ckpt_name|unet_name|diffusion_model|model_name|checkpoint|model_file|base_model)$/i.test(f?.fieldName||'')).map(f=>({value:f.value,nodeId:f.nodeId,fieldName:f.fieldName})),...extra].map(f=>({value:clean(String(f.value||'').split(/[\\/]/).at(-1),150),nodeId:clean(f.nodeId,100),fieldName:clean(f.fieldName,100)})).filter(f=>f.value).slice(0,16);
}
export function promptModelProfile(workflow={}) {
  const manual=normalizePromptModel(workflow.promptModel);
  let id=manual!=='auto'?manual:'',source=id?'configured':'unknown',evidence=[];
  if(!id){
    const fields=(workflow.discovery?.fields||[]).map(f=>{const extra=(workflow.extraNodes||[]).find(n=>String(n.nodeId)===String(f.nodeId)&&n.fieldName===f.fieldName);return extra?{...f,value:extra.fieldValue}:f;});
    const fieldKeys=new Set(fields.map(f=>String(f.nodeId)+':'+f.fieldName));
    const stored=(workflow.discovery?.modelEvidence||[]).filter(f=>!fieldKeys.has(String(f.nodeId)+':'+f.fieldName));
    const explicit=promptModelEvidence(fields,stored);
    const found=explicit.map(e=>({...e,id:modelId(e.value)})).filter(e=>e.id);
    const ids=[...new Set(found.map(e=>e.id))];
    if(ids.length===1){id=ids[0];source='metadata';evidence=found.map(e=>e.value).slice(0,3);}
    else if(ids.length>1){return {...PROMPT_MODELS.generic,id:'generic',source:'ambiguous',evidence:found.map(e=>e.value).slice(0,3)};}
    else {id=modelId([workflow.name,workflow.discovery?.title,workflow.modelName].filter(Boolean).join(' '));if(id){source='name-hint';evidence=[clean(workflow.name||workflow.modelName||workflow.discovery?.title,100)];}}
  }
  id=id||'generic';return {...PROMPT_MODELS[id],id,source,evidence};
}
export function protectedPromptTokens(value='',extra='') {
  const text=String(value);
  const groups=text.match(/\([^()]*@[^()]*\)/g)||[];
  const remainder=groups.reduce((s,g)=>s.replace(g,''),text);
  return [...new Set([...groups,...(remainder.match(/@[\w.-]+(?:\s+[\w.-]+)*?(?=\s*[,\n]|$)/g)||[]),...(text.match(/<lora:[^>\r\n]+>|\bembedding:[^,\s]+/gi)||[]),...String(extra||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean)])].slice(0,30);
}
export function fixedPromptPlan(workflow={},profile=promptModelProfile(workflow)) {
  return (workflow.discovery?.prefixTargets||[]).slice(0,16).map(target=>{
    const field=workflow.discovery.fields.find(f=>String(f.nodeId)===String(target.nodeId)&&f.fieldName===target.fieldName);
    const extra=(workflow.extraNodes||[]).find(f=>String(f.nodeId)===String(target.nodeId)&&f.fieldName===target.fieldName);
    const original=String(extra?extra.fieldValue:field?.value||'').slice(0,2000);
    const locked=protectedPromptTokens(original,workflow.triggerWords);
    const suffix=/Description\s*:\s*$/i.test(original)?'\nDescription:\n':'';
    const refine=workflow.fixedPromptMode!=='preserve'&&profile.id!=='generic';
    let proposed=original;
    if(refine){
      let rest=original.replace(/Description\s*:\s*$/i,'');
      for(const token of locked)rest=rest.split(token).join('');
      rest=rest.split(/[,\r\n]+/).map(t=>t.trim()).filter(t=>t&&!/^(?:masterpiece|best quality|high quality|highres|absurdres|score_\d(?:_up)?|[0-9]+k|ultra ?hd|newest|year\s+\d{4})$/i.test(t));
      const base=profile.format==='hybrid'?(profile.id==='anima-base'?'masterpiece, best quality, score_7, ':'masterpiece, best quality, ')+'highres, clean linework, balanced colors, coherent lighting':'A deliberate composition with coherent light, clear spatial relationships and carefully rendered material detail.';
      proposed=[...locked,base,...new Set(rest)].filter(Boolean).join(', ').replace(/,\s*$/,'')+suffix;
    }
    return {nodeId:String(target.nodeId),fieldName:target.fieldName,original,proposed,locked,suffix,refine,allowScore:profile.id==='anima-base'};
  });
}
export function acceptFixedPrompts(plan,generated=[],validate=x=>x) {
  return plan.map(item=>{
    const candidate=Array.isArray(generated)?generated.find(g=>String(g?.nodeId)===item.nodeId&&g.fieldName===item.fieldName):null;
    let prompt=item.proposed;
    if(item.refine&&typeof candidate?.prompt==='string'){
      const body=candidate.prompt.replace(/Description\s*:\s*$/i,'').trim();
      if(body.length>=12&&body.length<=1800&&item.locked.every(token=>body.includes(token))&&(item.allowScore||!/(?:^|[,\s])score_\d(?:_up)?\b/i.test(body))){try{prompt=validate(body)+item.suffix;}catch{}}
    }
    validate(prompt);
    return {nodeId:item.nodeId,fieldName:item.fieldName,prompt};
  });
}
