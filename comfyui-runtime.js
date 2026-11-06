import {applyLocalImageFixedPrompts} from './local-image-template.js';
// ComfyUI runtime: declarative workflow mapping, serial GPU execution, and
// verified media retrieval. Workflow JSON remains under assets/comfyui.
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {extname, isAbsolute, join, resolve} from 'node:path';
import {applyLocalGpuPolicy} from './local-gpu-policy.js';
import {prepareMediaWorkflow} from './local-workflow-mode.js';
import {readComfyContext} from './local-context.js';
import {describeLocalWorkflow} from './local-workflow-diagnostics.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.gif']);
const AUDIO_EXTENSIONS = new Set(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac']);
const DEFAULT_MAX_BYTES = {image: 64 * 1024 * 1024, video: 512 * 1024 * 1024, audio: 128 * 1024 * 1024, speech: 128 * 1024 * 1024};

function apiWorkflow(spec, root) {
  if (spec?.api && typeof spec.api === 'object') return JSON.parse(JSON.stringify(spec.api));
  if (!spec?.file) throw new Error('工作流没有配置 file');
  const file = isAbsolute(spec.file) ? spec.file : join(root, spec.file);
  if (!existsSync(file)) throw new Error('找不到工作流文件：' + file);
  const workflow = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (Array.isArray(workflow?.nodes)) throw new Error('这是 ComfyUI 画布文件，请先导出 API 格式的工作流 JSON 再接入');
  return workflow;
}

function setField(workflow, map, key, value) {
  const spec = map?.[key];
  if (!spec || !spec.node && !spec.field) return false;
  if (value === undefined || value === null) return false;
  if (!spec.node || !spec.field) throw new Error(`工作流输入 ${key} 没有完整 node/field 映射`);
  const node = workflow[String(spec.node)];
  if (!node?.inputs) throw new Error(`工作流里没有节点 ${spec.node}（写入 ${key}）`);
  if (!Object.hasOwn(node.inputs, spec.field)) throw new Error(`节点 ${spec.node} 没有输入字段 ${spec.field}，请检查 ${key} 映射`);
  node.inputs[spec.field] = value;
  if (String(node.inputs[spec.field]) !== String(value)) throw new Error(`写入 ${key} 后回读不一致`);
  return true;
}

function readTextOutput(entry, spec) {
  if (!spec?.node) return '';
  const node = entry?.outputs?.[String(spec.node)];
  if (!node) return '';
  if (spec.kind && spec.kind !== 'text') return '';
  const raw = node[spec.field || 'text'] ?? node.text ?? node.string;
  const text = Array.isArray(raw) ? raw.join('\n') : raw;
  return String(text ?? '').trim();
}

function validateRemotePart(value, allowSlash = false) {
  const raw = String(value || '');
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new Error('ComfyUI 输出路径不合法');
  const parts = allowSlash ? raw.split('/') : [raw];
  if (!raw || parts.some(part => !part || part === '.' || part === '..')) throw new Error('ComfyUI 输出路径包含路径遍历');
  return raw;
}

function detectMime(bytes) {
  const hex = bytes.subarray(0, 16).toString('hex');
  const ascii = bytes.subarray(0, 16).toString('ascii');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (ascii.startsWith('GIF87a') || ascii.startsWith('GIF89a')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'audio/wav';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.startsWith('OggS')) return 'audio/ogg';
  if (ascii.startsWith('ID3') || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  if (ascii.startsWith('fLaC')) return 'audio/flac';
  if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
  if (hex.startsWith('1a45dfa3')) return 'video/webm';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'AVI ') return 'video/x-msvideo';
  return '';
}

function extensionMime(extension) {
  return {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
    '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  }[extension] || '';
}

function compatible(kind, mime, extension) {
  if (!mime) return false;
  if (kind === 'image') return IMAGE_EXTENSIONS.has(extension) && mime.startsWith('image/');
  if (kind === 'video') return VIDEO_EXTENSIONS.has(extension) && (mime.startsWith('video/') || extension === '.gif' && mime === 'image/gif');
  return AUDIO_EXTENSIONS.has(extension) && (mime.startsWith('audio/') || mime === 'application/ogg' || mime === 'application/octet-stream');
}

export function collectComfyOutputs(entry) {
  const result = {images: [], videos: [], audio: [], text: []};
  for (const node of Object.values(entry?.outputs || {})) {
    for (const file of node?.images || []) (/\.(?:mp4|webm|mov|mkv)$/i.test(file.filename||'')?result.videos:result.images).push({...file, kind:/\.(?:mp4|webm|mov|mkv)$/i.test(file.filename||'')?'video':'image'});
    for (const file of node?.gifs || []) result.videos.push({...file, kind: 'video'});
    for (const file of node?.videos || []) result.videos.push({...file, kind: 'video'});
    for (const file of node?.audio || []) result.audio.push({...file, kind: 'audio'});
    for (const value of [node?.text, node?.string]) if (typeof value === 'string' && value.trim()) result.text.push(value.trim());
  }
  for (const key of Object.keys(result)) {
    if (key === 'text') continue;
    const seen = new Set();
    result[key] = result[key].filter(file => {
      const id = [file.type || 'output', file.subfolder || '', file.filename || ''].join('/');
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }
  return result;
}

function abortError() {
  return Object.assign(new Error('任务等待已取消；只停止本任务，不中断 ComfyUI 其他任务'), {name: 'AbortError'});
}

function sleep(ms, signal) {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(abortError());
    const abort = () => {
      clearTimeout(timer);
      fail(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', abort);
      done();
    }, ms);
    signal?.addEventListener?.('abort', abort, {once: true});
  });
}

function requestSignal(parent, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(abortError());
  if (parent?.aborted) abort();
  else parent?.addEventListener?.('abort', abort, {once: true});
  const timer = setTimeout(() => controller.abort(new Error('ComfyUI HTTP 请求超时')), timeoutMs);
  if (typeof timer.unref === 'function') timer.unref();
  return {
    signal: controller.signal,
    close() {
      clearTimeout(timer);
      parent?.removeEventListener?.('abort', abort);
    },
  };
}

async function uploadImage(baseUrl, file, fetchImpl, signal) {
  if (!existsSync(file)) throw new Error('要识别的图片不存在：' + file);
  const bytes = readFileSync(file);
  if (bytes.length > 32 * 1024 * 1024) throw new Error('图片超过 32MB，先压缩再识别');
  const form = new FormData();
  const extension = ['.png','.webp','.gif'].includes(extname(file).toLowerCase()) ? extname(file).toLowerCase() : '.jpg';
  const name = 'bridge-' + createHash('sha256').update(bytes).digest('hex').slice(0, 12) + extension;
  form.append('image', new Blob([bytes]), name);
  form.append('overwrite', 'true');
  form.append('type', 'input');
  const scoped = requestSignal(signal, 60000);
  try {
    const response = await fetchImpl(baseUrl.replace(/\/+$/, '') + '/upload/image', {method: 'POST', body: form, signal: scoped.signal});
    const body = await response.text();
    if (!response.ok) throw new Error('上传图片失败：' + response.status + ' ' + body.slice(0, 160));
    const parsed = JSON.parse(body);
    if (!parsed?.name) throw new Error('ComfyUI 没有返回上传后的文件名');
    return parsed.subfolder ? `${parsed.subfolder}/${parsed.name}` : parsed.name;
  } finally {
    scoped.close();
  }
}

export function createComfyRuntime({getConfig, root, fetchImpl = fetch} = {}) {
  let chain = Promise.resolve();
  let seq = 0;
  let idleTimer = null;
  let lastUsed = 0;
  let streamCheckedAt=0,streamAvailable=false;
  const recent = [];

  const config = () => {
    const value = typeof getConfig === 'function' ? getConfig() || {} : getConfig || {};
    return {
      enabled: value.enabled !== false,
      baseUrl: value.comfyUrl || value.baseUrl || 'http://127.0.0.1:8188',
      mediaDir: value.mediaDir,
      keepWarm: value.keepWarm !== false,
      idleUnloadMinutes: value.idleUnloadMinutes ?? 10,
      workflows: value.workflows || {},
      ...value,
    };
  };

  function callJson(baseUrl, pathname, init = {}, signal) {
    const scoped = requestSignal(signal, 20000);
    return (async () => {
      try {
        const response = await fetchImpl(baseUrl.replace(/\/+$/, '') + pathname, {...init, signal: scoped.signal});
        const text = await response.text();
        if (!response.ok) throw new Error(`ComfyUI ${pathname} -> ${response.status} ${text.slice(0, 160)}`);
        try {
          return JSON.parse(text);
        } catch {
          return text;
        }
      } finally {
        scoped.close();
      }
    })();
  }

  async function streamStatus(){
    if(Date.now()-streamCheckedAt<30000)return {available:streamAvailable};
    streamCheckedAt=Date.now();try{const value=await callJson(config().baseUrl,'/qq_bridge/stream/health');streamAvailable=value.available===true&&value.version===1;}catch{streamAvailable=false;}
    return {available:streamAvailable};
  }
  async function waitFor(baseUrl, promptId, timeoutMs, signal,stream={}) {
    const started = Date.now();
    let offset=0,streaming=!!stream.onText;
    for (;;) {
      if (signal?.aborted) throw abortError();
      if(streaming){let value;try{value=await callJson(baseUrl,'/qq_bridge/stream/'+encodeURIComponent(stream.requestId)+'?after='+offset,{},signal);}catch(error){if(signal?.aborted)throw error;streaming=false;}
        if(value){if(typeof value.text==='string'&&value.text)stream.onText(value.text);offset=Number(value.offset)||offset;}}
      const history = await callJson(baseUrl, '/history/' + encodeURIComponent(promptId), {}, signal);
      const entry = history?.[promptId];
      if (entry?.status?.status_str === 'error') {
        const error = (entry.status.messages || []).find(message => message[0] === 'execution_error');
        throw new Error('ComfyUI 执行失败：' + String(error?.[1]?.exception_message || '').slice(0, 200));
      }
      if (entry?.outputs && Object.keys(entry.outputs).length) return entry;
      if (Date.now() - started > timeoutMs) throw new Error('ComfyUI 结果未知：超时未完成，任务可能仍在队列中；未自动重试');
      await sleep(300, signal);
    }
  }

  async function downloadOutput(baseUrl, item, kind, mediaDir, promptId, index, signal, maxBytes) {
    const filename = validateRemotePart(item.filename);
    if (filename.includes('/')) throw new Error('ComfyUI 输出文件名不能包含路径');
    const subfolder = item.subfolder ? validateRemotePart(item.subfolder, true) : '';
    const type = String(item.type || 'output');
    if (!['output', 'temp', 'input'].includes(type)) throw new Error('ComfyUI 输出类型不合法');
    const extension = extname(filename).toLowerCase();
    if (!extensionMime(extension)) throw new Error('ComfyUI 输出后缀不在允许列表：' + extension);
    const query = new URLSearchParams({filename, subfolder, type});
    const scoped = requestSignal(signal, 120000);
    try {
      const response = await fetchImpl(baseUrl.replace(/\/+$/, '') + '/view?' + query.toString(), {signal: scoped.signal});
      if (!response.ok) throw new Error('下载 ComfyUI 产物失败：HTTP ' + response.status);
      const declared = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const declaredLength = Number(response.headers.get('content-length') || 0);
      const limit = Number(maxBytes || DEFAULT_MAX_BYTES[kind] || DEFAULT_MAX_BYTES.image);
      if (declaredLength > limit) throw new Error('ComfyUI 产物超过允许大小');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length) throw new Error('ComfyUI 返回了空产物');
      if (bytes.length > limit) throw new Error('ComfyUI 产物超过允许大小');
      const detected = detectMime(bytes);
      const mime = detected || declared;
      if (!mime || declared && declared !== 'application/octet-stream' && declared !== mime && !(kind === 'video' && declared === 'image/gif' && mime === 'image/gif')) {
        throw new Error(`ComfyUI 产物 MIME 与内容不符：${declared || '(无)'} / ${mime || '(未知)'}`);
      }
      const outputKind = kind === 'image' ? 'image' : kind === 'video' ? 'video' : 'audio';
      if (!compatible(outputKind, mime, extension)) throw new Error(`ComfyUI 产物类型与后缀不符：${mime} ${extension}`);
      mkdirSync(mediaDir, {recursive: true});
      const safe = `${String(promptId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)}-${outputKind}-${index}-${randomUUID().slice(0, 8)}${extension}`;
      const file = resolve(join(mediaDir, safe));
      if (!file.startsWith(resolve(mediaDir) + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('媒体输出路径越界');
      writeFileSync(file, bytes);
      return {kind: outputKind, file, mime, bytes: bytes.length};
    } finally {
      scoped.close();
    }
  }

  async function downloadMedia(baseUrl, entry, mediaDir, promptId, signal, maxBytes) {
    const collected = collectComfyOutputs(entry);
    const candidates = [
      ...collected.images.map(item => ({item, kind: 'image'})),
      ...collected.videos.map(item => ({item, kind: 'video'})),
      ...collected.audio.map(item => ({item, kind: 'audio'})),
    ];
    const media = [];
    try {
      let index = 0;
      for (const candidate of candidates) {
        media.push(await downloadOutput(baseUrl, candidate.item, candidate.kind, mediaDir, promptId, ++index, signal, maxBytes));
      }
      return {media, collected};
    } catch (error) {
      for (const item of media) try {
        unlinkSync(item.file);
      } catch {}
      throw error;
    }
  }

  async function run(kind, args = {}, options = {}) {
    const c = config();
    if (!c.enabled) throw new Error('ComfyUI 能力在插件设置里已关闭');
    const spec = c.workflows?.[kind];
    if (!spec) throw new Error('没有登记名为 ' + kind + ' 的工作流');
    const signal = options.signal;
    if (signal?.aborted) throw abortError();
    const job = {id: 'cm' + (++seq), kind, at: Date.now(), promptId: ''};
    const start = Date.now();

    // Every task and release shares this chain. Cancellation only rejects this
    // waiter; it never sends /interrupt for other ComfyUI work.
    const task = chain.then(async () => {
      if (signal?.aborted) throw abortError();
      const workflow = applyLocalGpuPolicy(prepareMediaWorkflow(apiWorkflow(spec, root),{kind:spec.output?.kind,hasImage:!!args.image,recompose:args.recomposeScene===true,outputNode:spec.output?.node}), {memoryProfile:c.memoryProfile || 'workflow',kind,vision:kind==='caption'||!!args.image||!!args.imageFiles?.length,fastDialogue:args.fastDialogue===true});
      if(args.requirePersonaReference===true){
        const binding=spec.inputs?.image;
        if(!args.image||!binding?.node||!binding.field||!Object.hasOwn(workflow[binding.node]?.inputs||{},binding.field))throw Error('人设参考图或输入映射缺失，未提交纯文字生图');
        if(!describeLocalWorkflow(workflow,spec,kind).imageBinding.onOutputPath)throw Error('人设图输入未连接到当前输出分支，未提交生成任务');
      }
      if (args.imageFiles?.length) {
        if (!spec.inputs?.images?.node && !spec.inputs?.image?.node) throw new Error('聊天工作流没有图片输入映射，请重新识别或改用独立视觉识别');
        if (!spec.inputs?.images?.node && args.imageFiles.length>1) throw new Error('这份聊天工作流只支持单张图片，请只发送一张或改用独立视觉识别');
        const uploaded=[];
        for (const file of args.imageFiles.slice(0,3)) {
          const name=await uploadImage(c.baseUrl,String(file),fetchImpl,signal);
          const slash=name.lastIndexOf('/');
          uploaded.push({filename:name.slice(slash+1),subfolder:slash>=0?name.slice(0,slash):'',type:'input'});
        }
        if (spec.inputs?.images?.node) setField(workflow,spec.inputs,'images',JSON.stringify(uploaded));
        else setField(workflow,spec.inputs,'image',uploaded[0].subfolder?uploaded[0].subfolder+'/'+uploaded[0].filename:uploaded[0].filename);
      }
      let imageName = '';
      if (args.image) imageName = await uploadImage(c.baseUrl, String(args.image), fetchImpl, signal);
      if (imageName) setField(workflow, spec.inputs, 'image', imageName);
      for (const key of ['text', 'history', 'system', 'requestId', 'temperature', 'maxTokens', 'seed', 'prompt', 'negativePrompt']) {
        let value = args[key];
        if (key === 'history' && value !== undefined) value = typeof value === 'string' ? value : JSON.stringify(value || []);
        setField(workflow, spec.inputs, key, value);
      }
      for (const [key, value] of Object.entries(args.params || {})) setField(workflow, spec.inputs, key, value);
      if(args.requirePersonaReference===true){
        const bound=describeLocalWorkflow(workflow,spec,kind).imageBinding;
        if(!imageName||bound.value!==imageName||!bound.onOutputPath)throw Error('人设图上传后未正确绑定到工作流，未提交生成任务');
      }
      if(spec.output?.kind==='image')applyLocalImageFixedPrompts(workflow,spec,args.fixedPrompts||[]);
      if (kind === 'image' || kind === 'video') {
        if (spec.inputs?.prompt && !String(args.prompt || '').trim()) throw new Error('图片/视频工作流缺少 prompt');
      }
      if(['image','video'].includes(spec.output?.kind)){
        const mapped=Object.fromEntries(Object.entries(spec.inputs||{}).map(([key,binding])=>[key,{node:String(binding.node||''),field:binding.field,value:workflow[binding.node]?.inputs?.[binding.field]}]));
        options.onInvocation?.({status:'submitted',kind:spec.output.kind,workflow:kind,workflowDetails:describeLocalWorkflow(workflow,spec,kind),submittedArguments:{prompt:args.prompt,negativePrompt:args.negativePrompt||'',fixedPrompts:args.fixedPrompts||[],seed:args.seed,referenceImage:!!args.image,sceneRecompose:args.recomposeScene===true,submittedNodes:mapped}});
      }
      const stream=args.streamText&&options.onText&&(await streamStatus()).available?{requestId:args.requestId,onText:options.onText}:{};
      const submitted = await callJson(c.baseUrl, '/prompt', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({prompt: workflow, client_id: 'bridge-' + job.id}),
      }, signal);
      if (!submitted?.prompt_id) throw new Error('ComfyUI 没有返回 prompt_id：' + JSON.stringify(submitted).slice(0, 160));
      job.promptId = submitted.prompt_id;
      options.onInvocation?.({status:'submitted',kind:spec.output?.kind||kind,workflow:kind,promptId:submitted.prompt_id,clientId:'bridge-'+job.id});
      let entry;
      try{entry=await waitFor(c.baseUrl, submitted.prompt_id, Number(spec.timeoutMs || 600000), signal,stream);}
      catch(error){
        if(signal?.aborted&&options.interruptOnAbort===true&&c.targetedInterrupt===true){
          const cleanupSignal=AbortSignal.timeout(2500);
          try{await callJson(c.baseUrl,'/queue',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({delete:[submitted.prompt_id]})},cleanupSignal);}catch{}
          try{await fetchImpl(c.baseUrl.replace(/\/+$/,'')+'/interrupt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt_id:submitted.prompt_id}),signal:cleanupSignal});}catch{}
        }
        throw error;
      }
      const mediaDir = resolve(String(c.mediaDir || process.env.LOCAL_MEDIA_DIR || resolve(process.cwd(), 'outputs', 'local-media')));
      const mediaEntry = ['image','video'].includes(spec.output?.kind) && spec.output?.node ? {outputs:{[spec.output.node]:entry.outputs?.[spec.output.node]||{}}} : entry;
      const {media, collected} = await downloadMedia(c.baseUrl, mediaEntry, mediaDir, submitted.prompt_id, signal, spec.maxBytes || c.maxBytes);
      const expectedKind = spec.output?.kind || (['image', 'video'].includes(kind) ? kind : '');
      const selectedMedia = ['image', 'video'].includes(expectedKind) ? media.filter(item => item.kind === expectedKind) : media;
      for (const preview of media.filter(item => !selectedMedia.includes(item))) try { unlinkSync(preview.file); } catch {}
      if (['image', 'video'].includes(expectedKind) && !selectedMedia.length) {
        throw new Error(`工作流没有返回 ${expectedKind === 'image' ? '图片' : '视频'} 产物，未将预览图当作最终结果`);
      }
      const text = readTextOutput(entry, spec.output) || collected.text[0] || '';
      if (!text && !media.length) throw new Error('ComfyUI 已结束，但没有返回文字、图片、视频或音频产物');
      return {
        ok: true,
        kind,
        text,
        context:readComfyContext(entry,spec.output?.node),
        media: selectedMedia,
        files: selectedMedia.map(item => item.file),
        attachments: selectedMedia.map(item => ({kind: item.kind, file: item.file})),
        promptId: submitted.prompt_id,
        elapsedMs: Date.now() - start,
        coverage: text && media.length ? 'ComfyUI 实际执行完成，已取得文字和媒体文件' : media.length ? 'ComfyUI 实际执行完成，媒体文件已下载并校验' : 'ComfyUI 实际执行完成，文本取自输出节点',
      };
    });
    chain = task.catch(() => {});
    try {
      const result = await task;
      lastUsed = Date.now();
      scheduleIdleUnload();
      if (c.keepWarm === false) await release();
      recent.push({...job, ok: true, elapsedMs: result.elapsedMs});
      if (recent.length > 20) recent.shift();
      return result;
    } catch (error) {
      recent.push({...job, ok: false, elapsedMs: Date.now() - start, error: String(error?.message || error).slice(0, 300)});
      if (recent.length > 20) recent.shift();
      throw error;
    }
  }

  const idleMs = () => Math.max(0.5, Number(config().idleUnloadMinutes ?? 10)) * 60000;
  const UNLOAD_WORKFLOW = {
    '1': {class_type: 'QwenTE_Unload', inputs: {'任意输入': ['2', 0]}},
    '2': {class_type: 'QwenTE_SkillLoader', inputs: {skill: '自动选择'}},
    '3': {class_type: 'easy showAnything', inputs: {anything: ['1', 0]}},
  };

  async function freeModelsNow(options = {}) {
    const c = config();
    const signal = options.signal;
    try {
      const queue=await callJson(c.baseUrl,'/queue',{},signal);
      if (queue?.queue_running?.length || queue?.queue_pending?.length) return {ok:false,freed:false,busy:true,error:'ComfyUI 有正在运行或排队的任务，保留任务及模型，稍后再释放'};
      const workflow = c.unloadWorkflow || UNLOAD_WORKFLOW;
      const submitted = await callJson(c.baseUrl, '/prompt', {
        method: 'POST',
        headers: {'content-type': 'application/json'},
        body: JSON.stringify({prompt: workflow, client_id: 'bridge-unload-' + randomUUID()}),
      }, signal);
      if (!submitted?.prompt_id) throw new Error('ComfyUI 未确认模型卸载任务，未将显存视为已释放');
      await waitFor(c.baseUrl, submitted.prompt_id, 30000, signal);
      const after=await callJson(c.baseUrl,'/queue',{},signal);
      if (after?.queue_running?.length || after?.queue_pending?.length) return {ok:false,freed:false,busy:true,error:'卸载后有新的 ComfyUI 任务，保留运行，暂不叠加其他 GPU 模型'};
      await callJson(c.baseUrl, '/free', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({unload_models: true, free_memory: true})}, signal);
      recent.push({id: 'unload', kind: 'unload', ok: true, at: Date.now()});
      return {ok: true, freed: true};
    } catch (error) {
      if (signal?.aborted) throw abortError();
      return {ok: false, freed: false, error: String(error?.message || error)};
    }
  }

  function scheduleIdleUnload() {
    if (idleTimer) clearTimeout(idleTimer);
    if (!config().keepWarm) return;
    const wait = idleMs();
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (Date.now() - lastUsed < wait) return;
      void release().catch(() => {});
    }, wait + 1000);
    if (typeof idleTimer.unref === 'function') idleTimer.unref();
  }

  function release(options = {}) {
    const task = chain.then(() => freeModelsNow(options));
    chain = task.catch(() => {});
    return task;
  }

  async function waitUntilIdle({signal,timeoutMs=900000,onWaiting=()=>{}}={}) {
    const started=Date.now(),c=config();
    for (;;) {
      const queue=await callJson(c.baseUrl,'/queue',{},signal);
      if (!queue?.queue_running?.length && !queue?.queue_pending?.length) return;
      onWaiting();
      if(Date.now()-started>timeoutMs)throw new Error('ComfyUI 仍有其他任务，已保留运行；本地任务等待超时');
      await sleep(500,signal);
    }
  }

  return {
    status: async () => {
      const c = config();
      const info = {ok: true, enabled: c.enabled, baseUrl: c.baseUrl, mediaDir: c.mediaDir, workflows: Object.keys(c.workflows || {}), root};
      try {
        const status = await callJson(c.baseUrl, '/system_stats');
        info.reachable = true;
        info.version = status?.system?.comfyui_version || '';
        info.ramFreeGb = Math.round((status?.system?.ram_free || 0) / 2 ** 30);
        info.gpu = (status.devices || []).map(device=>({name:device.name,totalMb:Math.round(Number(device.vram_total||0)/2**20),freeMb:Math.round(Number(device.vram_free||0)/2**20)}));
      } catch (error) {
        info.reachable = false;
        info.error = String(error?.message || error);
      }
      return info;
    },
    caption: (args, options) => run('caption', args, options),
    chat: (args, options) => run('chat', args, options),
    run,
    streamStatus,
    release,
    waitUntilIdle,
    recent: () => recent.slice(-10),
    async queue() {
      const c = config();
      const value = await callJson(c.baseUrl, '/queue');
      return {running: (value?.queue_running || []).length, pending: (value?.queue_pending || []).length};
    },
  };
}

export function ensureComfyFiles(root) {
  const dir = join(root, 'assets', 'comfyui');
  mkdirSync(dir, {recursive: true});
  return dir;
}
