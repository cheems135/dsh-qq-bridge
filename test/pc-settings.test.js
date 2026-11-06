import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {normalizeVoiceEngine} from '../voice-studio.js';
import {createMemoryHub,hubScope} from '../memory-hub.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function helper(name){
 const start=source.search(new RegExp('  (?:async )?function '+name+'\\('));
 assert.ok(start>=0,'actual plugin helper exists');
 const end=source.indexOf('\n  }',start);
 assert.ok(end>start,'actual plugin helper terminates');
 return source.slice(start,end+4);
}

test('retired voice engines cannot silently select a paid or other service',()=>{
 for(const value of ['edge','sweet','sapi','unknown',undefined])assert.equal(normalizeVoiceEngine(value),'none');
 for(const value of ['none','minimax','breeze','localai','custom'])assert.equal(normalizeVoiceEngine(value),value);
});

test('custom speech failure propagates without switching to another engine',async()=>{
 let calls=0;
 const context=vm.createContext({settings:{voice:{}},voiceDir:'unused',mkdirSync:()=>{},featureProfile:()=>({}),synthesizeCustomVoice:async()=>{calls++;throw Error('custom unavailable');}});
 vm.runInContext(helper('synthesizeLegacyVoice'),context);
 await assert.rejects(context.synthesizeLegacyVoice('text','private:12345',{engine:'custom'}),/custom unavailable/);
 await assert.rejects(context.synthesizeLegacyVoice('text','private:12345',{engine:'edge'}),/已移除/);
 assert.equal(calls,1);
});

test('clear-memory command resets its context and memory without deleting another contact store',()=>{
 const files=new Map(),meta=key=>({accountId:'a',key,personaId:'p',personaVersion:'v'});
 let now=1000;
 const hub=createMemoryHub({storage:{list:()=>[...files.keys()],read:f=>{if(!files.has(f))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(f));},write:(f,v)=>files.set(f,structuredClone(v))},allowed:()=>true,now:()=>now});
 try{
  for(const key of ['private:12345','private:67890'])hub.record(meta(key),{id:key,at:now,role:'user',text:'我喜欢种花',actual:true});
  const otherFile=hubScope(meta('private:67890'))+'.json',otherBefore=JSON.stringify(files.get(otherFile));
  const calls=[];now=2000;
  const context=vm.createContext({memoryHub:hub,recordsAllowed:()=>true,lifeMemory:{edit:(m,a)=>calls.push([m.key,a.action])},hubMeta:meta,calendarMeta:meta,personaGrowth:null,invalidateChat:key=>calls.push(['cancel',key]),memories:{'private:12345':{},'private:67890':{}},featureState:{floors:{}},state:{turns:{'private:12345':4,'private:67890':8}},saveState:()=>{},saveFeatures:()=>{},Date:{now:()=>now}});
  vm.runInContext(helper('clearChatMemory'),context);context.clearChatMemory('private:12345');
  assert.equal(JSON.stringify(files.get(otherFile)),otherBefore);
  assert.equal(hub.snapshot(meta('private:12345')).facts.length,0);
  assert.equal(context.state.turns['private:12345'],undefined);
  assert.equal(context.state.turns['private:67890'],8);
  assert.equal(context.featureState.floors['private:12345'],2000);
  assert.equal(calls[0][0],'cancel');
  assert.equal(calls[1][0],'private:12345');assert.equal(calls[1][1],'clear');
 }finally{hub.close();}
});
