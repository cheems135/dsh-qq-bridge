import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {analyzeRunningHubMetadata,parseRunningHubExample} from '../image-studio.js';
import {referenceBindings,referenceReuseBindings,emptyReferenceInputs} from '../image-persona.js';
import {checkedImageNodes} from '../image-api-contract.js';

const raw=JSON.parse(readFileSync(new URL('./fixtures/runninghub-optional-images.json',import.meta.url)));
test('actual app metadata permits one identity image with the None secondary input',async()=>{
 const discovery=analyzeRunningHubMetadata(raw,'app','123');
 assert.equal(discovery.fields.find(f=>f.nodeId==='475'&&f.fieldName==='image').required,false);
 const config={mode:'app',webappId:'123',autoDetect:false,extraNodes:[],discovery};
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('async function resolveImageWorkflow('),b=source.indexOf('const REFERENCE_PREFIX_RE',a);
 const scope={settings:{imagegen:{runninghub:{}}},normalizeRunningHub:()=>({activeWorkflowId:'fixture'}),chooseRunningHub:()=>structuredClone(config),parseRunningHubTarget:(id,mode)=>({id,mode}),referenceBindings,referenceReuseBindings,emptyReferenceInputs,studioClean:String};vm.createContext(scope);vm.runInContext(source.slice(a,b),scope);
 const resolved=await scope.resolveImageWorkflow('',false,{file:'identity.png'});
 assert.deepEqual(JSON.parse(JSON.stringify(resolved.personaReferenceInputs)),[{nodeId:'470',fieldName:'image'}]);
});
test('the known Qwen app requests canvas inputs for new scenes and requires real sources for explicit editing',async()=>{
 const discovery=analyzeRunningHubMetadata(raw,'app','2102644452430008321');
 const config={mode:'app',webappId:'2102644452430008321',autoDetect:false,extraNodes:[{nodeId:'475',fieldName:'image',fieldValue:'user-source.png'}],discovery};
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('async function resolveImageWorkflow('),b=source.indexOf('const REFERENCE_PREFIX_RE',a);
 const scope={settings:{imagegen:{runninghub:{}}},normalizeRunningHub:()=>({activeWorkflowId:'fixture'}),chooseRunningHub:()=>structuredClone(config),parseRunningHubTarget:(id,mode)=>({id,mode}),referenceBindings,referenceReuseBindings,emptyReferenceInputs,studioClean:String};
 vm.createContext(scope);vm.runInContext(source.slice(a,b),scope);
 const resolved=await scope.resolveImageWorkflow('',false,null,'画一个蓝色杯子');
 assert.deepEqual(Array.from(resolved.canvasInputs,n=>n.nodeId),['470']);
 assert.equal(resolved.extraNodes[0].fieldValue,'user-source.png');
 await assert.rejects(scope.resolveImageWorkflow('',false,null,'把这张图换个背景'),e=>e.code==='IMAGE_REQUIRED_INPUTS');
});
test('an explicit mandatory image remains required even when its schema contains None',()=>{
 const input=structuredClone(raw);input.data.nodeInfoList.find(n=>n.nodeId==='475').required=true;
 const d=analyzeRunningHubMetadata(input,'app','123');assert(d.requiredFields.some(f=>f.nodeId==='475'));
 const unknown=analyzeRunningHubMetadata({data:{nodeInfoList:[{nodeId:'1',fieldName:'image',fieldType:'IMAGE'}]}},'app','123');assert(unknown.requiredFields.some(f=>f.nodeId==='1'));
});
test('example import does not invent optional flags for unknown mandatory media',()=>{
 const payload={nodeInfoList:[{nodeId:'1',fieldName:'image',fieldType:'IMAGE',fieldValue:'example.png'},{nodeId:'2',fieldName:'text',fieldValue:'prompt',description:'positive prompt'}]};
 const parsed=parseRunningHubExample("curl 'https://www.runninghub.cn/task/openapi/ai-app/run' -d '"+JSON.stringify({webappId:'123',...payload})+"'");
 assert(parsed.requiredFields.some(f=>f.nodeId==='1'));
});
test('optional media submits blank instead of copying the provider example image',()=>{
 const discovery=analyzeRunningHubMetadata(raw,'app','123'),source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),a=source.indexOf('function runningHubNodeValues(');
 let build;for(let b=source.indexOf('}',a);b>=0;b=source.indexOf('}',b+1))try{build=Function('settings','normalizePromptLanguage','modelImagePrompt','checkedImageNodes','emptyReferenceInputs','referencePromptPrefix','return ('+source.slice(a,b+1)+');')({},()=> 'en',s=>s,checkedImageNodes,emptyReferenceInputs,()=> 'reference');break;}catch(e){if(!(e instanceof SyntaxError))throw e;}
 assert(build);const nodes=build({mode:'app',discovery,promptTargets:[{nodeId:'489',fieldName:'value'}],extraNodes:[]},'A public geometric scene');
 assert.equal(nodes.find(n=>n.nodeId==='475'&&n.fieldName==='image')?.fieldValue,'');
 const explicit=build({mode:'app',discovery,promptTargets:[{nodeId:'489',fieldName:'value'}],extraNodes:[{nodeId:'475',fieldName:'image',fieldValue:'user-upload.png'}]},'A public geometric scene');
 assert.equal(explicit.find(n=>n.nodeId==='475').fieldValue,'user-upload.png');
});
