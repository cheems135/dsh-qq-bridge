import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareLocalImagePrompt} from '../local-image-prompt.js';
import {createImageStudio,finishImagePrompt} from '../image-studio.js';
import {referencePromptPrefix,HEADWEAR_RULE_ZH,HEADWEAR_RULE_EN} from '../image-persona.js';
import {lockLocalPortraitCamera} from '../local-portrait-plan.js';

const prompt='她穿着蓝色居家服坐在窗边木桌前，一只手握着筷子夹起碗里的米饭，桌上放着热汤和青菜，身后能看到客厅的书柜与窗帘。前置自拍呈现腰部以上的自然表情，傍晚的柔和窗光照亮桌面与脸庞。';
const plan={prompt:'按当前日程拍一张正在吃饭的自拍',humanRequest:'发一张你现在的自拍',characterName:'测试角色',promptLanguage:'zh',camera:'front',framing:'upper',ownPortrait:true,look:'蓝发，猫耳',styleTags:['anime'],cameraChinese:'前置自拍，拍摄设备在画外。',cameraNegativeChinese:'拍摄设备入镜',lifeContext:{activity:'吃晚饭',location:'窗边木桌，客厅书柜与窗帘',outfit:'蓝色居家服',override:{location:false,outfit:false}},appearanceContext:[]};
const reference={file:'identity.png',description:'蓝发，猫耳'};
const workflow={name:'Qwen Image Edit',file:'missing-fixture.json',inputs:{prompt:{node:'1',field:'text'},image:{node:'2',field:'image'},negativePrompt:{node:'3',field:'text'}}};

test('local and API directors share scene, schedule, style, camera and identity preparation',async()=>{
 const inputs=[];const answer=(system,user)=>{inputs.push({system,user});return system.startsWith('【图像细节核对】')?JSON.stringify({ok:true,missing:[]}):JSON.stringify({prompt,style:'二维二次元插画。',negativePrompt:'纯白背景',referenceIdentity:'蓝发，猫耳'});};
 const actual=await prepareLocalImagePrompt({args:{prompt:'portrait'},plan,workflow,reference,root:process.cwd(),model:async options=>{assert.deepEqual(options.tools,[]);assert.ok(options.outputTokens<=512);return answer(options.messages[0].content,options.messages[1].content);}});
 assert.match(actual.prompt,/参考图为人设图/);assert.match(actual.prompt,/蓝色居家服/);assert.match(actual.prompt,/木桌|书柜/);assert.match(actual.prompt,/米饭/);
 const brief=JSON.parse(inputs[0].user);assert.equal(brief.lifeContext.activity,'吃晚饭');assert.equal(brief.personaReference,true);assert.equal(brief.framing,'upper');assert.match(brief.sceneEvidence,/blank studio/);assert.equal(inputs.length,2);
 const api=createImageStudio({getConfig:()=>({promptLanguage:'zh'}),visualPlan:()=>plan,ask:answer});
 const expected=await api.prepare(plan.humanRequest,{chat:{characterName:plan.characterName},workflow:{name:workflow.name,promptLanguage:'zh',personaReference:true,negativeTargets:[{}],discovery:{fields:[]}}});
 assert.equal(actual.prompt,referencePromptPrefix('zh',reference.description,false,plan.characterName)+' '+finishImagePrompt(lockLocalPortraitCamera(expected.prompt,plan,'zh'),'二维二次元插画。'));assert.equal(actual.negativePrompt,expected.negativePrompt);
});

test('scene omissions cannot reach image submission and missing reference bindings are explicit',async()=>{
 let calls=0;
 await assert.rejects(prepareLocalImagePrompt({args:{prompt:'portrait'},plan,workflow,reference,root:process.cwd(),model:async options=>{calls++;return options.messages[0].content.startsWith('【图像细节核对】')?'{"ok":false,"missing":["缺少实际场景，只有白底立绘"]}':JSON.stringify({prompt,style:'二维二次元插画。'});}}),/细节或日程核对未通过/);assert.equal(calls,6);
 await assert.rejects(prepareLocalImagePrompt({args:{prompt:'portrait'},plan,workflow:{...workflow,inputs:{}},reference,root:process.cwd(),model:()=>assert.fail('no compatible identity input')}),/参考图输入映射/);
});

test('explicit user source image does not inherit a persona identity declaration',async()=>{
 let brief;
 const result=await prepareLocalImagePrompt({args:{prompt:'修改这张图',image:'user.png'},plan:{...plan,ownPortrait:false,lifeContext:null},workflow,reference,root:process.cwd(),model:async options=>{brief=JSON.parse(options.messages[1].content);return JSON.stringify({prompt:'窗边木桌上放着一碗热米饭和一碗汤，背景有书架与窗帘，夕阳从窗户照入客厅。',style:'二维二次元插画。'});}});
 assert.equal(brief.personaReference,false);assert.doesNotMatch(result.prompt,/参考图为人设图/);
});

test('identity prefixes leave removable headwear to the current outfit and preserve anatomical features',()=>{
 const zh=referencePromptPrefix('zh','蓝发，猫耳，女仆发箍，白色头饰，蓝色连衣裙',false,'角色');
 assert.match(zh,/蓝发，猫耳/);assert.doesNotMatch(zh,/女仆发箍|白色头饰|蓝色连衣裙/);assert.ok(zh.includes(HEADWEAR_RULE_ZH));
 const en=referencePromptPrefix('en','blue hair, cat ears, maid headband, lace bonnet',false,'Character');
 assert.match(en,/blue hair, cat ears/);assert.doesNotMatch(en,/maid headband|lace bonnet/);assert.ok(en.includes(HEADWEAR_RULE_EN));
});

test('API and local outfit preparation both pass the matching headwear policy and explicit keep request to drafting and review',async()=>{
 const next={...plan,humanRequest:'换成蓝色泳装，保留我指定的星星发夹，别保留女仆发箍',prompt:'蓝色泳装，星星发夹，海边',lifeContext:null};
 const drafts=[],reviews=[];
 const answer=(system,user)=>{
  const input=JSON.parse(user);
  if(system.startsWith('【图像细节核对】')){reviews.push(input);return '{"ok":true,"missing":[]}';}
  drafts.push(input);assert.ok(system.includes(HEADWEAR_RULE_EN));
  return JSON.stringify({prompt:'她换上蓝色泳装，保留星星发夹并露出猫耳，站在海边的遮阳伞旁，抬手整理长发，身后能看到沙滩与海浪，前置自拍呈现自然表情，明亮柔和的阳光照亮脸庞。',style:'二维二次元插画。'});
 };
 const local=await prepareLocalImagePrompt({args:{prompt:'泳装自拍'},plan:next,workflow,reference,root:process.cwd(),model:async o=>answer(o.messages[0].content,o.messages[1].content)});
 const api=createImageStudio({getConfig:()=>({promptLanguage:'zh'}),visualPlan:()=>next,ask:answer});
 const remote=await api.prepare(next.humanRequest,{chat:{characterName:next.characterName},workflow:{personaReference:true,promptLanguage:'zh',negativeTargets:[{}]}});
 assert.equal(drafts.length,2);assert.equal(reviews.length,2);
 for(const brief of drafts){assert.equal(brief.headwearPolicy,HEADWEAR_RULE_ZH);assert.equal(brief.currentHumanRequest,next.humanRequest);}
 for(const review of reviews){assert.equal(review.headwearCheck,HEADWEAR_RULE_ZH);assert.match(review.finalPrompt,/星星发夹/);}
 assert.match(local.prompt,/星星发夹/);assert.match(remote.prompt,/星星发夹/);
});

test('headwear mismatch rejected by scene review is corrected before the prompt is accepted',async()=>{
 let drafts=0,reviews=0;
 const studio=createImageStudio({getConfig:()=>({promptLanguage:'zh'}),visualPlan:()=>({...plan,humanRequest:'换成沙滩泳装，头饰也要换',lifeContext:null}),ask:async(system,user)=>{
  const input=JSON.parse(user);
  if(system.startsWith('【图像细节核对】')){reviews++;assert.equal(input.headwearCheck,HEADWEAR_RULE_ZH);return reviews===1?'{"ok":false,"missing":["换成泳装却沿用女仆发箍"]}':'{"ok":true,"missing":[]}';}
  drafts++;return JSON.stringify({prompt:drafts===1?'她穿蓝色泳装，头上依然戴着女仆发箍，站在海边沙滩上自然微笑，背景是海浪和遮阳伞。':'她穿蓝色泳装，换上配套的蓝色发带并露出原有猫耳，站在海边沙滩上自然微笑，背景是海浪和遮阳伞。',style:'二维二次元插画。'});
 }});
 const result=await studio.prepare('沙滩泳装',{workflow:{personaReference:true,promptLanguage:'zh',negativeTargets:[]}});
 assert.equal(drafts,2);assert.equal(reviews,2);assert.match(result.prompt,/蓝色发带/);assert.doesNotMatch(result.prompt,/女仆发箍/);
});
