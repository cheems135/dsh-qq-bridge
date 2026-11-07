import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {agencyConfig} from '../agent-capabilities.js';
import {browserWorkspaceMode,workspaceMode} from '../agent-workspace.js';
import {createWorkspaceLeases} from '../workspace-lease.js';
import {createBrowserController} from '../browser-controller.js';

test('background preference defaults on even with an old desktop default, but visible requests remain available',()=>{
 const config=agencyConfig({workspace:'desktop'});assert.equal(config.preferBackground,true);
 assert.equal(browserWorkspaceMode(config,{meta:{kind:'proactive'}}),'internal');
 assert.equal(browserWorkspaceMode(config,{meta:{kind:'user',userWords:'帮我看看这个视频'}}),'internal');
 assert.equal(browserWorkspaceMode(config,{meta:{kind:'user',userWords:'在桌面浏览器打开这个视频'}}),'desktop');
 assert.equal(browserWorkspaceMode(config,{meta:{kind:'user',userWords:'不要弹出桌面窗口，在后台看'}}),'internal');
 assert.equal(workspaceMode(config,{}),'desktop');
 assert.equal(browserWorkspaceMode({...config,preferBackground:false},{}),'desktop');
});

test('a computer-only lease does not expose the browser, an explicit visible handoff does, and returning to background revokes it',()=>{
 const leases=createWorkspaceLeases(),context={accountId:'a',personaId:'p',key:'private:1',generation:1,chat:{isOwner:true,kind:'private'},meta:{kind:'user',userWords:'打开记事本'}};
 context.workspaceLease=leases.grant(context,{approved:true});assert.equal(browserWorkspaceMode({},context),'internal'); // Notepad may need a desktop, unrelated browsing does not.
 context.meta={kind:'user',userWords:'看一下这个视频'};assert.equal(browserWorkspaceMode({},context),'internal');
 context.workspaceLease=leases.grant(context,{approved:true,browserVisible:true});assert.equal(browserWorkspaceMode({},context),'desktop');
 context.meta={kind:'user',userWords:'用后台继续看'};context.workspaceLease=leases.resolve(context);assert.equal(context.workspaceLease,null);assert.equal(browserWorkspaceMode({},context),'internal');
});

test('the configured browser is launched headless for ordinary tools and visibly only for an explicit desktop request',async()=>{
 const dir=mkdtempSync(fileURLToPath(new URL('./background-browser-',import.meta.url))),exe=join(dir,'my-browser.exe');writeFileSync(exe,'fixture');
 const launches=[];let url='about:blank';
 const page={url:()=>url,isClosed:()=>false,on:()=>{},goto:async u=>{url=u;},waitForTimeout:async()=>{},evaluate:async(_fn,arg)=>arg?.nonce?{url,title:'fixture',text:'fixture',players:[],elements:[],links:[]}:({})};
 const chromium={launchPersistentContext:async(_profile,options)=>{launches.push(options);return {pages:()=>[page],on:()=>{},storageState:async()=>({cookies:[]}),close:async()=>{}};}};
 const controller=createBrowserController({getDataDir:()=>dir,getCacheDir:()=>dir,getExecutablePath:()=>exe,getHeadless:c=>browserWorkspaceMode({workspace:'desktop'},c)!=='desktop',chromium});
 const context={accountId:'a',personaId:'p',meta:{kind:'user',userWords:'搜索一下视频'}};
 try{
  await controller.act({action:'navigate',url:'https://example.com'},context);assert.equal(launches[0].headless,true);assert.equal(launches[0].executablePath,exe);
  await controller.act({action:'snapshot'},context);assert.equal(launches.length,1);
  await controller.act({action:'snapshot'},{...context,meta:{kind:'user',userWords:'在桌面浏览器显示这个网页'}});assert.equal(launches[1].headless,false);assert.equal(launches[1].executablePath,exe);
 }finally{await controller.close();rmSync(dir,{recursive:true,force:true});}
});
