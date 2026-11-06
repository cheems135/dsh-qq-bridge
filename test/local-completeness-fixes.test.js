import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {AsyncLocalStorage} from 'node:async_hooks';
import {localGroupAttentionInput} from '../local-group-attention.js';
import {chooseLocalRoute} from '../local-routing.js';
import {estimateTokens} from '../local-context.js';
import {sharedPersonaOutfit,alignOutfitReply} from '../local-persona-state.js';
import {parseGroupDecision,GROUP_ATTENTION_PROMPT} from '../group-conversation.js';

test('large group decisions fit measured local capacity, prioritize direct messages and keep recent context',()=>{
 for(const contextWindow of [1024,2048,4096,8192]){
  const snapshot={contextWindow,maxOutputTokens:512,features:{text:{supported:true},json:{supported:true}}};
  const rows=Array.from({length:32},(_,i)=>({id:String(i+1),speaker:'测试群友'+i,text:'普通群聊背景内容'.repeat(100),direct:i===2}));rows[2].text='你衣服是什么颜色？';
  const input=localGroupAttentionInput({snapshot,identity:'角色风格描述。'.repeat(300),leaving:'讨论结束时离开',rows,background:'很早的消息\n'.repeat(200)+'最新背景',recent:'我最近说过白色衣服。'});
  assert.equal(chooseLocalRoute(snapshot,{text:true,json:true,inputTokens:input.inputTokens,outputTokens:input.maxTokens}).target,'local');
  assert.match(input.user,/\[3\].*（@你）/);assert.match(input.user,/你衣服/);assert.equal(input.inputTokens,estimateTokens(input.system)+estimateTokens(input.user));
  if(contextWindow>=4096){assert.match(input.user,/最新背景/);assert.match(input.user,/白色衣服/);}
 }
});

test('actual group attention handler bounds only local decision input; API material is preserved',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),section=source.slice(source.indexOf('  async function evaluateGroupAttention(key)'),source.indexOf('\n  function sleepingPayload('));
 for(const local of [true,false]){
  const batch=Array.from({length:32},(_,i)=>({message_id:i+1,user_id:'member'+i,sender:{nickname:'成员'+i},message:[{type:'text',data:{text:'很长的群聊内容。'.repeat(100)}}]}));const directMessage=batch[2].message;let asked,merged;
  const sandbox={groupAttention:new Map([['group:12345',{batch,evaluating:false}]]),stopped:false,accountPaused:false,chats:new Map(),state:{chats:{}},featureState:{generation:0,inbox:[],outbox:[]},inboxRunning:new Set(),settings:{localChat:{enabled:local},presetPrompts:{}},activePersona:()=>({name:'测试角色',prompt:'角色人设。'.repeat(500)}),naturalPersonaText:x=>x,readPresetPrompt:()=>'',mentionsSelf:parts=>parts===directMessage,segmentsOf:x=>x,extractIncoming:parts=>({text:parts[0].data.text}),parseGroupDecision,groupWindowFor:()=>null,calendarMeta:()=>({}),pauseLocalGroupWindow:()=>()=>{},recentDialogueReplies:()=>['最近白色衣服'],groupTranscriptLines:()=> '群聊背景。'.repeat(400),serviceMediaScope:new AsyncLocalStorage(),getLocalCapabilities:async()=>({contextWindow:4096,maxOutputTokens:512}),localTurnScope:()=>({}),localScopeCurrent:()=>true,localGroupAttentionInput,GROUP_ATTENTION_PROMPT,effectiveModel:()=>null,log:()=>{},incomingAllowed:()=>true,mergeGroupWindow:(b,p)=>{merged={b,p};return {};},handlePayload:()=>{},scheduleGroupAttention:()=>{},Date,setTimeout,askModel:async(system,input,maxTokens)=>{asked={system,input,maxTokens};return '{"respond":true,"focusIds":["3"]}';}};
  vm.createContext(sandbox);vm.runInContext(section+'\nthis.run=evaluateGroupAttention;',sandbox);await sandbox.run('group:12345');assert.ok(asked);assert.equal(merged.p.focusIds[0],'3');assert.equal(merged.b.length,32);
  const size=estimateTokens(asked.system)+estimateTokens(asked.input);if(local)assert.ok(size<3328);else assert.ok(size>7000);
 }
});

test('clothing corrections preserve other objects, other people and differently colored garments',()=>{
 const state={outfit:'白色衣服'};
 for(const [input,expected]of [
  ['我穿粉色衣服，旁边是蓝色窗帘。','我穿白色衣服，旁边是蓝色窗帘。'],
  ['我穿粉色衣服和蓝色窗帘同框。','我穿白色衣服和蓝色窗帘同框。'],
  ['蓝色窗帘旁边，我的衣服是粉色的。','蓝色窗帘旁边，我的衣服是白色的。'],
  ['我的衣服是粉色的，头发是蓝黑色。','我的衣服是白色的，头发是蓝黑色。'],
  ['粉色呀，旁边窗帘是蓝色。','白色呀，旁边窗帘是蓝色。'],
  ['她的衣服是粉色的，我的衣服是蓝色的。','她的衣服是粉色的，我的衣服是白色的。'],
 ])assert.equal(alignOutfitReply(input,'你衣服什么颜色？',state),expected);
 assert.equal(alignOutfitReply('白色衬衫配蓝色裤子。','你衣服什么颜色？',{outfit:'白色衬衫配蓝色裤子'}),'白色衬衫配蓝色裤子。');
 assert.equal(alignOutfitReply('我的衬衫是粉色的，裤子是黑色的。','你衣服什么颜色？',{outfit:'白色衬衫，蓝色裤子'}),'我的衬衫是白色的，裤子是蓝色的。');
});

test('schedule transitions update shared clothing without random replies or clocks changing it',()=>{
 const day='2026-11-05',morning={date:day,phase:'morning',start:'09:00',outfit:'白色衬衫'};
 let state=sharedPersonaOutfit({day,scene:morning});assert.equal(state.outfit,'白色衬衫');
 state=sharedPersonaOutfit({day,stored:state,scene:{...morning,now:'10:00'},owner:true,request:'换成粉色上衣'});assert.equal(state.outfit,'粉色上衣');
 state=sharedPersonaOutfit({day,stored:state,scene:{...morning,now:'10:30'},history:[{dir:'out',text:'蓝色的衣服。',request:'衣服什么颜色？'}]});assert.equal(state.outfit,'粉色上衣');
 const afternoon={...morning,phase:'afternoon',start:'14:00',outfit:'蓝色外套'};
 state=sharedPersonaOutfit({day,stored:state,scene:afternoon});assert.equal(state.outfit,'蓝色外套');assert.equal(state.source,'schedule');
 state=sharedPersonaOutfit({day,stored:state,scene:{...afternoon,outfit:'黑色卫衣'}});assert.equal(state.outfit,'黑色卫衣');
 assert.equal(sharedPersonaOutfit({day,stored:state,scene:{outfit:'沿用当前角色形象'}}).outfit,'黑色卫衣');
 assert.equal(sharedPersonaOutfit({day,stored:{day,outfit:'白色衬衫',source:'schedule'},scene:afternoon}).outfit,'蓝色外套');
});
