import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createDeviceSync} from '../device-sync.js';
import {apiOnlyServices} from '../mobile-api-policy.js';

function fixture(t,device,settings,connections={profiles:[],routes:{enabled:false}}){
 const root=fs.mkdtempSync(path.join(process.env.QQ_BRIDGE_TEST_DIR||os.tmpdir(),'qq-mobile-sync-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const roots={cache:path.join(root,'cache'),memory:path.join(root,'memory')};
 for(const dir of Object.values(roots))fs.mkdirSync(dir,{recursive:true});
 const sourceDir=path.join(root,'source');fs.mkdirSync(sourceDir);fs.writeFileSync(path.join(sourceDir,'package.json'),JSON.stringify({name:'example',version:'1.53.0'}));
 fs.writeFileSync(path.join(root,'settings.json'),JSON.stringify(settings));fs.writeFileSync(path.join(root,'service-connections.json'),JSON.stringify(connections));fs.writeFileSync(path.join(root,'website-mcp.json'),'{}');
 const sync=createDeviceSync({device,dataDir:root,sourceDir,roots:()=>roots,flush:async()=>{},credential:async()=>'',status:()=>({version:'1.53.0',paused:true}),pause:async()=>{},resume:async()=>{},reload:async()=>{}});
 t.after(()=>sync.close());return {sync,root};
}
test('new sync shares API profiles, diary/memory settings but preserves each device runtime choices',async t=>{
 const desktopSettings={localChat:{enabled:true,modelId:'desktop-model'},comfyui:{enabled:true},agency:{desktop:true,workspace:'desktop'},voice:{engine:'localai',enabled:true},memory:{enabled:true},life:{enabled:true},personae:[{id:'same-character'}]};
 const phoneSettings={localChat:{enabled:false},voice:{engine:'breeze',enabled:true},agency:{desktop:false,workspace:'internal'}};
 const desktop=fixture(t,'desktop',desktopSettings,{profiles:[{id:'api',type:'openai',apiKey:'synthetic',chatModel:'any'}],routes:{enabled:true,chat:'local',image:'local',speech:'local'}});
 const phone=fixture(t,'phone',phoneSettings,{profiles:[],routes:{enabled:true,chat:'host',image:'legacy',speech:'legacy'}});
 await desktop.sync.local.manifest({runtimeIsolation:true});await phone.sync.local.manifest({runtimeIsolation:true});
 const transfer=desktop.sync.canonical('data/settings.json',Buffer.from(JSON.stringify(desktopSettings)));
 const received=JSON.parse(phone.sync.canonical('data/settings.json',transfer,false));
 assert.equal(received.localChat.enabled,false);assert.equal(received.comfyui.enabled,false);assert.equal(received.voice.engine,'breeze');assert.equal(received.agency.desktop,false);assert.deepEqual(received.memory,desktopSettings.memory);assert.deepEqual(received.life,desktopSettings.life);assert.deepEqual(received.personae,desktopSettings.personae);
 const returned=JSON.parse(desktop.sync.canonical('data/settings.json',phone.sync.canonical('data/settings.json',Buffer.from(JSON.stringify(received))),false));assert.equal(returned.localChat.enabled,true);assert.equal(returned.localChat.modelId,'desktop-model');assert.equal(returned.voice.engine,'localai');assert.equal(returned.agency.workspace,'desktop');
 const manifest=await desktop.sync.local.manifest({runtimeIsolation:true});assert.ok(manifest.files['data/service-connections.json']);assert.ok(manifest.files['data/website-mcp.json']);
 const bytes=desktop.sync.canonical('data/service-connections.json',fs.readFileSync(path.join(desktop.root,'service-connections.json')));const profiles=JSON.parse(phone.sync.canonical('data/service-connections.json',bytes,false));assert.equal(profiles.profiles[0].chatModel,'any');assert.equal(profiles.routes.chat,'host');assert.equal(profiles.legacyLocalEnabled,false);
});
test('legacy sync peers receive compatible settings, never unresolved new runtime markers',async t=>{
 const {sync}=fixture(t,'phone',{localChat:{enabled:false},voice:{engine:'breeze',enabled:true},agency:{workspace:'internal'}});
 await sync.local.manifest({flush:false});
 const bytes=sync.canonical('data/settings.json',Buffer.from(JSON.stringify({localChat:{enabled:false},agency:{workspace:'internal'},voice:{engine:'breeze'}}))).toString();
 assert.ok(!bytes.includes('@device/runtime/'));assert.ok(!bytes.includes('@device/agency/'));assert.ok(!bytes.includes('@device/voice/engine'));
});
test('mobile tool discovery excludes local generation and Windows workspace services',()=>{
 const common={search:()=>{},bilibili:()=>{},read:()=>{},comfyui:()=>{},workspace:()=>{},recharge:()=>{}};const mobile=apiOnlyServices(common);assert.deepEqual(Object.keys(mobile),['search','bilibili','read']);assert.strictEqual(apiOnlyServices(common,false),common);
});
test('device shells have independent navigation and phone-only capabilities stay off the phone menu',()=>{
 const sandbox={};vm.runInNewContext(fs.readFileSync(new URL('../ui/device-ui.js',import.meta.url),'utf8'),sandbox);const ui=sandbox.QQBridgeDeviceUI;
 const desktop=[{id:'system',pages:['local','services','devices']}];assert.equal(ui.groups('phone',desktop).length,5);assert.equal(ui.groups('desktop',desktop)[0].pages[0],'local');assert.equal(ui.supports('phone','local'),false);assert.equal(ui.supports('phone','photo'),false);for(const page of ['memory','daily','diary','services','bilibili','websitemcp','invocations'])assert.equal(ui.supports('phone',page),true);
 assert.equal(ui.previewWriteAllowed('/im-bridge/settings',{localChat:{enabled:true}}),false);assert.equal(ui.previewWriteAllowed('/im-bridge/device-profiles',{action:'select',device:'phone'}),true);assert.equal(ui.previewWriteAllowed('/im-bridge/features/companion',{action:'snapshot'}),true);
});
