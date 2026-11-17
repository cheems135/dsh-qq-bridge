import {fileURLToPath} from 'node:url';

const MEDIA_TYPES = new Set(['image', 'record', 'video']);
const cut = (value, length) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length);

function filePointer(value) {
  let file = String(value ?? '');
  if (file.startsWith('file:')) {
    try { file = fileURLToPath(file); } catch { return ''; }
  }
  return file.replace(/\\/g, '/').toLowerCase();
}

function sameFile(left, right) {
  return !!left && !!right && filePointer(left) === filePointer(right);
}

function checkedVisualInspection(value, file) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.description !== 'string' || !value.description.trim()
    || typeof value.ok !== 'boolean' || !Array.isArray(value.missing)
    || !value.missing.every(item => typeof item === 'string')
    || (value.file && !sameFile(value.file, file))) return null;
  return {
    description:cut(value.description, 700),
    ok:value.ok,
    missing:value.missing.map(item => cut(item, 180)).filter(Boolean).slice(0, 8),
  };
}

function mediaSource(job, segment, {mediaTask, videoJob} = {}) {
  const file = segment?.data?.file;
  const taskMatches = mediaTask && (job.mediaTaskId === mediaTask.id || mediaTask.deliveryId === job.id)
    && (!mediaTask.file || sameFile(mediaTask.file, file));
  const videoMatches = segment?.type === 'video' && videoJob
    && (job.deliveryKey === 'video:' + videoJob.id || videoJob.deliveryId === job.id)
    && (!videoJob.file || sameFile(videoJob.file, file));
  const explicit = job.mediaContext && typeof job.mediaContext === 'object' ? job.mediaContext : {};
  const task = taskMatches ? mediaTask : {};
  const video = videoMatches ? videoJob : {};
  const type = segment?.type;
  return {
    request: cut(type === 'video' ? video.args?.prompt || explicit.request || task.request : explicit.request || task.request, 500),
    prompt: cut(type === 'video' ? video.prepared?.prompt || explicit.prompt || task.prompt : explicit.prompt || task.prompt, 1600),
    action: cut(type === 'video' ? video.args?.actionPrompt || video.prepared?.action || explicit.action : explicit.action, 280),
    spokenText: cut(type === 'record' ? job.localTranscript || explicit.spokenText || task.spokenText : '', 1000),
    visualInspection: type === 'image' && taskMatches ? checkedVisualInspection(task.visualInspection, file) : null,
  };
}

function summary(type, source, verified) {
  const noun = type === 'image' ? '图片' : type === 'record' ? '语音' : '视频';
  const facts = [];
  if (type === 'record') {
    if (source.spokenText) facts.push('送入合成器的台词：' + source.spokenText + '（音频未转写核对）');
    else facts.push('台词未记录');
  } else {
    if (source.request) facts.push((type === 'image' ? '画面要求：' : '生成请求：') + source.request);
    if (source.visualInspection) {
      facts.push('视觉模型对成品的观察（可能有误）：' + source.visualInspection.description);
      if (source.visualInspection.missing.length) facts.push('与要求的差异：' + source.visualInspection.missing.join('、'));
      else if (!source.visualInspection.ok) facts.push('视觉模型判断成品与要求不符，未列明具体差异');
    } else facts.push('成品画面未视觉复核');
    if (source.action) facts.push('动作：' + source.action);
    if (source.prompt && source.prompt !== source.request) facts.push('生成提示词：' + source.prompt);
  }
  facts.push(verified ? 'QQ记录已读回' : 'QQ已接收，尚未读回');
  return '[' + noun + '；' + facts.join('；') + ']';
}

/**
 * Describe what was really accepted by QQ without treating a generation prompt
 * as visual proof. The returned media records retain the exact attachment
 * pointer for later lookups, while text is short enough for dialogue context.
 */
export function outgoingMediaEvidence(job, sources = {}) {
  const segments = Array.isArray(job?.segments) ? job.segments : [];
  const accepted = job?.status === 'sent' && !!(job.messageId || job.verification?.state === 'observed');
  const verified = job?.verification?.state === 'observed';
  const media = [];
  const parts = segments.map(segment => {
    if (segment?.type === 'text') return cut(segment.data?.text, 5000);
    if (!MEDIA_TYPES.has(segment?.type)) return '[' + cut(segment?.type || '附件', 20) + ']';
    const type = segment.type;
    if (!accepted) return '[' + (type === 'record' ? '语音' : type === 'image' ? '图片' : '视频') + ']';
    const source = mediaSource(job, segment, sources);
    media.push({type, file:String(segment.data?.file || ''), deliveryId:String(job.id || ''), messageId:String(job.messageId || ''), request:source.request, prompt:source.prompt, action:source.action, spokenText:source.spokenText, visualVerified:!!source.visualInspection, visualDescription:source.visualInspection?.description || '', visualMissing:source.visualInspection?.missing || [], visualMatch:source.visualInspection ? source.visualInspection.ok && source.visualInspection.missing.length === 0 : null, qqObserved:verified});
    return summary(type, source, verified);
  });
  return {text:parts.filter(Boolean).join('').slice(0, 3000), media};
}

/** Carry verified delivery evidence into a persistent API session's next turn.
 * The host already remembers its own generated prompt, but never sees the QQ
 * transport result unless the bridge explicitly supplies it.
 */
export function recentSentMediaContext(rows, {chat, accountId = '', personaId = '', now = Date.now(), userWords = ''} = {}) {
  const asksAboutMedia = /(?:刚才|刚刚|之前|上次|那张|这张|那个|这个|你发的|你拍的|你生成的|你说的).{0,18}(?:图|照片|视频|语音|声音|画|画面|内容)|(?:图|照片|视频|语音|声音).{0,12}(?:什么|内容|发了|拍了|做了)/.test(String(userWords));
  const windowMs = asksAboutMedia ? 24 * 60 * 60_000 : 10 * 60_000;
  const selected = (Array.isArray(rows) ? rows : []).filter(row =>
    row?.dir === 'out' && row.chat === chat && (row.accountId || '') === accountId
    && row.personaId === personaId && row.delivery === 'sent'
    && Array.isArray(row.media) && row.media.length > 0
    && Number(row.time) > now - windowMs && Number(row.time) <= now
  ).slice(-2);
  if (!selected.length) return '';
  return '【已发媒体的真实记录；区分生成要求、视觉模型观察与 QQ 回执】\n' + selected.map(row => {
    const details = row.media.map(item => {
      const noun = item.type === 'record' ? '语音' : item.type === 'video' ? '视频' : '图片';
      const parts = [noun, item.qqObserved ? 'QQ记录已读回' : 'QQ已接收但尚未读回'];
      if (item.type === 'record') parts.push(item.spokenText ? '送入合成器的台词：' + cut(item.spokenText, 360) + '（音频未转写）' : '台词未记录');
      else {
        if (item.request) parts.push('原要求：' + cut(item.request, 250));
        if (item.visualVerified) parts.push('视觉模型观察（可能有误）：' + cut(item.visualDescription, 300) + (item.visualMissing?.length ? '；差异：' + item.visualMissing.map(value => cut(value, 80)).join('、') : ''));
        else parts.push('成品画面未视觉复核');
        if (item.action) parts.push('动作：' + cut(item.action, 120));
        if (item.prompt && item.prompt !== item.request) parts.push('生成提示词摘录：' + cut(item.prompt, asksAboutMedia ? 250 : 100));
      }
      return parts.join('；');
    }).filter(Boolean);
    return new Date(row.time).toISOString() + ' ' + (details.some(value => value.length > 35) ? details.join(' | ') : cut(row.text, 700));
  }).join('\n') + (asksAboutMedia ? '\n如要确认图片或视频实际画面，可用 bridge_qq_read 读取这条已发媒体的原图或视频；不依据提示词猜测成品细节。' : '');
}
