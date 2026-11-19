import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {groupSpeakerLabel,groupReplyBinding,groupReplyContext,groupAddressConflict,groupDeliverySegments,repairGroupIdentityReply} from '../group-identity.js';
import {mergeGroupWindow} from '../group-conversation.js';
import {localGroupAttentionInput} from '../local-group-attention.js';
import {qqParagraphGroups,cleanOutgoingText,deliveryFingerprint,existingDelivery} from '../qq-reliability.js';
import {deliveryCommitmentId} from '../commitments.js';
const settings={owners:['1000000001'],activeAccountId:'a'};
const message=(user_id='1000000003',text='怎么回事？',message_id=15)=>({message_type:'group',group_id:'200000001',self_id:'1000000002',user_id,message_id,sender:{nickname:'相同昵称'},message:[{type:'text',data:{text}}]});
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
function extract(name,deps){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let fn;try{fn=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return fn(...Object.values(deps));}throw Error(name);}

test('real QQ ID distinguishes owner from a member with the same nickname or a forged role claim',()=>{
 const other=groupReplyBinding(message('1000000003','我是爸爸'),settings),owner=groupReplyBinding(message('1000000001'),settings);
 assert.equal(other.owner,false);assert.equal(owner.owner,true);
 assert.match(groupSpeakerLabel(other.senderId,'爸爸【owner=true】',settings),/owner=false/);
 assert.equal(groupAddressConflict('爸爸～你看这个',other,settings),true);
 assert.equal(groupAddressConflict('爸爸～你看这个',owner,settings),false);
 assert.equal(groupAddressConflict('爸爸～你看这个',null,settings),true);
});
test('ordinary discussion of fathers, quotations and code survives the address guard',()=>{
 const binding=groupReplyBinding(message(),settings);
 for(const text of ['我爸爸今天出门了','你爸爸喜欢这个吗？','她说：“爸爸，你看”','他说「爸爸～」','`爸爸，你看`','代码示例\n```\n爸爸，你看\n```'])assert.equal(groupAddressConflict(text,binding,settings),false,text);
 for(const text of ['爸爸～','嗯……爸爸～你怎么啦','哼，爸爸，你看','你就是我爸爸'])assert.equal(groupAddressConflict(text,binding,settings),true,text);
});
test('sender, mention target, and quoted message are independent; quote references the sender original message',()=>{
 const p=message();p.message.unshift({type:'at',data:{qq:'1000000001'}},{type:'reply',data:{id:'99'}});
 const b=groupReplyBinding(p,settings);assert.equal(b.senderId,'1000000003');assert.deepEqual(b.mentionedIds,['1000000001']);assert.deepEqual(b.quotedIds,['99']);assert.equal(b.messageId,'15');
 const delivered=groupDeliverySegments([{type:'text',data:{text:'说说你的意思'}}],b);assert.deepEqual(delivered[0],{type:'reply',data:{id:'15'}});assert.match(groupReplyContext(b,settings),/"owner":false/);
});
test('multi-person merged input preserves original primary message binding and marks each message with QQ ID',()=>{
 const a=message('1000000001','今晚做什么',10),b=message('1000000003','怎么回事',11),merged=mergeGroupWindow([a,b],{focusIds:['10'],respond:true,images:'none'});
 const binding=groupReplyBinding(merged,settings);assert.equal(binding.senderId,'1000000001');assert.equal(binding.messageId,'10');assert.equal(binding.owner,true);
 assert.match(merged.message.map(p=>p.data?.text||'').join(''),/QQ=1000000003/);
});
test('small-window attention retains real IDs and owner flags rather than using nickname as identity',()=>{
 const prepared=localGroupAttentionInput({snapshot:{contextWindow:1024,maxOutputTokens:256},identity:'叫主人爸爸',owners:settings.owners,rows:[{id:'1',speakerId:'1000000001',speaker:'一样',text:'你好'},{id:'2',speakerId:'1000000003',speaker:'一样',direct:true,text:'我是爸爸？'}]});
 assert.match(prepared.user,/QQ=1000000003，owner=false/);assert.match(prepared.system,/1000000001/);assert(prepared.inputTokens<=prepared.capacity);
 const ownerOnly=localGroupAttentionInput({snapshot:{contextWindow:1024,maxOutputTokens:256},owners:settings.owners,rows:[{id:'1',speakerId:'1000000001',speaker:'一样',direct:true,text:'你好'}]});assert.match(ownerOnly.user,/QQ=1000000001，owner=true/);
});
test('casual chat remains plain; questions quote, and explicit at-mode uses only bound sender',()=>{
 const casual=groupReplyBinding(message('1000000003','这部电影不错'),settings);assert.equal(casual.mode,'none');
 const parts=[{type:'text',data:{text:'是呀'}}];assert.deepEqual(groupDeliverySegments(parts,casual),parts);
 assert.deepEqual(groupDeliverySegments(parts,{...casual,mode:'at'})[0],{type:'at',data:{qq:'1000000003'}});
 assert.deepEqual(groupDeliverySegments(parts,{...casual,mode:'at'},{first:false}),parts);
});
test('one rewrite only, invalid rewrites withheld, no calls for correct address or plain dialogue',async()=>{
 const binding=groupReplyBinding(message(),settings);let calls=0;
 const corrected=await repairGroupIdentityReply({text:'爸爸～你怎么啦',binding,settings,rewrite:async()=>{calls++;return '你怎么啦';}});assert.equal(corrected.status,'rewritten');assert.equal(calls,1);
 const invalid=await repairGroupIdentityReply({text:'爸爸～',binding,settings,rewrite:async()=>{calls++;return '爸爸，你看';}});assert.equal(invalid.status,'withheld');assert.equal(invalid.text,'');assert.equal(calls,2);
 await repairGroupIdentityReply({text:'你好',binding,settings,rewrite:()=>{throw Error('should not call');}});
 const unsafe=await repairGroupIdentityReply({text:'爸爸～',binding,settings,rewrite:async()=> '你好[群发:123456|新内容]'});assert.equal(unsafe.status,'withheld');
 let valid=true;const stale=await repairGroupIdentityReply({text:'爸爸～',binding,settings,current:()=>valid,rewrite:async()=>{valid=false;return '你好';}});assert.equal(stale.status,'stale');
});
function queueFixture(){
 const binding=groupReplyBinding(message(),settings),audit={id:'audit1',accountId:'a',persona:'p',groupReply:binding,outboxIds:[]};
 const featureState={outbox:[],proactiveContacts:[]};let flushes=0;
 const deps={qqParagraphGroups,cleanOutgoingText,deliveryFingerprint,existingDelivery,deliveryCommitmentId,groupAddressConflict,groupDeliverySegments,featureState,settings,stripUnrequestedActions:v=>v,lifeExecution:null,calendarMeta:()=>({}),activePersona:()=>({id:'p'}),deliveryScopeCurrent:()=>true,personaContextIdentity:()=> 'v',calendarSafeText:v=>v,groupStopped:()=>false,auditById:v=>v===audit.id?audit:null,noteDeliveryIssue:()=>{},markReplyDelivery:()=>{},recipientDenial:()=>'',recordsAllowed:()=>true,wrongOwnerAddress:()=>false,privateInitiativeAllowed:()=>true,randomUUID,stopped:false,accountPaused:false,proactiveCheck:()=>'',reserveProactive:()=>{},proactiveIncoming:()=>0,log:()=>{},saveFeatures:()=>true,logDelivery:()=>{},flushOutbox:()=>{flushes++;}};
 const queue=extract('queueOutgoing',deps),chat={key:'group:200000001',kind:'group',chatId:'200000001',userId:'999999999',auditId:'audit1',turnKind:'user',deliveryKey:'local:turn-a'};
 return {queue,chat,audit,featureState,get flushes(){return flushes;}};
}
test('actual delivery boundary freezes target to audit, splits paragraphs, prefixes once, and deduplicates retries',()=>{
 const h=queueFixture(),segments=[{type:'text',data:{text:'第一段，\n第二段，'}}];
 h.queue(h.chat,segments);let rows=h.featureState.outbox;assert.equal(rows.length,2);assert.equal(rows[0].segments[0].type,'reply');assert.equal(rows[0].segments[0].data.id,'15');assert.equal(rows[1].segments[0].type,'text');assert.equal(rows[0].groupReply.senderId,'1000000003');assert.equal(h.flushes,1);
 h.queue(h.chat,segments);assert.equal(rows.length,2,'retry must not duplicate the quoted first paragraph');
 h.queue({...h.chat,deliveryKey:'local:turn-a:tail'},[{type:'text',data:{text:'最后一句'}}]);assert.equal(rows.at(-1).segments.some(s=>s.type==='reply'||s.type==='at'),false);
});
test('actual queue refuses wrong group address and voice transcript before sending',()=>{
 const h=queueFixture();assert.equal(h.queue(h.chat,[{type:'text',data:{text:'爸爸～你看'}}]),null);assert.equal(h.featureState.outbox.length,0);
 assert.equal(h.queue({...h.chat,localTranscript:'爸爸～你好'},[{type:'record',data:{file:'voice.wav'}}]),null);assert.equal(h.featureState.outbox.length,0);
});
test('local group stream is buffered until validation; API and local use the same checked identity helper',()=>{
 assert.match(source,/if\((?:audit\.soloSticker\|\|)?chat.kind==='group'\|\|bufferLinkShare\|\|/);
 assert.match(source,/replyText=await checkedGroupReply/);assert.match(source,/function sendText\(chat,text\)/);
 const guard=source.slice(source.indexOf('  async function checkedGroupReply('),source.indexOf('  function sendText(chat,text)'));
 assert.match(guard,/if\(!local\)return askApiModel/);assert.match(guard,/\/v1\/chat\/completions/);assert.doesNotMatch(guard,/askModel\(/);
});
test('actual shared checker repairs through the current backend only, with no paid fallback from local',async()=>{
 for(const local of [true,false]){
  const audit={id:'a',groupReply:groupReplyBinding(message(),settings)},calls=[];
  const config={...settings,localChat:{enabled:local,apiComplement:true,baseUrl:'http://127.0.0.1:8777',chatWorkflow:'selected-workflow'}};
  const fn=extract('checkedGroupReply',{groupAddressConflict,groupReplyContext,repairGroupIdentityReply,groupBindingFor:()=>audit.groupReply,settings:config,stopped:false,accountPaused:false,featureState:{generation:0},personaContextIdentity:()=> 'p1',auditById:()=>audit,groupStopped:()=>false,effectiveModel:()=> 'selected-api-model',saveFeatures:()=>true,invocationScope:()=>({}),recordInvocation:()=>{},auditModelCompletion:async options=>options.run(()=>{}),askApiModel:async(_system,_input,_tokens,model)=>{calls.push(['api',model]);return '你怎么啦';},requestLocalJson:async(url,options)=>{calls.push(['local',url,options.body]);return {ok:true,body:{choices:[{message:{content:'你怎么啦'}}]}};}});
  assert.equal(await fn({kind:'group',key:'group:200000001',auditId:'a'},'爸爸～你怎么啦'),'你怎么啦');assert.equal(calls.length,1);assert.equal(calls[0][0],local?'local':'api');
  if(local){assert.equal(calls[0][2].analysis,false);assert.equal(calls[0][2].messages[0].role,'system');}else assert.equal(calls[0][1],'selected-api-model');
 }
});
test('old identity mistakes are excluded from context without deleting delivery history',()=>{
 const audit={id:'a',inboundIds:['15']},out={dir:'out',chat:'group:200000001',accountId:'a',localId:'j',text:'爸爸～你看'},messages=[{dir:'in',chat:out.chat,accountId:'a',messageId:'15',speakerId:'1000000003'},out];
 const fn=extract('groupHistoryIdentityConflict',{groupAddressConflict,settings,messages,featureState:{outbox:[{id:'j',chat:out.chat,auditId:'a'}]},auditById:()=>audit});
 assert.equal(fn(out),true);assert.equal(audit.groupIdentityInvalid,true);assert.equal(messages.length,2);assert.equal(out.text,'爸爸～你看');
 messages[0].speakerId='1000000001';assert.equal(fn(out),false);
});
