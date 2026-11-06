import test from 'node:test';
import assert from 'node:assert/strict';
import {localPromptObject} from '../local-image-response.js';
import {prepareLocalImagePrompt} from '../local-image-prompt.js';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';
import {listenLocalServer} from './local-server-listen.js';
const prose='She sits beside the living room window reading an open book in blue loungewear. A bookshelf and curtains fill the background, and warm window light falls across her face.';
const plan={humanRequest:'发一张你在窗边看书的自拍',prompt:'在客厅窗边看书，蓝色居家服，书架和窗帘背景',promptLanguage:'en',characterName:'测试角色',ownPortrait:true,camera:'front',framing:'upper',styleTags:['anime'],look:'',lifeContext:{activity:'看书',location:'客厅窗边',outfit:'蓝色居家服'}};
const workflow={name:'Qwen Image Edit',file:'missing.json',inputs:{image:{node:'2',field:'image'},prompt:{node:'1',field:'text'}}};
const options={args:{prompt:'portrait'},plan,workflow,reference:{file:'identity.png',description:''},root:process.cwd()};
const value={prompt:prose,style:'Two-dimensional anime illustration.',negativePrompt:''};
const answer=o=>o.messages[0].content.startsWith('【图像细节核对】')?'{"ok":true,"missing":[]}':JSON.stringify(value);
test('valid file-backed identity does not require an optional handwritten reference description',async()=>{
 const result=await prepareLocalImagePrompt({...options,model:async o=>answer(o)});
 assert.match(result.prompt,/reading an open book/);assert.match(result.referenceIdentity,/attached reference image/);assert.doesNotMatch(result.prompt,/hair color is blue/);
});
test('quoted narrative, double-encoded JSON, text content arrays and blank optional negative fields decode without another inference',()=>{
 for(const raw of [JSON.stringify(prose),JSON.stringify(JSON.stringify(value)),{choices:[{message:{content:[{type:'text',text:JSON.stringify(value)}]}}]}])assert.equal(localPromptObject(raw).value.prompt,prose);
 assert.equal(localPromptObject(JSON.stringify({...value,negativePrompt:'   '})).value.negativePrompt,'');
 for(const raw of ['[]','null',JSON.stringify({action:'image',arguments:{prompt:prose}}),{choices:[{message:{refusal:'declined'}}]},JSON.stringify('Sorry, I cannot help with this request.')])assert.throws(()=>localPromptObject(raw));
});
test('mixed-language scene is corrected once, reviewed against the original brief and recorded before submission',async()=>{
 const stages=[];let translations=0,reviews=0;
 const result=await prepareLocalImagePrompt({...options,onProgress:e=>{if(e.promptPreparation)stages.push(e.promptPreparation);},model:async o=>{
  const system=o.messages[0].content;
  if(system.startsWith('【图像细节核对】')){reviews++;const review=JSON.parse(o.messages[1].content);assert.match(review.finalPrompt,/bookshelf/);assert.equal(review.requirements.lifeContext.activity,'看书');return '{"ok":true,"missing":[]}';}
  if(system.startsWith('【本地图片语言修正】')){translations++;assert.deepEqual(o.tools,[]);assert.match(o.messages[1].content,/蓝色居家服/);return JSON.stringify(value);}
  return JSON.stringify({...value,prompt:prose.replace('blue loungewear','蓝色居家服')});
 }});
 assert.equal(translations,1);assert.equal(reviews,1);assert.match(result.prompt,/blue loungewear/);assert.ok(stages.at(-1).attempts.some(a=>a.stage==='language'&&a.status==='returned'));
});
test('provider refusal stops new preparation calls and never becomes a fallback picture description',async()=>{
 let models=0;await assert.rejects(prepareLocalImagePrompt({...options,model:async()=>{models++;return {choices:[{message:{refusal:'declined'}}]};}}),/没有提供可用/);assert.equal(models,1);
});
test('persistent malformed output stays bounded and cannot bypass scene review',async()=>{
 let models=0;await assert.rejects(prepareLocalImagePrompt({...options,model:async()=>{models++;return 'not JSON';}}),/提示词润色未完成/);assert.equal(models,3);
});
for(const mode of ['missing-description','mixed-language','quoted-prose'])test('local gateway '+mode+' reaches exactly one simulated image execution with reference and complete scene, and journals preparation',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'image-reliability-')),configFile=join(dir,'config.json'),graph=join(dir,'image.json');
 writeFileSync(graph,JSON.stringify({1:{class_type:'Prompt',inputs:{text:''}},2:{class_type:'LoadImage',inputs:{image:''}},3:{class_type:'SaveImage',inputs:{images:['2',0]}}}));
 writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir,workflowLibrary:[{id:'scene',name:'Scene',kind:'image',file:graph,inputs:workflow.inputs,output:{node:'3',field:'images',kind:'image'}}]}));
 let submissions=0,submitted,translations=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},logger:()=>{},fetchImpl:async()=>Response.json({ok:true,busy:false}),runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(kind,args)=>{submissions++;submitted=args;const file=join(dir,'fixed-fixture.png');writeFileSync(file,probeColorPng());return {ok:true,promptId:'simulated-only',media:[{kind:'image',file}]};}},model:async o=>{
  if(o.purpose!=='image_prompt')return JSON.stringify({action:'image',arguments:{prompt:'window reading portrait'},waitText:'我去窗边挑个看得见书架的位置。'});
  const system=o.messages[0].content;if(system.startsWith('【图像细节核对】'))return '{"ok":true,"missing":[]}';
  if(system.startsWith('【本地图片语言修正】')){translations++;return JSON.stringify(value);}
  return mode==='mixed-language'?JSON.stringify({...value,prompt:prose.replace('blue loungewear','蓝色居家服')}):mode==='quoted-prose'?JSON.stringify(prose):JSON.stringify(value);
 }});
 const base=await listenLocalServer(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({origin:'qq',messages:[{role:'user',content:plan.humanRequest}],turnContext:{imagePlan:plan,personaImage:{dataUrl:'data:image/png;base64,'+probeColorPng().toString('base64'),description:''},recordScope:{accountId:'test',personaId:'p',chat:'private:test'}}})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(submissions,1);assert.equal(result.attachments.length,1);assert.ok(submitted.image);assert.equal(submitted.recomposeScene,true);assert.match(submitted.prompt,/bookshelf/);assert.match(submitted.prompt,/reading an open book/);assert.match(submitted.prompt,/selfie/i);
  const record=result.invocations.find(r=>r.tool==='image');assert.equal(record.status,'returned');assert.equal(record.reference.actualSource,'persona');assert.ok(record.promptPreparation.attempts.some(a=>a.stage==='draft'));assert.equal(translations,mode==='mixed-language'?1:0);assert.equal(result.qqDelivered,false);
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});
