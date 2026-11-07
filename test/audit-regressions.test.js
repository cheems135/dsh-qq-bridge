import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServiceConnections} from '../service-connections.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {createBrowserController} from '../browser-controller.js';
import {readBrowserVideo} from '../browser-video.js';

test('editing only the chat model preserves all image, speech, video and path settings',()=>{
 let state;const c=createServiceConnections({storage:{read:()=>state,write:s=>state=structuredClone(s)}});
 const first=c.save({type:'openai',baseUrl:'http://127.0.0.1:8000/v1',name:'My connection',chatModel:'chat-a',imageModel:'img',imageMode:'edits',speechModel:'tts',voice:'voice',videoModel:'vid',videoMode:'json',models:['chat-a','chat-b'],evidence:['models received'],paths:{image:'images/edits'}});
 const changed=c.save({id:first.id,chatModel:'chat-b'});assert.equal(changed.chatModel,'chat-b');
 for(const key of ['name','baseUrl','type','imageModel','imageMode','speechModel','voice','videoModel','videoMode','models','evidence','paths'])assert.deepEqual(changed[key],first[key],key);
 c.save({id:first.id,imageModel:'',voice:'',imageMode:'generations'});assert.equal(c.profile(first.id).imageModel,'');assert.equal(c.profile(first.id).voice,'');assert.equal(c.profile(first.id).imageMode,'generations');
});

test('partial connection edits retain credential origin checks and mobile source restrictions',()=>{
 let state;const c=createServiceConnections({storage:{read:()=>state,write:s=>state=structuredClone(s)}});
 const p=c.save({type:'openai',baseUrl:'https://one.example/v1',apiKey:'fictional-test-key',chatModel:'a'});
 assert.throws(()=>c.save({id:p.id,baseUrl:'https://two.example/v1'}),/旧密钥/);assert.equal(c.profile(p.id).baseUrl,'https://one.example/v1');
 const mobile=createServiceConnections({storage:{read:()=>state,write:s=>state=structuredClone(s)},apiOnly:true});assert.throws(()=>mobile.save({id:p.id,type:'comfyui'}),/手机版仅支持 API/);
});

test('invalid local configuration fails visibly without resetting or writing over the saved file',()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./config-guard-',import.meta.url))),configFile=join(dir,'config.json');
 try{
  for(const raw of ['{ "apiKey": "secret-sentinel", broken',JSON.stringify({backend:'openai',modelId:''}),JSON.stringify({chatWorkflow:'removed-custom-workflow'})]){
   writeFileSync(configFile,raw);assert.throws(()=>createLocalModelServer({configFile}),error=>{assert.match(error.message,/已保留原文件/);assert.doesNotMatch(error.message,/secret-sentinel/);return true;});assert.equal(readFileSync(configFile,'utf8'),raw);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('missing and BOM-prefixed configuration retain supported startup behavior',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./config-startup-',import.meta.url))),configFile=join(dir,'config.json');
 try{
  let service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{}});assert.equal(service.config.chatWorkflow,'');assert.equal(existsSync(configFile),false);await service.close();
  writeFileSync(configFile,'\uFEFF'+JSON.stringify({backend:'openai',modelId:'custom-local-model',voiceEnabled:false}));service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{}});assert.equal(service.config.modelId,'custom-local-model');await service.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('background and visible browser handoff retains cookies and isolates another persona',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./cookie-handoff-',import.meta.url))),exe=join(dir,'browser.exe');writeFileSync(exe,'fixture');const contexts=[];let visible=false;
 const chromium={launchPersistentContext:async()=>{
  const item={cookies:[],closed:false},page={url:()=> 'https://example.com',isClosed:()=>item.closed,on:()=>{},waitForTimeout:async()=>{},evaluate:async(_f,a)=>a?.nonce?{text:'page',players:[],elements:[]}:({})};
  item.api={pages:()=>[page],on:()=>{},storageState:async()=>({cookies:item.cookies}),addCookies:async cookies=>{item.cookies=structuredClone(cookies);},close:async()=>{item.closed=true;}};contexts.push(item);return item.api;
 }};
 const controller=createBrowserController({getDataDir:()=>dir,getCacheDir:()=>dir,getExecutablePath:()=>exe,getHeadless:()=>!visible,chromium});const c={accountId:'account',personaId:'persona',scope:'same'};
 try{
  await controller.act({action:'snapshot'},c);contexts[0].cookies=[{name:'local-login',value:'fictional-cookie',domain:'example.com',path:'/'}];
  visible=true;await controller.act({action:'snapshot'},c);assert.equal(contexts[0].closed,true);assert.equal(contexts[1].cookies[0].value,'fictional-cookie');
  visible=false;await controller.act({action:'snapshot'},c);assert.equal(contexts[1].closed,true);assert.equal(contexts[2].cookies[0].value,'fictional-cookie');
  await controller.act({action:'snapshot'},{...c,personaId:'another-persona'});assert.deepEqual(contexts[3].cookies,[]);
 }finally{await controller.close();rmSync(dir,{recursive:true,force:true});}
});

test('a redirected video keeps its paused state when observing the same short link again',async()=>{
 const short='https://short.example/1',landed='https://video.example/watch/1';let plays=0;
 const browser={peekVideo:async()=>({url:landed,currentTime:20,duration:60,paused:true}),status:()=>({executablePath:'my.exe'}),act:async args=>{if(args.action==='play')plays++;return{url:landed,file:'test.png'};}};
 const result=await readBrowserVideo({browser,args:{url:short},scope:'scope',previous:{mode:'browser',scope:'scope',url:short,finalUrl:landed,at:20},readFile:()=>Buffer.from('89504e470d0a1a0a','hex'),sleep:async()=>{}});
 assert.equal(plays,0);assert.equal(result.status,'paused');assert.equal(result.finalUrl,landed);assert.equal(result.frames.length,1);
});
