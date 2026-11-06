import {createHash} from 'node:crypto';

// Describe the submitted copy, after mode selection, GPU policy and uploads.
// Connectivity describes graph wiring; it is not a claim of identity fidelity.
export function describeLocalWorkflow(graph,spec={},id=''){
 const output=String(spec.output?.node||''),reachable=new Set();
 const visit=id=>{id=String(id);if(reachable.has(id)||!graph[id])return;reachable.add(id);for(const value of Object.values(graph[id].inputs||{}))if(Array.isArray(value)&&value.length===2&&graph[value[0]]&&Number.isInteger(value[1]))visit(value[0]);};visit(output);
 const fields=/^(?:width|height|batch_size|cfg|guidance|denoise|strength|strength_model|strength_clip|steps|sampler_name|scheduler|seed|noise_seed|switch|add_noise|start_at_step|end_at_step|megapixels|aspect_ratio|multiple|resolution|resolution_steps|device|dtype|weight_dtype|(?:unet|clip|vae|lora|ckpt|model)_?name)$/i;
 const nodes=Object.entries(graph).map(([nodeId,node])=>({id:nodeId,type:node.class_type,onOutputPath:reachable.has(nodeId),parameters:Object.fromEntries(Object.entries(node.inputs||{}).filter(([key,value])=>fields.test(key)&&['string','number','boolean'].includes(typeof value)).map(([key,value])=>[key,typeof value==='string'?value.slice(0,500):value])),links:Object.entries(node.inputs||{}).filter(([,value])=>Array.isArray(value)&&value.length===2&&graph[value[0]]&&Number.isInteger(value[1])).map(([input,value])=>({input,node:String(value[0]),output:value[1]}))}));
 const binding=spec.inputs?.image||{},imageNode=graph[binding.node],imageValue=imageNode?.inputs?.[binding.field];
 return {id,name:spec.name||id,graphSha256:createHash('sha256').update(JSON.stringify(graph)).digest('hex'),output:spec.output||{},imageBinding:{node:String(binding.node||''),field:binding.field||'',value:typeof imageValue==='string'?imageValue:'',onOutputPath:!!binding.node&&reachable.has(String(binding.node))},nodes};
}
