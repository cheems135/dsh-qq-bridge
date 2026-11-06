import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWorkflow,convertUiWorkflow} from '../workflow-inspector.js';

export const imageGraph=()=>({
  '1':{class_type:'CheckpointLoaderSimple',inputs:{ckpt_name:'local.safetensors'}},
  '2':{class_type:'CLIPTextEncode',inputs:{text:'bird',clip:['1',1]}},
  '3':{class_type:'CLIPTextEncode',inputs:{text:'blur',clip:['1',1]}},
  '4':{class_type:'KSampler',inputs:{model:['1',0],positive:['2',0],negative:['3',0],seed:7,steps:20}},
  '5':{class_type:'VAEDecode',inputs:{samples:['4',0],vae:['1',2]}},
  '6':{class_type:'SaveImage',inputs:{images:['5',0],filename_prefix:'output'}},
});

test('API graph identifies positive/negative via connections, not node order or text contents',()=>{
  const graph=imageGraph();graph['0']={class_type:'CLIPTextEncode',inputs:{text:'orphan'}};
  const a=inspectWorkflow(graph,{}, {filename:'Bird.json'});
  assert.equal(a.ready,true);assert.equal(a.name,'Bird');assert.equal(a.kind,'image');
  assert.deepEqual(a.inputs.prompt,{node:'2',field:'text'});
  assert.deepEqual(a.inputs.negativePrompt,{node:'3',field:'text'});
  assert.equal(a.inputs.seed.node,'4');
  assert.ok(!a.candidates.prompt.some(x=>x.node==='0'));
});

test('linked string input resolves to a primitive text source',()=>{
  const graph=imageGraph();graph['2'].inputs.text=['11',0];graph['11']={class_type:'PrimitiveString',inputs:{value:'bird'}};
  assert.deepEqual(inspectWorkflow(graph).inputs.prompt,{node:'11',field:'value'});
});

test('multiple active samplers do not silently pick a seed',()=>{
  const graph=imageGraph();graph['8']={class_type:'KSampler',inputs:{positive:['2',0],negative:['3',0],latent_image:['4',0],seed:9}};graph['5'].inputs.samples=['8',0];
  const a=inspectWorkflow(graph);assert.equal(a.inputs.seed.node,'');assert.equal(a.candidates.seed.length,2);assert.ok(a.warnings.some(x=>x.includes('随机种子')));
});

test('shared positive and negative text source requires an explicit choice',()=>{
  const graph=imageGraph();graph['4'].inputs.negative=['2',0];
  const a=inspectWorkflow(graph);assert.equal(a.inputs.prompt.node,'');assert.equal(a.inputs.negativePrompt.node,'');
});

test('zeroed negative conditioning does not mislabel the positive prompt as negative',()=>{
  const graph=imageGraph();graph['7']={class_type:'ConditioningZeroOut',inputs:{conditioning:['2',0]}};graph['4'].inputs.negative=['7',0];
  const a=inspectWorkflow(graph);assert.equal(a.inputs.prompt.node,'2');assert.equal(a.inputs.negativePrompt.node,'');
});

test('video output and source image are identified',()=>{
  const graph=imageGraph();graph['7']={class_type:'LoadImage',inputs:{image:'input.png'}};graph['4'].inputs.source_image=['7',0];
  graph['6']={class_type:'VHS_VideoCombine',inputs:{images:['5',0],frame_rate:24,filename_prefix:'video'}};
  const a=inspectWorkflow(graph);assert.equal(a.kind,'video');assert.equal(a.outputs[0].field,'gifs');assert.equal(a.inputs.image.node,'7');
});

test('chat graph detects user input, system, history and output without requiring a model preset',()=>{
  const a=inspectWorkflow({'1':{class_type:'QwenTE_MultiTurnChat',inputs:{'用户消息':'','对话历史JSON':'[]','请求ID':'old','增强设置':['2',0]}},'2':{class_type:'QwenTE_ChatSettings',inputs:{'系统提示词':'','温度':0.7,'最大生成token':256,seed:1}}});
  assert.equal(a.kind,'chat');assert.equal(a.inputs.prompt.field,'用户消息');assert.equal(a.inputs.system.node,'2');assert.equal(a.inputs.history.field,'对话历史JSON');assert.equal(a.outputs[0].field,'助手回复');
});

test('malformed JSON and dangling links cannot become ready imports',()=>{
  assert.throws(()=>inspectWorkflow('{broken'),/JSON/);
  const graph=imageGraph();graph['4'].inputs.positive=['999',0];assert.equal(inspectWorkflow(graph).ready,false);
});

test('Qwen native image JSON input is discovered separately from a LoadImage filename',()=>{
  const graph={'1':{class_type:'QwenTE_MultiTurnChat',inputs:{'用户消息':'','当前图片JSON':'[]'}}};
  const result=inspectWorkflow(graph);
  assert.deepEqual(result.inputs.images,{node:'1',field:'当前图片JSON'});assert.equal(result.inputs.image.node,'');
});

test('BOM and prompt wrappers are supported',()=>{
  assert.equal(inspectWorkflow('\uFEFF'+JSON.stringify({prompt:imageGraph()})).ready,true);
});

const info={
  CheckpointLoaderSimple:{input:{required:{ckpt_name:[['local.safetensors'],{}]}}},
  CLIPTextEncode:{input:{required:{text:['STRING',{}],clip:['CLIP',{}]}}},
  KSampler:{input:{required:{model:['MODEL',{}],positive:['CONDITIONING',{}],negative:['CONDITIONING',{}],seed:['INT',{control_after_generate:true}],steps:['INT',{}]}}},
  VAEDecode:{input:{required:{samples:['LATENT',{}],vae:['VAE',{}]}}},
  SaveImage:{input:{required:{images:['IMAGE',{}],filename_prefix:['STRING',{}]}}},
};
const ui=()=>({nodes:[
  {id:1,type:'CheckpointLoaderSimple',widgets_values:['local.safetensors'],inputs:[]},
  {id:2,type:'CLIPTextEncode',widgets_values:['bird'],inputs:[{name:'clip',link:1}]},
  {id:3,type:'CLIPTextEncode',widgets_values:['blur'],inputs:[{name:'clip',link:2}]},
  {id:4,type:'KSampler',widgets_values:[7,'randomize',20],inputs:[{name:'model',link:3},{name:'positive',link:4},{name:'negative',link:5}]},
  {id:5,type:'VAEDecode',widgets_values:[],inputs:[{name:'samples',link:6},{name:'vae',link:7}]},
  {id:6,type:'SaveImage',widgets_values:['output'],inputs:[{name:'images',link:8}]},
],links:[[1,1,1,2,0,'CLIP'],[2,1,1,3,0,'CLIP'],[3,1,0,4,0,'MODEL'],[4,2,0,4,1,'CONDITIONING'],[5,3,0,4,2,'CONDITIONING'],[6,4,0,5,0,'LATENT'],[7,1,2,5,1,'VAE'],[8,5,0,6,0,'IMAGE']]});

test('ordinary UI workflow converts widgets and skips seed-control widgets',()=>{
  const a=inspectWorkflow(ui(),info);assert.deepEqual(a.errors,[]);assert.equal(a.ready,true);
  assert.equal(a.api['4'].inputs.steps,20);assert.equal(a.api['4'].inputs.seed,7);assert.deepEqual(a.api['4'].inputs.positive,['2',0]);
});

test('reroute is resolved transparently',()=>{
  const graph=ui();graph.nodes.push({id:9,type:'Reroute',inputs:[{name:'input',type:'CONDITIONING',link:4}],outputs:[{type:'CONDITIONING'}]});graph.links=graph.links.filter(x=>x[0]!==4).concat([[4,2,0,9,0,'CONDITIONING'],[9,9,0,4,1,'CONDITIONING']]);graph.nodes.find(x=>x.id===4).inputs.find(x=>x.name==='positive').link=9;
  assert.deepEqual(convertUiWorkflow(graph,info).api['4'].inputs.positive,['2',0]);
});

test('missing definitions and mismatched dynamic widgets fail with actionable diagnostics',()=>{
  assert.equal(inspectWorkflow(ui(),{}).ready,false);
  const graph=ui();graph.nodes.find(x=>x.id===4).widgets_values=[7,'randomize','wrong'];
  assert.ok(inspectWorkflow(graph,info).errors.some(x=>x.includes('控件顺序')));
});

test('unused unknown UI nodes are ignored rather than blocking a valid output branch',()=>{
  const graph=ui();graph.nodes.push({id:99,type:'NotInstalledUnusedNode',widgets_values:['unused'],inputs:[]});
  const result=inspectWorkflow(graph,info);assert.equal(result.ready,true);assert.equal(result.api['99'],undefined);
});
