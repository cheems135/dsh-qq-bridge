import test from 'node:test';
import assert from 'node:assert/strict';
import {executionOverview} from '../execution-overview.js';
import {serviceSourceOverview} from '../service-source-overview.js';
import {renderServiceSources,paintExecutionRequests} from '../ui/execution-overview.js';
import {readFileSync} from 'node:fs';
import {createVideoTasks} from '../video-tasks.js';

const scope={accountId:'a',personaId:'p',chat:'private:12345'};
const audit=(patch={})=>({...scope,persona:'p',id:'turn',at:1,status:'completed',input:'帮我画图',answer:'画好了',...patch});
const media=(patch={})=>({...scope,id:'image',auditId:'turn',at:2,kind:'image',status:'failed',error:'生成失败',...patch});
const job=(patch={})=>({...scope,id:'reply',auditId:'turn',at:3,status:'sent',messageId:'qq1',...patch});
const record=(patch={})=>({...scope,id:'chat:turn',auditId:'turn',at:1,tool:'chat.reply',kind:'chat',backend:'api',status:'returned',...patch});
const view=options=>executionOverview({accountId:'a',...options});

test('a wait notice stays with its incoming QQ IDs and cannot turn a cancellation into delivery',()=>{
  const a=audit({status:'cancelled',inboundIds:['5','6']});
  const wait=job({auditId:'',deliveryRole:'progress',replyToInboundIds:['5','6']});
  const [request]=view({audits:[a],outbox:[wait]});
  assert.equal(request.state,'cancelled');
  assert.equal(request.steps.filter(s=>s.type==='delivery').length,1);
  assert.equal(view({audits:[{...a,status:'running'}],outbox:[wait]})[0].state,'running');
  assert.equal(view({outbox:[wait]})[0].state,'progress');
});

test('reused audit and invocation IDs in two QQ chats remain separate in the panel',()=>{
  const other='group:55555';
  const calls=[record({input:'甲'}),record({chat:other,input:'乙'})];
  const requests=view({audits:[audit(),audit({chat:other})],records:calls});
  assert.equal(requests.length,2);
  for(const request of requests){
    const pane={innerHTML:'',querySelectorAll:()=>[]};
    paintExecutionRequests(pane,[request],calls,row=>'详情'+row.input);
    const right=request.chat===other?'乙':'甲';
    assert.ok(pane.innerHTML.includes('详情'+right));
    assert.ok(!pane.innerHTML.includes('详情'+(right==='乙'?'甲':'乙')));
  }
});

test('private and group requests distinguish a legacy wait from a final, withheld, or intentionally silent answer',()=>{
  for(const chat of [scope.chat,'group:55555']){
    const wait=job({chat,deliveryKey:'local:turn:wait:line:0'});
    const display=(patch,jobs=[wait])=>view({audits:[audit({chat,...patch})],outbox:jobs})[0];
    assert.equal(display({}).state,'progress');
    assert.match(display({}).steps.at(-1).label,/等待提示/);
    assert.equal(display({deliveryState:'silent'}).state,'silent');
    assert.equal(display({deliveryState:'failed'}).state,'failed');
    const withheld=display({deliveryState:'withheld',deliveryReason:'已暂停 <test>'});
    assert.equal(withheld.state,'withheld');
    const pane={innerHTML:'',querySelectorAll:()=>[]};
    paintExecutionRequests(pane,[withheld],[],()=> '');
    assert.match(pane.innerHTML,/已暂停 &lt;test&gt;/);
    assert.equal(display({},[wait,job({chat,id:'final'})]).state,'accepted');
    const file=job({chat,messageId:'',uploadReceipt:{action:'upload_group_file',transport:'accepted',fileId:'f1'}});
    assert.equal(display({},[file]).state,'accepted');
  }
});

test('successful text delivery never hides failed image generation',()=>{
  const [r]=view({audits:[audit()],records:[record()],mediaTasks:[media()],outbox:[job()]});
  assert.equal(r.state,'partial');assert.equal(r.steps.length,4);assert.equal(r.output,'画好了');
  assert.equal(r.steps.find(s=>s.type==='media').error,'生成失败');assert.equal(r.recipient,'unknown');
});
test('delivery requires message id; observed record remains distinct from recipient receipt',()=>{
  for(const [patch,state] of [[{messageId:''},'unknown'],[{status:'unknown'},'unknown'],[{status:'sending',messageId:''},'queued'],[{},'accepted'],[{verification:{state:'observed'}},'observed']]){
    const [r]=view({audits:[audit()],outbox:[job(patch)]});
    assert.equal(r.state,state);assert.equal(r.recipient,'unknown');
  }
});
test('two concurrent chats, accounts and personas cannot be merged by timestamps or audit collisions',()=>{
  const rows=view({audits:[audit(),audit({accountId:'b'})],records:[record(),record({id:'other-persona',personaId:'q'}),record({id:'other-account',accountId:'b'}),record({id:'unlinked',auditId:'',chat:'group:55555'})],outbox:[job({personaId:'q'})]});
  assert.equal(rows.length,4);
  assert(!JSON.stringify(rows).includes('other-account'));
  assert.deepEqual(rows.find(r=>r.linked).recordIds,['chat:turn']);
  assert(!rows.find(r=>r.linked).steps.some(s=>s.type==='delivery'));
});
test('explicit media id links a delivery, including a cross-chat send with the same persona',()=>{
  const [r]=view({mediaTasks:[media({auditId:'',status:'queued',deliveryId:'reply'})],outbox:[job({auditId:'',chat:'group:55555',mediaTaskId:'image'})]});
  assert.equal(r.state,'accepted');assert.equal(r.steps.length,2);assert.equal(r.linked,false);
});
test('orphaned historical success is not presented as confirmed delivery',()=>{
  const [r]=view({mediaTasks:[media({status:'sent',auditId:''})]});
  assert.equal(r.state,'unknown');assert.equal(r.linked,false);
});
test('video generation errors and remote unknown results cannot be hidden by a text reply',()=>{
  const video={id:'video',scope:JSON.stringify(scope),auditId:'turn',at:2,status:'failed',error:'视频没有生成'};
  assert.equal(view({audits:[audit()],videoJobs:[video],outbox:[job()]})[0].state,'partial');
  assert.equal(view({audits:[audit()],videoJobs:[{...video,status:'pending_check'}],outbox:[job()]})[0].state,'unknown');
  const generated={...video,status:'queued',deliveryId:'video-reply'};
  assert.equal(view({audits:[audit()],videoJobs:[generated],outbox:[job({id:'video-reply'})]})[0].state,'accepted');
});
test('local generation-only video records do not create a phantom undelivered task',()=>{
  const video={id:'video',scope:JSON.stringify({...scope,delivery:'local-outbox'}),auditId:'turn',status:'generated',file:'local.mp4'};
  const [r]=view({audits:[audit()],videoJobs:[video],mediaTasks:[media({kind:'video',status:'queued',deliveryId:'reply'})],outbox:[job({mediaTaskId:'image'})]});
  assert.equal(r.state,'accepted');assert.equal(r.steps.filter(s=>s.type==='media').length,1);
});
test('video retry keeps its original audit association and does not generate twice',async()=>{
  const jobs=[],events=[];let generated=0;
  const task=createVideoTasks({jobs:()=>jobs,save(){},authorize(){},prepare:async()=>({seconds:2}),generate:async()=>{generated++;return {file:'video.mp4'};},deliver:async()=> 'delivery',record:job=>events.push(job.auditId)});
  const context={scope:JSON.stringify(scope),stamp:'same',auditId:'original'};
  const result=await task.run({action:'generate',prompt:'test'},context);
  await task.run({action:'resume',id:result.id},{...context,auditId:'later'});
  assert.equal(generated,1);assert.equal(jobs[0].auditId,'original');assert(events.every(id=>id==='original'));
});
test('filters match an entire request while preserving other stages of its lifecycle',()=>{
  const [r]=view({audits:[audit()],records:[record(),record({id:'model',backend:'local',kind:'image'})],outbox:[job()],kind:'image',backend:'local'});
  assert.deepEqual(r.recordIds,['chat:turn','model']);assert(r.steps.some(s=>s.type==='delivery'));
});
test('duplicate snapshots count once, tool errors can recover, and missing API usage is not free',()=>{
  const r=record({usage:{inputTokens:100},updatedAt:3});
  const [group]=view({audits:[audit()],records:[r,{...r,updatedAt:2},record({id:'imageapi',kind:'image',tool:'image.generate'}),record({id:'search',tool:'bridge_search',kind:'tool',status:'failed'})],outbox:[job()],cost:()=>0.2});
  assert.deepEqual(group.cost,{estimated:0.2,priced:1,unpriced:1,basis:'按插件现有 token 单价估算；未上报用量的媒体费用另计'});
  assert.equal(group.state,'accepted');assert.equal(group.failedCalls,1);
});
test('whitelist filtering and credential redaction apply to the aggregate, including outputs',()=>{
  const rows=view({audits:[audit({answer:'Bearer secretsecret / sk-1234567890abcd'})],records:[record(),record({id:'hidden',chat:'group:55555'})],outbox:[job({chat:'group:55555'})],allowed:chat=>chat==='private:12345'});
  assert.equal(rows.length,1);const json=JSON.stringify(rows);
  assert(!json.includes('secretsecret'));assert(!json.includes('sk-1234567890abcd'));assert(!json.includes('55555'));
});
test('saved source snapshots remain historical after configuration changes',()=>{
  const first=serviceSourceOverview({model:{provider:'first',model:'one'},now:1});
  const a=audit({sources:first});const later=serviceSourceOverview({model:{provider:'second',model:'two'},now:2});
  assert.equal(view({audits:[a]})[0].sources.items[0].model,'one');assert.equal(later.items[0].model,'two');
});
test('mixed routing reports local chat / API media and explicit API complement separately',()=>{
  const config={settings:{localChat:{enabled:true,backend:'comfyui',chatWorkflow:'custom',apiComplement:true,apiTaskAssist:true},voice:{enabled:true}},
    connections:{routes:{enabled:true},profiles:[{id:'i',type:'openai',name:'图片连接',imageModel:'image-x',baseUrl:'https://user:pass@api.test/v1?token=secret',apiKey:'secret'}]},sources:{chat:'local',image:'profile:i',speech:'legacy',video:'local'}};
  const r=serviceSourceOverview(config);assert.equal(r.items[0].model,'custom');assert.equal(r.items[1].backend,'api');assert.equal(r.items[1].model,'image-x');
  assert.equal(r.apiComplement,true);assert.equal(r.apiTaskAssist,true);assert.equal(r.items[2].state,'incomplete');
  assert(!JSON.stringify(r).includes('secret'));assert(!JSON.stringify(r).includes('pass'));assert.equal(r.items[1].origin,'https://api.test');
});
test('phone has API sources and does not advertise local fallback',()=>{
  const r=serviceSourceOverview({desktop:false,model:{provider:'api',model:'mobile'},settings:{localChat:{enabled:false}},sources:{chat:'host',image:'legacy',speech:'legacy',video:'legacy'}});
  assert.equal(r.device,'phone');assert.equal(r.apiComplement,false);assert(r.items.every(i=>i.backend==='api'));
});
test('a host with no selected chat model can still display its other configured sources',()=>{
  const r=serviceSourceOverview({model:null});assert.equal(r.items[0].state,'incomplete');assert.equal(r.items.length,5);
});
test('legacy voice selection can still execute locally while chat uses API',()=>{
  const r=serviceSourceOverview({settings:{voice:{enabled:true,localai:{preset:'own-voice',baseUrl:'http://localhost:9000'}}},voiceEngine:'localai',model:{provider:'api',model:'chat'}});
  assert.equal(r.items[0].backend,'api');assert.equal(r.items[2].backend,'local');assert.equal(r.items[2].from,'语音设置 → 本地语音');assert.equal(r.items[2].model,'own-voice');
});
test('request UI escapes generated text, labels and configuration, without adding replay buttons',()=>{
  const container={querySelectorAll:()=>[],innerHTML:''};
  const rows=view({audits:[audit({input:'<img src=x onerror=evil()>',answer:'<script>evil()</script>'})],outbox:[job()]});
  paintExecutionRequests(container,rows,[],()=>'<span>existing detail</span>');
  assert(!container.innerHTML.includes('<script>'));assert(!container.innerHTML.includes('<img'));assert(container.innerHTML.includes('&lt;script&gt;'));assert(!container.innerHTML.includes('<button'));
  assert(!renderServiceSources({items:[{label:'<script>',connection:'<img>',kind:'chat',backend:'api'}]}).includes('<script>'));
});
test('analysis and API complement preserve the parent request scope',()=>{
  const code=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  assert(code.includes("scope:{...(apiModelScope.getStore()?.recordScope||invocationScope('panel:analysis')),backend:'local'}"));
  assert(code.includes('api:request=>apiModelScope.run({...apiModelScope.getStore(),complement:request.apiComplement===true}'));
});
