// Recognize the explicit text/edit selector in a Qwen Image 2.1 template.
// Unknown graphs retain their authored semantics. Changes affect a copy only.
export function prepareMediaWorkflow(graph,{kind,hasImage=false,recompose=false,outputNode=''}={}){
 if(kind!=='image'||hasImage&&!recompose)return graph;
 const encoders=Object.values(graph).filter(node=>node.class_type==='TextEncodeQwenImage21');
 if(!encoders.length)return graph;
 const selectors=Object.values(graph).filter(node=>node.class_type==='ComfySwitchNode'&&['on_true','on_false'].some(field=>graph[node.inputs?.[field]?.[0]]?.class_type==='EmptyLatentImage'));
 if(selectors.length!==1)return graph;
 const selector=selectors[0],empty=['on_true','on_false'].map(field=>selector.inputs[field]).find(link=>graph[link?.[0]]?.class_type==='EmptyLatentImage');
 // Both required branches must validate even when the runtime is lazy.
 selector.inputs.on_true=[...empty];selector.inputs.on_false=[...empty];
 // A persona reference conditions identity; a newly composed scene starts from
 // an empty latent instead of treating the reference's white sheet as the scene.
 if(!hasImage)for(const node of encoders)for(const key of Object.keys(node.inputs))if(/^images\.image_\d+$/.test(key))delete node.inputs[key];
 for(const node of Object.values(graph)){
  if(node.class_type!=='ComfySwitchNode')continue;
  const fields=['on_true','on_false'],decoded=fields.find(field=>graph[node.inputs?.[field]?.[0]]?.class_type==='VAEDecode');
  if(decoded){const link=node.inputs[decoded];node.inputs.on_true=[...link];node.inputs.on_false=[...link];}
 }
 if(!graph[outputNode])return graph;
 const reachable=new Set();
 const visit=id=>{id=String(id);if(reachable.has(id)||!graph[id])return;reachable.add(id);for(const value of Object.values(graph[id].inputs||{}))if(Array.isArray(value)&&value.length===2&&graph[value[0]]&&Number.isInteger(value[1]))visit(value[0]);};
 visit(outputNode);
 for(const id of Object.keys(graph))if(!reachable.has(id))delete graph[id];
 return graph;
}
