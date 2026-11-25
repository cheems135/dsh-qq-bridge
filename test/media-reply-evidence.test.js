import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {conversationExecutionGrounding} from '../initiative-grounding.js';
import {createMediaTaskLifecycle} from '../media-task-lifecycle.js';

const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
const scope = {accountId:'a', personaId:'p', key:'private:7'};
const owner = {accountId:'a', personaId:'p', chat:scope.key};

function evidence(state) {
  const start = source.indexOf('  function conversationExecutionHint(');
  const end = source.indexOf('\n  }', start) + 4;
  const run = Function('conversationExecutionGrounding','activePersona','featureState','settings','isDesktop',
    source.slice(start,end)+';return conversationExecutionHint;')(
    conversationExecutionGrounding, () => ({id:'p'}), state, {activeAccountId:'a'}, true);
  const text = run({key:scope.key,kind:'private',isOwner:false});
  const line = text.split('\n').find(row=>row.includes('近期同一对话工具事实'));
  return JSON.parse(line.slice(line.indexOf('】')+1));
}

test('a follow-up after restart sees native media stages and only linked same-scope QQ receipts', () => {
  const now = Date.now()-1000;
  const state = {mediaTasks:[], outbox:[], videoJobs:[]};
  const lifecycle = createMediaTaskLifecycle({state:()=>state, account:()=>scope.accountId,
    persona:()=>scope.personaId, source:()=> 'local', audit:()=>null, record:()=>{}, persist:()=>true, now:()=>now});
  const task = lifecycle.begin({key:scope.key,auditId:'turn'},'image').task;
  const get = () => evidence(JSON.parse(JSON.stringify(state))).find(row=>row.taskId===task.id);
  assert.equal(get()?.status,'registered');
  lifecycle.finish(task,'waiting_service');
  assert.equal(get().status,'waiting_service');
  lifecycle.finish(task,'generated',{file:'/private/secret-filename.png'});
  assert.equal(get().status,'generated');
  state.outbox.push({id:'text', ...owner, status:'sent', messageId:'text-ack', auditId:'turn', at:now},
    {id:'delivery', ...owner, accountId:'other', status:'sent', messageId:'wrong', mediaTaskId:task.id, at:now},
    {id:'delivery', ...owner, chat:'group:7', status:'sent', messageId:'wrong', mediaTaskId:task.id, at:now});
  assert.equal(get().status,'generated');
  const job = {id:'correct', ...owner, mediaTaskId:task.id, at:now, status:'queued'};
  state.outbox.push(job);
  assert.equal(get().status,'queued');
  job.status='sent';
  assert.equal(get().status,'unknown');
  job.messageId='123';
  assert.equal(get().status,'accepted');
  job.verification={state:'observed'};
  assert.equal(get().status,'observed');
  assert.doesNotMatch(JSON.stringify(get()), /secret-filename|wrong|text-ack/);
  job.status='unknown';
  assert.equal(get().status,'unknown');
  state.outbox=[];
  lifecycle.finish(task,'failed',{error:'服务返回错误'});
  assert.equal(get().status,'failed');
  assert.match(get().error,/服务返回错误/);
  state.videoJobs.push({scope:JSON.stringify(owner),id:'v1',at:now,status:'pending_check',remote:{id:'remote'}});
  assert.equal(evidence(state).find(row=>row.taskId==='v1')?.status,'unknown');
});

test('one portrait request cannot submit generation twice after a failed or ambiguous first attempt', async () => {
  const start=source.indexOf('  async function photoFor('), end=source.indexOf('  function imageSize(',start);
  let attempts=0, searches=0;
  const settings={photo:{source:'auto'},life:{enabled:false}};
  const error=Object.assign(Error('首次生成结果未知'),{deliveryUnknown:true});
  const deps={settings,splitWorkflowRequest:text=>({text}),photoPromptPlan:()=>({personish:true}),
    photoFromLibrary:()=>null,generatePhoto:async()=>{attempts++;throw error;},log:()=>{},
    searchPhoto:async()=>{searches++;return null;}};
  const photo=Function(...Object.keys(deps),source.slice(start,end)+';return photoFor;')(...Object.values(deps));
  await assert.rejects(photo('合照'),e=>e===error);
  assert.equal(attempts,1);
  assert.equal(searches,0);
  error.deliveryUnknown=false;
  await assert.rejects(photo('合照'),e=>e===error);
  assert.equal(attempts,2);
  assert.equal(searches,1);
});

test('failure to store a registration cannot start generation or leave an in-memory duplicate', () => {
  const state={mediaTasks:[],outbox:[]}, events=[];
  let writesWork=false, starts=0;
  const lifecycle=createMediaTaskLifecycle({state:()=>state,account:()=>scope.accountId,persona:()=>scope.personaId,
    source:()=> 'local',audit:()=>null,record:event=>events.push(event),persist:()=>writesWork});
  const submit=()=>{
    const result=lifecycle.begin({key:scope.key,auditId:'turn'},'image');
    if(!result.duplicate) starts++;
  };
  assert.throws(submit,/本次没有启动/);
  assert.equal(starts,0);
  assert.deepEqual(state.mediaTasks,[]);
  assert.deepEqual(events,[]);
  writesWork=true;
  submit();submit();
  assert.equal(starts,1);
});

test('an uncertain generation uses the explanation path once without marking it as delivered media', async () => {
  const start=source.indexOf('  function mediaFailureNotice('),end=source.indexOf('  async function explainMediaFailure(',start);
  const task={...owner,id:'img',kind:'image',auditId:'turn',status:'unknown',serviceTaskId:'remote'};
  const out=[],explained=[];
  const deps={settings:{activeAccountId:'a'},activePersona:()=>({id:'p'}),featureState:{mediaTasks:[task]},
    saveFeatures(){},log(){},explainMediaFailure:async(c,t)=>{explained.push(t);out.push({c:{...c,mediaTaskId:''},text:'生成服务还没返回结果，我先查清楚，不重复提交。'});t.noticeDeliveryId='delivery';},personaContextIdentity:()=> 'rev',queueOutgoing:(c,parts)=>{out.push({c,text:parts[0].data.text});return 'delivery';}};
  const notice=Function(...Object.keys(deps),source.slice(start,end)+';return mediaFailureNotice;')(...Object.values(deps));
  const chat={key:scope.key,auditId:'turn',mediaTaskId:'img',turnKind:'user'};
  notice(chat,'image','failed');
  await Promise.resolve();
  assert.equal(explained[0],task);
  assert.match(out[0].text,/还没返回结果/);
  assert.doesNotMatch(out[0].text,/QQ|做好|生成好了/);
  assert.equal(out[0].c.mediaTaskId,'');
  assert.equal(task.noticeDeliveryId,'delivery');
  notice(chat,'image','unknown');
  assert.equal(out.length,1);
  const orphan={...chat,mediaTaskId:'orphan',mediaDeliveryId:'video-or-image',expectedAccountId:'b'};
  notice(orphan,'image','failed');
  assert.equal(out.length,1);
  notice({...orphan,expectedAccountId:'a'},'image','failed');
  assert.match(out[1].text,/发送失败/);
});
