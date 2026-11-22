import {naturalBubbleParts,normalizeReplyNewlines,stickerMessageGroups,QQ_LINE_BREAK_RULE} from '../chat-bubbles.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {randomUUID} from 'node:crypto';
import {cleanOutgoingText,qqParagraphGroups,deliveryFingerprint,existingDelivery} from '../qq-reliability.js';
import {deliveryCommitmentId} from '../commitments.js';
import {expressionHint} from '../conversation-care.js';
import {BRIEF_RULES,briefExpression} from '../prompt-budget.js';
import {mobileRule} from '../mobile-prompt.js';
import {NATURAL_PARAGRAPH_RULE,cleanGeneratedReplyDividers,requestsLiteralText} from '../local-reply.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  function '+name+'\\(','m'));for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(error){if(error instanceof SyntaxError)continue;throw error;}return fn(...Object.values(deps));}throw Error('Function not found');}
function fixture({saveOk=true,deny=()=>'',audit=null}={}){const featureState={outbox:[],proactiveContacts:[]};let saves=0,flushes=0;const deps={qqParagraphGroups,cleanOutgoingText,deliveryFingerprint,existingDelivery,deliveryCommitmentId,featureState,settings:{activeAccountId:'a'},stripUnrequestedActions:v=>v,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),deliveryScopeCurrent:()=>true,personaContextIdentity:()=> 'v',calendarSafeText:v=>v,groupStopped:()=>false,auditById:()=>audit,noteDeliveryIssue:()=>{},recipientDenial:deny,recordsAllowed:()=>true,wrongOwnerAddress:()=>false,privateInitiativeAllowed:()=>true,randomUUID,stopped:false,accountPaused:false,proactiveCheck:()=>'',reserveProactive:()=>{},proactiveIncoming:()=>0,log:()=>{},saveFeatures:()=>{saves++;return saveOk;},logDelivery:()=>{},flushOutbox:()=>{flushes++;}};
 const queue=extract('queueOutgoing',deps);return {queue,featureState,deps,get saves(){return saves;},get flushes(){return flushes;}};}
const chat={key:'private:12345',kind:'private',chatId:'12345',turnKind:'user',deliveryKey:'local:turn-1'};
test('literal typography survives prepared bubbles and paragraph children without exposing internal markers',()=>{
 for(const preparedReply of [undefined,'bubble']){
   const audit={id:'one',accountId:'a',persona:'p',status:'completed',outboxIds:[],userWords:'请逐字回复，保留标点和空格。'};
   const h=fixture({audit});
   const first='苹果🍎，',second='式子 a  +  b。';
   for(const text of preparedReply?[first,second]:[first+'\n'+second]){
     h.queue({...chat,preparedReply,auditId:'one'},[{type:'text',data:{text}}]);
   }
   assert.deepEqual(h.featureState.outbox.map(j=>j.segments[0].data.text),[first,second]);
 }
 assert.equal(cleanOutgoingText('【说话方式】内部提示\n苹果🍎。',{chatStyle:true,formatRequest:'原样回复'}),'苹果🍎。');
 assert.equal(cleanOutgoingText('苹果🍎。',{chatStyle:true,formatRequest:'不用逐字回复'}),'苹果');
});
test('echoed per-turn directions and invented follow-ups are cut before they become separate bubbles',()=>{
 const leaked='小池是导演。\n\n【本轮相处方式】直接回答这次问题。\n\n小池是姓还是全名？';
 assert.equal(cleanGeneratedReplyDividers(leaked,{request:'回到电影'}),'小池是导演。');
 assert.equal(cleanOutgoingText(leaked,{chatStyle:true,formatRequest:'回到电影'}),'小池是导演');
 const quoted='例子\n```text\n【本轮相处方式】模板\n```\n结尾';
 assert.equal(cleanGeneratedReplyDividers(quoted,{request:'给我写示例代码'}),quoted);
});
test('actual queue turns CR, LF and CRLF into independent persisted QQ jobs',()=>{
 for(const text of ['第一段，\n第二段,\r\n第三段。','第一段，\r第二段,\n第三段。']){
 const h=fixture(),id=h.queue(chat,[{type:'text',data:{text}}]),jobs=h.featureState.outbox;assert.equal(jobs.length,3);assert.equal(jobs[0].id,id);assert.deepEqual(jobs.map(j=>j.segments[0].data.text),['第一段','第二段','第三段']);assert.equal(new Set(jobs.map(j=>j.deliveryKey)).size,3);assert.deepEqual(jobs[0].paragraphIds,jobs.map(j=>j.id));assert.equal(h.saves,1);assert.equal(h.flushes,1);
 h.queue(chat,[{type:'text',data:{text}}]);assert.equal(jobs.length,3,'same delivery cannot duplicate children');
 }
});
test('literal newline escapes remain on the same line in the actual queue',()=>{
 const text='第一段，\\n第二段,\\r\\n第三段';
 const h=fixture();
 h.queue(chat,[{type:'text',data:{text}}]);
 assert.deepEqual(h.featureState.outbox.map(job=>job.segments[0].data.text),[text]);
});
test('same proactive episode and recipient scope are preserved across paragraphs',()=>{const h=fixture();h.queue({...chat,turnKind:'proactive',contactEpisode:'episode-a'},[{type:'at',data:{qq:'123'}},{type:'text',data:{text:'第一段，\n第二段，'}}]);const jobs=h.featureState.outbox;assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.proactiveEpisode==='episode-a'&&j.accountId==='a'&&j.personaId==='p'));assert.equal(jobs[0].segments[0].type,'at');assert.equal(jobs[1].segments[0].type,'text');});
test('code, JSON and mixed media are never split into separate fabricated messages',()=>{for(const text of ['```js\nconsole.log(1.2);\n```','{\n"text":"hello"\n}','1. first\n2. second'])assert.equal(qqParagraphGroups([{type:'text',data:{text}}]).length,1);assert.equal(qqParagraphGroups([{type:'image',data:{file:'a'}},{type:'text',data:{text:'第一段\n第二段'}}]).length,1);});
test('the shared splitter keeps overflow lines together at the configured bubble count',()=>{
 const text='第一行\n第二行\r第三行';
 const parts=qqParagraphGroups([{type:'text',data:{text}}],{maxBubbles:2});
 assert.deepEqual(parts.map(group=>group[0].data.text),['第一行','第二行\n第三行']);
});
test('whole-message recipient denial or storage failure cannot send partial paragraphs',()=>{const denied=fixture({deny:()=> 'outside whitelist'});assert.equal(denied.queue(chat,[{type:'text',data:{text:'一\n二'}}]),null);assert.equal(denied.featureState.outbox.length,0);const failed=fixture({saveOk:false});assert.equal(failed.queue(chat,[{type:'text',data:{text:'第一段\n第二段'}}]),null);assert.equal(failed.flushes,0);assert.ok(failed.featureState.outbox.every(j=>j.status==='failed'));});
test('comma at a paragraph ending is removed after style cleanup, preserving decimal punctuation and inline code',()=>{assert.equal(cleanOutgoingText('第一段，\r\n第二段,',{chatStyle:true}),'第一段\n第二段');assert.equal(cleanOutgoingText('版本1.2，\n`x = 1.2;`',{chatStyle:true}),'版本1.2\n`x = 1.2;`');});

function sender(h,{isDesktop,plainText=false,maxBubbles=1}){
 const errors=[];
 const parse=extract('burstSegments',{settings:{stickerDisabled:[]},FACE_IDS:{},resolveSticker:()=>'/fixture/happy.png',randomSticker:()=>'/fixture/happy.png',stickersInGroup:()=>[],log:()=>{}});
 const start=source.indexOf('function renderForChat('),end=source.indexOf('\n}',start)+2;
 const renderForChat=Function('normalizeReplyNewlines','requestsLiteralText','return ('+source.slice(start,end)+')')(normalizeReplyNewlines,requestsLiteralText);
 const deps={...h.deps,chats:new Map(),state:{chats:{}},isDesktop,completeMediaReply:v=>v,directMediaIntent:()=>null,
  explicitlyRequestsImage:()=>false,removeDuplicatePassages:v=>v,imageFirstReply:v=>v,cfg:{plainText},
  companionSettings:()=>({maxBubbles}),naturalBubbleParts,cleanGeneratedReplyDividers,renderForChat,
  burstSegments:parse,stickerMessageGroups,sendSegments:h.queue,setTimeout:fn=>queueMicrotask(fn),replyDeliveryFailure:(_chat,error)=>errors.push(error)};
 const persistTextBubbles=extract('persistTextBubbles',{...deps,queueOutgoing:h.queue,markReplyDelivery:()=>{}});
 return {send:extract('sendTextNow',{...deps,persistTextBubbles}),errors};
}

for(const isDesktop of [true,false])for(const [text,expected] of [
 ['第一段，\n第二段。\n[表情包:开心]',['第一段','第二段']],
 ['第一段，\n第二段。[表情包:开心]',['第一段','第二段']],
 ['第一段，\\n第二段。[表情包:开心]',['第一段，\\n第二段']],
 ['[表情包:开心]\n第一段，\n第二段。',['第一段','第二段']],
])test(`actual ${isDesktop?'PC':'phone'} path separates sticker delivery using actual text lines: ${JSON.stringify(text)}`,async()=>{
 const audit={id:'audit',accountId:'a',persona:'p',status:'completed',userWords:'聊聊天',answer:text,outboxIds:[]};
 const h=fixture({audit}),{send,errors}=sender(h,{isDesktop});
 const actor={...chat,auditId:audit.id,mediaIntentHandled:true};await send(actor,text);
 assert.deepEqual(errors,[]);const jobs=h.featureState.outbox,images=jobs.filter(j=>j.segments.some(s=>s.type==='image'));
 assert.equal(jobs.length,expected.length+1);assert.equal(images.length,1);assert.deepEqual(images[0].segments,[{type:'image',data:{file:'/fixture/happy.png'}}]);
 assert.deepEqual(jobs.filter(j=>j!==images[0]).map(j=>j.segments[0].data.text),expected);
 assert.equal(jobs[0].segments[0].type,text.startsWith('[表情包')?'image':'text');
});

test('sticker marker no longer suppresses explicit newlines before parsing',()=>{
 assert.deepEqual(naturalBubbleParts('第一段\n第二段[表情包:开心]',{maxBubbles:1}),['第一段','第二段[表情包:开心]']);
 assert.deepEqual(naturalBubbleParts('[发送:12345|第一段\n第二段]'),['[发送:12345|第一段\n第二段]']);
 assert.deepEqual(naturalBubbleParts('先答一句\r\n[发送:12345|第一行\n第二行]\n再补一句'),['先答一句','[发送:12345|第一行\n第二行]','再补一句']);
});

test('the outgoing queue removes generated divider artifacts without creating new bubbles',()=>{
 for(const bars of ['||','|||','｜｜','‖','∥']){
  const oneLine='今晚不喝咖啡'+bars+'豆浆配南瓜';
  const text=oneLine+'\r\n再吃点蒸南瓜';
  assert.deepEqual(naturalBubbleParts(text),[oneLine,'再吃点蒸南瓜']);
  assert.deepEqual(naturalBubbleParts(oneLine),[oneLine]);
  const h=fixture();
  h.queue(chat,[{type:'text',data:{text:oneLine+'\n'+bars+'\n再吃点蒸南瓜'}}]);
  assert.deepEqual(h.featureState.outbox.map(job=>job.segments[0].data.text),['今晚不喝咖啡 豆浆配南瓜','再吃点蒸南瓜']);
 }
 assert.deepEqual(naturalBubbleParts('先说第一句。再说第二句？'),['先说第一句。再说第二句？']);
});
test('manual text and intentional code or relay syntax retain literal vertical bars',()=>{
 const h=fixture();
 const text='请保留 a || b';
 h.queue({...chat,turnKind:undefined},[{type:'text',data:{text}}]);
 assert.equal(h.featureState.outbox[0].segments[0].data.text,text);
 for(const literal of ['`a || b`','```js\na || b\n```','{\n"text":"a || b"\n}','[发送:12345|a || b]','| 左 | 右 |\n| --- | --- |\n| a || b | c |']){
  assert.equal(cleanGeneratedReplyDividers(literal),literal);
 }
 assert.equal(cleanGeneratedReplyDividers(text,{request:'请原样返回'}),text);
});

test('desktop, mobile and local prompts use the same line-break rule',()=>{
 for(const prompt of [expressionHint({}, {privateChat:true}),briefExpression({},true),BRIEF_RULES.voice,mobileRule('voice',BRIEF_RULES.voice,true),NATURAL_PARAGRAPH_RULE]){
  assert.ok(prompt.includes(QQ_LINE_BREAK_RULE));
  assert.ok(!prompt.includes('|'.repeat(3)));
 }
});
for(const isDesktop of [true,false])test(`actual ${isDesktop?'PC':'phone'} text delivery keeps length, punctuation and links inside the original line`,async()=>{
 const longLine='我刚把窗户关好，外面下雨的声音好近，明天再出门走走。'.repeat(100);
 const sample=longLine+'||我刚看到 https://example.org/x?value=a%7C%7Cb\r\n‖\r这样写 `a || b`';
 const audit={id:'audit',accountId:'a',persona:'p',status:'completed',userWords:'今晚你打算做什么？',answer:sample,outboxIds:[]};
 const h=fixture({audit}),{send,errors}=sender(h,{isDesktop,plainText:true});
 const actor={...chat,auditId:audit.id,mediaIntentHandled:true};
 await send(actor,sample);
 assert.deepEqual(errors,[]);
 assert.deepEqual(h.featureState.outbox.map(job=>job.segments[0].data.text),[
  longLine.replaceAll('。','')+' 我刚看到 https://example.org/x?value=a%7C%7Cb','这样写 a || b',
 ]);
});
test('a paced proactive note queues at most two bubbles in one episode and cancels the remainder after a reply',async()=>{
 const {proactiveDenial,reserveProactive}=await import('../social-pacing.js');
 const h=fixture(),at=Date.now(),incoming=at-31*60_000;
 const check=(job,lastIncoming=incoming,clock=Date.now())=>proactiveDenial(job,h.featureState.proactiveContacts,lastIncoming,clock,60);
 const queue=extract('queueOutgoing',{...h.deps,settings:{...h.deps.settings,autonomy:{privateMinGapMinutes:60}},proactiveCheck:job=>check(job),proactiveIncoming:()=>incoming,reserveProactive});
 const actor={...chat,turnKind:'proactive',deliveryKey:'proactive:three-paragraphs'};
 const text='第一段刚翻到一篇有意思的文章\n第二段里有个细节我反复想了两遍\n第三段也想问问你会怎么看';
 assert.ok(queue(actor,[{type:'text',data:{text}}]));
 const [first,second]=h.featureState.outbox;
 assert.equal(h.featureState.outbox.length,2);
 assert.deepEqual(first.paragraphIds,[first.id,second.id]);
 assert.equal(first.proactiveEpisode,second.proactiveEpisode);
 assert.ok(second.notBefore>=first.notBefore+3000);
 assert.deepEqual([first,second].map(j=>j.segments[0].data.text).join('\n'),text);
 assert.equal(h.featureState.proactiveContacts.length,1);
 assert.equal(check(first),'');
 assert.equal(check(second),'');
 assert.match(check(second,at+10),/本次主动私聊/);
 assert.match(check({...second,id:'different-job'}),/本次主动私聊/);
 assert.match(check({...second,proactiveEpisode:'extra',proactiveParagraphBatch:''}),/全账号主动私聊间隔/);
 assert.match(check({...first,proactiveEpisode:'next'},incoming,at+61*60_000),/相同内容/);
 assert.equal(h.saves,1);
 assert.equal(h.flushes,1);
});
test('phone batch write failure marks both proactive bubbles failed without flushing',async()=>{
 const {proactiveDenial,reserveProactive}=await import('../social-pacing.js');
 const h=fixture({saveOk:false}),incoming=Date.now()-31*60_000;
 const queue=extract('queueOutgoing',{...h.deps,settings:{...h.deps.settings,autonomy:{privateMinGapMinutes:60}},proactiveCheck:job=>proactiveDenial(job,h.featureState.proactiveContacts,incoming,Date.now(),60),proactiveIncoming:()=>incoming,reserveProactive});
 const persist=extract('persistTextBubbles',{...h.deps,queueOutgoing:queue,markReplyDelivery:()=>{},burstSegments:text=>[{type:'text',data:{text}}],stickerMessageGroups});
 persist({...chat,turnKind:'proactive',deliveryKey:'proactive:phone'},['第一段\n第二段\n第三段'],0);
 assert.equal(h.featureState.outbox.length,2);
 assert.ok(h.featureState.outbox.every(j=>j.status==='failed'));
 assert.equal(h.flushes,0);
});
