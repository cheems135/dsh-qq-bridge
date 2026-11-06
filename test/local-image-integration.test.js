import {listenLocalServer} from './local-server-listen.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalModelServer} from '../local-model-server.mjs';
import {probeColorPng} from '../local-probe-image.js';

test('gateway image execution submits the shared reviewed scene and persona reference once, with correlated invocation records',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'local-scene-submit-')),file=join(directory,'config.json'),graph=join(directory,'image.json');
 writeFileSync(graph,JSON.stringify({1:{class_type:'Prompt',inputs:{text:''}},2:{class_type:'LoadImage',inputs:{image:''}},3:{class_type:'SaveImage',inputs:{images:['2',0]}}}));
 writeFileSync(file,JSON.stringify({voiceEnabled:false,dialoguePriority:'quality',mediaDir:directory,workflowLibrary:[{id:'scene',name:'Scene',kind:'image',file:graph,inputs:{prompt:{node:'1',field:'text'},image:{node:'2',field:'image'}},output:{node:'3',field:'images',kind:'image'}}]}));
 let submissions=0,submitted,models=0;const prose='她穿着蓝色居家服坐在客厅窗边木桌前，手握筷子夹起碗中的米饭，桌面放着热汤与青菜，身后有书架和窗帘。画面为前置自拍的上半身取景，暖色窗光照亮她的脸与桌面。';
 const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:directory,LOCAL_AI_LOG_FILE:join(directory,'log')},logger:()=>{},runtime:{status:async()=>({reachable:true}),waitUntilIdle:async()=>{},release:async()=>({freed:true}),run:async(kind,args,options)=>{assert.equal(kind,'scene');submissions++;submitted=args;options.onInvocation({status:'submitted',kind:'image',workflowDetails:{imageBinding:{node:'2',field:'image',value:'uploaded-persona.png',onOutputPath:true}},submittedArguments:{prompt:args.prompt,sceneRecompose:args.recomposeScene}});options.onInvocation({status:'submitted',promptId:'actual-prompt',clientId:'bridge-test'});const image=join(directory,'result.png');writeFileSync(image,probeColorPng());return {ok:true,promptId:'actual-prompt',media:[{kind:'image',file:image}]};}},model:async options=>{models++;if(options.purpose==='image_prompt'){assert.deepEqual(options.tools,[]);return options.messages[0].content.startsWith('【图像细节核对】')?'{"ok":true,"missing":[]}':JSON.stringify({prompt:prose,style:'二维二次元插画。'});}return '{"action":"image","arguments":{"prompt":"portrait"},"waitText":"还在摆弄这张晚饭自拍，陪我等会儿。"}';},fetchImpl:async()=>Response.json({ok:true})});
 const base=await listenLocalServer(service);
 try{
  const response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'生成一张你的自拍'}],turnContext:{recordScope:{accountId:'a',personaId:'p',chat:'private:test'},personaImage:{dataUrl:'data:image/png;base64,'+probeColorPng().toString('base64'),description:'蓝发，猫耳'},imagePlan:{prompt:'按日程在客厅吃饭',humanRequest:'生成一张你的自拍',promptLanguage:'zh',characterName:'测试角色',ownPortrait:true,camera:'front',framing:'upper',look:'蓝发，猫耳',styleTags:['anime'],lifeContext:{activity:'吃饭',location:'客厅木桌',outfit:'蓝色居家服'},appearanceContext:[]}}})});
  const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.attachments.length,1);assert.equal(submissions,1);assert.equal(models,3);assert.match(submitted.prompt,/参考图为人设图/);assert.match(submitted.prompt,/书架和窗帘/);assert.ok(submitted.image);assert.equal(submitted.recomposeScene,true);
  const records=(await(await fetch(base+'/v1/local/invocations')).json()).records;assert.equal(records.length,1);assert.equal(records[0].status,'returned');assert.equal(records[0].promptId,'actual-prompt');assert.equal(records[0].imagePlan.lifeContext.location,'客厅木桌');assert.equal(records[0].submittedArguments.prompt,submitted.prompt);assert.equal(records[0].reference.used,true);assert.equal(records[0].reference.actualSource,'persona');assert.equal(records[0].reference.sha256.length,64);assert.equal(records[0].imagePlan.ownPortrait,true);
 }finally{service.server.closeAllConnections();await service.close();rmSync(directory,{recursive:true,force:true});}
});
