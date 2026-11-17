import test from 'node:test';import assert from 'node:assert/strict';
import {createExecutionRuntime,isReconciliationObservation,operationEffect} from '../execution-runtime.js';
import {createLifeExecution} from '../life-execution.js';
import {normalizeHearing,requestAudioTranscription} from '../hearing-evidence.js';
import {modelPurpose,describeInvocation} from '../model-invocation-audit.js';
import {resolveVoiceDelivery,breezeSpeech} from '../voice-studio.js';
function execution(value,{error=false,tool='ops_bash',command='rm test-only.txt'}={}){
 const events=[],steps=[],life={beginStep:()=>({step:{id:'step'}}),settleStep:(_id,_meta,_step,r)=>steps.push(r)};
 const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>({}),getLife:()=>life,journal:r=>events.push(r)});
 const context={accountId:'a',personaId:'p',key:'private:test',meta:{lifeJobId:'job'}};
 const exec={name:tool,arguments:{command}};runtime.beginHost(exec,context);runtime.finish(exec,context,{isError:error,value});
 return {events,steps};
}
test('actual host foreground success completes a local deletion step without an unknown-state loop',()=>{
 const {events,steps}=execution({exitCode:0,status:'completed',kind:'foreground',timedOut:false,aborted:false,signal:null,stdout:{text:'removed test-only.txt'}});
 assert.equal(events.at(-1).status,'confirmed');assert.equal(steps[0].status,'confirmed');
});
test('foreground completion lets the real life engine finish, without inventing a completed task from an exit code alone',async()=>{
 const meta={accountId:'a',personaId:'p'},now=()=>Date.parse('2026-11-16T10:30:00+08:00');let saved;
 const life=createLifeExecution({storage:{read:()=>saved,write:x=>saved=structuredClone(x)},config:()=>({execute:true,sleep:false,maxTasksPerDay:0}),roles:()=>[{meta}],allowed:()=>true,sceneFor:()=>({date:'2026-11-16',start:'10:00',end:'11:00',activity:'整理测试作品',taskKind:'create'}),dispatch:async()=> 'session',now});
 try{
  await life.tick();const job=life.snapshot(meta).jobs[0];assert(job);
  const runtime=createExecutionRuntime({policy:{check:()=>({}),consume:()=>{}},metaFor:()=>meta,getLife:()=>life,now});
  const context={...meta,key:'private:test',meta:{lifeJobId:job.id}},exec={name:'ops_bash',arguments:{command:'rm test-only.txt'}};
  runtime.beginHost(exec,context);runtime.finish(exec,context,{isError:false,value:{exitCode:0,status:'completed',kind:'foreground',timedOut:false,aborted:false,signal:null}});
  assert.equal(life.snapshot(meta).jobs[0].steps[0].status,'confirmed');assert.equal(life.snapshot(meta).jobs[0].status,'running');
  assert.throws(()=>life.finish(job.id,meta,{status:'completed'}),/真实作品|具体内容证据/);
 }finally{await life.close();}
});
test('incomplete or failed process and stdout-only success cannot claim verified completion',()=>{
 for(const value of [{exitCode:0,status:'running',kind:'background'},{exitCode:0,status:'completed',kind:'foreground',timedOut:true},{exitCode:1,status:'completed',kind:'foreground'},{stdout:{text:'[exit code: 0]'}}]){
  const {steps}=execution(value);assert.equal(steps[0].status,'unknown');
 }
 const {steps}=execution({exitCode:0,status:'completed',kind:'foreground'},{error:true});assert.equal(steps[0].status,'unknown');
});
test('reconciliation permits actual read-only file tools, not arbitrary shell commands',()=>{
 for(const name of ['ops_glob','ops_grep','ops_read_files']){assert(isReconciliationObservation({name}));assert.equal(operationEffect({toolName:name}),'read');}
 assert(!isReconciliationObservation({name:'ops_bash',arguments:{command:'ls'}}));assert(!isReconciliationObservation({name:'edit'}));
});
test('SenseVoice formatted emotion/event evidence is separated from speech only for that recognizer',async()=>{
 const h=normalizeHearing({text:'😭还没想好。😔'},{model:'FunAudioLLM/SenseVoiceSmall'});
 assert.equal(h.text,'还没想好。');assert.deepEqual(h.labels.map(r=>r.label),['哭声','低落']);assert(h.labels.every(r=>r.status==='candidate'));
 assert.equal(normalizeHearing({text:'你好😊'},{model:'custom'}).text,'你好😊');assert.deepEqual(normalizeHearing(null).labels,[]);
 const realFormat=await requestAudioTranscription(Buffer.from('fixture'),{asrApiKey:'test',asrModel:'FunAudioLLM/SenseVoiceSmall'},{fetchImpl:async()=>Response.json({text:'我等你。😔'})});
 assert.equal(realFormat.text,'我等你。');assert.equal(realFormat.labels[0].label,'低落');
});
test('calendar memory cost is not mislabelled as repeated task verification, including retained records',()=>{
 const system='【任务事实核对】不是完成证据\n【日历分层记忆】整理来源';
 assert.equal(modelPurpose(system),'归档日历记忆');assert.equal(describeInvocation({tool:'model.complete',purpose:'核对任务完成证据',systemPrompt:system}).purpose,'归档日历记忆');
});
test('a real-length direction is prepared once and reaches TTS unchanged with the word-preservation suffix',async()=>{
 const instructions='语气自然温和，开头带一点如释重负的轻叹，像把悬着的心放下；第一句话稍慢，带轻微委屈后的松弛。后半句转为柔和安心，语速放缓，说得轻而笃定，像关心叮嘱，结尾自然收住，不用欢快上扬。';
 const config={emotion:'auto',breeze:{mode:'official',apiKey:'fixture',voiceId:'voc_fixture'}};
 const plan=resolveVoiceDelivery(config,{text:'我们晚一点见吧'},{delivery:{emotion:'relieved+gentle',instructions}});
 let body;const audio=Buffer.alloc(1200);audio.write('ID3');
 await breezeSpeech('我们晚一点见吧',config,plan,async(_u,o)=>{body=JSON.parse(o.body);return new Response(audio);});
 assert.equal(body.instructions,plan.instructions);assert(body.instructions.length<=160);assert.match(body.instructions,/只改表演，不改台词。$/);assert(!body.text.includes('语气自然'));
});
