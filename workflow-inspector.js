const KEYS = ['prompt', 'negativePrompt', 'seed', 'image', 'images', 'imageEnabled', 'system', 'history', 'requestId', 'temperature', 'maxTokens'];
const empty = () => ({node: '', field: ''});
const linked = value => Array.isArray(value) && value.length === 2 && ['string','number'].includes(typeof value[0]) && Number.isInteger(value[1]);
const primitiveTypes = new Set(['STRING','INT','FLOAT','BOOLEAN']);
const controls = new Set(['fixed','increment','decrement','randomize','random','固定','随机','递增','递减']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function title(node, id) { return String(node._meta?.title || node.class_type || '节点') + '（' + id + '）'; }

export function convertUiWorkflow(graph, objectInfo = {}) {
  const errors = [], warnings = [], api = {};
  const nodes = new Map((graph.nodes || []).map(node => [String(node.id), node]));
  const links = new Map((graph.links || []).map(link => {
    if (Array.isArray(link)) return [String(link[0]), {origin: String(link[1]), slot: Number(link[2]), target: String(link[3])}];
    return [String(link.id), {origin: String(link.origin_id), slot: Number(link.origin_slot), target: String(link.target_id)}];
  }));
  const active = new Set();
  const roots = [...nodes.values()].filter(node=>node.mode!==2&&node.mode!==4&&(objectInfo[node.type]?.output_node||/(?:Save|Preview|Output).*(?:Image|Video|Text)|(?:Image|Video|Text).*(?:Save|Output)|VideoCombine|MultiTurnChat|showAnything/i.test(node.type)));
  function mark(id) {
    id=String(id);if(active.has(id))return;active.add(id);
    for(const input of nodes.get(id)?.inputs||[]){const link=links.get(String(input.link));if(link)mark(link.origin);}
  }
  if(roots.length)for(const node of roots)mark(node.id);else for(const id of nodes.keys())active.add(id);
  function resolveLink(linkId, stack = new Set()) {
    const link = links.get(String(linkId));
    if (!link) throw Error('找不到连线 ' + linkId);
    const node = nodes.get(link.origin);
    if (!node) throw Error('连线引用了不存在的节点 ' + link.origin);
    if (stack.has(link.origin)) throw Error('转接节点包含循环连线');
    const next = new Set([...stack, link.origin]);
    if (/^PrimitiveNode$/i.test(node.type)) {
      if (!Array.isArray(node.widgets_values) || !node.widgets_values.length) throw Error('常量节点没有可读取的值');
      return clone(node.widgets_values[0]);
    }
    if (/^Reroute$/i.test(node.type) || node.mode === 4) {
      const outputType = node.outputs?.[link.slot]?.type;
      const choices = (node.inputs || []).filter(input => input.link != null && (!outputType || input.type === outputType || input.type === '*'));
      if (choices.length !== 1) throw Error(title({_meta:{title:node.title},class_type:node.type}, node.id) + ' 无法确定绕过后的连线，请导出 API 格式');
      return resolveLink(choices[0].link, next);
    }
    if (node.mode === 2) throw Error('连线引用了已停用的节点 ' + node.id);
    return [String(node.id), link.slot];
  }
  for (const node of nodes.values()) {
    if(!active.has(String(node.id)))continue;
    if (node.mode === 2 || node.mode === 4 || /^(?:Reroute|PrimitiveNode|Note|MarkdownNote)$/i.test(node.type)) continue;
    const info = objectInfo[node.type];
    if (!info?.input) { errors.push(`无法读取「${node.title || node.type}」的节点定义，请连接安装了相应节点的 ComfyUI，或导出 API 格式后导入。`); continue; }
    const inputs = {}, sockets = new Map((node.inputs || []).map(input => [input.name, input]));
    const fields = [];
    for (const category of ['required','optional']) {
      const schema = info.input[category] || {};
      for (const name of info.input_order?.[category] || Object.keys(schema)) if (schema[name]) fields.push([name, schema[name], category]);
    }
    let cursor = 0;
    const widgets = node.widgets_values || [];
    const dictionary = widgets && !Array.isArray(widgets) && typeof widgets === 'object';
    for (const [name, spec, category] of fields) {
      const type = spec[0], options = spec[1] || {}, socket = sockets.get(name);
      const isWidget = Array.isArray(type) || primitiveTypes.has(type);
      try {
        if (socket?.link != null) {
          inputs[name] = resolveLink(socket.link);
          // Converted widgets remain serialized by LiteGraph even when hidden.
          if (socket.widget && isWidget && !dictionary) {
            cursor++;
            if ((options.control_after_generate || /^(?:seed|noise_seed)$/i.test(name)) && controls.has(String(widgets[cursor]).toLowerCase())) cursor++;
          }
          continue;
        }
        if (!isWidget || options.forceInput) {
          if (category === 'required') throw Error(`必需输入 ${name} 没有连接`);
          continue;
        }
        let value = dictionary ? widgets[name] : widgets[cursor++];
        if (value === undefined && Object.hasOwn(options, 'default')) value = clone(options.default);
        if (value === undefined) { if (category === 'optional') continue; throw Error(`无法读取 ${name} 的控件值`); }
        if (Array.isArray(type) && !type.includes(value)) throw Error(`${name} 的选项不在本机节点列表中，请在 ComfyUI 选择已安装的模型或文件后保存`);
        if (type === 'STRING' && typeof value !== 'string' || type === 'BOOLEAN' && typeof value !== 'boolean' || ['INT','FLOAT'].includes(type) && typeof value !== 'number') throw Error(`${name} 的控件顺序与当前节点定义不匹配`);
        inputs[name] = clone(value);
        if (!dictionary && (options.control_after_generate || /^(?:seed|noise_seed)$/i.test(name)) && controls.has(String(widgets[cursor]).toLowerCase())) cursor++;
      } catch (error) { errors.push(`「${node.title || node.type}」：${error.message}`); }
    }
    for (const socket of sockets.values()) if (socket.link != null && !Object.hasOwn(inputs, socket.name)) {
      try { inputs[socket.name] = resolveLink(socket.link); } catch (error) { errors.push(error.message); }
    }
    if (!dictionary && cursor < widgets.length) errors.push(`「${node.title || node.type}」存在未识别的动态控件；请导出 API 格式，避免错填参数。`);
    api[String(node.id)] = {class_type: node.type, inputs, _meta:{title:node.title || info.display_name || node.type}};
  }
  for (const [id,node] of Object.entries(api)) for (const value of Object.values(node.inputs)) if (linked(value) && !api[String(value[0])]) errors.push(`节点 ${id} 引用了无法转换的节点 ${value[0]}`);
  return {api, errors:[...new Set(errors)], warnings};
}

export function inspectWorkflow(raw, objectInfo = {}, {filename = '',preferredKind=''} = {}) {
  let graph;
  try { graph = typeof raw === 'string' ? JSON.parse(raw.replace(/^\uFEFF/, '')) : clone(raw); }
  catch { throw Error('文件不是有效的 JSON 工作流'); }
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw Error('请选择 ComfyUI JSON 工作流文件');
  if (graph.workflow?.nodes) graph = graph.workflow;
  if (graph.prompt && typeof graph.prompt === 'object' && !graph.class_type && !graph.nodes) graph = graph.prompt;
  const format = Array.isArray(graph.nodes) ? 'ui' : 'api';
  const converted = format === 'ui' ? convertUiWorkflow(graph, objectInfo) : {api:graph, errors:[], warnings:[]};
  const api = Object.fromEntries(Object.entries(converted.api).filter(([,node]) => node && typeof node.class_type === 'string' && node.inputs && typeof node.inputs === 'object'));
  const errors = [...converted.errors], warnings = [...converted.warnings];
  if (!Object.keys(api).length) errors.push('文件内没有可运行的工作流节点');
  for (const [id,node] of Object.entries(api)) for (const [field,value] of Object.entries(node.inputs)) if (linked(value) && !api[String(value[0])]) errors.push(`节点 ${id} 的 ${field} 引用了不存在的节点 ${value[0]}`);
  const outputs = [];
  for (const [id,node] of Object.entries(api)) {
    const type = node.class_type, label = title(node,id), info = objectInfo[type];
    if (/VideoCombine/i.test(type)) outputs.push({node:id,field:'gifs',kind:'video',label});
    else if (/(?:Save|Preview|Output).*Video|Video.*(?:Save|Output)/i.test(type)) outputs.push({node:id,field:/^SaveVideo$/i.test(type)?'images':'videos',kind:'video',label});
    else if (/(?:Save|Preview|Output).*Image|Image.*(?:Save|Output)/i.test(type)) outputs.push({node:id,field:'images',kind:'image',label});
    else if (/QwenTE_MultiTurnChat/i.test(type)) outputs.push({node:id,field:'助手回复',kind:'chat',label});
    else if (/(?:show|display|preview|save).*text|text.*(?:show|display|output)|showAnything/i.test(type)) outputs.push({node:id,field:'text',kind:'chat',label});
    else if (info?.output_node) {
      const types = info.output || [];
      const kind = types.includes('VIDEO') ? 'video' : types.includes('IMAGE') ? 'image' : types.includes('STRING') ? 'chat' : '';
      if (kind) outputs.push({node:id,field:kind==='chat'?'text':kind==='image'?'images':'videos',kind,label});
    }
  }
  const kind = ['chat','image','video'].includes(preferredKind)?preferredKind:outputs.some(output=>output.kind==='video') ? 'video' : outputs.some(output=>output.kind==='image') ? 'image' : 'chat';
  const selectedOutputs = outputs.filter(output=>output.kind===kind);
  const ancestors = new Set();
  function visit(id) {
    id=String(id);if(ancestors.has(id)||!api[id])return;ancestors.add(id);
    for(const value of Object.values(api[id].inputs))if(linked(value))visit(value[0]);
  }
  for(const output of selectedOutputs)visit(output.node);
  if(!selectedOutputs.length) { if(preferredKind==='chat')warnings.push('没有自动识别到文本输出，请手动选择实际回传文本的节点和字段；必要时在工作流添加文本显示节点');else errors.push('没有找到可返回图片、视频或文本的输出节点'); for(const id of Object.keys(api))ancestors.add(id); }
  // Mixed graphs need all text branches available when the user changes output type.
  if(preferredKind==='chat')for(const output of outputs.filter(x=>x.kind==='chat'))visit(output.node);
  const candidates = Object.fromEntries(KEYS.map(key=>[key,[]]));
  function add(key,id,field,score,reason) {
    if(!api[id]||!ancestors.has(String(id)))return;
    const prior=candidates[key].find(item=>item.node===String(id)&&item.field===field);
    if(prior){if(score>prior.score){prior.score=score;prior.reason=reason;}return;}
    candidates[key].push({node:String(id),field,label:title(api[id],id)+' · '+field,score,reason});
  }
  function textSource(id,field,seen=new Set()) {
    const marker=id+':'+field;if(seen.has(marker))return[];seen.add(marker);
    const node=api[id],value=node?.inputs?.[field];
    if(typeof value==='string')return[{id:String(id),field}];
    if(!linked(value))return[];
    const source=api[String(value[0])];if(!source)return[];
    return Object.entries(source.inputs).filter(([name,v])=>typeof v==='string'&&!/file|model|prefix|system|系统|路径/i.test(name)||linked(v)&&/text|prompt|value|string|提示|文本/i.test(name)).flatMap(([name])=>textSource(String(value[0]),name,seen));
  }
  function conditioning(id,key,seen=new Set()) {
    id=String(id);if(seen.has(id)||!api[id])return;seen.add(id);
    const node=api[id];
    if(key==='negativePrompt'&&/ConditioningZeroOut/i.test(node.class_type))return;
    for(const [field,value] of Object.entries(node.inputs)){
      if(/^(?:text|text_g|text_l|prompt|positive_prompt|negative_prompt|提示词|文本)$/i.test(field)) for(const origin of textSource(id,field))add(key,origin.id,origin.field,100,'连接到'+(key==='prompt'?'正向':'反向')+'条件');
      if(linked(value))conditioning(value[0],key,seen);
    }
  }
  for(const [id,node] of Object.entries(api))if(ancestors.has(id))for(const [field,value] of Object.entries(node.inputs)){
    if(linked(value)&&/^(?:positive|negative|正向条件|反向条件|正面条件|负面条件)$/i.test(field))conditioning(value[0],/negative|反向|负面/i.test(field)?'negativePrompt':'prompt');
    const label=String(node._meta?.title||'')+' '+node.class_type;
    if(typeof value==='number'&&/^(?:seed|noise_seed|随机种子)$/i.test(field))add('seed',id,field,90,'采样随机种子');
    if(/^(?:image|图片)$/i.test(field)&&typeof value==='string'&&/load|upload|加载|上传/i.test(label)&&!/mask|遮罩|掩码/i.test(label))add('image',id,field,90,'可替换的输入图片');
    if(preferredKind==='chat'&&typeof value==='boolean'&&/^(?:use_image|enable_image|image_enabled|使用图片|启用图片)$/i.test(field))add('imageEnabled',id,field,100,'随本轮是否有图片切换的布尔输入；请确认其含义');
    if(typeof value!=='string')continue;
    if(node.class_type === 'QwenTE_MultiTurnChat' && field === '当前图片JSON')add('images',id,field,110,'多模态聊天的本轮图片列表');
    if(/^(?:system|system_prompt|系统提示词)$/i.test(field))add('system',id,field,100,'系统提示词');
    else if(/history|历史/i.test(field))add('history',id,field,95,'对话历史');
    else if(/^(?:request_id|requestId|请求ID)$/i.test(field))add('requestId',id,field,100,'每轮请求标识');
    else if(/^(?:user_message|user_prompt|question|message|input_text|用户消息|用户输入|问题)$/i.test(field))add('prompt',id,field,110,'本轮用户输入');
    else if(/^(?:text|text_g|text_l|prompt|positive_prompt|negative_prompt|提示词|文本|value|值)$/i.test(field)&&!/file|filename|model|prefix|系统|system/i.test(label+' '+field)){
      const negative=/negative|反向|负面|负向/i.test(label+' '+field), positive=/positive|正向|正面/i.test(label+' '+field);
      const usable=/encode|prompt|string|text|chat|caption|文本|提示|对话/i.test(label)||/prompt|提示词/.test(field);
      if(usable)add(negative?'negativePrompt':'prompt',id,field,negative||positive?95:/prompt|提示词/.test(field)?75:55,negative?'标记为反向提示词':positive?'标记为正向提示词':'文本输入候选');
    }
    if(/^(?:temperature|温度)$/i.test(field))add('temperature',id,field,100,'生成温度');
  }
  if(preferredKind==='chat')for(const [id,node]of Object.entries(api))if(ancestors.has(id))for(const [field,value]of Object.entries(node.inputs)){
    if(typeof value==='string'&&!/file|model|prefix|path|system|history|request|api.?key|token|url|路径|系统|历史/i.test(field))add('prompt',id,field,20,'手动确认文本输入');
  }
  // Numeric chat settings are not prompt text.
  for(const [id,node]of Object.entries(api))if(ancestors.has(id))for(const [field,value]of Object.entries(node.inputs)){
    if(typeof value==='number'&&/^(?:temperature|温度)$/i.test(field))add('temperature',id,field,100,'生成温度');
    if(typeof value==='number'&&/^(?:max_tokens|max_new_tokens|最大生成token)$/i.test(field))add('maxTokens',id,field,100,'最大回复长度');
  }
  const inputs = {};
  for(const key of KEYS){
    candidates[key].sort((a,b)=>b.score-a.score||a.node.localeCompare(b.node));
    const [first,second]=candidates[key];
    inputs[key]=first&&first.score>=70&&(!second||first.score-second.score>=15)?{node:first.node,field:first.field}:empty();
    if(first&&!inputs[key].node)warnings.push(({'prompt':'提示词','negativePrompt':'反向提示词','seed':'随机种子','image':'输入图片'}[key]||key)+'有多个或不明确的候选，请从下拉框选择');
  }
  if(inputs.prompt.node&&inputs.prompt.node===inputs.negativePrompt.node&&inputs.prompt.field===inputs.negativePrompt.field){inputs.prompt=empty();inputs.negativePrompt=empty();warnings.push('正向和反向条件共用了同一个文本输入，需要选择要替换的位置');}
  if(!inputs.prompt.node)warnings.push('请确认用于接收本轮提示词的输入');
  if(selectedOutputs.length>1)warnings.push('存在多个输出节点，请选择要返回的结果');
  const manualOutputs=preferredKind==='chat'?Object.entries(api).map(([id,node])=>({node:id,field:'text',kind:'chat',manual:true,label:title(node,id)+' · 手动指定文本回执'})):[];
  return {api,format,name:String(filename||'新工作流').replace(/^.*[\\/]/,'').replace(/\.json$/i,''),kind,inputs,candidates,outputs,manualOutputs,warnings:[...new Set(warnings)],errors:[...new Set(errors)],ready:!errors.length&&!!inputs.prompt.node&&selectedOutputs.length===1};
}
