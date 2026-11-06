import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localImageTemplate,applyLocalImageFixedPrompts} from '../local-image-template.js';
import {normalizeWorkflowLibrary} from '../local-config.js';
import {prepareLocalImagePrompt} from '../local-image-prompt.js';
import {createImageStudio} from '../image-studio.js';
import {referencePromptPrefix} from '../image-persona.js';
import {createComfyRuntime} from '../comfyui-runtime.js';
import {probeColorPng} from '../local-probe-image.js';
const graph=()=>({'1':{class_type:'PrimitiveString',inputs:{value:'old scene'}},'2':{class_type:'JoinString',inputs:{text_a:'(@artist), highres\nDescription:\n',text_b:['1',0]}},'3':{class_type:'Encode',inputs:{text:['2',0],image:['6',0]}},'4':{class_type:'SaveImage',inputs:{images:['3',0]}},'6':{class_type:'LoadImage',inputs:{image:'reference.png'}},'5':{class_type:'UNETLoader',inputs:{unet_name:'anima_base.safetensors'}},'99':{class_type:'UnusedJoin',inputs:{text_a:'unused\nDescription:\n',text_b:['1',0]}}});
const spec={id:'image-fixture',name:'Fixture',kind:'image',file:'fixture.json',inputs:{prompt:{node:'1',field:'value'},image:{node:'6',field:'image'}},output:{node:'4',field:'images',kind:'image'},promptModel:'anima-base',promptLanguage:'en',fixedPromptMode:'preserve',triggerWords:'frame_trigger',note:'Keep a soft hand-drawn look.'};
const plan={prompt:'窗边阅读，蓝色居家服，背景有书架与窗帘',humanRequest:'发一张你在窗边看书的自拍',characterName:'测试角色',promptLanguage:'zh',ownPortrait:true,camera:'front',framing:'upper',cameraEnglish:'Front-facing selfie, camera outside the frame.',cameraChinese:'前置自拍，拍摄设备在画外。',look:'blue hair and cat ears',styleTags:['anime'],lifeContext:{activity:'阅读',location:'客厅窗边',outfit:'蓝色居家服'},appearanceContext:[]};
const prose='She sits by the living room window reading an open book, wearing blue loungewear. Bookshelves and curtains fill the background, while warm window light falls on her face. Front-facing selfie, camera outside the frame.';
const drafted={prompt:prose,style:'Two-dimensional anime illustration.',referenceIdentity:'blue hair and cat ears',negativePrompt:''};
test('local library retains the API director metadata instead of dropping it during normalization',()=>{
 const item={...spec,discovery:{prefixTargets:[{nodeId:'2',fieldName:'text_a'}]},extraNodes:[{nodeId:'2',fieldName:'text_a',fieldValue:'(@artist), highres\nDescription:\n'}]};const normalized=normalizeWorkflowLibrary([item])[0];
 for(const key of ['promptModel','promptLanguage','fixedPromptMode','triggerWords','note','discovery','extraNodes'])assert.deepEqual(normalized[key],item[key]);
});
test('only the connected separate prefix is detected; variable scene and unused branches remain independent',()=>{
 const template=localImageTemplate(spec,graph(),{language:'zh',usesReference:true});assert.deepEqual(template.discovery.prefixTargets,[{nodeId:'2',fieldName:'text_a'}]);assert.equal(template.promptLanguage,'en');assert.equal(template.personaReference,true);assert.ok(template.discovery.fields.some(f=>f.fieldName==='unet_name'));assert.match(template.discovery.reference,/@artist/);
 assert.throws(()=>localImageTemplate({...spec,discovery:{prefixTargets:[{nodeId:'1',fieldName:'value'}]}},graph()),/不能绑定同一字段/);
});
test('same API and local director receive identical system and brief: model, prefix, current request, schedule and eight recent messages',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'template-parity-'));writeFileSync(join(dir,'fixture.json'),JSON.stringify(graph()));
 const conversation=Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'本轮相关对话 '+i})),operationReview={intent:'角色阅读自拍',resolvedRequest:plan.humanRequest},localCalls=[],apiCalls=[],evidence=[];
 const answer=(system,user,calls)=>{calls.push({system,brief:JSON.parse(user)});return system.startsWith('【图像细节核对】')?'{"ok":true,"missing":[]}':JSON.stringify(drafted);};
 try{
  const local=await prepareLocalImagePrompt({args:{prompt:'portrait'},plan,workflow:spec,reference:{file:'identity.png',description:plan.look},root:dir,conversation,operationReview,onProgress:e=>{if(e.promptPreparation)evidence.push(e.promptPreparation);},model:async o=>answer(o.messages[0].content,o.messages[1].content,localCalls)});
  const workflow=localImageTemplate(spec,graph(),{usesReference:true}),director=createImageStudio({getConfig:()=>({promptLanguage:'en'}),visualPlan:()=>plan,ask:async(s,u)=>answer(s,u,apiCalls)});
  const api=await director.prepare(plan.humanRequest,{chat:{characterName:plan.characterName,operationContext:conversation.map(r=>({role:r.role,text:r.content})),operationReview},workflow});
  assert.deepEqual(localCalls,apiCalls);assert.equal(localCalls[0].brief.recentConversation.length,8);assert.equal(localCalls[0].brief.modelStrategy.id,'anima-base');assert.equal(localCalls[0].brief.fixedPromptPlan.length,1);assert.equal(localCalls[0].brief.lifeContext.outfit,'蓝色居家服');
  assert.equal(local.prompt,referencePromptPrefix('en',drafted.referenceIdentity,false,plan.characterName)+' '+api.prompt);assert.equal(local.negativePrompt,api.negativePrompt);assert.deepEqual(local.fixedPrompts,api.fixedPrompts);assert.ok(local.prompt.endsWith(drafted.style));assert.equal(evidence.at(-1).template.source,'shared-api-image-director');assert.match(evidence.at(-1).template.system,/MODEL-SPECIFIC RULES/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('style remains last even when local camera protection adds a constraint and the model omits the optional style field',async()=>{
 const p={...plan,styleTags:['watercolor'],promptLanguage:'zh'},workflow={...spec,promptLanguage:'zh'};
 const result=await prepareLocalImagePrompt({args:{prompt:'portrait'},plan:p,workflow,root:'.',reference:null,model:async o=>o.messages[0].content.startsWith('【图像细节核对】')?'{"ok":true,"missing":[]}':JSON.stringify({prompt:'她穿着蓝色居家服坐在客厅窗边阅读一本展开的书，身后有书架和窗帘，柔和的窗光照亮她的脸。她把书放在桌边，画面保留自然的生活环境。'})});
 assert.ok(result.prompt.endsWith('水彩插画。'));assert.ok(result.prompt.indexOf('拍摄设备在画外')<result.prompt.lastIndexOf('水彩插画。'));assert.doesNotMatch(result.prompt,/\n/);
});
test('fixed prefixes preserve original spacing and artist tokens, and cannot overwrite a non-prefix node',()=>{
 const original=graph(),w=structuredClone(original),prefix='(@artist), soft light\nDescription:\n';applyLocalImageFixedPrompts(w,spec,[{nodeId:'2',fieldName:'text_a',prompt:prefix}]);assert.equal(w['2'].inputs.text_a,prefix);assert.notDeepEqual(w,original);
 assert.throws(()=>applyLocalImageFixedPrompts(graph(),spec,[{nodeId:'1',fieldName:'value',prompt:'replace scene'}]),/未识别字段/);
 assert.throws(()=>applyLocalImageFixedPrompts(graph(),spec,[{nodeId:'2',fieldName:'text_a',prompt:'missing artist and trigger'}]),/遗漏已锁定/);
});
test('actual Comfy runtime submits the prepared scene and registered fixed prefix to separate graph nodes on a private copy',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'template-runtime-')),original=graph(),prefix='(@artist), soft light\nDescription:\n',events=[];let submitted,posts=0;
 const runtime=createComfyRuntime({root:dir,getConfig:{baseUrl:'http://127.0.0.1:8188',mediaDir:dir,memoryProfile:'8gb',workflows:{draw:{...spec,api:original}}},fetchImpl:async(url,init={})=>{
  if(url.endsWith('/prompt')){posts++;submitted=JSON.parse(init.body).prompt;return Response.json({prompt_id:'fixture-only'});}
  if(url.includes('/history/fixture-only'))return Response.json({'fixture-only':{outputs:{4:{images:[{filename:'fixture.png',subfolder:'',type:'output'}]}}}});
  if(url.includes('/view?'))return new Response(probeColorPng(),{headers:{'content-type':'image/png'}});throw Error('Unexpected fixture request');
 }});
 try{
  const result=await runtime.run('draw',{prompt:prose,fixedPrompts:[{nodeId:'2',fieldName:'text_a',prompt:prefix}]},{onInvocation:e=>events.push(e)});
  assert.equal(posts,1);assert.equal(submitted['1'].inputs.value,prose);assert.equal(submitted['2'].inputs.text_a,prefix);assert.equal(original['2'].inputs.text_a,'(@artist), highres\nDescription:\n');assert.equal(result.media.length,1);assert.deepEqual(events.find(e=>e.submittedArguments)?.submittedArguments.fixedPrompts,[{nodeId:'2',fieldName:'text_a',prompt:prefix}]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
import {fitLocalImageBrief} from '../local-image-template.js';
test('8 GB prompt fitting preserves the complete shared template and all current visual facts, only excerpting optional old dialogue',()=>{
 const system='Complete shared API director instructions. '.repeat(100),brief={currentHumanRequest:'在窗边阅读，穿绿色外套和配套发带',lifeContext:{activity:'阅读',location:'窗边',outfit:'绿色外套'},visualBrief:'书架与窗帘，前置自拍，暖色窗光',cameraConstraint:'device outside frame',recentConversation:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',text:('旧聊天'+i+'。').repeat(300)}))};
 const result=fitLocalImageBrief(system,JSON.stringify(brief)),after=JSON.parse(result.user);assert.equal(result.stats.oldDialogueExcerpted,true);assert.deepEqual(after.lifeContext,brief.lifeContext);assert.equal(after.currentHumanRequest,brief.currentHumanRequest);assert.equal(after.visualBrief,brief.visualBrief);assert.equal(after.cameraConstraint,brief.cameraConstraint);assert.equal(after.recentConversation.length,8);assert.ok(result.stats.afterEstimate<result.stats.beforeEstimate);
});
test('configured fixed-prefix overrides are the reference the director sees and the runtime preserves',()=>{
 const configured={...spec,extraNodes:[{nodeId:'2',fieldName:'text_a',fieldValue:'(@new_artist), watercolor\nDescription:\n'}]},g=graph(),template=localImageTemplate(configured,g);
 assert.match(template.discovery.reference,/@new_artist/);assert.doesNotMatch(template.discovery.reference,/\(@artist\)/);
 applyLocalImageFixedPrompts(g,configured,[{nodeId:'2',fieldName:'text_a',prompt:configured.extraNodes[0].fieldValue}]);assert.equal(g['2'].inputs.text_a,configured.extraNodes[0].fieldValue);
});
