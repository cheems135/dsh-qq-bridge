// Apply the memory profile to the submitted copy, never the user's workflow.
// Unknown node families remain untouched rather than guessing their semantics.
import {applyWorkflowParameters} from './workflow-parameters.js';
export function modelBillions(filename = '') {
  const match = String(filename).match(/(?:^|[-_\\/])(\d+(?:\.\d+)?)B(?:[-_.\\/]|$)/i);
  return match ? Number(match[1]) : 0;
}

export function applyLocalGpuPolicy(workflow, {memoryProfile = '8gb', kind = '', vision = false,fastDialogue=false} = {}) {
  if (memoryProfile !== '8gb') return workflow;
  const qwenImage21=Object.values(workflow).some(node=>node.class_type==='TextEncodeQwenImage21');
  for (const node of Object.values(workflow)) {
    const input = node.inputs || {};
    if(qwenImage21){
      if(node.class_type==='CLIPLoader'&&input.type==='qwen_image'&&Object.hasOwn(input,'device'))input.device='cpu';
      if(node.class_type==='QwenImage21Cache'&&Object.hasOwn(input,'device'))input.device='cpu';
      if(['ResolutionSelector','ImageScaleToTotalPixels'].includes(node.class_type)&&Number(input.megapixels)>0.5)input.megapixels=0.5;
    }
    if (node.class_type === 'QwenTE_ModelLoader') {
      if(fastDialogue){if(Object.hasOwn(input,'启用思考'))input['启用思考']=false;if(Object.hasOwn(input,'保留历史think'))input['保留历史think']=false;}
      const size = modelBillions(input['主模型']);
      const bounded9B=size===9&&input['模型系列']==='Qwen3.5-VL'&&/Q4_K_[MS]\.gguf$/i.test(String(input['主模型']||''));
      input['上下文长度'] = Math.min(Number(input['上下文长度']) || 4096, bounded9B?8192:vision ? 6144 : 4096);
      if (Object.hasOwn(input,'KV缓存K类型')) input['KV缓存K类型'] = 'q8_0';
      if (Object.hasOwn(input,'KV缓存V类型')) input['KV缓存V类型'] = 'q8_0';
      if (size > 8) {
        if(bounded9B){
          // Bounded offload for a 9B Q4 dense model. Keep part of the model
          // on CPU and reserve space for its visual projection on an 8GB GPU.
          const requested=Number(input['GPU层数']);
          const layerLimit=input['上下文长度']>4096?20:28;
          input['GPU层数']=requested===0?0:Math.min(requested>0?requested:layerLimit,layerLimit);
        }else if (input['模型系列'] === 'Qwen3.6-VL' && Object.hasOwn(input,'MoE专家上CPU')) {
          input['MoE专家上CPU'] = true;
        } else if (Number(input['GPU层数']) !== 0) {
          // Dense/unknown large models: CPU inference avoids an unsafe guess
          // about layer count or quantization size. Users may opt out in UI.
          input['GPU层数'] = 0;
        }
      }
    }
    if (['QwenTE_ChatSettings','QwenTE_ImageInfer'].includes(node.class_type)) {
      if(fastDialogue&&Object.hasOwn(input,'输出think块'))input['输出think块']=false;
      if (Object.hasOwn(input,'最大边长')) input['最大边长'] = Math.min(Number(input['最大边长']) || 768, 768);
      if (kind === 'caption' && Object.hasOwn(input,'最大生成token')) input['最大生成token'] = Math.min(Number(input['最大生成token']) || 384, 384);
    }
  }
  return workflow;
}

// Capacity reporting, prompt fitting and runtime submission must use the same
// saved parameters and memory policy. Never alter the original workflow file.
export function workflowContextWindow(graph,spec={},options={}){
 const effective=applyLocalGpuPolicy(applyWorkflowParameters(structuredClone(graph),spec),options);
 const sizes=Object.values(effective).filter(n=>n.class_type==='QwenTE_ModelLoader').map(n=>Number(n.inputs?.['上下文长度'])).filter(n=>n>=1024);
 return sizes.length?Math.min(...sizes):4096;
}
