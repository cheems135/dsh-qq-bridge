import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createImageStudio} from '../image-studio.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return fn(...Object.values(deps));}throw Error('Missing function '+name);}
test('image correction receives the full review and previous draft without submitting an image',async()=>{
 const scene='她穿着浅色短裙坐在客厅木桌旁，桌面放着一本翻开的书和一杯温水，手指轻轻搭在书页边缘。房间里的书架、窗帘与台灯构成完整背景，近处镜头呈现自然神态和衣服的布料纹理，画面保持连贯的空间关系。';
 const issues=['当前应为夜间人工照明。'.repeat(30),'用户要求短裙，不应强制恢复日程原服装。'],drafts=[];let reviews=0,submissions=0;
 const studio=createImageStudio({getConfig:()=>({promptLanguage:'zh'}),visualPlan:()=>({humanRequest:'夏日短裙风格',prompt:'模型原稿误写为阳光街道午后',styleTags:['anime'],lifeContext:{location:'室内',outfit:'开衫'}}),fetchImpl:()=>{submissions++;throw Error('No paid generation in this test');},ask:async(system,input)=>{
  if(system.startsWith('【图像细节核对】'))return JSON.stringify(++reviews===1?{ok:false,missing:issues}:{ok:true,missing:[]});
  drafts.push(JSON.parse(input));return JSON.stringify({prompt:scene,style:'二维二次元插画。'});
 }});
 await studio.prepare('夏日短裙风格');assert.equal(drafts.length,2);assert.deepEqual(drafts[1].repairFeedback.issues,issues);assert.equal(drafts[1].repairFeedback.previousPrompt,scene);assert.match(drafts[1].repairFeedback.instruction,/earlier model draft/);assert.equal(submissions,0);
});
test('actual group and private media failure explanation queues one natural text, not a generation retry',async()=>{
 for(const kind of ['group','private']){
  const queued=[],task={id:'t',kind:'image',status:'failed',accountId:'a',auditId:'audit',error:'提示词核对未通过，尚未调用生图接口'},chat={kind,key:kind+':123',chatId:'123',auditId:'audit'},deps={featureState:{generation:0},conversationScope:()=> 'scope',activePersona:()=>({id:'p',prompt:'角色'}),calendarSafeText:v=>v,personaPromptText:()=> '角色',auditById:()=>({userWords:'发一张照片'}),operationContext:()=>[],askModel:async()=> '刚才那张没开始画，提示词里的白天和现在夜里撞上了',effectiveModel:()=>({}),stopped:false,accountPaused:false,localIssueReply:()=> 'fallback',personaWaitStyle:()=>({}),personaContextIdentity:()=> 'v',queueOutgoing:(c,segments)=>{queued.push({c,segments});return 'queued';},saveFeatures:()=>{}};
  await extract('explainMediaFailure',deps)(chat,task);assert.equal(queued.length,1);assert.equal(queued[0].segments[0].type,'text');assert.equal(queued[0].c.mediaCaptionHandled,true);assert.equal(task.noticeDeliveryId,'queued');assert.equal(task.failureContextPending,false);
 }
});
test('media failure explanation does not leak into a replaced conversation',async()=>{
 let scope='old',sent=0;const deps={featureState:{generation:0},conversationScope:()=>scope,activePersona:()=>({}),calendarSafeText:String,personaPromptText:()=>'',auditById:()=>({}),operationContext:()=>[],askModel:async()=>{scope='new';return '失败说明';},effectiveModel:()=>({}),stopped:false,accountPaused:false,queueOutgoing:()=>{sent++;}};
 await extract('explainMediaFailure',deps)({key:'group:123'},{error:'failed'});assert.equal(sent,0);
});

test('failure speech uses persona before task facts without prescribing cute phrasing, fixed length or asking for the same request again',async()=>{
 let system,input;const queued=[];
 const deps={featureState:{generation:0},conversationScope:()=> 'scope',activePersona:()=>({id:'p'}),calendarSafeText:String,personaPromptText:()=> 'PERSONA_FIRST',auditById:()=>({userWords:'拍张照片'}),operationContext:()=>[],askModel:async(s,u)=>{system=s;input=JSON.parse(u);return '镜头那句写岔了，图还没开始画。';},effectiveModel:()=>({}),stopped:false,accountPaused:false,localIssueReply:()=> 'fallback',personaWaitStyle:()=>({}),personaContextIdentity:()=> 'v',queueOutgoing:(chat,segments)=>{queued.push(segments);return 'delivery';},saveFeatures:()=>true};
 await extract('explainMediaFailure',deps)({key:'private:123',auditId:'a'},{id:'image',kind:'image',status:'failed',error:'提示词校验未通过，尚未调用生图接口'});
 assert(system.startsWith('PERSONA_FIRST'));assert.doesNotMatch(system,/只写一到两句|80字以内|必须.*撒娇|必须.*道歉/);
 assert.equal(input.originalRequestAvailable,true);assert.equal(input.stage,'failed');assert.equal(queued.length,1);
});
