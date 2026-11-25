import {renderServiceSources,capabilityPages} from '../ui/execution-overview.js';
import {deviceCapabilities} from '../settings-contract.js';
import {readConsoleSource} from './console-source.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {apiOnlySettings} from '../mobile-api-policy.js';import {applyNonpaymentPolicy} from '../nonpayment-policy.js';
const html=readConsoleSource(),source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
function ui(edition,unifiedApiMode){const s={renderServiceSources,capabilityPages,connectionState:null,localAudioState:null,capabilityLabels:{chat:"聊天",image:"图片",speech:"语音",video:"视频",sing:"唱歌"},esc:String,deviceCapabilities,data:{status:{edition},settings:{unifiedApiMode}}};vm.createContext(s);vm.runInContext(html.slice(html.indexOf('  function runtimeDevice('),html.indexOf('  function deviceUiPreview('))+html.slice(html.indexOf('  function sourcesWithSinging('),html.indexOf('  function capabilityPageMarkup('))+html.slice(html.indexOf('  function viewServiceConnections('),html.indexOf('  function captureConnection('))+';this.read={mobileApiOnly,viewServiceConnections};',s);return s;}
test('desktop exposes independent sources with no whole-mode controls regardless of a saved legacy flag',()=>{
 for(const flag of [true,false,undefined]){const c=ui('desktop',flag);assert.equal(c.read.mobileApiOnly(),false);const all=c.read.viewServiceConnections();for(const id of ['connectionRouteChat','connectionRouteImage','connectionRouteSpeech','connectionRouteVideo','connectionRoutesSave'])assert(all.includes(id));for(const id of ['connectionWholeMode','connectionModeSave','connectionRoutingEnabled'])assert(!all.includes(id));assert(all.includes('本地 ComfyUI'));}
});
test('phone remains API only after the legacy overall-mode UI is removed',()=>{
 for(const flag of [true,false,undefined]){const c=ui('mobile',flag);assert(c.read.mobileApiOnly());assert(!c.read.viewServiceConnections().includes('<option value="comfyui">'));assert(!c.read.viewServiceConnections().includes('connectionWholeMode'));}
});
test('changing browser width or a saved flag cannot change actual runtime device capabilities',()=>{
 const c=ui('desktop',true);c.innerWidth=390;assert(!c.read.mobileApiOnly());c.data.status.edition='mobile';c.innerWidth=1440;assert(c.read.mobileApiOnly());
});
test('actual saveSettings cancels old tasks once on real local/API changes despite unified flag',()=>{
 const old=new AbortController(),events=[],chat={sessionId:'session',key:'private:test',pendingTurns:[{}],turns:new Map()};const s={settings:{unifiedApiMode:true,localChat:{enabled:false,apiComplement:false,apiTaskAssist:false}},serviceRoutingEpoch:0,isDesktop:true,apiOnlySettings,applyNonpaymentPolicy,featureState:{generation:1},apiModeController:old,AbortController,Promise,chats:new Map([['session',chat]]),state:{chats:{'private:test':'session'}},ctx:{sessionController:{cancel:()=>events.push('session')}},cancelFeatureWork:()=>events.push('tasks'),saveState:()=>{},mkdirSync:()=>{},dirname:()=>'',settingsFile:'test-only',writeFileSync:()=>{},renameSync:()=>{},profilesReloading:true,monitorReady:false,log:()=>{}};
 vm.createContext(s);const start=source.indexOf('  const backendMode='),end=source.indexOf('  const apiModelScope=',start);assert(start>0&&end>start);vm.runInContext(source.slice(start,end)+source.slice(source.indexOf('  function saveSettings('),source.indexOf('  function setPrivateWhitelist('))+';this.save=saveSettings;',s);
 s.settings.localChat.enabled=true;s.save();assert(old.signal.aborted);assert.equal(s.featureState.generation,2);assert.equal(chat.backendRetired,true);assert.equal(chat.pendingTurns.length,0);assert.equal(events.filter(x=>x==='tasks').length,1);s.save();assert.equal(events.filter(x=>x==='tasks').length,1);
 s.settings.localChat.apiComplement=true;s.save();assert.equal(s.featureState.generation,2);s.settings.localChat.apiTaskAssist=true;s.save();assert.equal(s.featureState.generation,2);s.serviceRoutingEpoch++;s.save();assert.equal(s.featureState.generation,3);
});
