import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {API_CONTEXT_REVISION,summarySourceKey,planConversationSummary,apiContextRotation,conversationHistory,conversationSeed,checkedConversationSummary,qqRecallTarget} from '../api-conversation-context.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const ready={turns:new Map(),pendingTurns:[]};
test('handoff uses QQ event order, distinguishes forwarded material, and leaves transient notices out',()=>{
 const scope={key:'private:1',accountId:'a',personaId:'p',now:100,excludeIds:['91']};
 const row=(time,text,extra={})=>({chat:scope.key,accountId:'a',personaId:'p',time,dir:'in',text,...extra});
 const history=conversationHistory([
   row(25,'替我看看\n[转发] 我保证周一给你',{userText:'替我看看'}),
   row(30,'排队中',{dir:'out',delivery:'sent',deliveryRole:'progress'}),
   row(27,'已撤回的想法',{retracted:true}),row(50,'当前批消息',{messageId:'90',sourceMessageIds:['90','91']}),
   row(20,'离线时发的第一句'),row(101,'时钟偏到将来'),row(26,'[转发] 朋友自己的话',{userText:''})
 ],scope);
 assert.deepEqual(history.recent.map(r=>r.at),[20,25,26]);
 assert.match(history.recent[1].text,/^替我看看\n【QQ附带资料】\n\[转发\]/);
 assert.match(history.recent[2].text,/^【QQ附带资料】/);
});
test('old oversized history rotates even above the former 100 percent cutoff; an active turn never rotates',()=>{const rec={sessionId:'old',contextTokens:360000};assert.equal(apiContextRotation(rec,ready).rotate,true);assert.equal(apiContextRotation(rec,{...ready,turns:new Map([['task',{}]])},{force:true}).rotate,false);assert.equal(apiContextRotation(rec,{...ready,pendingTurns:[{}]}).rotate,false);});
test('warm short chats do not rotate at eight turns or merely reaching forty turns',()=>{
 const rec={sessionId:'s',contextPolicyVersion:API_CONTEXT_REVISION,contextBaseTokens:35000,contextTokens:45000,contextTurns:8};
 assert.equal(apiContextRotation(rec,ready).rotate,false);
 assert.equal(apiContextRotation({...rec,contextTurns:40},ready).rotate,false);
 assert.equal(apiContextRotation({...rec,contextTokens:65000,contextTurns:24},ready).rotate,true);
 assert.equal(apiContextRotation({...rec,contextTokens:65000,contextTurns:23},ready).rotate,false);
 assert.equal(apiContextRotation({...rec,contextTokens:77425,contextTurns:5},ready).rotate,false);
 assert.equal(apiContextRotation({...rec,contextTokens:110000,contextTurns:5},ready).rotate,true,'large tool output must still respect capacity');
 assert.equal(apiContextRotation(rec,ready,{force:true}).rotate,true);
 assert.equal(apiContextRotation({...rec,contextTokens:30000},ready,{windowTokens:32000}).rotate,true,'an explicitly smaller context window remains authoritative');
});
test('handoff keeps recent original messages apart from older sources, with account/persona and clear boundaries',()=>{const rows=Array.from({length:80},(_,i)=>({chat:'private:1',accountId:'a',personaId:'p',messageId:String(i),time:i+1,dir:i%2?'out':'in',text:'原话'+i}));rows.push({...rows[0],accountId:'other',text:'SECRET'}, {...rows[0],personaId:'other',text:'FOREIGN'});const h=conversationHistory(rows,{key:'private:1',accountId:'a',personaId:'p',floor:10,excludeIds:['79']});assert.equal(h.recent.length,24);assert.equal(h.recent.at(-1).text,'原话78');assert(h.older.every(r=>r.at>10&&r.at<h.recent[0].at));assert(!JSON.stringify(h).includes('SECRET'));assert(!JSON.stringify(h).includes('FOREIGN'));assert(conversationSeed({items:[{text:'未完成约定'}]},h.recent).includes('未完成约定'));});
test('invalid summary references fall back to real excerpts, rather than inventing a bridge memory',()=>{const rows=[{id:'s1',speaker:'甲',at:1,text:'还没做完，等你有空继续'}];const summary=checkedConversationSummary('{"items":[{"text":"已经完成付款","sourceIds":["fake"]}]}',rows);assert.equal(summary.method,'local-excerpts');assert(!JSON.stringify(summary).includes('已经完成付款'));assert(JSON.stringify(summary).includes('还没做完'));});
test('handoff summarizes only appended evidence, and rejects prior summaries after an edit or clear',()=>{
 const rows=Array.from({length:20},(_,i)=>({id:'s'+(i+1),at:i+1,role:i%2?'user':'assistant',speaker:'当前联系人',text:'这是第 '+i+' 条原始记录。'.repeat(16)}));
 const covered=rows.slice(0,18);
 const previous={method:'evidence-summary',sourceKey:summarySourceKey(covered),coveredSourceCount:18,items:[{text:'仍需跟进一个未完成约定',sourceIds:['s2']}]};
 const plan=planConversationSummary(rows,previous);
 assert.deepEqual(plan.sources.map(row=>row.id),['prior','s19','s20']);
 assert.strictEqual(planConversationSummary(covered,previous).reuse,true);
 assert.ok(JSON.stringify(plan.sources).length<JSON.stringify(rows).length/3);
 const checked=checkedConversationSummary(JSON.stringify({items:[{text:'既有约定仍有效',sourceIds:['prior']},{text:'新证据',sourceIds:['s19']}]}),plan.rows,plan.prior,{allowPrior:true});
 assert.equal(checked.items.length,2);
 assert.equal(planConversationSummary([{...rows[0],text:'对方明确纠正了原话'},...rows.slice(1)],previous).prior,undefined);
 assert.equal(planConversationSummary(rows.slice(9),previous).prior,undefined);
});
function extract(name,deps){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0);for(let end=source.indexOf('}',start);end>=0;end=source.indexOf('}',end+1)){let factory;try{factory=Function(...Object.keys(deps),'return ('+source.slice(start,end+1)+');');}catch(e){if(e instanceof SyntaxError)continue;throw e;}return factory(...Object.values(deps));}throw Error(name);}
function fixture(){let summaryCalls=0,newSessions=0,stamp='v';const old={sessionId:'old',contextTokens:300000,preset:'p',workspace:'/chat',owner:true},live={...ready,sessionId:'old'},state={chats:{'private:1':old}},chats=new Map([['old',live]]);const rows=Array.from({length:45},(_,i)=>({chat:'private:1',accountId:'a',personaId:'p',time:i+1,dir:i%2?'out':'in',text:'接续话题'+i,messageId:String(i)}));const deps={contextHandoffs:new Map(),settings:{memory:{enabled:true},activeAccountId:'a',owners:['1']},apiInvocationAllowed:()=>true,state,chats,apiContextRotation,conversationHistory,checkedConversationSummary,fallbackConversationSummary:(r,p)=>checkedConversationSummary('invalid',r,p),CONTEXT_SUMMARY_RULE:'test',planConversationSummary,API_CONTEXT_REVISION,conversationContextStamp:()=>stamp,activePersona:()=>({id:'p'}),chatWorkspace:()=>'/chat',stopped:false,accountPaused:false,messages:rows,featureState:{floors:{}},memories:{},askModel:async()=>{summaryCalls++;return '{"items":[{"text":"话题仍在继续","sourceIds":["s1"]}]}';},effectiveModel:()=>({}),log:()=>{},clearSilenceTimer:()=>{},clearAfterTimer:()=>{},noteEvent:()=>{},randomUUID:()=> 'id',recordInvocation:()=>{},invocationScope:()=>({}),ensureSession:async(chat,opts)=>{assert.equal(state.chats[chat.key],old);assert(opts.validate());newSessions++;state.chats[chat.key]={sessionId:'new',contextSummary:opts.handoff};return 'new';},attachChat:(id,chat)=>chats.set(id,chat),cleanupPreviousConversation:async()=>{}};return {run:extract('rotateApiConversation',deps),deps,state,chats,old,live,get summaryCalls(){return summaryCalls;},get newSessions(){return newSessions;},change(){stamp='new';}};}
test('actual host handoff swaps mapping after summary, retains originals, and retires only the idle old session',async()=>{const f=fixture();assert.equal(await f.run({key:'private:1',chatId:'1',kind:'private'}),'new');assert.equal(f.newSessions,1);assert.equal(f.summaryCalls,1);assert.equal(f.state.chats['private:1'].contextSummary.items[0].text,'话题仍在继续');assert.equal(f.deps.messages.length,45);assert.equal(f.live.backendRetired,true);assert.equal(f.chats.has('old'),false);});
test('scope changes during summarization keep the original mapping and do not create a new session',async()=>{const f=fixture();f.deps.askModel=async()=>{f.change();return '{}';};const run=extract('rotateApiConversation',f.deps);assert.equal(await run({key:'private:1',chatId:'1',kind:'private'}),null);assert.equal(f.newSessions,0);assert.equal(f.state.chats['private:1'],f.old);});

test('handoff reuses a successful unchanged source set, including speaker and time',async()=>{
 const initial=fixture();await initial.run({key:'private:1',chatId:'1',kind:'private'});
 const known=initial.state.chats['private:1'].contextSummary;
 const f=fixture();f.old.contextSummary=known;
 await f.run({key:'private:1',chatId:'1',kind:'private'});
 assert.equal(f.summaryCalls,0);assert.deepEqual(f.state.chats['private:1'].contextSummary.items,known.items);
 assert.notEqual(summarySourceKey([{speaker:'我',at:1,text:'收到'}]),summarySourceKey([{speaker:'你',at:1,text:'收到'}]));
});

test('withdrawals stay out of recent lines, older evidence and restored summaries',()=>{
 const rows=Array.from({length:36},(_,i)=>({chat:'private:12345',accountId:'a',personaId:'p',dir:'in',messageId:String(10+i),time:i+1,text:'旧消息'+i}));
 const scope={key:'private:12345',accountId:'a',personaId:'p'};
 rows[1].text='已撤回的起点';rows[34].text='已撤回的终点';rows[35].text='更正为周日下午';
 const before=conversationHistory(rows,scope);
 const previous={items:[{text:'旧摘要写入已撤回的起点',sourceIds:['s2']}],method:'evidence-summary',coveredSourceCount:before.older.length,sourceKey:summarySourceKey(before.older)};
 assert.match(conversationSeed(previous,before.recent,before.older),/旧摘要/);
 rows[1].retracted=true;rows[34].retracted=true;
 const after=conversationHistory(rows,scope),seed=conversationSeed(previous,after.recent,after.older);
 assert.match(seed,/更正为周日下午/);assert.doesNotMatch(seed,/已撤回|旧摘要/);
 const plan=planConversationSummary(after.older,previous);
 assert.equal(plan.reuse,false);assert.equal(plan.prior,undefined);assert.doesNotMatch(JSON.stringify(plan.sources),/已撤回/);
});

test('QQ recall routes and ledger updates isolate account and chat, including a delayed combined input',()=>{
 const key='private:12345',selfId='67890',event={post_type:'notice',notice_type:'friend_recall',self_id:selfId,user_id:'12345',message_id:-73};
 assert.deepEqual(qqRecallTarget(event,selfId),{key,id:'-73'});
 assert.deepEqual(qqRecallTarget({...event,notice_type:'group_recall',group_id:'12345'},selfId),{key:'group:12345',id:'-73'});
 for(const change of [{self_id:'88888'},{user_id:selfId},{message_id:0},{post_type:'message'}])assert.equal(qqRecallTarget({...event,...change},selfId),null);
 const original={chat:key,accountId:'a',personaId:'p',dir:'in',messageId:'-71',sourceMessageIds:['-71','-73'],text:'两句合并的原话'};
 const deps={settings:{activeAccountId:'a'},recordsStored:()=>true,recordsAllowed:()=>true,activePersona:()=>({id:'p'}),messages:[original,{...original,accountId:'b'},{...original,chat:'group:12345'}],state:{chats:{[key]:{sessionId:'s',preset:'p'}}},sessionDigests:new Map([['s','旧预载']]),recentWithdrawals:new Set(),withdrawalKey:(a,k,id)=>JSON.stringify([a,k,String(id)]),pruneMonitor:()=>{},recordCalendarRow:()=>{},log:()=>{}};
 deps.messageHistory={putMany:()=>{},recall:()=>{}};deps.messageKey=r=>JSON.stringify([r.accountId,r.chat,r.messageId]);
 const mark=extract('markQqWithdrawal',deps);mark(key,'b','-73');assert.equal(original.retracted,undefined);
 mark(key,'a','-73');mark(key,'a','-73');
 assert.deepEqual(deps.messages.map(r=>!!r.retracted),[true,false,false]);assert.equal(deps.state.chats[key].recallRevision,1);assert.equal(deps.sessionDigests.has('s'),false);
 const record=extract('logMessage',deps);mark(key,'a','-99');record({chat:key,dir:'in',messageId:'-98',sourceMessageIds:['-98','-99'],text:'通知先于合并写入'});
 assert.equal(deps.messages.at(-1).retracted,true);
});

test('a withdrawal while the summary is being generated prevents installing its old evidence',async()=>{
 const f=fixture();
 f.deps.askModel=async()=>{f.old.recallRevision=1;return '{"items":[{"text":"过时的摘要","sourceIds":["s1"]}]}';};
 assert.equal(await extract('rotateApiConversation',f.deps)({key:'private:1',chatId:'1',kind:'private'}),null);
 assert.equal(f.newSessions,0);
});
