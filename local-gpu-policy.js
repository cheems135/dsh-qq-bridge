// Apply the memory profile to the submitted copy, never the user's workflow.
// Unknown node families remain untouched rather than guessing their semantics.
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
      input['上下文长度'] = Math.min(Number(input['上下文长度']) || 4096, vision ? 6144 : 4096);
      if (Object.hasOwn(input,'KV缓存K类型')) input['KV缓存K类型'] = 'q8_0';
      if (Object.hasOwn(input,'KV缓存V类型')) input['KV缓存V类型'] = 'q8_0';
      if (size > 8) {
        if (input['模型系列'] === 'Qwen3.6-VL' && Object.hasOwn(input,'MoE专家上CPU')) {
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
