import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBrowserController,sameBrowserDestination} from '../browser-controller.js';

async function fixture(run){
 const dir=mkdtempSync(fileURLToPath(new URL('./browser-path-',import.meta.url))),one=join(dir,'one.exe'),two=join(dir,'two.exe');writeFileSync(one,'fixture');writeFileSync(two,'fixture');
 let current='about:blank',clock=1000;const launches=[],navigations=[],keys=[],closes=[];
 const page={url:()=>current,isClosed:()=>false,on:()=>{},goto:async url=>{navigations.push(url);current=url==='https://short.example/abc'?'https://example.com/video/abc?tracking=server':url;},waitForTimeout:async()=>{},keyboard:{press:async key=>keys.push(key)},evaluate:async(fn,arg)=>arg?.nonce?{url:current,title:'video',text:'actual page fixture',players:[{currentTime:15,paused:false}],elements:[],links:[]}:typeof fn==='string'?{}:true};
 const chromium={launchPersistentContext:async(dir,options)=>{launches.push({dir,options});const callbacks=[];return {pages:()=>[page],on:(name,fn)=>{if(name==='close')callbacks.push(fn);},storageState:async()=>({cookies:[]}),addCookies:async()=>{},close:async()=>{closes.push(1);callbacks.forEach(fn=>fn());}};}};
 let selected=one;const controller=createBrowserController({getDataDir:()=>dir,getCacheDir:()=>dir,getExecutablePath:()=>selected,chromium,now:()=>clock});
 try{await run({one,two,dir,controller,launches,navigations,keys,closes,select:path=>selected=path,setTime:t=>clock=t,context:{scope:'fixture'}});}finally{await controller.close();rmSync(dir,{recursive:true,force:true});}
}

test('configured browser is used exclusively and a broken executable never falls back to a different browser',async()=>fixture(async f=>{
 await f.controller.act({action:'navigate',url:'https://example.com'},f.context);assert.equal(f.launches.length,1);assert.equal(f.launches[0].options.executablePath,f.one);assert.equal(f.controller.status().fixedExecutable,true);
 f.select(join(f.dir,'missing.exe'));await assert.rejects(f.controller.act({action:'snapshot'},f.context),/指定的浏览器程序不存在/);assert.equal(f.launches.length,1);assert.equal(f.controller.status().available,false);
}));

test('changing browser executable reopens only this managed session while keeping its persistent profile',async()=>fixture(async f=>{
 await f.controller.act({action:'snapshot'},f.context);f.select(f.two);await f.controller.act({action:'snapshot'},f.context);
 assert.equal(f.launches.length,2);assert.equal(f.closes.length,1);assert.equal(f.launches[1].options.executablePath,f.two);assert.equal(f.launches[0].dir,f.launches[1].dir);
}));

test('repeated redirected video navigation observes the existing page and does not reload playback',async()=>fixture(async f=>{
 await f.controller.act({action:'navigate',url:'https://short.example/abc'},f.context);await f.controller.act({action:'navigate',url:'https://short.example/abc'},f.context);await f.controller.act({action:'snapshot'},f.context);assert.equal(f.navigations.length,1);
 await f.controller.act({action:'navigate',url:'https://example.com/other'},f.context);await f.controller.act({action:'navigate',url:'https://short.example/abc'},f.context);assert.equal(f.navigations.length,3);
}));

test('Bilibili tracking parameters do not reload the same video, while a new video, part or explicit time still navigates',()=>{
 assert.equal(sameBrowserDestination('https://www.bilibili.com/video/BVabc/?vd_source=a','https://www.bilibili.com/video/BVabc?spm_id_from=b'),true);
 for(const url of ['https://www.bilibili.com/video/BVdef','https://www.bilibili.com/video/BVabc?p=2','https://www.bilibili.com/video/BVabc?t=90'])assert.equal(sameBrowserDestination('https://www.bilibili.com/video/BVabc',url),false);
 assert.equal(sameBrowserDestination('https://example.com/watch?id=1','https://example.com/watch?id=2'),false);
});

test('automatic refresh shortcuts preserve recent video playback, explicit user refresh and later recovery remain available',async()=>fixture(async f=>{
 await f.controller.act({action:'navigate',url:'https://example.com/watch'},f.context);
 for(const key of ['F5','Control+r','Control+Shift+r','Shift+F5'])assert.equal((await f.controller.act({action:'press',key},f.context)).skipped,true);
 assert.equal(f.keys.length,0);
 await f.controller.act({action:'press',key:'F5'},{...f.context,meta:{kind:'user',userWords:'帮我刷新这个网页'}});assert.deepEqual(f.keys,['F5']);
 f.setTime(62000);await f.controller.act({action:'press',key:'Control+r'},f.context);assert.equal(f.keys.length,2);
}));
