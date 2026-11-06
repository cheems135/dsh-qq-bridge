import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMediaWorkflow} from '../local-workflow-mode.js';
import {applyLocalGpuPolicy} from '../local-gpu-policy.js';
test('known dual-mode Qwen workflow uses text branch without stale reference; attached images and unknown graphs retain semantics',()=>{
 const graph={a:{class_type:'LoadImage',inputs:{image:'missing.png'}},b:{class_type:'TextEncodeQwenImage21',inputs:{'images.image_1':['a',0]}},c:{class_type:'EmptyLatentImage',inputs:{}},s:{class_type:'ComfySwitchNode',inputs:{switch:false,on_true:['c',0],on_false:['b',2]}},d:{class_type:'VAEDecode',inputs:{samples:['s',0]}},e:{class_type:'CLIPLoader',inputs:{type:'qwen_image',device:'default'}},f:{class_type:'QwenImage21Cache',inputs:{device:'auto'}},r:{class_type:'ResolutionSelector',inputs:{megapixels:1.5}}};
 graph.b.inputs.clip=['e',0];graph.d.inputs.conditioning=['b',0];graph.d.inputs.model=['f',0];graph.c.inputs.width=['r',0];
 const original=JSON.stringify(graph),result=prepareMediaWorkflow(structuredClone(graph),{kind:'image',outputNode:'d'});
 assert.equal(result.a,undefined);assert.equal(result.b.inputs['images.image_1'],undefined);assert.deepEqual(result.s.inputs.on_false,['c',0]);assert.equal(JSON.stringify(graph),original);
 const bounded=applyLocalGpuPolicy(result,{memoryProfile:'8gb'});assert.equal(bounded.e.inputs.device,'cpu');assert.equal(bounded.f.inputs.device,'cpu');assert.equal(bounded.r.inputs.megapixels,.5);
 assert.deepEqual(prepareMediaWorkflow(structuredClone(graph),{kind:'image',hasImage:true,outputNode:'d'}),graph);
 const unknown={a:{class_type:'CustomEncoder',inputs:{image:'missing.png'}}};assert.deepEqual(prepareMediaWorkflow(structuredClone(unknown),{kind:'image'}),unknown);
});

test('new persona scenes keep identity conditioning but bypass reference canvas and post color matching',()=>{
 const graph={ref:{class_type:'LoadImage',inputs:{image:'identity.png'}},enc:{class_type:'TextEncodeQwenImage21',inputs:{'images.image_1':['ref',0]}},empty:{class_type:'EmptyLatentImage',inputs:{}},latent:{class_type:'ComfySwitchNode',inputs:{on_true:['empty',0],on_false:['enc',2]}},decode:{class_type:'VAEDecode',inputs:{samples:['latent',0],conditioning:['enc',0]}},color:{class_type:'easy imageColorMatch',inputs:{image_ref:['ref',0],image_target:['decode',0]}},output:{class_type:'ComfySwitchNode',inputs:{on_false:['decode',0],on_true:['color',0]}},save:{class_type:'SaveImage',inputs:{images:['output',0]}}};
 const original=JSON.stringify(graph);const result=prepareMediaWorkflow(structuredClone(graph),{kind:'image',hasImage:true,recompose:true,outputNode:'save'});
 assert.deepEqual(result.enc.inputs['images.image_1'],['ref',0]);assert.deepEqual(result.latent.inputs.on_false,['empty',0]);assert.deepEqual(result.output.inputs.on_true,['decode',0]);assert.equal(result.color,undefined);assert.equal(JSON.stringify(graph),original);
 assert.deepEqual(prepareMediaWorkflow(structuredClone(graph),{kind:'image',hasImage:true,outputNode:'save'}),graph);
});
