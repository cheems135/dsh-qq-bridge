import {audioDeliveryKind} from '../audio-delivery.js';
import {naturalBubbleParts} from '../chat-bubbles.js';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {recentOperationContext} from '../operation-context.js';import {socialShareReply,socialRewriteNeeded} from '../social-sharing.js';import {prepareQqFileUpload,fileUploadAccepted} from '../qq-file-sharing.js';import {createQqNativeCapabilities} from '../qq-native-capabilities.js';
const technical='十秒那版做完了，鼓点卡96bpm正好十六拍，接缝磨到0.0025，我听着像一口气不断。';
test('music report is rewritten with persona and latest image context, not a canned line',async()=>{
 let data,system;const text=await socialShareReply(technical,{persona:'克制的摄影师，称对方先生',recipient:'当前熟人',recent:[{role:'user',text:'[图片]这张像不像你',hasImage:true},{role:'assistant',text:'帽子画得有点夸张。'}],ask:async(s,u)=>{data=JSON.parse(u);system=s;return '先生，刚才那张画先放一边，我想让你听听这段。';}});
 assert.match(text,/先生/);assert.match(data.persona,/摄影师/);assert.equal(data.candidate,'');assert.equal(data.discardedReport,true);assert(!JSON.stringify(data).includes('96bpm'));assert(data.recent[0].hasImage);assert.match(system,/BPM/);assert(!/96|0\.0025/.test(text));
});
test('explicit technical questions keep exact detail; requests to avoid parameters do not bypass rewrite',async()=>{
 assert.equal(await socialShareReply(technical,{request:'请给我BPM和接缝参数',ask:()=>{throw Error('must not call')}}),technical);
 assert(socialRewriteNeeded(technical,{request:'别讲参数，用人设分享'}));assert(!socialRewriteNeeded('这段想先给你听。'));
});
test('technical request in the latest real user turn is retained during scheduled followup',async()=>{
 assert.equal(await socialShareReply(technical,{recent:[{role:'user',text:'刚才那段的BPM是多少？'}]}),technical);
});
test('unsupported file-limit claim is rewritten using actual available upload route',async()=>{
 let data;const value=await socialShareReply('桥接只肯发图片和语音，文件甩不进聊天。',{ask:async(_s,u)=>{data=JSON.parse(u);return '我想把原文件也给你，等这次上传有结果再说。';}});assert(!value.includes('桥接'));assert.equal(data.capabilities.fileSharing.route,'bridge_life_share');assert.equal(data.capabilities.fileSharing.currentDelivery,'not-confirmed');
});
test('failed rewrite never silently sends the original report or retries artwork generation',async()=>{
 await assert.rejects(socialShareReply(technical,{ask:async()=>technical}),e=>e.code==='SHARING_STYLE_REQUIRED');await assert.rejects(socialShareReply(technical,{ask:async()=>{throw Error('offline')}}),e=>e.code==='SHARING_STYLE_REQUIRED');
});
test('new files may get natural dialogue without pretending file was delivered; ordinary text is unchanged',async()=>{
 let input;assert.equal(await socialShareReply('',{kind:'file',evidence:{title:'鲸歌',file:'C:/private/whale.wav'},ask:async(_s,u)=>{input=u;return '这段我想先给你听听。';}}),'这段我想先给你听听。');assert(!input.includes('C:/private'));assert.equal(await socialShareReply('这段我想先给你听听。'),'这段我想先给你听听。');
});
test('scope cancellation rejects a late style rewrite',async()=>{
 const c=new AbortController();await assert.rejects(socialShareReply(technical,{signal:c.signal,ask:async()=>{c.abort();return '迟到的配话';}}),e=>e.name==='AbortError');
});
test('eight consecutive outgoing bubbles cannot evict the latest received image',()=>{
 const rows=[{chat:'private:1',accountId:'a',personaId:'p',time:1,dir:'in',text:'[图片]',image:true,messageId:'image-id'},...Array.from({length:10},(_,i)=>({chat:'private:1',accountId:'a',personaId:'p',time:i+2,dir:'out',text:'回复'+i}))];const context=recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100});assert.equal(context.length,8);assert.equal(context[0].role,'user');assert.equal(context[0].id,'image-id');assert.equal(context[0].hasImage,true);assert.equal(context.at(-1).text,'回复9');
 assert.equal(recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100,floor:1}).length,8);assert(recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100,floor:1}).every(r=>r.role==='assistant'));
});
test('latest user anchor never reintroduces cleared, failed, retracted, other account or other recipient input',()=>{
 const rows=[{chat:'private:2',accountId:'a',personaId:'p',time:12,dir:'in',text:'别人图片',image:true},{chat:'private:1',accountId:'other',personaId:'p',time:13,dir:'in',text:'别的账号'},...Array.from({length:10},(_,i)=>({chat:'private:1',accountId:'a',personaId:'p',time:i+2,dir:'out',text:'回复'}))];assert(recentOperationContext(rows,{key:'private:1',accountId:'a',personaId:'p',now:100}).every(r=>r.role==='assistant'));
});
test('file transport selects the actual private/group upload API and keeps caption separate',()=>{
 const job={kind:'private',chatId:'12345',segments:[{type:'file',data:{file:'song.wav',sha256:'hash'}}]},verify=()=>({file:'song.wav',sha256:'hash'});assert.equal(prepareQqFileUpload(job,verify).action,'upload_private_file');assert.equal(prepareQqFileUpload({...job,kind:'group'},verify).action,'upload_group_file');assert.equal(prepareQqFileUpload({...job,segments:[{type:'image'}]},verify),null);assert.throws(()=>prepareQqFileUpload({...job,segments:[...job.segments,{type:'text',data:{text:'hi'}}]},verify));assert.throws(()=>prepareQqFileUpload(job,()=>({file:'song.wav',sha256:'changed'})));assert.equal(fileUploadAccepted({file_id:'f'},'upload_private_file').read,'unknown');
});
test('native file capability remains unknown while queued, not falsely platform-supported or delivered',async()=>{
 const c={accountId:'a',personaId:'p',key:'private:12345',kind:'private',chatId:'12345',userId:'12345'};const api=createQqNativeCapabilities({request:async()=>({status:'ok',data:{queued:true,deliveryId:'outbox'}}),allowedUsers:()=>['12345'],isOwner:()=>true});assert(api.catalog(c).some(r=>r.action==='upload_private_file'));const result=await api.call({action:'upload_private_file',params:{user_id:'12345',file:'song.wav',name:'song.wav'}},c);assert(result.ok);assert.equal(result.verified,false);assert.equal(api.catalog(c).find(r=>r.action==='upload_private_file').status,'unknown');assert.equal((await api.call({action:'upload_private_file',params:{user_id:'99999',file:'song.wav',name:'song.wav'}},c)).ok,false);
});
const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');
import {bindQueuedSenders,queuedDeliverySelection} from '../delivery-outbox.js';
test('legacy outbox binds the actual originating QQ and cannot starve the next receiver',()=>{
 const state={audits:[{id:'audit',accountId:'p',chat:'private:123',inboundIds:['17']}],
   inbox:[{id:'10001:private:123:17',accountId:'p',key:'private:123',receivedIds:['17']}],
   outbox:['audit','',''].map((auditId,i)=>({id:String(i),chat:'private:123',accountId:'p',status:'queued',auditId}))};
 state.outbox[2].qqSenderId='20002';
 assert.equal(bindQueuedSenders(state,'p','',''),true);
 assert.equal(state.outbox[0].qqSenderId,'10001');
 assert.equal(state.outbox[1].status,'failed');
 assert.equal(queuedDeliverySelection(state.outbox,100,{qqSenderId:'20002',qqAccountId:'p'}).job.id,'2');
 assert.equal(queuedDeliverySelection(state.outbox,100,{qqSenderId:'10001',qqAccountId:'p'}).job.id,'0');
});
function outbox({fail=false,persist=true,mutated=false,verified=true,changeDuringWait=false}={}){
 const start=source.indexOf('  async function flushOutbox()'),end=source.indexOf('  function cancelFeatureWork(',start);const calls=[],job={id:'j',status:'queued',kind:'private',chatId:'12345',chat:'private:12345',accountId:'a',personaId:'p',attempts:0,segments:[{type:'file',data:{file:'song.wav',sha256:'hash'}}]};
 const deps={outboxRunning:false,stopped:false,accountPaused:false,socket:{ready:true},outboxWakeTimer:null,clearTimeout,queuedDeliverySelection:()=>({job:job.status==='queued'?job:null}),featureState:{outbox:[job]},outgoingJobDenial:()=>'',guardDelay:()=>0,outboundWait:()=>{},lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),prepareQqFileUpload,verifiedSharedFile:()=>({file:'song.wav',sha256:mutated?'changed':'hash'}),outgoingImageSegments:()=>{throw Error('must use upload API')},saveFeatures:()=>persist,logDelivery:()=>{},guardState:{lastSendAt:0,windowCount:0},request:async(name,params)=>{calls.push({name,params});if(fail)throw Object.assign(Error(fail==='hard'?'平台拒绝':'超时'),{submitted:true,deliveryUnknown:fail!=='hard'});return {file_id:'file-1'};},qqActionResult:()=>({}),fileUploadAccepted,auditById:()=>null,knownUnsentRetry:()=>null,calendarSafeText:s=>s,noteDeliveryIssue:()=>{},armDeliveryVerification:()=>{},armOutboxWake:()=>{}};
 deps.socket.qqSenderId=verified?'10001':'';deps.socket.qqAccountId='a';deps.socket.qqReceiverRevision=1;
 deps.settings={activeAccountId:'a'};job.qqSenderId='10001';
 if(changeDuringWait){deps.guardDelay=()=>1;deps.outboundWait=async()=>{deps.socket.qqSenderId='20002';deps.socket.qqReceiverRevision++;};}
 const guards={sent:0,failed:0};deps.guardSent=()=>{guards.sent++;};deps.guardFailed=()=>{guards.failed++;};
 const run=new Function(...Object.keys(deps),source.slice(start,end)+';return flushOutbox;')(...Object.values(deps));return {run,job,calls,socket:deps.socket,guards};
}
test('socket readiness alone cannot submit a persisted upload; confirming the expected QQ resumes it',async()=>{
 const h=outbox({verified:false});await h.run();assert.equal(h.calls.length,0);assert.equal(h.job.status,'queued');
 h.socket.qqSenderId='10001';await h.run();assert.equal(h.calls.length,1);assert.equal(h.job.status,'sent');
});
test('changing login while waiting for the send guard does not transfer a previous account message',async()=>{
 const h=outbox({changeDuringWait:true});await h.run();assert.equal(h.calls.length,0);assert.equal(h.job.status,'queued');
});
test('actual persistent outbox submits an upload once and records accepted without claiming read',async()=>{
 const h=outbox();await h.run();assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'upload_private_file');assert.equal(h.job.uploadReceipt.fileId,'file-1');assert.equal(h.job.verification.state,'unconfirmed');assert.equal(h.job.verification.read,'unknown');
});
test('sending guard sees successful receipts only and failed attempts do not reset the failure streak',async()=>{
 const sent=outbox();await sent.run();assert.deepEqual(sent.guards,{sent:1,failed:0});
 const unknown=outbox({fail:true});await unknown.run();assert.deepEqual(unknown.guards,{sent:0,failed:0});
 const failed=outbox({fail:'hard'});await failed.run();assert.deepEqual(failed.guards,{sent:0,failed:1});
 // A local validation failure occurs before dispatch and remains a failed job.
 const invalid=outbox({mutated:true});await invalid.run();assert.equal(invalid.guards.sent,0);
});
test('file upload timeout is unknown, never automatically resubmitted; changed file or storage failure sends nothing',async()=>{
 const h=outbox({fail:true});await h.run();assert.equal(h.calls.length,1);assert.equal(h.job.status,'unknown');for(const options of [{persist:false},{mutated:true}]){const f=outbox(options);await f.run();assert.equal(f.calls.length,0);assert.equal(f.job.status,'failed');}
});
test('actual artifact file share queues original audio and dialogue once, not a download-folder fallback',async()=>{
 const existing=fs.readFileSync(new URL('./sharing-dialogue.test.js',import.meta.url),'utf8').replace(/\r\n/g,'\n');let body=existing.slice(existing.indexOf('function shareFixture('),existing.indexOf("test('actual native image sharing prepares"));body=body.replace('const deps={',"const deps={audioDeliveryKind,verifiedSharedFile:()=>({file,sha256:'hash',bytes:1200}),socialReplyForChat:async()=> '这段想给你先听听。',").replace("const file='fixture.png'","const file='fixture.mp3'").replace("Buffer.from('89504e470d0a1a0a00','hex')","Buffer.from('ID3'+'.'.repeat(1200))");
 const make=new Function('source','assert','crypto','naturalBubbleParts','audioDeliveryKind',body+';return shareFixture;')(source,assert,crypto,naturalBubbleParts,audioDeliveryKind),f=make({audio:true});assert((await f.callback({action:'send',file:f.file,delivery:'file'},f.context)).ok);assert.equal(f.sent[0].segments[0].type,'file');assert.equal(f.sent[0].segments[0].data.sha256,'test');assert.equal(f.sent[1].segments[0].data.text,'这段想给你先听听。');await f.callback({action:'send',file:f.file,delivery:'file'},f.context);assert.equal(f.sent.length,2);const voice=make({audio:true});assert((await voice.callback({action:'send',file:voice.file},voice.context)).ok);assert.equal(voice.sent[0].segments[0].type,'record');assert.equal(voice.sent[0].segments[0].data.file,voice.file);assert((await voice.callback({action:'send',file:voice.file,delivery:'file'},voice.context)).ok);assert.equal(voice.sent[2].segments[0].type,'file');
});

test('standalone music-making recap is covered even when numbers are written as Chinese words',()=>{
 assert(socialRewriteNeeded('它八个音全是往下滑的，一声都没往上爬。'));assert(socialRewriteNeeded('第五声沉得差点碰到底，加了鼓点之后反倒不那么丧了。'));assert(!socialRewriteNeeded('第五声沉得差点碰到底。',{request:'详细分析第五声的处理'}));
});

test('a nickname and invitation cannot disguise production recap as social sharing',async()=>{
 for(const text of ['爸爸，接缝磨了半天，现在听着一口气不断，你想听吗？','爸爸，它八个音全往下滑，第五声沉得快碰底，你要不要听？']){
  assert(socialRewriteNeeded(text));await assert.rejects(socialShareReply(technical,{ask:async()=>text}),e=>e.code==='SHARING_STYLE_REQUIRED');
 }
 assert(!socialRewriteNeeded('刚才那张图先记着，换我给你听点东西，这段有点像躲在海底偷懒。'));
});
