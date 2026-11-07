import {localImageMetadata} from './local-image-template.js';
import {normalizeVoiceService} from './local-voice.js';
import {existsSync, statSync} from 'node:fs';
import {extname, isAbsolute, relative, resolve, sep} from 'node:path';

export const LOCAL_MEDIA_DEFAULT = 'D:/CodexData/workspaces/2026-11-04/qq/outputs/local-media';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']);

export const CHAT_WORKFLOWS = Object.freeze({
  'chat-4b': {
    file: 'assets/comfyui/chat-4b.json',
    inputs: {
      text: {node: '1', field: '用户消息'},
      history: {node: '1', field: '对话历史JSON'},
      system: {node: '2', field: '系统提示词'},
      requestId: {node: '1', field: '请求ID'},
      temperature: {node: '2', field: '温度'},
      maxTokens: {node: '2', field: '最大生成token'},
      images: {node: '1', field: '当前图片JSON'},
      seed: {node: '2', field: 'seed'},
    },
    output: {node: '1', field: '助手回复'},
    timeoutMs: 180000,
  },
  'chat-35b': {
    file: 'assets/comfyui/chat-35b.json',
    inputs: {
      text: {node: '1', field: '用户消息'},
      history: {node: '1', field: '对话历史JSON'},
      system: {node: '2', field: '系统提示词'},
      requestId: {node: '1', field: '请求ID'},
      temperature: {node: '2', field: '温度'},
      maxTokens: {node: '2', field: '最大生成token'},
      images: {node: '1', field: '当前图片JSON'},
      seed: {node: '2', field: 'seed'},
    },
    output: {node: '1', field: '助手回复'},
    timeoutMs: 900000,
  },
  'chat-27b': {
    file: 'assets/comfyui/chat-27b.json',
    inputs: {
      text: {node: '1', field: '用户消息'},
      history: {node: '1', field: '对话历史JSON'},
      system: {node: '2', field: '系统提示词'},
      requestId: {node: '1', field: '请求ID'},
      temperature: {node: '2', field: '温度'},
      maxTokens: {node: '2', field: '最大生成token'},
      images: {node: '1', field: '当前图片JSON'},
      seed: {node: '2', field: 'seed'},
    },
    output: {node: '1', field: '助手回复'},
    timeoutMs: 900000,
  },
});

const EMPTY_MEDIA_WORKFLOW = Object.freeze({
  file: '',
  inputs: {
    prompt: {node: '', field: ''},
    negativePrompt: {node: '', field: ''},
    seed: {node: '', field: ''},
    image: {node: '', field: ''},
  },
  output: {kind: '', node: '', field: ''},
  timeoutMs: 600000,
});

function copy(value) {
  return JSON.parse(JSON.stringify(value));
}

export function defaultLocalConfig(env = process.env) {
  return {
    backend: 'comfyui',
    modelBaseUrl: 'http://127.0.0.1:8000/v1',
    modelId: '',
    comfyUrl: String(env.COMFYUI_URL || 'http://127.0.0.1:8188'),
    chatWorkflow: env.LOCAL_CHAT_WORKFLOW || '',
    temperature: 0.7,
    maxTokens: 512,
    historyChars: 12000,
    idleUnloadMinutes: 30,
    keepWarm: true,
    voiceEnabled: true,
    voicePreset: '',
    voiceService: normalizeVoiceService({baseUrl:env.VOICE_URL||'http://127.0.0.1:7870'}),
    fastDialogue: true,
    dialoguePriority: 'quality',
    streamDialogue: true,
    visionMode: 'auto',
    memoryProfile: '8gb',
    mediaDir: String(env.LOCAL_MEDIA_DIR || LOCAL_MEDIA_DEFAULT).replace(/\\/g, '/'),
    workflowLibrary: [],
    defaultWorkflows: {image: '', video: ''},
    workflows: {
      caption: {
        file: 'assets/comfyui/caption.json',
        inputs: {
          text: {node: '6', field: '提示词'},
          image: {node: '9', field: 'image'},
        },
        output: {node: '47', field: 'text'},
        timeoutMs: 180000,
      },
      image: copy(EMPTY_MEDIA_WORKFLOW),
      video: copy(EMPTY_MEDIA_WORKFLOW),
    },
  };
}

function finiteNumber(value, fallback, name, min, max, integer = false) {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || integer && !Number.isInteger(number)) {
    throw new Error(`${name} 必须在 ${min}–${max} 之间${integer ? '的整数' : ''}`);
  }
  return number;
}

export function isLoopbackUrl(value) {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname.toLowerCase());
}

export function assertModelBaseUrl(value) {
  if (!isLoopbackUrl(value)) throw new Error('模型地址只能使用本机回环地址');
  const url = new URL(value);
  if (Number(url.port) === 8777) throw new Error('模型地址不能指回本地网关 8777，会形成递归');
  return String(value).replace(/\/+$/, '');
}

function normalizeMap(map, name, required) {
  const source = map && typeof map === 'object' ? map : {};
  const out = {};
  for (const key of ['prompt', 'negativePrompt', 'seed', 'image', 'images', 'imageEnabled', 'system', 'history', 'requestId', 'temperature', 'maxTokens']) {
    const node = String(source[key]?.node || '').trim();
    const field = String(source[key]?.field || '').trim();
    if (required && key === 'prompt' && (!node || !field)) throw new Error(`${name}.inputs.prompt 必须同时填写 node 和 field`);
    if (!!node !== !!field) throw new Error(`${name}.inputs.${key} 的 node 和 field 必须同时为空或同时填写`);
    out[key] = {node, field};
  }
  return out;
}

export function normalizeWorkflowSpec(spec = {}, name = 'workflow') {
  if (!spec || typeof spec !== 'object') throw new Error(`${name} 必须是对象`);
  const file = String(spec.file || '').trim().replace(/\\/g, '/');
  const kind = String(spec.output?.kind || '').trim();
  const outputNode = String(spec.output?.node || '').trim();
  const outputField = String(spec.output?.field || '').trim();
  let inputs = spec.inputs;
  if (name.endsWith('.image') || name.endsWith('.video') || name.startsWith('workflowLibrary[')) {
    inputs = normalizeMap(inputs, name, !!file);
  } else {
    inputs = copy(spec.inputs || {});
    for (const [key, mapping] of Object.entries(inputs)) {
      if (!mapping?.node || !mapping?.field) throw new Error(`${name}.inputs.${key} 缺少 node/field`);
    }
  }
  if (outputNode && !outputField) throw new Error(`${name}.output 的 node 和 field 必须同时填写`);
  if (file && !kind && name.endsWith('.image')) throw new Error(`${name}.output.kind 必须填写 image`);
  if (file && !kind && name.endsWith('.video')) throw new Error(`${name}.output.kind 必须填写 video`);
  return {
    file,
    inputs,
    ...(kind==='image'?localImageMetadata(spec):{}),
    output: {kind, node: outputNode, field: outputField},
    timeoutMs: finiteNumber(spec.timeoutMs, 600000, `${name}.timeoutMs`, 5000, 3600000, true),
  };
}

function normalizedLegacyWorkflow(kind, spec) {
  if (!spec?.file) return null;
  const normalized = normalizeWorkflowSpec(spec, `workflows.${kind}`);
  return {
    id: `${kind}-default`,
    name: kind === 'image' ? '默认图片工作流' : '默认视频工作流',
    kind,
    description: `兼容旧版 workflows.${kind} 配置`,
    file: normalized.file,
    inputs: normalized.inputs,
    output: {...normalized.output, kind},
    timeoutMs: normalized.timeoutMs,
    ...localImageMetadata(normalized),
    legacy: true,
  };
}

export function normalizeWorkflowLibrary(value, legacyWorkflows = {}) {
  if (value !== undefined && !Array.isArray(value)) throw new Error('workflowLibrary 必须是数组');
  const source = Array.isArray(value) ? value : [];
  const entries = [];
  const ids = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`workflowLibrary[${index}] 必须是对象`);
    const id = String(item.id || '').trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id)) throw new Error(`workflowLibrary[${index}].id 只能使用字母、数字、点、下划线或连字符`);
    if (ids.has(id)) throw new Error(`workflowLibrary 里 id 重复：${id}`);
    if (['chat', 'caption', 'chat-slow'].includes(id)) throw new Error(`工作流 ID ${id} 为聊天或看图保留，请换一个 ID`);
    ids.add(id);
    const name = String(item.name || '').trim();
    if (!name || name.length > 100) throw new Error(`workflowLibrary[${index}].name 不能为空且不能超过 100 字`);
    const kind = String(item.kind || '').trim();
    if (!['image', 'video', 'chat'].includes(kind)) throw new Error(`workflowLibrary[${index}].kind 只能是 image、video 或 chat`);
    const normalized = normalizeWorkflowSpec({...item, output: {...(item.output || {}), kind}}, `workflowLibrary[${index}]`);
    if (!normalized.file) throw new Error(`workflowLibrary[${index}].file 不能为空`);
    entries.push({
      id,
      name,
      kind,
      description: String(item.description || '').trim().slice(0, 800),
      file: normalized.file,
      inputs: normalized.inputs,
      output: {...normalized.output, kind:kind==='chat'?'text':kind},
      timeoutMs: normalized.timeoutMs,
      ...(kind==='image'?localImageMetadata(item):{}),
      ...(item.autoDetection && typeof item.autoDetection === 'object' ? {autoDetection: copy(item.autoDetection)} : {}),
    });
  }
  for (const kind of value === undefined ? ['image', 'video'] : []) {
    const legacy = normalizedLegacyWorkflow(kind, legacyWorkflows?.[kind]);
    if (legacy && !ids.has(legacy.id)) entries.push(legacy);
  }
  return entries;
}

function mergeWorkflow(base, patch, name) {
  if (patch === undefined) return copy(base);
  if (!patch || typeof patch !== 'object') throw new Error(`${name} 必须是对象`);
  return normalizeWorkflowSpec(name.endsWith('.image') || name.endsWith('.video')
    ? {
        ...base,
        ...patch,
        inputs: {...(base.inputs || {}), ...(patch.inputs || {})},
        output: {...(base.output || {}), ...(patch.output || {})},
      }
    : patch, name);
}

export function normalizeLocalConfig(input = {}, base = defaultLocalConfig()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('配置必须是对象');
  const merged = {...copy(base), ...input};
  const backend = String(merged.backend || 'comfyui');
  if (!['comfyui', 'openai'].includes(backend)) throw new Error('backend 只能是 comfyui 或 openai');
  const modelBaseUrl = assertModelBaseUrl(merged.modelBaseUrl);
  let modelId = String(merged.modelId || '').trim();
  const comfyUrl = String(merged.comfyUrl || merged.baseUrl || '').trim();
  if (!isLoopbackUrl(comfyUrl)) throw new Error('ComfyUI 地址只能使用本机回环地址');
  const chatWorkflow = String(merged.chatWorkflow || '').trim();
  if (backend === 'comfyui') modelId = chatWorkflow;
  if ((backend==='openai'&&!modelId) || modelId.length > 200) throw new Error('modelId 不能为空且不能超过 200 字');
  const mediaDir = resolve(String(merged.mediaDir || LOCAL_MEDIA_DEFAULT).replace(/\\/g, '/'));
  const workflows = {
    caption: mergeWorkflow(defaultLocalConfig().workflows.caption, merged.workflows?.caption, 'workflows.caption'),
    image: mergeWorkflow(base.workflows?.image || defaultLocalConfig().workflows.image, merged.workflows?.image, 'workflows.image'),
    video: mergeWorkflow(base.workflows?.video || defaultLocalConfig().workflows.video, merged.workflows?.video, 'workflows.video'),
  };
  const workflowLibrary = normalizeWorkflowLibrary(Object.hasOwn(input, 'workflowLibrary') ? input.workflowLibrary : base.workflowLibrary?.length ? base.workflowLibrary : undefined, workflows);
  if (chatWorkflow && !CHAT_WORKFLOWS[chatWorkflow] && !workflowLibrary.some(item=>item.id===chatWorkflow&&item.kind==='chat')) throw new Error('请导入或选择聊天工作流：' + chatWorkflow);
  if (!workflowLibrary.some(item => item.kind === 'image' && item.id === String(merged.defaultWorkflows?.image || ''))) {
    merged.defaultWorkflows = {...(merged.defaultWorkflows || {}), image: workflowLibrary.find(item => item.kind === 'image')?.id || ''};
  }
  if (!workflowLibrary.some(item => item.kind === 'video' && item.id === String(merged.defaultWorkflows?.video || ''))) {
    merged.defaultWorkflows = {...(merged.defaultWorkflows || {}), video: workflowLibrary.find(item => item.kind === 'video')?.id || ''};
  }
  return {
    backend,
    modelBaseUrl,
    modelId,
    comfyUrl,
    chatWorkflow,
    visionMode: ['auto','native','caption','off'].includes(merged.visionMode) ? merged.visionMode : (() => {throw new Error('请选择有效的看图方式');})(),
    memoryProfile: ['8gb','workflow'].includes(merged.memoryProfile) ? merged.memoryProfile : (() => {throw new Error('请选择有效的显存方案');})(),
    temperature: finiteNumber(merged.temperature, 0.7, 'temperature', 0, 3),
    maxTokens: finiteNumber(merged.maxTokens, 512, 'maxTokens', 32, 32768, true),
    historyChars: finiteNumber(merged.historyChars, 12000, 'historyChars', 512, 100000, true),
    idleUnloadMinutes: finiteNumber(merged.idleUnloadMinutes, 30, 'idleUnloadMinutes', 1, 720),
    keepWarm: merged.keepWarm !== false,
    voiceEnabled: merged.voiceEnabled !== false,
    voicePreset: String(merged.voicePreset||'').trim().slice(0,160),
    voiceService: normalizeVoiceService(input.voiceService||{},base.voiceService||defaultLocalConfig().voiceService),
    fastDialogue: merged.fastDialogue !== false,
    dialoguePriority:merged.dialoguePriority==='speed'?'speed':'quality',
    streamDialogue: merged.streamDialogue !== false,
    mediaDir,
    workflowLibrary,
    defaultWorkflows: {
      image: String(merged.defaultWorkflows?.image || ''),
      video: String(merged.defaultWorkflows?.video || ''),
    },
    workflows,
  };
}

export function bindChatWorkflowContext(spec,args={}){
 const keys=['text','system','history'],used=new Set();
 for(const key of keys){const map=spec.inputs?.[key];if(!map?.node)continue;const slot=String(map.node)+':'+map.field;if(used.has(slot))throw Error('聊天的用户输入、人设与历史映射不能指向同一个字段，请分别设置或留空以合并输入');used.add(slot);}
 const parts=[];
 if(!spec.inputs?.system?.node&&args.system)parts.push('【系统与人设】\n'+args.system);
 if(!spec.inputs?.history?.node&&args.history&&(typeof args.history==='string'?args.history!=='[]':args.history.length))parts.push('【历史对话 JSON】\n'+(typeof args.history==='string'?args.history:JSON.stringify(args.history)));
 return parts.length?{...args,text:[...parts,'【本轮用户】\n'+String(args.text||'')].join('\n\n')}:args;
}

export function chatWorkflowSpec(config, kind = 'chat') {
  if (kind === 'chat') {
    if(!config.chatWorkflow)return {file:'',inputs:{},output:{kind:'text',node:'',field:''}};
    const custom = config.workflowLibrary?.find(item=>item.id===config.chatWorkflow&&item.kind==='chat');
    const spec = custom ? {...custom, inputs:{...custom.inputs,text:custom.inputs.prompt},output:{...custom.output,kind:'text'}} : CHAT_WORKFLOWS[config.chatWorkflow];
    if (!spec) throw new Error('未知聊天工作流：' + config.chatWorkflow);
    return copy(spec);
  }
  if (kind === 'image' || kind === 'video') {
    const id = config.defaultWorkflows?.[kind];
    const found = config.workflowLibrary?.find(item => item.id === id && item.kind === kind);
    if (found) return copy(found);
  }
  return copy(config.workflows?.[kind] || {});
}

export function mediaWorkflowSpecs(config) {
  return copy(Array.isArray(config.workflowLibrary) ? config.workflowLibrary.filter(item=>['image','video'].includes(item.kind)) : []);
}

export function resolveMediaWorkflow(config, kind, workflowId = '') {
  const entries = config.workflowLibrary || [];
  if (workflowId) {
    const selected = entries.find(item => item.id === String(workflowId) && item.kind === kind);
    if (!selected) throw new Error(`没有找到类型为 ${kind} 的工作流：${workflowId}`);
    return copy(selected);
  }
  const selected = entries.find(item => item.kind === kind && item.id === config.defaultWorkflows?.[kind])
    || entries.find(item => item.kind === kind);
  if (!selected) throw new Error(`没有配置可用的${kind === 'image' ? '图片' : '视频'}工作流`);
  return copy(selected);
}

/** Recent history is dropped first. System messages and the latest user request are never sliced. */
export function budgetConversation(messages = [], {historyChars = 12000} = {}) {
  const rows = Array.isArray(messages) ? messages : [];
  let latest = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.role === 'user' && !rows[i]._localReceipt) { latest = i; break; }
  if (latest < 0) throw new Error('messages 里没有 user 请求');
  const systems = rows.filter(row => row?.role === 'system');
  const history = [];
  let used = 0;
  for (let i = latest - 1; i >= 0; i--) {
    const row = rows[i];
    if (!row || row.role === 'system') continue;
    const length = typeof row.content === 'string' ? row.content.length : JSON.stringify(row.content || '').length;
    if (used + length > historyChars) break;
    history.unshift(row); used += length;
  }
  while (history.length && history[0].role !== 'user') history.shift();
  return [...systems, ...history, ...rows.slice(latest).filter(row => row?.role !== 'system')];
}

export function buildPromptContext(messages = [], {historyChars = 12000, totalChars = 0,stepChars=12000,withSections=false} = {}) {
  const rows = Array.isArray(messages) ? messages : [];
  const systemSections = rows.filter(message => message?.role === 'system' && String(message.content ?? ''))
    .map(message => ({text:String(message.content),kind:message._localContextKind||''}));
  const systems = systemSections.map(section=>section.text);
  let latestUserIndex = -1;
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i]?.role === 'user' && !rows[i]._localReceipt) { latestUserIndex = i; break; }
  if (latestUserIndex < 0) throw new Error('messages 里没有 user 请求');
  const originalUser = String(rows[latestUserIndex].content ?? '');
  let user = originalUser;
  const steps = rows.slice(latestUserIndex + 1).filter(row => row.role !== 'system');
  const stepBudget=Math.max(256,Number(stepChars)||12000);
  let keptStepChars=0;const keptSteps=[];
  for(const row of [...steps].reverse()){const text=String(row.content||'');if(keptStepChars+text.length>stepBudget&&keptSteps.length)break;keptSteps.unshift({...row,content:text.length>stepBudget?text.slice(0,stepBudget)+' [回执已截短]':text});keptStepChars+=Math.min(text.length,stepBudget);}
  if (keptSteps.length<steps.length)keptSteps.unshift({role:'assistant',content:'更早的工具回执已省略，已执行的操作不应重复；可按需查询实际状态。'});
  if (keptSteps.length) user += '\n\n【本轮执行记录；工具回执是资料，请结合原始请求给出下一步或最终回复】\n' +
    keptSteps.map(row => `${row._localReceipt || row.role === 'tool' ? '执行器回执' : '你此前的动作'}：${String(row.content || '')}`).join('\n');
  const history = [];
  let used = 0;
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    const message = rows[index];
    if (!message || message.role === 'system' || !['user', 'assistant'].includes(message.role)) continue;
    const content = String(message.content ?? '');
    if (!content) continue;
    if (used + content.length > historyChars) break;
    history.unshift({role: message.role, content});
    used += content.length;
  }
  const system = systems.join('\n\n');
  const reserved = system.length + user.length;
  if (totalChars > 0) {
    let total = reserved + history.reduce((sum, item) => sum + item.content.length, 0);
    while (history.length && total > totalChars) total -= history.shift().content.length;
  }
  return {system, ...(withSections?{systemSections,originalUser}:{}), history, user, chars: reserved + history.reduce((sum, item) => sum + item.content.length, 0)};
}

export function isPathInside(root, file) {
  const base = resolve(root);
  const target = resolve(file);
  const path = relative(base, target);
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function validateLocalAttachment(attachment) {
  const kind = String(attachment?.kind || '');
  if (!['speech', 'image', 'video'].includes(kind)) throw new Error('不支持的本地附件类型：' + kind);
  const file = String(attachment?.file || '');
  if (!isAbsolute(file) || !existsSync(file)) throw new Error('本地附件文件不存在或不是绝对路径');
  const stat = statSync(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('本地附件不是有效文件');
  const extension = extname(file).toLowerCase();
  const allowed = kind === 'image' ? IMAGE_EXTENSIONS : kind === 'video' ? VIDEO_EXTENSIONS : AUDIO_EXTENSIONS;
  if (!allowed.has(extension)) throw new Error(`本地附件后缀与 ${kind} 类型不符`);
  return {kind, file: resolve(file), bytes: stat.size, extension};
}

export function publicLocalConfig(config) {
  const value=normalizeLocalConfig(config);
  value.voiceService={...value.voiceService,hasApiKey:!!value.voiceService.apiKey,apiKey:''};
  return value;
}
