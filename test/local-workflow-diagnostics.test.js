import test from 'node:test';
import assert from 'node:assert/strict';
import {describeLocalWorkflow} from '../local-workflow-diagnostics.js';
test('submitted graph diagnostics describe actual image binding, model, sampler and output wiring without mutating the graph',()=>{
 const graph={1:{class_type:'LoadImage',inputs:{image:'uploaded-reference.png'}},2:{class_type:'Encode',inputs:{image:['1',0]}},3:{class_type:'KSampler',inputs:{positive:['2',0],steps:6,cfg:1,denoise:.8,seed:77}},4:{class_type:'SaveImage',inputs:{images:['3',0]}},5:{class_type:'UNETLoader',inputs:{unet_name:'model.safetensors'}}},before=JSON.stringify(graph);
 const view=describeLocalWorkflow(graph,{inputs:{image:{node:'1',field:'image'}},output:{node:'4',kind:'image'}},'selected');
 assert.equal(view.imageBinding.value,'uploaded-reference.png');assert.equal(view.imageBinding.onOutputPath,true);assert.equal(view.nodes.find(n=>n.id==='3').parameters.denoise,.8);assert.equal(view.nodes.find(n=>n.id==='5').parameters.unet_name,'model.safetensors');assert.equal(view.nodes.find(n=>n.id==='5').onOutputPath,false);assert.equal(view.graphSha256.length,64);assert.equal(JSON.stringify(graph),before);
 const disconnected=describeLocalWorkflow({...graph,2:{class_type:'Encode',inputs:{}}},{inputs:{image:{node:'1',field:'image'}},output:{node:'4'}},'selected');assert.equal(disconnected.imageBinding.onOutputPath,false);
});
