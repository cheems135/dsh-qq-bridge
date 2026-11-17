import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
import {createPromptPreferenceStore,defaultPromptPreferences,normalizePromptPreferences,promptPreferenceRule} from '../prompt-preferences.js';
import {createImageStudio} from '../image-studio.js';import {prepareLocalImagePrompt} from '../local-image-prompt.js';import {buildVideoPrompt} from '../video-prompt.js';
import {createLocalModelServer} from '../local-model-server.mjs';import {listenLocalServer} from './local-server-listen.js';
const temporaryRoot=fileURLToPath(new URL('../.prompt-preferences-tests/',import.meta.url));mkdirSync(temporaryRoot,{recursive:true});const tmpdir=()=>temporaryRoot;
test('retrying identical saved text is idempotent and does not add redundant history',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'retry-')),'prefs.json'),store=createPromptPreferenceStore(file),values=defaultPromptPreferences();values.chat.customText='同一份内容';
 store.save(values,0);const saved=readFileSync(file,'utf8');const result=store.save(values,1);assert.equal(result.revision,1);assert.equal(result.history.length,1);assert.equal(readFileSync(file,'utf8'),saved);
});
test('preview is read-only; persisted preferences survive reload and support history and optimistic concurrency',()=>{
 const dir=mkdtempSync(join(tmpdir(),'prompt-prefs-')),file=join(dir,'prefs.json'),store=createPromptPreferenceStore(file),values=defaultPromptPreferences();
 values.chat.tone='casual';assert.match(store.preview(values).rules.chat.zh,/自然口语/);assert.equal(existsSync(file),false);
 store.save(values,0);assert.equal(createPromptPreferenceStore(file).snapshot().values.chat.tone,'casual');
 assert.throws(()=>store.save(values,0),/其他窗口/);store.reset(1);assert.equal(store.snapshot().values.chat.tone,'persona');store.restore(1,2);assert.equal(store.snapshot().values.chat.tone,'casual');
});
test('defaults add no instructions, unknown free-form overrides are rejected, and corrupt storage cannot break startup',()=>{
 for(const kind of ['chat','image','video'])assert.equal(promptPreferenceRule(kind,undefined),'');
 assert.throws(()=>normalizePromptPreferences({image:{rawSystem:'replace'}}),/不支持/);assert.throws(()=>normalizePromptPreferences({image:{detail:'unknown'}}),/不支持/);
 const file=join(mkdtempSync(join(tmpdir(),'prompt-invalid-')),'prefs.json');writeFileSync(file,'broken');const store=createPromptPreferenceStore(file);assert.match(store.snapshot().warning,/默认/);assert.equal(readFileSync(file,'utf8'),'broken');
});
test('API and local image preparation receive the same selected preferences; video preserves its base scene',async()=>{
 const values=defaultPromptPreferences();values.image.detail='detailed';values.video.camera='steady';values.image.customText='背景保留窗外的庭院。';values.video.customText='先拉近书桌，再缓慢平移。';
 const plan={humanRequest:'画窗边的书桌',prompt:'窗边的书桌与书架',styleTags:['anime'],promptLanguage:'zh',promptPreferences:values};
 const prompt='窗边的木桌上摆着一本翻开的书和一杯温水，旁边是明亮的台灯与整齐的书架。窗帘与墙面的浅色纹理构成完整背景，光线符合实际时间，画面具有清晰的空间关系，整体安静自然，不包含人物。';
 const answer=JSON.stringify({prompt,style:'二维二次元插画。'});let apiSystem='',localSystem='';
 await createImageStudio({getConfig:()=>({promptLanguage:'zh',promptPreferences:values}),visualPlan:()=>plan,ask:async s=>{apiSystem=s;return answer;}}).prepare(plan.humanRequest);
 await prepareLocalImagePrompt({args:{prompt:plan.humanRequest},plan,workflow:{kind:'image',inputs:{prompt:{node:'1',field:'text'}},file:'missing'},reference:null,root:process.cwd(),model:async options=>{localSystem=options.messages[0].content;return answer;}});
 for(const system of [apiSystem,localSystem]){assert.match(system,/增加有用的空间细节/);assert.match(system,/背景保留窗外的庭院/);}
 assert.match(buildVideoPrompt('完整基础场景',{promptPreferences:values}),/先拉近书桌，再缓慢平移/);
 assert.match(buildVideoPrompt('完整基础场景',{promptPreferences:values}),/^完整基础场景\n【呈现偏好】.*稳定镜头/);
 assert.match(buildVideoPrompt('Base scene',{promptPreferences:values,language:'en'}),/Prefer a steady shot/);
});

test('Chinese custom instructions persist, preview, restore and reject invalid input without changing storage',()=>{
 const file=join(mkdtempSync(join(tmpdir(),'custom-text-')),'prefs.json'),store=createPromptPreferenceStore(file),values=defaultPromptPreferences();
 values.chat.customText='先回应我的感受，再自然接话。\n不要连续问问题。';
 assert.match(store.preview(values).rules.chat.zh,/不要连续问问题/);assert.equal(existsSync(file),false);
 store.save(values,0);assert.equal(createPromptPreferenceStore(file).snapshot().values.chat.customText,values.chat.customText);
 store.reset(1);store.restore(1,2);assert.equal(store.snapshot().values.chat.customText,values.chat.customText);
 const saved=readFileSync(file,'utf8');
 for(const customText of [null,{},'字'.repeat(4001),'错误\u0000文字'])assert.throws(()=>store.save({chat:{customText}},3),/4000/);
 assert.equal(readFileSync(file,'utf8'),saved);assert.equal(promptPreferenceRule('chat',{chat:{customText:'  \n '}}),'');
});

test('local video dispatch includes the saved presentation choice without real rendering',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'local-video-')),file=join(dir,'config.json'),values=defaultPromptPreferences();values.video.camera='steady';
 writeFileSync(file,JSON.stringify({backend:'comfyui',chatWorkflow:'chat-4b',dialoguePriority:'speed',voiceEnabled:false,mediaDir:join(dir,'media'),workflowLibrary:[{id:'video-example',name:'视频',kind:'video',file:'unused.json',inputs:{prompt:{node:'1',field:'text'}},output:{node:'2',field:'videos'}}]}));
 let submitted,modelCalls=0;
 const service=createLocalModelServer({configFile:file,runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),run:async(_kind,args)=>{submitted=args;return {ok:true,media:[]};}},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),logger:()=>{},model:async()=>++modelCalls===1?{choices:[{message:{tool_calls:[{id:'v1',function:{name:'video',arguments:{prompt:'窗边的书桌，窗帘轻轻摆动',workflowId:'video-example'}}}]}}]}:{choices:[{message:{content:'处理完成。'}}]}});
 const base=await listenLocalServer(service);
 try{const response=await fetch(base+'/v1/local/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'生成窗边书桌的视频'}],turnContext:{promptPreferences:values}})});assert.equal(response.status,200,await response.text());assert.match(submitted.prompt,/稳定镜头/);assert.match(submitted.prompt,/窗边的书桌/);}finally{service.server.closeAllConnections();await service.close();}
});
