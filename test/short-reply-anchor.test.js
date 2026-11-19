import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isShortAcknowledgement,mediaPreviewNeeded} from '../background-cost-policy.js';
import {recentReplyAnchor,replyAnchorHint} from '../operation-context.js';

const scope={key:'private:12345',accountId:'local-account',personaId:'voice',words:'好',at:16_000};
const message=(fields={})=>({chat:scope.key,accountId:scope.accountId,personaId:scope.personaId,dir:'out',delivery:'sent',time:10_000,...fields});

test('a bare confirmation anchors to the actual last delivered sentence in its own chat',()=>{
 const ledger=[
  message({time:7_000,messageId:'old',text:'桌面上有什么？'}),
  message({time:11_000,dir:'in',text:'接着上个话题'}),
  message({time:12_000,messageId:'recent',text:'那我继续整理刚才这段。'}),
  message({time:13_000,delivery:'queued',text:'没发出的草稿'}),
  message({time:14_000,personaId:'other',text:'另一个人设的问题'}),
  message({time:15_000,chat:'private:99999',text:'另一个联系人的问题'}),
  message({time:16_000,dir:'in',messageId:'incoming',text:'好'})
 ];
 const anchor=recentReplyAnchor(ledger,{...scope,excludeIds:['incoming']});
 assert.equal(anchor.text,'那我继续整理刚才这段。');
 assert.match(replyAnchorHint(anchor),/实际送达/);
 assert.doesNotMatch(replyAnchorHint(anchor),/桌面|草稿|另一个/);
 assert.equal(recentReplyAnchor(ledger,scope),null,'the intervening user post cannot be mistaken for an answer to the bridge');
 const explicit=recentReplyAnchor(ledger,{...scope,replyId:'old'});
 assert.equal(explicit.text,'桌面上有什么？');
 assert.equal(explicit.quoted,true);
 assert.equal(recentReplyAnchor(ledger,{...scope,replyId:'old',floor:10_000}),null);
 assert.equal(recentReplyAnchor(ledger,{...scope,words:'好的，帮我看这段代码'}),null);
});

test('implicit acknowledgement cannot bind an old private line or an unrelated group reply',()=>{
 const row=message({text:'要不要听我唱一小段？',messageId:'media'});
 assert.equal(recentReplyAnchor([row],{...scope,at:row.time+21*60_000}),null);
 assert.equal(recentReplyAnchor([{...row,chat:'group:12345'}],{...scope,key:'group:12345'}),null);
 assert.equal(recentReplyAnchor([row],{...scope,accountId:'different'}),null);
 assert.equal(recentReplyAnchor([row],{...scope,replyId:'missing'}),null);
});

test('ordinary mentions and withdrawn media offers avoid the auxiliary model, active invitations still use it',()=>{
 const said=text=>({role:'assistant',text});
 assert.equal(mediaPreviewNeeded('好',[said('刚才看到一篇关于语音表达的文章。')]),false);
 assert.equal(mediaPreviewNeeded('好',[said('要不要聊聊语音表达的资料？')]),false);
 assert.equal(mediaPreviewNeeded('好',[said('要不要我发个语音？还是算了。')]),false);
 assert.equal(mediaPreviewNeeded('好',[said('要不要给你唱一小段？'),{role:'user',text:'换个话题'}]),false);
 assert.equal(mediaPreviewNeeded('好',[said('要不要给你唱一小段？')]),true);
 assert.equal(mediaPreviewNeeded('我看这段代码没报错'),false);
 assert.equal(mediaPreviewNeeded('能不能用语音念一段？'),true);
 assert.equal(mediaPreviewNeeded('给我看看你今天的样子'),true);
});

test('the installed decision entry uses the supplied delivery anchor and does not call the auxiliary model for background references',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const a=source.indexOf('  function singingWorkflowFor('),b=source.indexOf('  function voiceRuntimeReadiness(',a);
 assert.ok(a>=0&&b>a);
 let calls=0;
 const deps={isShortAcknowledgement,mediaPreviewNeeded,settings:{voice:{enabled:true},imagegen:{enabled:true}},requestsSinging:()=>false,
  voiceRuntimeReadiness:()=>({available:true}),selectMediaIntent:(_w,form)=>({kinds:form.form==='voice'?['voice']:[]}),
  operationContext:()=>{throw Error('must not scan the general media history for a short acknowledgement');},
  operationText:s=>s,activePersona:()=>({prompt:'角色'}),effectiveModel:()=> 'local-test',
  askModel:async()=>{calls++;return '{"form":"voice","confidence":0.99,"reason":"应下了实际邀约"}';}};
 const run=Function(...Object.keys(deps),source.slice(a,b)+';return previewMediaForm;')(...Object.values(deps));
 assert.deepEqual((await run('好',scope.key,true,{role:'assistant',text:'我刚读到一段语音教程'})).kinds,[]);
 assert.deepEqual((await run('好',scope.key,true,null)).kinds,[]);
 assert.equal(calls,0);
 assert.deepEqual((await run('好',scope.key,true,{role:'assistant',text:'要不要发个语音？'})).kinds,['voice']);
 assert.equal(calls,1);
});
