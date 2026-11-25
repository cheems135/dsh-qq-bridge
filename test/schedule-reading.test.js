import {audioDeliveryKind} from '../audio-delivery.js';
import {naturalBubbleParts} from '../chat-bubbles.js';
import {scheduledChatHeld,scheduledChatReceipt} from '../schedule-continuity.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {assertScheduleReading,scheduleReadingEvidence,unsupportedScheduleReading} from '../schedule-reading.js';import {executeLocalAutonomy} from '../local-autonomy.js';import {briefLifeJob} from '../prompt-budget.js';
const planned={id:'j',status:'planned',scene:{activity:'阅读鲸鱼育幼文章',actual:false},steps:[],evidence:[]};
const read={tool:'bridge_read',ok:true,substantive:true,url:'https://example.org/whale',coverage:'实际已读到育幼段落：幼鲸喝母鲸乳汁。'};
const failedSample='我刚看到一篇讲鲸鱼育幼的文章，说小鲸鱼是喝妈妈奶长大的，我一下子懵了——那它们在海里怎么喝啊？我还挺想弄明白的。';
test('actual failed API sentence is rejected for planned schedule even with tool discovery',()=>{
 for(const evidence of [[],[{tool:'bridge_tools',ok:true,substantive:true,coverage:'已发现阅读工具'}],[{tool:'bridge_search',ok:true,substantive:true,coverage:'找到一篇文章标题'}]])assert.throws(()=>assertScheduleReading(failedSample,{...planned,evidence}),e=>e.code==='SCHEDULE_READING_EVIDENCE_REQUIRED');
});
test('a completed status, actual flag and self-authored note cannot invent a read receipt',()=>{
 assert.throws(()=>assertScheduleReading(failedSample,{...planned,status:'completed',scene:{actual:true},note:'我已读过',finalReply:'我已经读完'}));
 assert.equal(scheduleReadingEvidence({...planned,evidence:[{...read,ok:false}]}).observed,false);
 assert.equal(scheduleReadingEvidence({...planned,evidence:[{...read,substantive:false}]}).observed,false);
});
test('intention, general knowledge, denial, invitation and attributed user words remain usable',()=>{
 for(const text of ['爸爸，我想去看看小鲸鱼是怎么吃奶的，你也好奇嘛？','我还没有读过那篇，想先找来看看。','鲸鱼是哺乳动物，我想知道它们怎么喂奶。','你读过那篇文章吗？','你刚说“我刚看到一篇文章”，是指哪篇？','我不是没时间，只是想晚一点再看。','I want to read that article.','I have not read that article.'])assert.doesNotThrow(()=>assertScheduleReading(text,planned),text);
});
test('implicit and English experience claims cannot bypass missing evidence',()=>{
 for(const text of ['刚读到一个有趣的点。','今天刚看到这篇文章。','这篇文章里说小鲸鱼喝奶。','我不是没读过这篇。','I just read an article about whales.',"I've just read that article.",'“我刚看到一篇文章。”'])assert.throws(()=>assertScheduleReading(text,planned),text);
});
test('partial real reading can be shared before the whole task finishes',()=>{
 const job={...planned,status:'running',evidence:[read]};assert.doesNotThrow(()=>assertScheduleReading('爸爸，我刚读到这段，小鲸喝妈妈的乳汁，正好接上你刚才的问题。',job));
 assert.throws(()=>assertScheduleReading('我已经读完整篇了。',job),e=>e.reason==='partial_reading_evidence');
 assert.doesNotThrow(()=>assertScheduleReading('我还没读完整篇，但刚读到这段。',job));
 assert.doesNotThrow(()=>assertScheduleReading('我已经读完整篇了。',{...job,evidence:[{...read,complete:true}]}));
});
test('brief job preserves machine reading evidence and full/partial flags',()=>{
 const full=briefLifeJob({...planned,evidence:[{...read,complete:true,fullViewed:true}]});assert.equal(full.readingEvidence.observed,true);assert.equal(full.evidence[0].complete,true);assert.equal(scheduleReadingEvidence(full).complete,true);
});
test('local schedule check blocks the real bad draft with a successful discovery receipt',async()=>{
 let delivered=false,finished='';await assert.rejects(executeLocalAutonomy({context:{id:'test',persona:'角色',cue:'日程',lifeJob:planned,expectAction:true},assertCurrent:()=>{},run:async input=>{assert(input.messages.some(m=>m.content.includes('当前任务的程序阅读证据')));return {ok:true,body:{text:failedSample,receipts:[{tool:'bridge_tools',ok:true}]}};},deliver:()=>{delivered=true;},finish:r=>{finished=r;}}),e=>e.code==='SCHEDULE_READING_EVIDENCE_REQUIRED');assert.equal(delivered,false);assert.equal(finished,'failed');
});
test('actual task with real reading still delivers a contextual reply',async()=>{
 let delivered='';const text='爸爸，我刚读到小鲸喝妈妈的乳汁，接上刚才那个问题了。';await executeLocalAutonomy({context:{id:'real',persona:'角色',cue:'日程',lifeJob:{...planned,evidence:[read]},expectAction:true},assertCurrent:()=>{},run:async()=>({ok:true,body:{text,receipts:[{tool:'bridge_read',ok:true}]}}),deliver:r=>{delivered=r.text;}});assert.equal(delivered,text);
});
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
function nativeChat(job=planned){
 const start=source.indexOf('      lifeChat:async(args,context)=>{'),end=source.indexOf('\n      adjustLife:',start);assert(start>0&&end>start);let sends=0;
 const deps={scheduledChatHeld,scheduledChatReceipt,socialReplyForChat:async v=>v,agencyAuthorized:()=>true,shareTask:()=>job,targets:()=>['private:12345'],resolveShareRecipient:v=>v||'private:12345',assertScheduleReading,textHash:v=>crypto.createHash('sha256').update(v).digest('hex'),outgoingActivityChat:()=>({}),executionRuntime:{begin:()=>{}},naturalBubbleParts:v=>[v],sendSegments:()=>{sends++;return 'sent';},rememberActivityShare:()=>{}};
 const fn=new Function(...Object.keys(deps),'return ({'+source.slice(start,end)+'}).lifeChat;')(...Object.values(deps));return {call:text=>fn({action:'send',text,target:'private:12345'},{key:'private:12345',meta:{kind:'user',lifeJobId:'j'}}),get sends(){return sends;}};
}
test('actual native API schedule chat checks evidence before any queue side effect',async()=>{
 const f=nativeChat();await assert.rejects(f.call(failedSample),e=>e.code==='SCHEDULE_READING_EVIDENCE_REQUIRED');assert.equal(f.sends,0);
 const ok=nativeChat({...planned,evidence:[read]});assert((await ok.call('我刚读到小鲸喝妈妈的乳汁。')).ok);assert.equal(ok.sends,1);
});

test('search-only page is not reading evidence even if a producer marked it substantive',()=>{
 assert.throws(()=>assertScheduleReading(failedSample,{...planned,evidence:[{...read,tool:'bridge_browser',coverage:'仅搜索结果页，未读取正文'}]}));
});
test('older real read remains in bounded prompt evidence after many metadata operations',()=>{
 const job={...planned,evidence:[read,...Array.from({length:10},()=>({tool:'bridge_tools',ok:true,substantive:false,coverage:'工具发现'}))]};const brief=briefLifeJob(job);assert.equal(brief.evidence.length,6);assert.equal(scheduleReadingEvidence(brief).observed,true);
});
test('tool-time reading proof is refreshed instead of rejecting a task that just read successfully',async()=>{
 let proof={...planned},delivered=false;await executeLocalAutonomy({context:{id:'fresh',persona:'角色',cue:'日程',lifeJob:planned,expectAction:true},getLifeJob:()=>proof,assertCurrent:()=>{},run:async()=>{proof={...planned,evidence:[read]};return {ok:true,body:{text:'我刚读到小鲸喝母鲸乳汁。',receipts:[{tool:'bridge_read',ok:true}]}};},deliver:()=>{delivered=true;}});assert.equal(delivered,true);
});

test('actual native artwork share blocks invented reading before queuing image or caption',async()=>{
 const existing=fs.readFileSync(new URL('./sharing-dialogue.test.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');let fixture=existing.slice(existing.indexOf('function shareFixture('),existing.indexOf("test('actual native image sharing prepares"));fixture=fixture.replace('const deps={','const deps={assertScheduleReading,scheduledChatHeld,scheduledChatReceipt,').replace("'先给你看看这只小鲸鱼。'",JSON.stringify(failedSample));
 const make=new Function('audioDeliveryKind','source','assertScheduleReading','scheduledChatHeld','scheduledChatReceipt','crypto','assert','naturalBubbleParts',fixture+';return shareFixture;')(audioDeliveryKind,source,assertScheduleReading,scheduledChatHeld,scheduledChatReceipt,crypto,assert,naturalBubbleParts),f=make();f.context.meta= {kind:'user',lifeJobId:'j'};await assert.rejects(f.callback({action:'send',file:f.file},f.context),e=>e.code==='SCHEDULE_READING_EVIDENCE_REQUIRED');assert.equal(f.sent.length,0);
 const valid=make();valid.context.meta= {kind:'user',lifeJobId:'j'};valid.job.evidence=[read];assert((await valid.callback({action:'send',file:valid.file},valid.context)).ok);assert.equal(valid.sent.length,2);
});
