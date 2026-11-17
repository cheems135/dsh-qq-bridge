import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {applyLocalGpuPolicy,workflowContextWindow} from '../local-gpu-policy.js';
import {createCapabilityDetector} from '../local-capabilities.js';import {normalizeLocalConfig} from '../local-config.js';
import {executeLocalAutonomy,LOCAL_LIFE_ACTION_RULES} from '../local-autonomy.js';
import {localCalendarRequest} from '../local-life-plan.js';
import {createLifeMemory} from '../life-memory.js';
const graph={'1':{class_type:'QwenTE_ModelLoader',inputs:{'主模型':'model-9B.Q4_K_M.gguf','模型系列':'Qwen3.5-VL','GPU层数':28,'上下文长度':4096}},'2':{class_type:'Chat',inputs:{text:'',model:['1',0]}}};
test('8000-token override is reported and submitted consistently; lower explicit GPU values and original file survive',()=>{
 const spec={parameterOverrides:[{node:'1',field:'上下文长度',value:8000}]};assert.equal(workflowContextWindow(graph,spec,{memoryProfile:'8gb'}),8000);assert.equal(graph['1'].inputs['上下文长度'],4096);
 const copy=structuredClone(graph);copy['1'].inputs['上下文长度']=8000;const result=applyLocalGpuPolicy(copy);assert.equal(result['1'].inputs['GPU层数'],20);assert.equal(result['1'].inputs['上下文长度'],8000);
 copy['1'].inputs['GPU层数']=12;assert.equal(applyLocalGpuPolicy(copy)['1'].inputs['GPU层数'],12);
});
test('workflow parameter changes invalidate cached capacity even though the file stays unchanged',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'capacity-test-'));writeFileSync(join(dir,'chat.json'),JSON.stringify(graph));let config=normalizeLocalConfig({backend:'comfyui',memoryProfile:'8gb',chatWorkflow:'test',workflowLibrary:[{id:'test',name:'test',kind:'chat',file:join(dir,'chat.json'),inputs:{prompt:{node:'2',field:'text'}},output:{node:'2',field:'text',kind:'text'}}]});
 const detector=createCapabilityDetector({root:dir,workDir:dir,getConfig:()=>config,services:async()=>({reachable:true}),probe:async({nonce})=>JSON.stringify({action:'capability_ping',arguments:{nonce}})});
 try{const before=await detector.detect();assert.equal(before.contextWindow,4096);const id=detector.identity();config.workflowLibrary[0].parameterOverrides=[{node:'1',field:'上下文长度',value:8000}];assert.notEqual(detector.identity(),id);assert.equal((await detector.snapshot()).contextWindow,8000);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('local autonomous task carries one copy of the job and compact execution instructions',async()=>{
 let captured;const job={id:'test',scene:{activity:'阅读网页'},checkpoint:{next:'继续阅读'}};
 await executeLocalAutonomy({context:{id:'t',persona:'角色',cue:'继续任务',lifeJob:job,rules:'duplicate old execution policy'},assertCurrent:()=>{},guardTool:(_n,_a,fn)=>fn(),run:async input=>{captured=input;return {ok:true,body:{text:'[skip]',receipts:[]}};}});
 assert.equal(captured.messages.filter(m=>m.content.includes(JSON.stringify(job))).length,1);assert.ok(captured.messages.some(m=>m.content.includes(LOCAL_LIFE_ACTION_RULES)));assert.ok(!captured.messages.some(m=>m.content.includes('duplicate old execution policy')));
});
test('calendar memory output fits local limits without deleting source evidence or changing other requests',()=>{
 const input=JSON.stringify({sources:[{id:'s1',text:'今天想阅读科幻小说。',actuallyCompleted:false}]});const r=localCalendarRequest('【日历分层记忆】只输出有依据的JSON',input,2200,{contextWindow:4096,maxOutputTokens:1200});assert.equal(r.tokens,1200);assert.equal(r.input,input);assert.equal(localCalendarRequest('其他请求',input,2200,{}).tokens,2200);
});
test('a long calendar source is split into local-sized batches with no source text silently omitted',async()=>{
 const files=new Map(),seen=[],meta={kind:'chat',accountId:'test',personaId:'test',key:'private:12345'},original=Array.from({length:250},(_,i)=>'第'+i+'条读书笔记，保存真实来源。').join('');
 const engine=createLifeMemory({storage:{list:()=>[...files.keys()],read:n=>{if(!files.has(n))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(n));},write:(n,v)=>files.set(n,structuredClone(v))},now:()=>Date.parse('2026-11-08T13:00:00+08:00'),config:()=>({life:{enabled:false},memory:{enabled:true,schedule:'daily'}}),allowed:()=>true,roles:()=>[],signature:()=>'',sourceBatchBudget:()=>1800,ask:async(_system,input)=>{const data=JSON.parse(input);assert.ok(input.length<2100);seen.push(...data.sources.map(s=>s.text));return JSON.stringify({events:[{text:'阅读笔记',sourceIds:[data.sources[0].id],quote:data.sources[0].text.slice(0,12)}]});}});
 try{engine.record(meta,{dir:'in',time:Date.parse('2026-11-07T13:00:00+08:00'),userText:original});const result=await engine.tick({maxJobs:1,force:true});assert.equal(result.failed,0);assert.equal(result.days,1);assert.equal(seen.join(''),original);assert.ok(seen.length>1);}finally{engine.close();}
});
