import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {readBrowserVideo} from '../browser-video.js';
import {createBilibiliService} from '../bilibili-service.js';

function fixture({ready=true,fail=false}={}){
 const actions=[];let url='',at=0,paused=true,reloads=0;
 const browser={status:()=>({executablePath:'D:/my-browser/browser.exe'}),peekVideo:async()=>url&&ready?{url,currentTime:at,duration:60,paused}:null,
  act:async a=>{actions.push(a);if(fail)throw Error('指定浏览器无法启动');
   if(a.action==='navigate'){if(url!==a.url){reloads++;url=a.url;at=0;}}
   if(a.action==='play')paused=false;if(a.action==='pause')paused=true;if(a.action==='seek')at=a.at;
   return {ok:true,url,file:'actual-screenshot.png'};
  }};
 const options={browser,scope:'private-scope',context:{},readFile:()=>Buffer.from('89504e470d0a1a0a','hex'),sleep:async()=>{if(!paused)at+=0.5;}};
 return {actions,options,browser,reloads:()=>reloads};
}

test('watching without a prior browser player opens the configured browser and returns real browser frames',async()=>{
 const f=fixture(),result=await readBrowserVideo({...f.options,args:{url:'https://example.com/watch/123'}});
 assert.equal(f.actions[0].action,'navigate');assert.ok(f.actions.some(a=>a.action==='play'));assert.equal(result.frames.length,3);
 assert.equal(result.backend,'configured-browser');assert.equal(result.browserExecutable,'D:/my-browser/browser.exe');assert.equal(result.position.source,'configured-browser');assert.equal(result.audioDecoded,false);
});

test('next reuses playback without reload, respects pause, and supports an explicit browser seek',async()=>{
 const f=fixture(),url='https://example.com/watch/123';let result=await readBrowserVideo({...f.options,args:{url}});
 await f.browser.act({action:'pause'});f.actions.length=0;
 result=await readBrowserVideo({...f.options,args:{url},previous:{mode:'browser',scope:'private-scope',at:result.cursor}});
 assert.equal(result.status,'paused');assert.equal(f.actions.some(a=>a.action==='play'),false);assert.equal(f.reloads(),1);
 result=await readBrowserVideo({...f.options,args:{url,action:'start',at:30}});assert.equal(result.frames[0].at,30);assert.equal(f.reloads(),1);
});

test('browser launch failures and unavailable players are errors, never another viewing backend',async()=>{
 const broken=fixture({fail:true});await assert.rejects(readBrowserVideo({...broken.options,args:{url:'https://example.com/video'}}),/指定浏览器无法启动/);assert.equal(broken.actions.length,1);
 const empty=fixture({ready:false});await assert.rejects(readBrowserVideo({...empty.options,args:{url:'https://example.com/video'}}),/未取得可播放的视频/);assert.equal(empty.actions.some(a=>a.action==='screenshot'),false);
});

test('watching rejects stale sessions and screenshots from another page',async()=>{
 const f=fixture();let allowed=true;f.options.authorize=()=>allowed;f.options.sleep=async()=>{allowed=false;};
 await assert.rejects(readBrowserVideo({...f.options,args:{url:'https://example.com/video'}}),/会话或浏览器权限已改变/);
 const other=fixture();other.options.browser.act=async a=>a.action==='screenshot'?{url:'https://example.com/other',file:'x'}:{url:'https://example.com/video'};
 other.options.browser.peekVideo=async()=>({url:'https://example.com/video',currentTime:1,duration:50,paused:true});
 await assert.rejects(readBrowserVideo({...other.options,args:{url:'https://example.com/video'}}),/截图时浏览器已切换视频/);
});

test('Bilibili desktop frames open the selected part through the browser callback, without playurl or decoding',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./bili-browser-',import.meta.url)));let calls=0,decode=0;
 const service=createBilibiliService({directory:dir,authorize:()=>true,fetchImpl:async()=>{throw Error('No Bilibili resource API expected');},watchVideo:async(args)=>{calls++;assert.equal(args.url,'https://www.bilibili.com/video/BV1xx411c7mD?p=2');return {backend:'configured-browser',browserExecutable:'my.exe',status:'streaming',continuous:true,frames:[{at:1,part:{}}],coverage:'真实浏览器画面'};},readVideo:async()=>{decode++;throw Error('Do not decode');}});
 try{
  const result=await service.act({action:'frames',bvid:'BV1xx411c7mD',page:2},{accountId:'a',personaId:'p'});assert.equal(result.backend,'configured-browser');assert.equal(calls,1);assert.equal(decode,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Bilibili browser failure is not silently retried through the decoder',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./bili-browser-error-',import.meta.url)));let decode=0;
 const service=createBilibiliService({directory:dir,watchVideo:async()=>{throw Error('配置的浏览器不可用');},readVideo:async()=>{decode++;},fetchImpl:async()=>{throw Error('No resource API expected');}});
 try{await assert.rejects(service.act({action:'frames',bvid:'BV1xx411c7mD'},{accountId:'a',personaId:'p'}),/配置的浏览器不可用/);assert.equal(decode,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('host uses the shared desktop watcher and persists the actual browser result',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const start=source.indexOf('  async function watchDesktopVideo('),end=source.indexOf('\n  function lifeServices(){',start);
 const state={};let called=0,saved=0;
 const deps={settings:{media:{video:true}},videoScope:()=> 'scope',featureState:state,readBrowserVideo:async options=>{called++;assert.equal(options.args.url,'https://example.com/watch');assert.equal(options.authorize({key:'private'}),true);return{url:options.args.url,cursor:10,sessionId:'actual-browser',status:'streaming',browserExecutable:'chosen.exe'};},browserController:{},agencyAuthorized:()=>true,saveFeatures:()=>saved++,websiteReader:null,learningMeta:()=>({})};
 const host=Function(...Object.keys(deps),'return ('+source.slice(start,end).trim()+');')(...Object.values(deps));
 await host({url:'https://example.com/watch'},{key:'private'});assert.equal(called,1);assert.equal(saved,1);assert.equal(state.watchSessions.private.mode,'browser');assert.equal(state.watchSessions.private.browserExecutable,'chosen.exe');
 assert.match(source,/if\(isDesktop\)return watchDesktopVideo\(\{\.\.\.args,url\},context\)/);
});
