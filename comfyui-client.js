// ComfyUI 工作流客户端：声明式映射 + 预检 + 注入自检 + 结果按契约取回。
// 纯函数部分可离线测试；网络部分只在这里发请求。
import { createHash } from 'node:crypto';

export const workflowHash = (apiJson) => createHash('sha256').update(JSON.stringify(apiJson)).digest('hex').slice(0, 16);

export function parseManifest(raw) {
  const m = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!m?.id || !m.inputs || !m.outputs) throw new Error('manifest 缺少 id/inputs/outputs');
  for (const [key, spec] of Object.entries(m.inputs)) {
    if (!spec?.node || !spec?.field) throw new Error(`manifest 输入 ${key} 缺少 node/field`);
  }
  for (const [key, spec] of Object.entries(m.outputs)) {
    if (spec != null && (!spec.node || !spec.kind)) throw new Error(`manifest 输出 ${key} 缺少 node/kind`);
  }
  return m;
}

/** 运行前预检：节点存在、字段存在、类型对得上。返回问题列表，空数组即通过。 */
export function preflight(manifest, objectInfo, workflow) {
  const problems = [];
  const nodeOf = (id) => objectInfo?.[id] ?? objectInfo?.[String(id)];
  for (const [key, spec] of Object.entries(manifest.inputs)) {
    const info = nodeOf(spec.node);
    if (!info) { problems.push(`输入 ${key}: 节点 ${spec.node} 不在 ComfyUI 里`); continue; }
    const fields = { ...(info.input?.required || {}), ...(info.input?.optional || {}) };
    // 本地模型类字段：当前值必须在该节点的候选列表里（模型文件没装就会在这里被拦住）
    const fieldSpec = fields[spec.field];
    if (Array.isArray(fieldSpec?.[0]) && workflow?.[String(spec.node)]?.inputs?.[spec.field] !== undefined) {
      const current = workflow[String(spec.node)].inputs[spec.field];
      if (!fieldSpec[0].includes(current)) problems.push(`输入 ${key}: 当前值 ${current} 不在候选里`);
    }
    if (!(spec.field in fields)) problems.push(`输入 ${key}: 节点 ${spec.node} 没有字段 ${spec.field}（现有：${Object.keys(fields).join(',')}）`);
  }
  for (const [key, spec] of Object.entries(manifest.outputs)) {
    if (!spec) continue;
    if (!nodeOf(spec.node)) problems.push(`输出 ${key}: 节点 ${spec.node} 不存在`);
  }
  return problems;
}

/** 把值注入 API 格式工作流，并在注入后逐项回读确认。 */
export function inject(workflow, manifest, values) {
  const wf = JSON.parse(JSON.stringify(workflow));
  const applied = [];
  for (const [key, spec] of Object.entries(manifest.inputs)) {
    const value = values[key];
    if (value === undefined || value === null || value === '') {
      if (spec.required) throw new Error(`缺少必填输入 ${key}`);
      continue;
    }
    const node = wf[String(spec.node)];
    if (!node?.inputs) throw new Error(`工作流里没有节点 ${spec.node}`);
    if (spec.type === 'int' && !Number.isFinite(Number(value))) throw new Error(`输入 ${key} 需要整数，收到 ${value}`);
    node.inputs[spec.field] = spec.type === 'int' ? Number(value) : value;
    if (String(node.inputs[spec.field]) !== String(spec.type === 'int' ? Number(value) : value)) throw new Error(`输入 ${key} 注入后回读不一致`);
    applied.push(key);
  }
  if (JSON.stringify(wf).includes('{{')) throw new Error('工作流里仍有未替换的占位符');
  return { workflow: wf, applied };
}

/** 从 /history 结果里按契约取输出，数量/类型不符直接报错，不猜。 */
export function extract(historyEntry, manifest) {
  const outputs = historyEntry?.outputs || {};
  const out = { images: [], audio: [], video: [], text: [] };
  const grab = (key) => {
    const spec = manifest.outputs[key];
    if (!spec) return [];
    const node = outputs[String(spec.node)];
    if (!node) throw new Error(`结果里没有输出节点 ${spec.node}（${key}）`);
    if (spec.kind === 'image') {
      const files = node.images || node.gifs || [];
      if (spec.count && files.length !== spec.count) throw new Error(`输出 ${key} 期望 ${spec.count} 个，实际 ${files.length}`);
      return files.map((f) => ({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' }));
    }
    if (spec.kind === 'audio') return (node.audio || []).map((f) => ({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' }));
    if (spec.kind === 'video') return (node.gifs || node.videos || node.images || []).map((f) => ({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' }));
    if (spec.kind === 'text') return [String(node.text ?? node.string ?? '').trim()].filter(Boolean);
    return [];
  };
  for (const key of Object.keys(manifest.outputs)) {
    if (!manifest.outputs[key]) continue;
    out[key] = grab(key);
  }
  return out;
}


/**
 * 极简绑定：不懂节点 ID 也能用。
 * 1) 工作流里写了 {{prompt}} 就替换；没写就填第一个 CLIPTextEncode 的 text
 * 2) {{image}} / {{image1}}… 替换成上传后的文件名；没写就依次填 LoadImage
 * 3) 其它 {{key}} 用 params 里的同名字段替换
 */
export function fill(workflow, { prompt = '', images = [], params = {} } = {}) {
  const wf = JSON.parse(JSON.stringify(workflow));
  const notes = [];
  let promptDone = false;
  const imageQueue = [...images];

  for (const [id, node] of Object.entries(wf)) {
    if (!node?.inputs) continue;
    for (const [field, value] of Object.entries(node.inputs)) {
      if (typeof value !== 'string') continue;
      if (value.includes('{{prompt}}')) { node.inputs[field] = value.replaceAll('{{prompt}}', prompt); promptDone = true; }
      const imgMatch = value.match(/\{\{image(\d*)\}\}/);
      if (imgMatch) {
        const index = imgMatch[1] ? Number(imgMatch[1]) - 1 : 0;
        const file = imageQueue[index];
        if (file) { node.inputs[field] = value.replace(/\{\{image\d*\}\}/g, file); notes.push('image->' + id + '.' + field); }
      }
      for (const [key, val] of Object.entries(params)) {
        if (value.includes('{{' + key + '}}')) node.inputs[field] = value.replaceAll('{{' + key + '}}', String(val));
      }
    }
  }

  if (!promptDone && prompt) {
    const textNode = Object.entries(wf).find(([, n]) => n?.class_type === 'CLIPTextEncode' && typeof n?.inputs?.text === 'string' && !n.inputs.text.includes('{{'));
    if (textNode) { textNode[1].inputs.text = prompt; notes.push('prompt->' + textNode[0] + '.text（自动）'); }
    else notes.push('没有可写的提示词节点，prompt 未使用');
  }

  const loadNodes = Object.entries(wf).filter(([, n]) => /LoadImage$/i.test(n?.class_type || ''));
  loadNodes.forEach(([id, node], i) => {
    if (imageQueue[i] && !String(node.inputs.image || '').includes(imageQueue[i])) { node.inputs.image = imageQueue[i]; notes.push('image->' + id + '.image（自动）'); }
  });

  const leftovers = JSON.stringify(wf).match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (leftovers) throw new Error('还有没替换的占位符：' + [...new Set(leftovers)].join(','));
  return { workflow: wf, notes };
}

/** 从 /history 里把所有能取到的产物都收出来，不需要预先声明节点。 */
export function collectOutputs(entry) {
  const out = { images: [], audio: [], video: [], text: [] };
  for (const node of Object.values(entry?.outputs || {})) {
    for (const f of node.images || []) out.images.push({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    for (const f of node.gifs || []) out.video.push({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    for (const f of node.audio || []) out.audio.push({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    for (const f of node.videos || []) out.video.push({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
    if (typeof node.text === 'string' && node.text.trim()) out.text.push(node.text.trim());
  }
  return out;
}


/** 本地串行队列：一次只跑一个任务，其余排队，失败不阻塞后续。 */
export function createJobQueue({ concurrency = 1, execute, now = () => Date.now() } = {}) {
  if (typeof execute !== 'function') throw new Error('队列缺少 execute');
  const pending = [];
  const running = new Set();
  const jobs = new Map();
  let seq = 0;

  const positionOf = (job) => {
    const i = pending.indexOf(job);
    return i < 0 ? 0 : i + 1;
  };
  function pump() {
    while (running.size < concurrency && pending.length) {
      const job = pending.shift();
      running.add(job);
      job.status = 'running';
      job.startedAt = now();
      Promise.resolve()
        .then(() => execute(job))
        .then((result) => { job.status = 'done'; job.result = result; job.finishedAt = now(); })
        .catch((error) => { job.status = 'error'; job.error = String(error?.message || error); job.finishedAt = now(); })
        .finally(() => { running.delete(job); pump(); });
    }
  }
  return {
    submit(input) {
      const job = { id: 'cj' + (++seq), status: 'queued', input, createdAt: now() };
      jobs.set(job.id, job);
      pending.push(job);
      pump();
      return job.id;
    },
    get(id) {
      const job = jobs.get(id);
      if (!job) return null;
      return { id: job.id, status: job.status, position: positionOf(job), error: job.error || '', result: job.status === 'done' ? job.result : undefined, createdAt: job.createdAt };
    },
    list() { return [...jobs.values()].map((j) => ({ id: j.id, status: j.status, position: positionOf(j) })); },
    size() { return pending.length + running.size; },
    running() { return running.size; },
  };
}

export function createComfyClient({ baseUrl, token = '', fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');
  if (!root) throw new Error('缺少 ComfyUI 地址');
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) };
  async function call(pathname, init = {}) {
    const res = await fetchImpl(root + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    if (!res.ok) throw new Error(`ComfyUI ${pathname} -> ${res.status} ${String(text).slice(0, 200)}`);
    return body;
  }
  return {
    objectInfo: () => call('/object_info'),
    submit: (workflow, clientId) => call('/prompt', { method: 'POST', body: JSON.stringify({ prompt: workflow, client_id: clientId }) }),
    history: (promptId) => call('/history/' + encodeURIComponent(promptId)),
    queue: () => call('/queue'),
    async run({ workflow, manifest, values, clientId, pollMs = 1200, deadlineMs = 180000 }) {
      const problems = preflight(manifest, await this.objectInfo());
      if (problems.length) throw new Error('预检未通过：' + problems.join('；'));
      const { workflow: wf } = inject(workflow, manifest, values);
      const submitted = await this.submit(wf, clientId);
      const promptId = submitted?.prompt_id;
      if (!promptId) throw new Error('ComfyUI 没有返回 prompt_id');
      const started = Date.now();
      for (;;) {
        const hist = await this.history(promptId);
        const entry = hist?.[promptId];
        if (entry?.outputs) return { promptId, output: extract(entry, manifest), status: entry.status || {} };
        if (entry?.status?.status_str === 'error') throw new Error('ComfyUI 执行失败：' + JSON.stringify(entry.status).slice(0, 300));
        if (Date.now() - started > deadlineMs) throw new Error('ComfyUI 结果未知：超时未完成，未重试');
        await new Promise((r) => setTimeout(r, pollMs));
      }
    },
  };
}
