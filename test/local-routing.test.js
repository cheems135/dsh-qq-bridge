import {applyNonpaymentPolicy,nonpaymentOpen} from '../nonpayment-policy.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {localRequirements,chooseLocalRoute,localCompletionInput,createModelRouter} from '../local-routing.js';
import {estimateTokens} from '../local-context.js';
const ready=()=>({status:'ready',contextWindow:4096,maxOutputTokens:512,features:Object.fromEntries(['text','json','tools','vision','asr','speech','image','video'].map(key=>[key,{supported:true}]))});
test('local mode rejects unsupported capabilities and capacity without choosing an API',()=>{
 for(const field of ['text','json','tools','vision','asr','speech','image','video','native','special']){const c=ready();c.features[field]={supported:false,reason:'未接入'};assert.equal(chooseLocalRoute(c,{[field]:true}).target,'unavailable');}
 assert.equal(chooseLocalRoute(ready(),{text:true}).target,'local');
 assert.equal(chooseLocalRoute({...ready(),busy:true},{text:true}).target,'wait');
 assert.equal(chooseLocalRoute(null,{text:true}).target,'unavailable');
 assert.equal(chooseLocalRoute(ready(),{text:true,inputTokens:10000}).target,'unavailable');
 assert.equal(chooseLocalRoute(ready(),{text:true,outputTokens:1800}).target,'unavailable');
 assert.equal(chooseLocalRoute(ready(),{text:true,externalTools:true},{hostTools:false}).target,'unavailable');
});
test('requirements use actual task types rather than a fixed model allowlist',()=>{
 assert.equal(localRequirements('生成一张图片').image,true);assert.equal(localRequirements('制作一段视频').video,true);
 assert.equal(localRequirements('使用 powershell 执行命令').native,true);assert.equal(localRequirements('帮我搜一下B站').externalTools,true);
 assert.equal(localRequirements('你好',{images:true,voiceInput:true}).vision,true);assert.equal(localRequirements('你好',{voiceInput:true}).asr,true);
});
test('opaque host attachments never become silent text-only local inputs',()=>{
 assert.equal(localCompletionInput([{type:'image',attachment:'private-reference'}]).supported,false);
 assert.equal(localCompletionInput([{type:'image_url',image_url:{url:'https://example.com/image.png'}}]).supported,false);
 const value=localCompletionInput([{type:'text',text:'看看图片'},{type:'image',data:'eA==',mediaType:'image/png'}]);assert.equal(value.supported,true);assert.equal(value.images,true);assert.equal(value.content.length,2);
});
test('local failures, pending checks, busy service and unsupported vision never call API',async()=>{
 let cloud=0,local=0,snapshot=ready();const router=createModelRouter({getSnapshot:async()=>snapshot,local:async()=>{local++;throw Error('fetch failed');},api:async()=>{cloud++;return 'cloud';}});
 await assert.rejects(router.complete({requirements:{text:true}}),/fetch failed/);
 for(const value of [null,{...ready(),busy:true},{...ready(),features:{text:{supported:null}}}]){snapshot=value;await assert.rejects(router.complete({requirements:{text:true}}),/本轮没有调用 API/);}
 snapshot=ready();snapshot.features.vision.supported=false;await assert.rejects(router.complete({requirements:{vision:true}}));assert.equal(local,1);assert.equal(cloud,0);
 assert.equal(await router.complete({enabled:false}),'cloud');assert.equal(cloud,1);
});

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('  function apiChatRoute('),source.indexOf('\n  const PERSONA_SYSTEM'));
function host(){let cloud=0,local=0;const s={settings:{activeAccountId:'test',localChat:{enabled:true},model:{}},featureState:{generation:0},apiModeController:new AbortController(),apiModelScope:new AsyncLocalStorage(),cfg:{model:{provider:'example-api',model:'custom-any-model'}},AbortSignal,AbortController,JSON,Date,estimateTokens,localCompletionInput,chooseLocalRoute,createModelRouter,calendarModelStats:[],effectiveModel:()=>s.settings.model?.provider?s.settings.model:s.cfg.model,recordModelRoute:()=>{},getLocalCapabilities:async()=>ready(),ctx:{get:name=>name==='llm'?{async*stream(){cloud++;yield {type:'text-delta',text:'api result'};}}:undefined},requestLocalJson:async()=>{local++;return {ok:true,body:{choices:[{message:{content:'{"items":[]}'}}]}};}};vm.createContext(s);vm.runInContext(helpers+'\nthis.api=askApiModel;this.ask=askModel;',s);return {s,cloud:()=>cloud,local:()=>local};}
test('actual host helpers isolate local structured analysis from API model selection',async()=>{
 const h=host();assert.equal(await h.s.ask('system','input',200,null,1000,true),'{"items":[]}');assert.equal(h.local(),1);assert.equal(h.cloud(),0);
 await assert.rejects(h.s.api('system','input'),/本地模式/);assert.equal(h.cloud(),0);
 h.s.settings.localChat.enabled=false;h.s.getLocalCapabilities=()=>{throw Error('must not inspect local model in API mode');};assert.equal(await h.s.ask('system','input'),'api result');assert.equal(h.cloud(),1);assert.equal(h.local(),1);
});
test('actual host helper retains malformed local JSON and network errors locally',async()=>{
 const h=host();h.s.requestLocalJson=async()=>({ok:true,body:{choices:[{message:{content:'invalid JSON'}}]}});await assert.rejects(h.s.ask('s','u',100,null,1000,true));assert.equal(h.cloud(),0);
 h.s.requestLocalJson=async()=>{throw Error('fetch failed');};await assert.rejects(h.s.ask('s','u',100),/fetch failed/);assert.equal(h.cloud(),0);
});
test('switching account or mode during capability checking prevents old local dispatch',async()=>{
 for(const change of [h=>h.s.settings.activeAccountId='other',h=>h.s.settings.localChat.enabled=false]){const h=host();h.s.getLocalCapabilities=async()=>{change(h);return ready();};await assert.rejects(h.s.ask('s','u',100),e=>e.name==='AbortError');assert.equal(h.cloud(),0);assert.equal(h.local(),0);}
});
test('bridge cloud paths have an explicit local-mode boundary',()=>{
 assert.equal((source.match(/ctx\.get\('llm'\)/g)||[]).length,1,'all direct model callers must use the guarded accessor');
 for(const functionName of ['admit','nudge','runSelfTest','pruneStickersBySimilarity','generateWithSiliconFlowRaw','generateWithRunningHub','generateWithPollinations']){const section=source.slice(source.indexOf('  async function '+functionName+'('));assert.match(section.slice(0,500),/settings\.localChat\?\.enabled|apiInvocationAllowed|traceApiMedia/);}
});

test('held API access cannot start a request after switching to local mode',()=>{
 const h=host();h.s.settings.localChat.enabled=false;const llm=h.s.apiLlm();h.s.settings.localChat.enabled=true;assert.throws(()=>llm.stream({messages:[]}),/本地模式/);assert.equal(h.cloud(),0);
});
test('an API handle captured before a mode transition cannot use a newly created controller',()=>{
 const h=host();h.s.settings.localChat.enabled=false;const handle=h.s.apiLlm();h.s.apiModeController.abort();h.s.apiModeController=new AbortController();assert.throws(()=>handle.stream({messages:[]}),error=>error.name==='AbortError');assert.equal(h.cloud(),0);
});
test('API complement is opt-in and only unsupported tasks enter an explicitly scoped API call',async()=>{
 const h=host();h.s.settings.localChat.apiComplement=true;assert.equal(await h.s.ask('s','u',100),'{"items":[]}');assert.equal(h.cloud(),0);h.s.getLocalCapabilities=async()=>null;assert.equal(await h.s.ask('s','u',100),'api result');assert.equal(h.cloud(),1);
 await assert.rejects(h.s.api('s','direct'),/本地模式/);assert.equal(h.cloud(),1);
 h.s.settings.localChat.apiComplement=false;await assert.rejects(h.s.ask('s','u',100),/本轮没有调用 API/);assert.equal(h.cloud(),1);
});
test('complement never replays a local inference that already started',async()=>{
 let cloud=0,local=0;const router=createModelRouter({getSnapshot:async()=>ready(),local:async()=>{local++;throw Error('model disconnected after tool');},api:async()=>cloud++});await assert.rejects(router.complete({apiComplement:true,requirements:{text:true}}),/disconnected/);assert.equal(local,1);assert.equal(cloud,0);
});
test('mode changes abort old API calls and cancel old bridge jobs exactly once',()=>{
 const transitions=[],oldController=new AbortController();const s={settings:{localChat:{enabled:true}},backendMode:()=>JSON.stringify([s.settings.localChat.enabled===true,s.settings.localChat.apiComplement===true]),savedBackendMode:'[false,false]',state:{chats:{}},saveState:()=>{},featureState:{generation:0},apiModeController:oldController,AbortController,Promise,chats:new Map([['session',{sessionId:'session'}]]),cancelFeatureWork:reason=>transitions.push(reason),ctx:{sessionController:{cancel:()=>transitions.push('session-cancel')}},mkdirSync:()=>{},dirname:()=>'',settingsFile:'unused',writeFileSync:()=>{},renameSync:()=>{},profilesReloading:true,monitorReady:false,log:()=>{}};
 s.isDesktop=true;s.apiOnlySettings=value=>value;s.applyNonpaymentPolicy=applyNonpaymentPolicy;
 vm.createContext(s);vm.runInContext(source.slice(source.indexOf('  function saveSettings()'),source.indexOf('\n  function setPrivateWhitelist'))+'\nthis.save=saveSettings;',s);
 s.save();assert.equal(oldController.signal.aborted,true);assert.equal(s.apiModeController.signal.aborted,false);assert.equal(transitions.length,2);s.save();assert.equal(transitions.length,2);s.settings.localChat.enabled=false;s.save();assert.equal(transitions.length,4);
});

test('local capability failures preserve their reason and never enable an unselected API fallback',()=>{
 const snapshot={status:'unavailable',serviceReachable:true,reason:'本地能力测试接口 HTTP 503'};
 const result=chooseLocalRoute(snapshot,{text:true},{enabled:true,apiComplement:false});
 assert.equal(result.target,'unavailable');assert.equal(result.reason,snapshot.reason);
});
