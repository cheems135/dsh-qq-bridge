import {conversationHistory,conversationSeed} from '../api-conversation-context.js';
import {currentLifeChatTurns} from '../life-conversation-context.js';
import {CONTEXT_RULES,CORE_CONTEXT_RULES} from '../context-demand.js';
import {defaultPromptPreferences,promptPreferenceRule} from '../prompt-preferences.js';
import {DIALOGUE_ONLY_RULE,DRAFT_VOICE_RULE} from '../dialogue-only.js';
import {GROUP_REPLY_RULES} from '../group-conversation.js';
import {personaDecisionPrompt} from '../dialogue-persona.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {mobileRule,mobileToolDescription} from '../mobile-prompt.js';import {mobileSessionRules} from '../mobile-dialogue.js';import {BRIEF_RULES,briefExpression,stickerDigest,uniqueRules} from '../prompt-budget.js';import {recipientIdentity} from '../contact-policy.js';import {NATURAL_TASK_RULES} from '../tone-routing.js';import {SOCIAL_IMAGE_RULES} from '../social-assets.js';import {createAgentCapabilities} from '../agent-capabilities.js';
function builder(source,deps){const start=source.indexOf('  function buildSessionInstructions(');for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let factory;try{factory=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return factory(...Object.values(deps));}throw Error('builder unavailable');}
export function renderPrompt(source,{desktop=false,lifeOnly=false,rows,kind='private',personaText}={}){
  const persona={id:'角色',prompt:'【完整用户人设】保留每个字：自己规定的语气、关系和喜好。'};
  const key=kind+':12345678';
  const history=rows||[{chat:key,accountId:'a',personaId:persona.id,time:1700000000000,dir:'in',text:'前文提到的衣服是白色，后来亲口改成黑色'}];
  const deps={
    conversationHistory,conversationSeed,currentLifeChatTurns,
    state:{chats:{}},lifeExecution:null,calendarMeta:()=>({}),
    promptPreferences:{snapshot:()=>({values:defaultPromptPreferences()})},promptPreferenceRule,
    DIALOGUE_ONLY_RULE,CONTEXT_RULES,CORE_CONTEXT_RULES,GROUP_REPLY_RULES,
    mobileRule,mobileSessionRules,BRIEF_RULES,briefExpression,recipientIdentity,uniqueRules,
    stickerDigest,NATURAL_TASK_RULES,SOCIAL_IMAGE_RULES,personaPromptText:p=>p.prompt,
    settings:{
      activeAccountId:'a',owners:['12345678'],userNotes:{'12345678':'本人'},
      life:{enabled:true},memory:{enabled:true},realism:{},agency:{enabled:true},phone:{enabled:true},
      ownerPerms:{send:true,broadcast:true,schedule:true},stickerDisabled:[],stickers:{enabled:true},
      stickerGroup:{笑:'开心'},voice:{enabled:true},imagegen:{enabled:true}
    },
    companionSettings:()=>({}),isDesktop:desktop,companionReactionAvailable:()=>false,realismHint:()=>'',
    effectiveUsers:()=>['12345678'],listStickers:()=>['笑'],imageCapabilityHint:()=>'【图】使用已配置的实际图片接口。',
    messages:history,featureState:{floors:{}},memories:{},sessionDigests:new Map(),
    sessionInstructions:new Map(),personaPreamble:new Map(),log:()=>{}
  };
  if(personaText)deps.personaPromptText=personaText;
  builder(source,deps)({key,kind,isOwner:true,lifeOnly},persona,'session');
  return {text:deps.sessionInstructions.get('session'),digest:deps.sessionDigests.get('session'),persona:persona.prompt,history};
}
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
// Capture the pre-change shared rule slots without shipping personal task paths.
const baseline=source.replace(/mobileRule\('[a-z]+',(BRIEF_RULES\.[a-z]+),!isDesktop\)/g,'$1');
test('desktop and mobile sessions distinguish writing for someone from speaking or acting for them',()=>{
  const personaText=p=>personaDecisionPrompt({card:p.prompt});
  for(const desktop of [true,false])for(const kind of ['private','group']){
    const {text,persona}=renderPrompt(source,{desktop,kind,rows:[],personaText});
    assert.ok(text.includes(persona));
    assert.equal(text.split(DRAFT_VOICE_RULE).length,2);
    assert.doesNotMatch(text,/默认只写直接对对方说的话/);
    assert.match(text,/要措辞就给适合收件人直接读的草稿/);
    if(kind==='group')assert.match(text,/群友请你拟的话是给他选用的草稿/);
    if(!desktop)assert.match(text,/只有请求涉及实际操作时才调用/);
  }
});
test('mobile rule compaction leaves desktop rules byte-identical and does not touch arbitrary persona text',()=>{for(const [key,value]of Object.entries(BRIEF_RULES))assert.equal(mobileRule(key,value,false),value);assert.equal(mobileRule('not-a-bridge-rule','用户原文',true),'用户原文');const pc=renderPrompt(source,{desktop:true}),old=renderPrompt(baseline,{desktop:true});assert.equal(pc.text,old.text);assert.equal(pc.digest,old.digest);});
test('PC and mobile builders preserve full persona/history and offer on-demand features without permanent manuals',()=>{for(const desktop of [false,true]){const after=renderPrompt(source,{desktop});assert(after.text.includes(after.persona));assert(after.digest.includes(after.history[0].text));for(const word of ['bridge_context','付款','评论','日程','服装','语音','音乐','视频','链接','文件'])assert(after.text.includes(word),word);assert.match(after.text,/照片|图片/);for(const manual of ['【手边的表情包】','【Live2D 直播舞台】','【拍摄日程默认状态】'])assert(!after.text.includes(manual),manual);assert.doesNotMatch(after.text,/每天最多|每小时最多|请求限额|字数上限/);}});
test('schedule-only session excludes an eleven-hour-old bedtime exchange while normal chat keeps its history',()=>{const now=Date.now(),rows=[{chat:'private:12345678',accountId:'a',personaId:'角色',time:now-11*3600000,dir:'in',text:'数到七十再睡'},{chat:'private:12345678',accountId:'a',personaId:'角色',time:now-11*3600000+1000,dir:'out',text:'开始数了'},{chat:'private:12345678',accountId:'a',personaId:'角色',time:now-60000,dir:'in',text:'现在请看这张图片'}];const life=renderPrompt(source,{desktop:true,lifeOnly:true,rows}),normal=renderPrompt(source,{desktop:true,rows});assert(life.digest.includes('现在请看这张图片'));assert(!life.digest.includes('数到七十'));assert(!life.digest.includes('开始数了'));assert(normal.digest.includes('数到七十'));});
test('mobile descriptions keep tool names, actions, schemas and execution results identical',async()=>{function build(platform){const definitions=new Map();const tools=createAgentCapabilities({platform,ctx:{get:name=>name==='tools'?{register:def=>definitions.set(def.name,def)}:undefined},getConfig:()=>({enabled:true}),getContext:()=>({}),authorize:()=>true,browser:{status:()=>({}),act:async args=>({ok:true,action:args.action})},desktop:{status:()=>({})},audio:{status:()=>({})},getPhone:()=>({status:()=>({})}),services:{qqSocial:async()=>({ok:true}),lifeChat:async()=>({ok:true}),lifeShare:async()=>({ok:true})}});tools.start();return definitions;}const pc=build('win32'),phone=build('linux');for(const [name,definition]of phone){assert(pc.has(name));if(name!=='bridge_device')assert.deepEqual(definition.parameters,pc.get(name).parameters);assert(definition.description);if(['bridge_browser','bridge_device','bridge_qq_profile','bridge_life_share','bridge_life_qq'].includes(name))assert(definition.description.length<pc.get(name).description.length,name);}const result=await phone.get('bridge_browser').execute({action:'snapshot'},{agent:{id:'s'}});assert.equal(result.ok,true);assert.equal(result.action,'snapshot');assert.match(phone.get('bridge_qq_profile').description,/comments.*reply.*verify/);});
test('unknown tools and Windows descriptions are preserved verbatim',()=>{assert.equal(mobileToolDescription('user_plugin','自定义说明','linux'),'自定义说明');assert.equal(mobileToolDescription('bridge_browser','原版说明','win32'),'原版说明');});
