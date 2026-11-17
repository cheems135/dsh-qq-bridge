import {createMediaTaskLifecycle} from '../media-task-lifecycle.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mediaExecutionSummary,speechSourceReadiness} from '../media-execution.js';
import {referenceBindings,referenceReuseBindings,emptyReferenceInputs} from '../image-persona.js';

test('a delivered text reply cannot hide voice generation failure before a send job exists',()=>{
 const tasks=[{id:'v',kind:'voice',status:'failed',error:'语音来源未选择',auditId:'a'}];
 const result=mediaExecutionSummary(tasks,[{id:'text',auditId:'a',status:'sent',verification:{state:'observed'}}]);assert.equal(result.state,'failed');assert.equal(result.completed,false);assert.equal(result.items[0].stage,'generation');assert.equal(result.failures[0].error,'语音来源未选择');
});
test('media receipt/readback stays separate from recipient receipt and incomplete siblings',()=>{
 const tasks=[{id:'image',kind:'image',status:'generated',deliveryId:'job'}],out=[{id:'job',status:'sent',messageId:'123'}];assert.equal(mediaExecutionSummary(tasks,out).state,'accepted');out[0].verification={state:'observed'};const observed=mediaExecutionSummary(tasks,out);assert.equal(observed.state,'observed');assert.equal(observed.recipient,'unknown');assert.equal(mediaExecutionSummary([...tasks,{id:'voice',status:'failed'}],out).state,'partial');out[0].status='unknown';assert.equal(mediaExecutionSummary(tasks,out).state,'unknown');
});
test('phone and PC share API speech readiness; phone refuses local speech',()=>{
 for(const desktop of [true,false]){assert.equal(speechSourceReadiness({engine:'none',desktop}).available,false);assert.equal(speechSourceReadiness({engine:'custom',desktop}).available,true);assert.equal(speechSourceReadiness({source:'profile:p',profile:{type:'openai',speechModel:'voice-model',voice:'speaker'},desktop}).available,true);assert.equal(speechSourceReadiness({source:'profile:p',profile:{type:'openai',speechModel:'voice-model'},desktop}).available,false);}assert.equal(speechSourceReadiness({source:'local',desktop:false}).available,false);
});
test('actual media lifecycle records generation failure without waiting for QQ send and isolates other audits',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('  var mediaLifecycle;'),b=source.indexOf('function mediaFailureNotice(',a),events=[],audit={id:'a',accountId:'account',persona:'p'};
 const scope={createMediaTaskLifecycle,featureState:{mediaTasks:[],outbox:[]},settings:{activeAccountId:'account'},activePersona:()=>({id:'p'}),randomUUID:()=> 'task',saveFeatures:()=>{},auditById:id=>id==='a'?audit:null,recordInvocation:(event,context)=>events.push({event,context}),serviceSource:()=> 'legacy',mediaExecutionSummary};vm.createContext(scope);vm.runInContext(source.slice(a,b),scope);const {task}=scope.beginMediaTask({key:'private:1',auditId:'a'},'voice');scope.finishMediaTask(task,'failed',{error:'语音服务未选择'});assert.equal(events.at(-1).event.status,'failed');assert.equal(events.at(-1).context.backend,'api');assert.equal(audit.mediaExecution.state,'failed');assert.equal(audit.mediaExecution.items.length,1);
 scope.serviceSource=()=> 'local';scope.finishMediaTask(task,'cancelled');assert.equal(events.at(-1).context.backend,'api','task source remains original after mode switch');
});
test('real workflow preflight cannot treat a cleared required second image as supplied',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('async function resolveImageWorkflow('),b=source.indexOf('const REFERENCE_PREFIX_RE',a),fields=[{nodeId:'470',fieldName:'image',label:'image1',type:'IMAGE',required:true},{nodeId:'475',fieldName:'image',label:'image2',type:'IMAGE',required:true}];
 const config={name:'fixture-edit',mode:'app',webappId:'123',autoDetect:false,promptNodeId:'10',referenceMode:'auto',extraNodes:[],discovery:{fields,requiredFields:fields}};
 const scope={settings:{imagegen:{runninghub:{}}},normalizeRunningHub:()=>({activeWorkflowId:'fixture'}),chooseRunningHub:()=>structuredClone(config),parseRunningHubTarget:(id,mode)=>({id,mode}),referenceBindings,referenceReuseBindings,emptyReferenceInputs,studioClean:String};vm.createContext(scope);vm.runInContext(source.slice(a,b),scope);
 await assert.rejects(scope.resolveImageWorkflow('',false,{file:'reference.png'}),e=>e.code==='IMAGE_REQUIRED_INPUTS'&&e.missingInputs.length===1&&e.missingInputs[0].nodeId==='475'&&e.referenceAvailable===true);
 config.extraNodes=[{nodeId:'475',fieldName:'image',fieldValue:'user-second-image.png'}];const resolved=await scope.resolveImageWorkflow('',false,{file:'reference.png'});assert.equal(resolved.personaReference.file,'reference.png');
});
