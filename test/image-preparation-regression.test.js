import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {photoComposition} from '../image-persona.js';
import {requestedImageText} from '../image-prompt-language.js';
import {modelImagePrompt,createImageStudio} from '../image-studio.js';
import {prepareLocalImagePrompt,explicitlyRequiresReference} from '../local-image-prompt.js';
import {localPromptLanguageMismatch} from '../local-image-response.js';
import {localMediaFailure} from '../local-transport.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';
import {listenLocalServer} from './local-server-listen.js';

const request='画一张生日贺卡，上面写“生日快乐”';
const prose='A birthday card rests beside a wrapped present on a wooden table. The card displays the lettering "生日快乐" in blue ink, surrounded by small painted flowers.';
test('English scene validation preserves requested Chinese lettering, but rejects untranslated narration',()=>{
 const literalText=requestedImageText(request);
 assert.deepEqual(literalText,['生日快乐']);
 assert.equal(modelImagePrompt(prose,{literalText}),prose);
 assert.equal(localPromptLanguageMismatch({prompt:prose},'en','',literalText),false);
 for(const bad of [prose.replace('wooden table','木桌'),prose.replace('生日快乐','晚上好'),'"生日快乐"'])assert.throws(()=>modelImagePrompt(bad,{literalText}));
 assert.throws(()=>modelImagePrompt(prose));
 assert.deepEqual(requestedImageText('她说“我今天穿蓝衣服”'),[]);
});

test('API and local directors keep requested lettering without repair or repeated preparation',async()=>{
 const plan={humanRequest:request,prompt:request,camera:'scene',framing:'scene',promptLanguage:'en'};
 let apiCalls=0,localCalls=0;
 const api=createImageStudio({getConfig:()=>({promptLanguage:'en'}),visualPlan:()=>plan,ask:async(_,brief)=>{apiCalls++;assert.deepEqual(JSON.parse(brief).literalText,['生日快乐']);return JSON.stringify({prompt:prose});}});
 const apiResult=await api.prepare(request);
 const localResult=await prepareLocalImagePrompt({args:{prompt:request},plan,workflow:{file:'unused.json',inputs:{}},root:process.cwd(),model:async o=>{localCalls++;assert.equal(o.purpose,'image_prompt');return JSON.stringify({prompt:prose});}});
 assert.match(apiResult.prompt,/生日快乐/);assert.match(localResult.prompt,/生日快乐/);
 assert.equal(apiCalls,1);assert.equal(localCalls,1);
});

test('explicit subject crops apply to people and objects without relying on persona recognition',()=>{
 for(const [request,framing] of [['拍一张朋友的全身照','full'],['画一个人的半身像','upper'],['脸部特写','face'],['只拍你的眼睛特写','detail'],['拍一张茶杯特写','detail']]){
  const result=photoComposition({request,ownPortrait:false});
  assert.equal(result.framing,framing,request);assert.notEqual(result.camera,'front');
  assert.doesNotMatch(result.framingEnglish,/Frame the surroundings|camera holder/);
 }
 const selfie=photoComposition({request:'自拍，只拍你的眼睛特写',ownPortrait:true});
 assert.equal(selfie.camera,'front');assert.equal(selfie.framing,'detail');
});

test('routed local media reports the real failed receipt rather than a missing file or duplicate error',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const begin=source.indexOf('  async function runRoutedLocalMedia('),end=source.indexOf('  async function connectedSpeech(',begin);
 const body={receipts:[{tool:'image',ok:false,error:'工作流「测试」没有参考图输入映射',invocationId:'failed-image'},{tool:'image',ok:false,error:'重复调用',duplicate:true},{tool:'search',ok:false,error:'无关的搜索失败'}],attachments:[]};
 let submitted=0;
 const deps={settings:{localChat:{}},isLoopbackUrl:()=>true,invocationScope:()=>({}),featureState:{generation:0},applyLocalPortraitPlan:()=>({}),photoPromptPlan:()=>({}),activePersona:()=>({}),localPersonaReference:()=>null,apiModeController:new AbortController(),runWithHostTools:async()=>{submitted++;return {ok:true,body};},currentScheduleScope:()=>({}),personaPromptText:()=>'',personaWaitStyle:()=>'',connectionPromptModel:()=>{},localMediaFailure};
 const run=Function(...Object.keys(deps),'return ('+source.slice(begin,end).trim()+')')(...Object.values(deps));
 await assert.rejects(run('image','普通测试','private:test'),error=>error.message.includes('没有参考图输入映射')&&error.invocationId==='failed-image');
 assert.equal(submitted,1);
 assert.equal(localMediaFailure({error:{message:'服务断开'}},'image').message,'服务断开');
 assert.doesNotMatch(localMediaFailure({receipts:[{tool:'search',ok:false,error:'无关搜索'}]},'image').message,/无关搜索/);
});

test('text-to-image is allowed with an optional saved persona image but cannot consume an explicit edit input',async()=>{
 const plan={humanRequest:'发一张你的自拍',prompt:'窗边读书',ownPortrait:true,look:'blue hair and cat ears',promptLanguage:'en'};
 const reference={file:'identity.png',description:plan.look},workflow={file:'unused.json',inputs:{}};
 const result=await prepareLocalImagePrompt({args:{prompt:'portrait'},plan,reference,workflow,root:process.cwd(),model:async o=>{
  if(o.messages[0].content.startsWith('【图像细节核对】'))return '{"ok":true,"missing":[]}';
  const brief=JSON.parse(o.messages[1].content);assert.equal(brief.personaReference,false);assert.equal(brief.identityConditioning,'persona-description');assert.match(brief.referenceDescription,/blue hair/);
  return JSON.stringify({prompt:'She has blue hair and cat ears and reads a book by the window. Soft light falls across her face in a natural selfie composition.'});
 }});
 assert.match(result.prompt,/blue hair/);assert.doesNotMatch(result.prompt,/supplied reference|attached reference|参考图为人设图/);
 await assert.rejects(prepareLocalImagePrompt({args:{prompt:'edit',image:'uploaded.png'},plan,reference,workflow,root:process.cwd(),model:()=>assert.fail('no inference')}),/参考图输入映射/);
 assert.equal(explicitlyRequiresReference('不用图生图，直接文字生成'),false);
 assert.equal(explicitlyRequiresReference('必须使用人设图生成'),true);
});

for(const mode of ['saved-persona','missing-persona','explicit-reference','mapping-lost'])test('selected text-to-image workflow: '+mode,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'image-mode-')),configFile=join(dir,'config.json'),graphFile=join(dir,'image.json');
 const graph={1:{class_type:'Prompt',inputs:{text:''}},3:{class_type:'SaveImage',inputs:{}}};
 if(mode==='mapping-lost'){graph[2]={class_type:'LoadImage',inputs:{image:''}};graph[3].inputs.images=['2',0];}
 writeFileSync(graphFile,JSON.stringify(graph));
 writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir,workflowLibrary:[{id:'scene',name:'纯文生图测试',kind:'image',file:graphFile,triggerWords:'character_token',inputs:{prompt:{node:'1',field:'text'}},output:{node:'3',field:'images',kind:'image'}}]}));
 let models=0,submissions=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'log')},logger:()=>{},fetchImpl:async()=>Response.json({ok:true}),runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(id,args)=>{
  submissions++;assert.equal(id,'scene');assert.equal(args.image,undefined);assert.equal(args.requirePersonaReference,false);assert.equal(args.recomposeScene,false);
  assert.match(args.prompt,/blue hair and cat ears/);assert.match(args.prompt,/character_token/);assert.match(args.prompt,/book by the window/);
  assert.doesNotMatch(args.prompt,/supplied reference|attached reference|参考图为人设图/);
  const file=join(dir,'result.png');writeFileSync(file,probeColorPng());return {ok:true,promptId:'simulated-only',media:[{kind:'image',file}]};
 }},model:async o=>{models++;return o.messages[0].content.startsWith('【图像细节核对】')?'{"ok":true,"missing":[]}':JSON.stringify({prompt:'She has blue hair and cat ears and reads a book by the window. Soft light falls across her face in a natural selfie composition.'});}});
 const base=await listenLocalServer(service),humanRequest=mode==='explicit-reference'?'必须使用人设图生成一张自拍':'发一张你的自拍';
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:humanRequest}],turnContext:{mediaOnly:{kind:'image',prompt:humanRequest},imagePlan:{humanRequest,ownPortrait:true,promptLanguage:'en',camera:'front',look:'blue hair and cat ears'},personaReferenceDiagnostics:{configured:true,required:true,plannedOwnPortrait:true},...(mode==='missing-persona'?{}:{personaImage:{dataUrl:'data:image/png;base64,'+probeColorPng().toString('base64')}})}})});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));
  if(['explicit-reference','mapping-lost'].includes(mode)){
   assert.equal(models,0);assert.equal(submissions,0);assert.equal(body.attachments.length,0);assert.match(localMediaFailure(body,'image').message,/纯文生图测试.*参考图输入映射/);
  }else{
   assert.equal(models,2,JSON.stringify(body));assert.equal(submissions,1);assert.equal(body.attachments.length,1);
   const record=body.invocations.find(r=>r.tool==='image');assert.equal(record.status,'returned');assert.equal(record.reference.mode,'text-to-image');assert.equal(record.reference.used,false);assert.equal(record.reference.required,false);
  }
 }finally{service.server.closeAllConnections();await service.close();rmSync(dir,{recursive:true,force:true});}
});

