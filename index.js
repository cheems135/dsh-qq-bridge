/**
 * dsh-im-bridge — bridge a chat platform (QQ via NapCat / OneBot 11 today)
 * into DeepSeek Harness sessions.
 *
 * Design notes
 * ------------
 * - Runs as a Host plugin inside the DSH process, so it talks to the same
 *   services the Web GUI uses: `ctx.sessionController` creates a Session,
 *   admits a prompt, and `session/event` feeds every committed Session event
 *   back to us. Replies are collected per turn and pushed back to the chat.
 * - Chat ⇄ Session mapping is persisted in a small JSON state file, so a
 *   restart continues the same conversation.
 * - The WebSocket client is implemented on `node:net` + `node:crypto` on
 *   purpose: a profile-installed bundle must not depend on packages that only
 *   exist inside the DSH installation (`ws`), and global `WebSocket` is not
 *   guaranteed in every Electron main process.
 * - Nothing here executes model output: this plugin only moves text.
 */

import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const name = 'dsh-im-bridge';
/** The Session Remote controller is the only service this bridge needs. */
export const inject = ['sessionController'];

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_MAX_REPLY_CHARS = 1500;

/** Python used for edge-tts: env override, the bundled DSH runtime, then PATH. */
const DEFAULT_PYTHON = [
  process.env.DSH_IM_PYTHON,
  join(process.env.USERPROFILE ?? homedir(), '.dsh', 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'python', 'python.exe'),
  'python',
].find((candidate) => candidate && (candidate === 'python' || existsSync(candidate))) ?? 'python';
const MAX_PARTIAL_LOG = 400;

/**
 * Baseline behaviour every conversation inherits, above the per-persona prompt.
 * Editable from the panel; this constant is only the seed value.
 */
const DEFAULT_BASE_PERSONA = [
  '你是这个 QQ 号背后的聊天角色。下面几条是底层准则，每一轮都生效，优先于具体人设：',
  '- 他难过、失落、烦躁时，先接住情绪，用符合你人设的口吻安慰。不讲道理、不列建议、不说「加油」。',
  '- 看着时间说话：深夜（23–5 点）劝他睡，早上（6–10 点）问个好，饭点顺手提醒吃饭。别生硬报时，别每句都提。',
  '- 他发图片或表情包时你看得见，但**不要描述画面内容**、不要复述图里的文字，也不要分析这张图什么意思。像人一样只给一句反应。',
].join('\n');

/* ------------------------------------------------------------------ */
/* config                                                              */
/* ------------------------------------------------------------------ */

function str(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function strList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter((item) => item !== '');
}

/** `proactive: { enabled, minMinutes, maxMinutes, ... }` — the bot may speak first. */
function normalizeProactive(value) {
  if (!value || typeof value !== 'object' || value.enabled === false) return null;
  const clamp = (input, fallback, min, max) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const minMinutes = clamp(value.minMinutes, 120, 10, 24 * 60);
  const maxMinutes = Math.max(minMinutes, clamp(value.maxMinutes, 300, 10, 24 * 60));
  return {
    minMinutes,
    maxMinutes,
    startHour: clamp(value.startHour, 9, 0, 23),
    endHour: clamp(value.endHour, 23, 1, 24),
    maxPerDay: clamp(value.maxPerDay, 3, 1, 20),
    minIdleMinutes: clamp(value.minIdleMinutes, 30, 0, 24 * 60),
    cue: str(
      value.cue,
      '（现在没人在跟你说话。你想主动找他聊聊，就发一句；没兴趣就只回 [skip]。）',
    ),
  };
}

/** `silence: { enabled, minMinutes, maxMinutes, maxNudges }` — react to being ignored. */
function normalizeSilence(value) {
  if (!value || typeof value !== 'object' || value.enabled === false) return null;
  const clamp = (input, fallback, min, max) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const minMinutes = clamp(value.minMinutes, 18, 1, 24 * 60);
  return {
    minMinutes,
    maxMinutes: Math.max(minMinutes, clamp(value.maxMinutes, 35, 1, 24 * 60)),
    maxNudges: clamp(value.maxNudges, 2, 1, 5),
    cue: str(
      value.cue,
      '（他有一阵没吭声了。你想催一句、损他一句、或者自己起个新话题，就发；不想就只回 [skip]。）',
    ),
  };
}

/** `afterthought: { enabled, chance, minSeconds, maxSeconds }` — one more bubble after a reply. */
function normalizeAfterthought(value) {
  if (!value || typeof value !== 'object' || value.enabled === false) return null;
  const clamp = (input, fallback, min, max) => {
    const number = Number(input);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  const minSeconds = clamp(value.minSeconds, 25, 5, 600);
  return {
    chance: clamp(value.chance, 0.25, 0, 1),
    minSeconds,
    maxSeconds: Math.max(minSeconds, clamp(value.maxSeconds, 70, 5, 600)),
    cue: str(
      value.cue,
      '（你刚说完，忽然又想起一句。想说就发，不想就只回 [skip]。）',
    ),
  };
}

/** `model: { provider, model, reasoningEffort }` — the Session-local route. */
function normalizeModel(value) {
  if (!value || typeof value !== 'object') return null;
  const provider = str(value.provider, '');
  const model = str(value.model, '');
  if (provider === '' || model === '') return null;
  const reasoningEffort = str(value.reasoningEffort, '');
  return { provider, model, ...(reasoningEffort === '' ? {} : { reasoningEffort }) };
}

function normalizeConfig(raw) {
  const config = raw && typeof raw === 'object' ? raw : {};
  const dataDir = str(config.dataDir, join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'im-bridge'));
  const maxReplyChars = Number(config.maxReplyChars);
  return {
    wsUrl: str(config.wsUrl, 'ws://127.0.0.1:3001'),
    accessToken: str(config.accessToken, ''),
    allowUsers: strList(config.allowUsers),
    allowGroups: strList(config.allowGroups),
    groupRequireAt: config.groupRequireAt !== false,
    cwd: str(config.cwd, process.cwd()),
    agentPreset: str(config.agentPreset, ''),
    model: normalizeModel(config.model),
    proactive: normalizeProactive(config.proactive),
    silence: normalizeSilence(config.silence),
    afterthought: normalizeAfterthought(config.afterthought),
    dataDir,
    stateFile: str(config.stateFile, join(dataDir, 'state.json')),
    logFile: str(config.logFile, join(dataDir, 'bridge.log')),
    stickerDir: str(config.stickerDir, join(dataDir, 'stickers')),
    maxReplyChars: Number.isFinite(maxReplyChars) && maxReplyChars >= 200 ? Math.floor(maxReplyChars) : DEFAULT_MAX_REPLY_CHARS,
    plainText: config.plainText !== false,
    denyReply: str(config.denyReply, '抱歉，我不在这个账号的可回复名单里。'),
    errorReply: str(config.errorReply, '（这边出错了，稍后再试一次吧）'),
    emptyReply: str(config.emptyReply, '（这一轮没有产生文字回复）'),
    greeting: typeof config.greeting === 'string' ? config.greeting : '在的。QQ 已经接上 DeepSeek Harness 了，直接说话就行。',
    selfTest: config.selfTest === true,
    selfTestPrompt: str(config.selfTestPrompt, '用一句话介绍你自己。'),
    selfTestImage: str(config.selfTestImage, ''),
    presetRev: str(config.presetRev, ''),
    napcat: {
      dir: str(config.napcat?.dir, join(homedir(), 'NapCat')),
      qq: str(config.napcat?.qq, ''),
      launcher: str(config.napcat?.launcher, ''),
    },
    presetDir: str(config.presetDir, process.env.DSH_PRESET_DIR ?? ''),
  };
}

/* ------------------------------------------------------------------ */
/* logging                                                             */
/* ------------------------------------------------------------------ */

function makeLogger(pathOrGetter) {
  const resolve = typeof pathOrGetter === 'function' ? pathOrGetter : () => pathOrGetter;
  let bytes = -1;
  let known = '';
  return function log(message) {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    try {
      const file = resolve();
      if (file !== known) {
        known = file;
        bytes = -1;
        mkdirSync(dirname(file), { recursive: true });
      }
      if (bytes < 0 || bytes > 2 * 1024 * 1024) {
        if (bytes > 2 * 1024 * 1024) writeFileSync(file, '');
        try {
          bytes = statSync(file).size;
        } catch {
          bytes = 0;
        }
      }
      appendFileSync(file, line);
      bytes += Buffer.byteLength(line);
    } catch {
      /* a broken log must never break the bridge */
    }
  };
}

/* ------------------------------------------------------------------ */
/* minimal RFC 6455 client                                             */
/* ------------------------------------------------------------------ */

class MiniWebSocket {
  constructor(url, { token = '', onOpen, onMessage, onClose } = {}) {
    this.url = url;
    this.token = token;
    this.onOpen = onOpen;
    this.onMessage = onMessage;
    this.onClose = onClose;
    this.socket = null;
    this.ready = false;
    this.closed = false;
    this.buffer = Buffer.alloc(0);
    this.handshake = Buffer.alloc(0);
    this.fragments = [];
    this.pendingPing = 0;
  }

  open() {
    const target = new URL(this.url);
    if (target.protocol === 'wss:') throw new Error('wss:// is not supported by this bridge; use ws:// on loopback');
    const port = Number(target.port || 80);
    const key = randomBytes(16).toString('base64');
    const socket = connect({ host: target.hostname, port });
    this.socket = socket;
    socket.setNoDelay(true);

    socket.on('connect', () => {
      const lines = [
        `GET ${target.pathname || '/'}${target.search || ''} HTTP/1.1`,
        `Host: ${target.host}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
      ];
      if (this.token) lines.push(`Authorization: Bearer ${this.token}`);
      socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    });

    socket.on('data', (chunk) => {
      if (this.closed) return;
      if (!this.ready) {
        this.handshake = Buffer.concat([this.handshake, chunk]);
        const end = this.handshake.indexOf('\r\n\r\n');
        if (end < 0) return;
        const head = this.handshake.subarray(0, end).toString('latin1');
        const rest = this.handshake.subarray(end + 4);
        const status = head.split('\r\n')[0] || '';
        if (!/ 101 /.test(` ${status} `)) {
          this.fail(new Error(`websocket handshake rejected: ${status}`));
          return;
        }
        const accept = /sec-websocket-accept:\s*(\S+)/i.exec(head);
        const expected = createHash('sha1').update(key + WS_GUID).digest('base64');
        if (accept && accept[1] !== expected) {
          this.fail(new Error('websocket handshake failed: bad Sec-WebSocket-Accept'));
          return;
        }
        this.ready = true;
        this.onOpen?.();
        if (rest.length > 0) this.consume(rest);
        return;
      }
      this.consume(chunk);
    });

    socket.on('error', (error) => this.fail(error));
    socket.on('close', () => this.fail(new Error('socket closed')));
  }

  fail(error) {
    if (this.closed && this.ready === false && this.failed) return;
    this.failed = true;
    const wasReady = this.ready;
    this.ready = false;
    this.closed = true;
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
    if (wasReady || !this.silent) this.onClose?.(error);
  }

  /** Close from our side without waiting for the peer. */
  close() {
    this.silent = true;
    if (this.ready && this.socket) {
      try {
        this.writeFrame(0x8, Buffer.alloc(0));
      } catch {
        /* ignore */
      }
    }
    this.closed = true;
    this.ready = false;
    try {
      this.socket?.destroy();
    } catch {
      /* ignore */
    }
    this.socket = null;
  }

  send(text) {
    if (!this.ready) return false;
    this.writeFrame(0x1, Buffer.from(text, 'utf8'));
    return true;
  }

  ping() {
    if (!this.ready) return;
    this.pendingPing = Date.now();
    this.writeFrame(0x9, Buffer.alloc(0));
  }

  writeFrame(opcode, payload) {
    const socket = this.socket;
    if (!socket) return;
    const length = payload.length;
    const mask = randomBytes(4);
    let header;
    if (length < 126) {
      header = Buffer.alloc(2);
      header[1] = 0x80 | length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }
    header[0] = 0x80 | opcode;
    const masked = Buffer.allocUnsafe(length);
    for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ mask[i & 3];
    socket.write(Buffer.concat([header, mask, masked]));
  }

  consume(chunk) {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const buffer = this.buffer;
      if (buffer.length < 2) return;
      const fin = (buffer[0] & 0x80) !== 0;
      const opcode = buffer[0] & 0x0f;
      const masked = (buffer[1] & 0x80) !== 0;
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) return;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (buffer.length < 10) return;
        length = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }
      let mask = null;
      if (masked) {
        if (buffer.length < offset + 4) return;
        mask = buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (buffer.length < offset + length) return;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      this.buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
      this.handleFrame(fin, opcode, payload);
      if (this.closed) return;
    }
  }

  handleFrame(fin, opcode, payload) {
    if (opcode === 0x8) {
      try {
        if (this.ready) this.writeFrame(0x8, Buffer.alloc(0));
      } catch {
        /* ignore */
      }
      this.fail(new Error('peer closed the websocket'));
      return;
    }
    if (opcode === 0x9) {
      try {
        this.writeFrame(0xa, payload);
      } catch {
        /* ignore */
      }
      return;
    }
    if (opcode === 0xa) {
      this.pendingPing = 0;
      return;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      this.fragments = [payload];
    } else if (opcode === 0x0) {
      this.fragments.push(payload);
    } else {
      return;
    }
    if (!fin) return;
    const text = Buffer.concat(this.fragments).toString('utf8');
    this.fragments = [];
    this.onMessage?.(text);
  }
}

/* ------------------------------------------------------------------ */
/* OneBot helpers                                                      */
/* ------------------------------------------------------------------ */

function messageSegments(message) {
  if (typeof message === 'string') return [{ type: 'text', data: { text: message } }];
  return Array.isArray(message) ? message : [];
}

function segmentsToText(message, selfId) {
  const parts = [];
  for (const segment of messageSegments(message)) {
    if (!segment || typeof segment !== 'object') continue;
    const data = segment.data && typeof segment.data === 'object' ? segment.data : {};
    switch (segment.type) {
      case 'text':
        parts.push(String(data.text ?? ''));
        break;
      case 'at': {
        const qq = String(data.qq ?? '');
        if (qq === 'all') parts.push('@全体成员 ');
        else if (qq !== '' && qq !== String(selfId)) parts.push(`@${qq} `);
        break;
      }
      case 'face':
        parts.push('[表情]');
        break;
      case 'image':
        // A forwarded image becomes an attachment part of its own; the text
        // placeholder would only make the model describe a caption.
        break;
      case 'mface':
        parts.push('[表情]');
        break;
      case 'record':
        parts.push('[语音]');
        break;
      case 'video':
        parts.push('[视频]');
        break;
      case 'file':
        parts.push('[文件]');
        break;
      case 'reply':
      case 'forward':
      case 'json':
      case 'xml':
        break;
      default:
        break;
    }
  }
  return parts.join('').trim();
}

function mentionsSelf(message, selfId) {
  return messageSegments(message).some(
    (segment) => segment?.type === 'at' && String(segment?.data?.qq ?? '') === String(selfId),
  );
}

/** Pull the visible text out of an AssistantMessage content array. */
function textOfContent(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
  }
  return parts.join('');
}

/**
 * QQ renders no Markdown, so headings, bold markers, inline-code ticks and
 * pipe tables arrive as literal noise. Keep the prose, drop the syntax.
 * Deliberately conservative: single `*`/`_` are left alone so snake_case and
 * maths survive, and fenced blocks keep their code, only losing the fences.
 */
function renderForChat(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const kept = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^\s*\|/.test(line)) {
      const cells = line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim());
      if (cells.length > 0 && cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
      kept.push(cells.filter((cell) => cell !== '').join(' · '));
      continue;
    }
    kept.push(line);
  }
  return kept
    .join('\n')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Human texting arrives in bursts, not one paragraph. The persona separates
 * bursts with `|||`; this keeps that decision but never lets a burst exceed
 * the platform length limit.
 */
/**
 * Fallback rhythm: when the model writes one paragraph anyway, break it at
 * sentence ends so it still arrives as chat bubbles instead of a block.
 * Short replies and single sentences are left alone.
 */
function sentenceBubbles(text) {
  const value = String(text ?? '').trim();
  if (value.length <= 28) return [value];
  const sentences = value
    .split(/(?<=[。！？!?~…])/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== '');
  if (sentences.length <= 1) return [value];
  const perBubble = Math.ceil(sentences.length / 3);
  const bubbles = [];
  for (let index = 0; index < sentences.length; index += perBubble) {
    bubbles.push(sentences.slice(index, index + perBubble).join(''));
  }
  return bubbles;
}

function splitBursts(text, limit) {
  return String(text ?? '')
    // `|||` is the explicit burst marker; a blank line is the same impulse
    // expressed the way people actually type it.
    .split(/\|\|\||\n\s*\n/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .flatMap((part) => sentenceBubbles(part))
    .flatMap((part) => splitMessage(part, limit));
}

/* ------------------------------------------------------------------ */
/* QQ expressions                                                      */
/* ------------------------------------------------------------------ */

/**
 * Built-in QQ face ids (the classic 0–105 set every client renders). The
 * persona may end a burst with `[表情:白眼]`; unknown names are dropped rather
 * than shown as literal text.
 */
const FACE_IDS = {
  微笑: 14,
  呲牙: 13,
  笑: 13,
  偷笑: 21,
  憨笑: 29,
  坏笑: 45,
  大笑: 9,
  哭: 9,
  流泪: 5,
  快哭了: 51,
  委屈: 50,
  难过: 16,
  白眼: 23,
  抠鼻: 42,
  鄙视: 49,
  傲慢: 24,
  疑问: 33,
  惊讶: 15,
  惊恐: 27,
  尴尬: 10,
  汗: 28,
  擦汗: 41,
  困: 26,
  哈欠: 48,
  晕: 35,
  发怒: 11,
  咒骂: 32,
  敲打: 39,
  抓狂: 19,
  鼓掌: 43,
  强: 80,
  弱: 81,
  握手: 82,
  胜利: 83,
  抱拳: 84,
  爱心: 67,
  心碎: 68,
  亲亲: 53,
  再见: 40,
  猪头: 63,
  饭: 62,
  月亮: 76,
  太阳: 77,
};

/** Raster media type from magic bytes; the attachment service trusts this over a URL suffix. */
function sniffImage(bytes) {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function splitMessage(text, limit) {
  const chunks = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim() !== '') chunks.push(rest);
  return chunks.length === 0 ? [''] : chunks;
}

/* ------------------------------------------------------------------ */
/* plugin                                                              */
/* ------------------------------------------------------------------ */

/**
 * Standalone console page. Served by the host as plain HTML on purpose: a
 * client-half module is injected into the main window, and a mistake there can
 * take the whole UI down with it. A separate page can only break itself.
 */
const CONSOLE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>QQ 桥接 · 控制台</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; font:14px/1.65 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif; background:#fafafa; color:#1a1a1a; }
  .wrap { max-width:720px; margin:0 auto; padding:28px 20px 60px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { opacity:.6; font-size:12px; margin-bottom:18px; }
  .card { border:1px solid #e3e3e8; border-radius:12px; padding:14px 16px; margin-bottom:12px; background:#fff; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:6px 0; }
  .dot { width:8px; height:8px; border-radius:50%; display:inline-block; margin-right:8px; }
  button { border:1px solid #d5d5dc; background:transparent; color:inherit; border-radius:8px; padding:6px 14px; font-size:13px; cursor:pointer; }
  button:hover { border-color:#999; }
  code { background:rgba(128,128,128,.14); padding:1px 6px; border-radius:5px; }
  .muted { opacity:.6; font-size:12px; }
  .err { color:#d33; font-size:12px; min-height:18px; }
  @media (prefers-color-scheme: dark) {
    body { background:#141416; color:#eee; }
    .card { background:#1d1d21; border-color:#2e2e35; }
    button { border-color:#3a3a42; }
  }
</style>
</head>
<body>
<div class="wrap">
  <h1>QQ 桥接 · 控制台</h1>
  <div class="sub">这个页面由插件自己提供，和主界面无关；它坏了也不影响 DSH。</div>

  <div class="card">
    <div class="row"><span id="conn">…</span><span class="muted" id="who"></span></div>
    <div class="row"><span>人格</span><code id="preset">-</code></div>
    <div class="row"><span>白名单</span><span class="muted" id="users">-</span></div>
    <div class="row"><span>会话</span><span class="muted" id="chats">-</span></div>
    <div class="row" style="justify-content:flex-start;gap:10px;padding-top:10px">
      <button id="reconnect">重连 NapCat</button>
      <button id="test">发测试消息</button>
    </div>
  </div>

  <div class="card">
    <div class="row"><b>主动行为</b><span class="muted">本页开关只对这次运行生效</span></div>
    <div class="row"><span>定时找你（2–5 小时）</span><button data-toggle="proactive">-</button></div>
    <div class="row"><span>沉默后追问（18–35 分钟）</span><button data-toggle="silence">-</button></div>
    <div class="row"><span>说完再补一句</span><button data-toggle="afterthought">-</button></div>
  </div>

  <div class="err" id="err"></div>
  <div class="muted" id="log"></div>
</div>
<script>
(function () {
  var state = null;
  function $(id) { return document.getElementById(id); }
  function render() {
    if (!state) return;
    $('conn').innerHTML = '<span class="dot" style="background:' + (state.connected ? '#3ecf8e' : '#e05a5a') + '"></span>' + (state.connected ? 'NapCat 已连接' : 'NapCat 未连接');
    $('who').textContent = state.selfId ? ('账号 ' + state.selfId) : '等待登录';
    $('preset').textContent = state.preset;
    $('users').textContent = state.allowUsers.length ? state.allowUsers.join('、') : '（空，谁都不理）';
    $('chats').textContent = state.chats.length + ' 个';
    Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (btn) {
      var key = btn.getAttribute('data-toggle');
      btn.textContent = state[key] ? '已开启' : '已关闭';
      btn.style.opacity = state[key] ? '1' : '.55';
    });
    $('log').textContent = '日志：' + state.logFile;
  }
  function refresh() {
    fetch('/im-bridge/status', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (v) { state = v; render(); $('err').textContent = ''; })
      .catch(function (e) { $('err').textContent = '读取失败：' + e.message; });
  }
  function act(payload) {
    return fetch('/im-bridge/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
      .then(function (r) { return r.json(); })
      .then(function (v) { state = v; render(); $('err').textContent = ''; })
      .catch(function (e) { $('err').textContent = '操作失败：' + e.message; });
  }
  $('reconnect').onclick = function () { act({ kind: 'reconnect' }); };
  $('test').onclick = function () { act({ kind: 'test' }); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-toggle]'), function (btn) {
    btn.onclick = function () { act({ kind: 'toggle', target: btn.getAttribute('data-toggle') }); };
  });
  refresh();
  setInterval(refresh, 5000);
})();
</script>
</body>
</html>`;

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);

  // Heavy files (log, monitor history, voice, stickers) live under a movable
  // cache root; settings.json and state.json stay in the profile data dir so
  // the pointer itself survives a move.
  let cacheRoot = cfg.dataDir;
  let logFile = cfg.logFile;
  let messagesFile = join(cacheRoot, 'messages.json');
  let messagesDir = join(cacheRoot, 'messages');
  let voiceDir = join(cacheRoot, 'voice');
  let stickerDir = cfg.stickerDir;

  function repoint(nextRoot) {
    const root = typeof nextRoot === 'string' && nextRoot.trim() !== '' ? nextRoot.trim() : '';
    if (root !== '') {
      cacheRoot = root;
      logFile = join(root, 'bridge.log');
      messagesFile = join(root, 'messages.json');
      messagesDir = join(root, 'messages');
      voiceDir = join(root, 'voice');
      stickerDir = join(root, 'stickers');
    } else {
      cacheRoot = cfg.dataDir;
      logFile = cfg.logFile;
      messagesFile = join(cacheRoot, 'messages.json');
      messagesDir = join(cacheRoot, 'messages');
      voiceDir = join(cacheRoot, 'voice');
      stickerDir = cfg.stickerDir;
    }
  }

  const log = makeLogger(() => logFile);
  log(`apply: ws=${cfg.wsUrl} users=${JSON.stringify(cfg.allowUsers)} groups=${JSON.stringify(cfg.allowGroups)} cwd=${cfg.cwd}`);

  if (cfg.allowUsers.length === 0 && cfg.allowGroups.length === 0) {
    log('WARNING: allowUsers and allowGroups are both empty — every incoming message will be denied.');
  }

  const timeZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
    } catch {
      return 'Asia/Shanghai';
    }
  })();

  /* ---------------- state ---------------- */

  const state = loadState(cfg.stateFile, log);
  const chats = new Map(); // sessionId -> chat runtime
  const creating = new Map(); // chatKey -> Promise<sessionId>
  const configuredModels = new Set(); // sessionIds already routed
  const personaPreamble = new Map(); // sessionId -> persona text for the first prompt
  let socket = null;
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let heartbeat = null;
  let stopped = false;
  let echoSeq = 0;
  let greeted = false;
  let lastSelfId = '';
  let accountPaused = false;
  let selfTest = null;
  const proactive = { count: 0, day: '', timer: null };

  /**
   * A chat turn cannot answer an approval prompt, so the agent must never wait
   * on one: pin the session policy to `never` (requests are then rejected and
   * the model continues) and reject anything that still reaches the waterfall.
   */
  function pinApprovalPolicy(sessionId) {
    try {
      const agent = ctx.get('agents')?.get(sessionId);
      if (agent === undefined) return;
      ctx.get('approval')?.setPolicy(agent, 'never');
    } catch (error) {
      log(`approval policy pin failed for ${sessionId}: ${error?.message ?? error}`);
    }
  }

  ctx.on('approval/request', (request, next) => {
    const agent = request?.agent;
    if (!agent || !chats.has(agent.id)) return next();
    log(`auto-rejected approval for "${request.toolName}" in ${agent.id}`);
    return 'rejected';
  });

  // A plugin reload must not leave a QQ turn parked on an approval prompt that
  // nothing can answer any more.
  for (const key of Object.keys(state.chats)) {
    const sessionId = state.chats[key]?.sessionId;
    if (typeof sessionId !== 'string' || sessionId === '') continue;
    try {
      ctx.sessionController.cancel({ sessionId });
      log(`cancelled any in-flight turn for ${key}`);
    } catch (error) {
      log(`startup cancel skipped for ${key}: ${error?.message ?? error}`);
    }
  }

  // One compact line per load: what a chat session can actually route to.
  void (async () => {
    try {
      const catalog = await ctx.sessionController.modelCatalog();
      const groups = (catalog?.groups ?? []).map((group) =>
        `${group.id}: ${(group.models ?? [])
          .map((model) => `${model.id}${model.reasoning?.efforts?.length ? `(${model.reasoning.efforts.map((effort) => effort.id).join('|')})` : ''}`)
          .join(', ')}`);
      log(`model catalog → ${groups.join('  ·  ')}; default=${JSON.stringify(catalog?.default)}`);
    } catch (error) {
      log(`model catalog unavailable: ${error?.message ?? error}`);
    }
  })();

  function loadState(file, logger) {
    try {
      if (!existsSync(file)) return { version: 1, chats: {} };
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.chats !== 'object' || parsed.chats === null) {
        return { version: 1, chats: {} };
      }
      return { version: 1, chats: parsed.chats };
    } catch (error) {
      logger(`state file unreadable, starting fresh: ${error?.message ?? error}`);
      return { version: 1, chats: {} };
    }
  }

  function saveState() {
    try {
      mkdirSync(dirname(cfg.stateFile), { recursive: true });
      const tmp = `${cfg.stateFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, cfg.stateFile);
    } catch (error) {
      log(`state save failed: ${error?.message ?? error}`);
    }
  }

  /* ---------------- editable settings ---------------- */

  // The patch file stays the fallback; anything the panel changes lives here so
  // the UI never has to rewrite YAML.
  const settingsFile = join(cfg.dataDir, 'settings.json');
  const settings = loadSettings();
  repoint(typeof settings.cacheDir === 'string' ? settings.cacheDir : '');
  // Preset edits are also written into the YAML; once DSH reloads the bundle the
  // replayed copy is identical and must not be fed to the model twice.
  for (const [presetId, text] of Object.entries(settings.presetPrompts ?? {})) {
    if (readPresetPrompt(presetId).trim() === String(text).trim()) delete settings.presetPrompts[presetId];
  }

  // 开机自启：往当前用户的「启动」文件夹放一个隐藏启动脚本，不需要管理员权限。
  const startupScriptPath = join(
    process.env.APPDATA ?? join(cfg.dataDir, 'appdata'),
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Startup',
    'DSH-NapCat.vbs',
  );

  function setAutoStart(enabled) {
    try {
      if (enabled) {
        const userBat = join(cfg.napcat.dir, 'launcher-user.bat');
        const launcher = existsSync(userBat)
          ? userBat
          : cfg.napcat.launcher !== ''
            ? cfg.napcat.launcher
            : join(cfg.napcat.dir, 'launcher.bat');
        mkdirSync(dirname(startupScriptPath), { recursive: true });
        writeFileSync(
          startupScriptPath,
          `CreateObject("WScript.Shell").Run "cmd /c ""${launcher}"" ${cfg.napcat.qq}", 0, False\r\n`,
          'utf8',
        );
        log(`autostart enabled -> ${startupScriptPath}`);
      } else if (existsSync(startupScriptPath)) {
        unlinkSync(startupScriptPath);
        log('autostart disabled');
      }
      settings.autoStart = enabled;
      saveSettings();
      return true;
    } catch (error) {
      log(`autostart failed: ${error?.message ?? error}`);
      return false;
    }
  }

  // 用户手动删了启动脚本也能自愈。
  if (settings.autoStart === true && !existsSync(startupScriptPath)) setAutoStart(true);

  function loadSettings() {
    const base = {
      whitelist: [],
      groups: [],
      personae: [],
      activePersonaId: '',
      stickers: { enabled: true },
      voice: {
        enabled: false,
        rate: 0,
        voiceName: 'Microsoft Huihui Desktop',
        engine: 'edge',
        edgeVoice: 'zh-CN-XiaoxiaoNeural',
        customUrl: '',
        customVoice: '',
      },
      search: { engine: 'host', searxUrl: '', customUrl: '' },
      memory: { enabled: true, everyTurns: 40, maxChars: 400 },
      memoryDir: '',
      basePersona: '',
      autoStart: false,
      intelligence: 'standard',
      owner: '',
      owners: [],
      ownerPerms: { send: true, broadcast: true, schedule: true },
      stickerDisabled: [],
      stickerGroup: {},
      stickerGroups: [],
      disabledUsers: [],
      hiddenPresets: [],
      presetPrompts: {},
      dnd: { enabled: false, startHour: 23, endHour: 9 },
      model: null,
      cacheDir: '',
      modelByChat: {},
      accounts: [],
      activeAccountId: '',
      toggles: {},
      proactiveCfg: { startHour: 9, endHour: 23, maxPerDay: 3 },
    };
    try {
      if (!existsSync(settingsFile)) return base;
      const parsed = JSON.parse(readFileSync(settingsFile, 'utf8'));
      if (parsed === null || typeof parsed !== 'object') return base;
      return {
        whitelist: Array.isArray(parsed.whitelist) ? parsed.whitelist.map(String) : [],
        personae: Array.isArray(parsed.personae)
          ? parsed.personae
              .filter((item) => item && typeof item.id === 'string')
              .map((item) => ({
                id: item.id,
                name: String(item.name ?? item.id),
                preset: String(item.preset ?? ''),
                prompt: String(item.prompt ?? ''),
              }))
          : [],
        activePersonaId: typeof parsed.activePersonaId === 'string' ? parsed.activePersonaId : '',
        stickers: { enabled: parsed.stickers?.enabled !== false },
        voice: {
          enabled: parsed.voice?.enabled === true,
          rate: Number.isFinite(Number(parsed.voice?.rate)) ? Number(parsed.voice.rate) : 0,
          voiceName:
            typeof parsed.voice?.voiceName === 'string' && parsed.voice.voiceName !== ''
              ? parsed.voice.voiceName
              : 'Microsoft Huihui Desktop',
          engine: parsed.voice?.engine === 'sapi' ? 'sapi' : parsed.voice?.engine === 'custom' ? 'custom' : 'edge',
          edgeVoice:
            typeof parsed.voice?.edgeVoice === 'string' && parsed.voice.edgeVoice !== ''
              ? parsed.voice.edgeVoice
              : 'zh-CN-XiaoxiaoNeural',
          customUrl: typeof parsed.voice?.customUrl === 'string' ? parsed.voice.customUrl : '',
          customVoice: typeof parsed.voice?.customVoice === 'string' ? parsed.voice.customVoice : '',
          pythonPath: typeof parsed.voice?.pythonPath === 'string' ? parsed.voice.pythonPath : '',
          pythonLib: typeof parsed.voice?.pythonLib === 'string' ? parsed.voice.pythonLib : '',
        },
        search: {
          engine:
            parsed.search?.engine === 'searx' || parsed.search?.engine === 'wikipedia' || parsed.search?.engine === 'ddg' || parsed.search?.engine === 'custom'
              ? parsed.search.engine
              : 'host',
          searxUrl: typeof parsed.search?.searxUrl === 'string' ? parsed.search.searxUrl : '',
          customUrl: typeof parsed.search?.customUrl === 'string' ? parsed.search.customUrl : '',
        },
        memory: {
          enabled: parsed.memory?.enabled !== false,
          everyTurns: Number.isFinite(Number(parsed.memory?.everyTurns)) ? Math.min(500, Math.max(5, Number(parsed.memory.everyTurns))) : 40,
          maxChars: Number.isFinite(Number(parsed.memory?.maxChars)) ? Math.min(2000, Math.max(120, Number(parsed.memory.maxChars))) : 400,
        },
        memoryDir: typeof parsed.memoryDir === 'string' ? parsed.memoryDir : '',
        basePersona: typeof parsed.basePersona === 'string' ? parsed.basePersona : '',
        autoStart: parsed.autoStart === true,
        owner: typeof parsed.owner === 'string' ? parsed.owner.trim() : '',
        owners: Array.isArray(parsed.owners)
          ? parsed.owners.map(String).map((value) => value.trim()).filter((value) => value !== '')
          : typeof parsed.owner === 'string' && parsed.owner.trim() !== ''
            ? [parsed.owner.trim()]
            : [],
        ownerPerms: {
          send: parsed.ownerPerms?.send !== false,
          broadcast: parsed.ownerPerms?.broadcast !== false,
          schedule: parsed.ownerPerms?.schedule !== false,
        },
        intelligence:
          parsed.intelligence === 'eco' || parsed.intelligence === 'high' || parsed.intelligence === 'max' ? parsed.intelligence : 'standard',
        stickerDisabled: Array.isArray(parsed.stickerDisabled) ? parsed.stickerDisabled.map(String) : [],
        stickerGroup:
          parsed.stickerGroup && typeof parsed.stickerGroup === 'object' && !Array.isArray(parsed.stickerGroup)
            ? Object.fromEntries(Object.entries(parsed.stickerGroup).map(([name, group]) => [String(name), String(group)]))
            : {},
        stickerGroups: Array.isArray(parsed.stickerGroups) ? parsed.stickerGroups.map(String) : [],
        disabledUsers: Array.isArray(parsed.disabledUsers) ? parsed.disabledUsers.map(String) : [],
        hiddenPresets: Array.isArray(parsed.hiddenPresets) ? parsed.hiddenPresets.map(String) : [],
        presetPrompts:
          parsed.presetPrompts && typeof parsed.presetPrompts === 'object' && !Array.isArray(parsed.presetPrompts)
            ? Object.fromEntries(Object.entries(parsed.presetPrompts).map(([key, value]) => [String(key), String(value)]))
            : {},
        groups: Array.isArray(parsed.groups) ? parsed.groups.map(String) : [],
        dnd: {
          enabled: parsed.dnd?.enabled === true,
          startHour: Number.isFinite(Number(parsed.dnd?.startHour)) ? Number(parsed.dnd.startHour) : 23,
          endHour: Number.isFinite(Number(parsed.dnd?.endHour)) ? Number(parsed.dnd.endHour) : 9,
        },
        model:
          parsed.model && typeof parsed.model === 'object' && typeof parsed.model.provider === 'string' && typeof parsed.model.model === 'string'
            ? {
                provider: parsed.model.provider,
                model: parsed.model.model,
                ...(typeof parsed.model.reasoningEffort === 'string' && parsed.model.reasoningEffort !== ''
                  ? { reasoningEffort: parsed.model.reasoningEffort }
                  : {}),
              }
            : null,
        modelByChat:
          parsed.modelByChat && typeof parsed.modelByChat === 'object' && !Array.isArray(parsed.modelByChat)
            ? Object.fromEntries(
                Object.entries(parsed.modelByChat)
                  .filter(([, route]) => route && typeof route.provider === 'string' && typeof route.model === 'string')
                  .map(([key, route]) => [
                    key,
                    {
                      provider: route.provider,
                      model: route.model,
                      ...(typeof route.reasoningEffort === 'string' && route.reasoningEffort !== '' ? { reasoningEffort: route.reasoningEffort } : {}),
                    },
                  ]),
              )
            : {},
        accounts: Array.isArray(parsed.accounts)
          ? parsed.accounts
              .filter((item) => item && typeof item.id === 'string')
              .map((item) => ({
                id: item.id,
                name: String(item.name ?? item.id),
                wsUrl: String(item.wsUrl ?? ''),
                token: String(item.token ?? ''),
              }))
          : [],
        activeAccountId: typeof parsed.activeAccountId === 'string' ? parsed.activeAccountId : '',
        cacheDir: typeof parsed.cacheDir === 'string' ? parsed.cacheDir : '',
        toggles:
          parsed.toggles && typeof parsed.toggles === 'object'
            ? {
                proactive: parsed.toggles.proactive,
                silence: parsed.toggles.silence,
                afterthought: parsed.toggles.afterthought,
              }
            : {},
        proactiveCfg: {
          startHour: Number.isFinite(Number(parsed.proactiveCfg?.startHour)) ? Number(parsed.proactiveCfg.startHour) : 9,
          endHour: Number.isFinite(Number(parsed.proactiveCfg?.endHour)) ? Number(parsed.proactiveCfg.endHour) : 23,
          maxPerDay: Number.isFinite(Number(parsed.proactiveCfg?.maxPerDay)) ? Number(parsed.proactiveCfg.maxPerDay) : 3,
        },
      };
    } catch (error) {
      log(`settings unreadable, using defaults: ${error?.message ?? error}`);
      return base;
    }
  }

  function saveSettings() {
    try {
      mkdirSync(dirname(settingsFile), { recursive: true });
      const tmp = `${settingsFile}.tmp`;
      writeFileSync(tmp, JSON.stringify(settings, null, 2));
      renameSync(tmp, settingsFile);
    } catch (error) {
      log(`settings save failed: ${error?.message ?? error}`);
    }
  }

  /** QQ numbers allowed to talk: the panel's list wins once it is non-empty. */
  function effectiveUsers() {
    const base = settings.whitelist.length > 0 ? settings.whitelist : cfg.allowUsers;
    return base.filter((user) => !settings.disabledUsers.includes(user));
  }

  /** Stickers sharing a label, used by `[表情包:分组名]`. */
  function stickersInGroup(group) {
    return Object.entries(settings.stickerGroup)
      .filter(([, value]) => value === group)
      .map(([name]) => name)
      .filter((name) => !settings.stickerDisabled.includes(name));
  }

  /** QQ groups allowed: the panel's list wins once it is non-empty. */
  function effectiveGroups() {
    return settings.groups.length > 0 ? settings.groups : cfg.allowGroups;
  }

  /** True inside the do-not-disturb window; only self-initiated messages are suppressed. */
  function inDnd(now) {
    if (settings.dnd.enabled !== true) return false;
    const start = Number(settings.dnd.startHour);
    const end = Number(settings.dnd.endHour);
    const hour = now.getHours();
    return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  /* ---------- spend estimate ---------- */

  const usageFile = join(cfg.dataDir, 'usage.json');
  const PRICE = { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] }; // 元/百万 token，[空闲, 高峰]
  let usage = loadUsage();

  function loadUsage() {
    try {
      const parsed = JSON.parse(readFileSync(usageFile, 'utf8'));
      return { day: String(parsed.day ?? ''), total: Number(parsed.total) || 0, turns: Number(parsed.turns) || 0, last: Number(parsed.last) || 0 };
    } catch {
      return { day: '', total: 0, turns: 0, last: 0 };
    }
  }

  function saveUsage() {
    try {
      mkdirSync(dirname(usageFile), { recursive: true });
      writeFileSync(usageFile, JSON.stringify(usage, null, 2));
    } catch (error) {
      log(`usage save failed: ${error?.message ?? error}`);
    }
  }

  function beijingHour(timeMs) {
    return new Date(timeMs + 8 * 3600 * 1000).getUTCHours();
  }

  function isPeak(timeMs) {
    const local = new Date(timeMs + 8 * 3600 * 1000);
    const day = local.getUTCDay();
    if (day === 0 || day === 6) return false;
    const hour = local.getUTCHours();
    return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18);
  }

  /** Fold one assistant message's usage into today's running total. */
  function recordUsage(tokenUsage, timeMs) {
    try {
      const tier = isPeak(timeMs ?? Date.now()) ? 1 : 0;
      const input = Number(tokenUsage.inputTokens) || 0;
      const cache = Number(tokenUsage.cacheReadTokens) || 0;
      const output = Number(tokenUsage.outputTokens) || 0;
      const cost = (cache / 1e6) * PRICE.hit[tier] + (input / 1e6) * PRICE.miss[tier] + (output / 1e6) * PRICE.out[tier];
      const day = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      if (usage.day !== day) {
        usage = { day, total: 0, turns: 0, last: 0 };
      }
      usage.total += cost;
      usage.turns += 1;
      usage.last = cost;
      saveUsage();
    } catch (error) {
      log(`usage record failed: ${error?.message ?? error}`);
    }
  }

  /** Write the persona text back into an installed preset's YAML block. */
  function writePresetPrompt(id, prompt) {
    const file = join(cfg.presetDir, `${id}-preset`, 'cordis.patch.yml');
    if (!existsSync(file)) throw new Error(`找不到预设文件：${file}`);
    const backup = `${file}.orig`;
    if (!existsSync(backup)) cpSync(file, backup);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const start = lines.findIndex((line) => /^\s*prefix:\s*\|-?\s*$/.test(line));
    if (start === -1) throw new Error('这个预设里没有 prefix 块，改不了');
    const indent = (lines[start].match(/^\s*/) ?? [''])[0].length;
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (lines[index].trim() === '') continue;
      const lead = (lines[index].match(/^\s*/) ?? [''])[0].length;
      if (lead <= indent) {
        end = index;
        break;
      }
    }
    const body = String(prompt)
      .split(/\r?\n/)
      .map((line) => `${' '.repeat(indent + 2)}${line}`);
    const next = [...lines.slice(0, start + 1), ...body, ...lines.slice(end)];
    writeFileSync(file, next.join('\n'), 'utf8');
    const check = readPresetPrompt(id);
    if (check.trim() !== String(prompt).trim()) {
      cpSync(backup, file);
      throw new Error('写回后校验失败，已还原（可能是格式问题）');
    }
  }

  /** Read the persona text out of an installed preset bundle (read-only). */
  function readPresetPrompt(id) {
    try {
      const file = join(cfg.presetDir, `${id}-preset`, 'cordis.patch.yml');
      if (!existsSync(file)) return '';
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      const start = lines.findIndex((line) => /^\s*prefix:\s*\|-?\s*$/.test(line));
      if (start === -1) return '';
      const indent = (lines[start].match(/^\s*/) ?? [''])[0].length;
      const body = [];
      for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index];
        if (line.trim() === '') {
          body.push('');
          continue;
        }
        const lead = (line.match(/^\s*/) ?? [''])[0].length;
        if (lead <= indent) break;
        body.push(line.slice(Math.min(lead, indent + 2)));
      }
      return body.join('\n').trim();
    } catch (error) {
      log(`preset read failed (${id}): ${error?.message ?? error}`);
      return '';
    }
  }

  /** Bytes used by one file or directory tree (best effort). */
  function sizeOf(path) {
    try {
      const info = statSync(path);
      if (info.isFile()) return info.size;
      if (!info.isDirectory()) return 0;
      return readdirSync(path).reduce((sum, name) => sum + sizeOf(join(path, name)), 0);
    } catch {
      return 0;
    }
  }

  /** Drop regenerable files: voice renders, old monitor images, the log. */
  function cleanCache() {
    const removed = [];
    try {
      if (existsSync(voiceDir)) {
        for (const name of readdirSync(voiceDir)) {
          unlinkSync(join(voiceDir, name));
        }
        removed.push('voice');
      }
      if (existsSync(messagesDir)) {
        const files = readdirSync(messagesDir).sort();
        for (const name of files.slice(0, Math.max(0, files.length - 100))) {
          unlinkSync(join(messagesDir, name));
        }
        removed.push('messages');
      }
      if (existsSync(logFile)) {
        writeFileSync(logFile, '');
        removed.push('log');
      }
      log(`cache cleaned: ${removed.join(', ') || 'nothing'}`);
    } catch (error) {
      log(`cache clean failed: ${error?.message ?? error}`);
    }
    return removed;
  }

  /** Move the movable files from the active cache root into `targetRoot`. */
  function moveCache(targetRoot) {
    if (typeof targetRoot !== 'string' || targetRoot.trim() === '' || targetRoot === cacheRoot) return;
    mkdirSync(targetRoot, { recursive: true });
    for (const name of ['messages.json', 'messages', 'voice', 'stickers', 'bridge.log']) {
      const from = join(cacheRoot, name);
      const to = join(targetRoot, name);
      if (!existsSync(from) || existsSync(to)) continue;
      cpSync(from, to, { recursive: true, force: false, errorOnExist: false });
      rmSync(from, { recursive: true, force: true });
    }
  }

  /** Gather raw search material from the configured engine. */
  async function collectSearchMaterial(term) {
    const engine = settings.search?.engine ?? 'host';
    const encoded = encodeURIComponent(term);
    try {
      if (engine === 'searx') {
        const base = String(settings.search.searxUrl ?? '').trim().replace(/\/+$/, '');
        if (base !== '') {
          const response = await fetch(`${base}/search?q=${encoded}&format=json&language=zh-CN`, {
            signal: AbortSignal.timeout(15000),
            headers: { accept: 'application/json' },
          });
          if (response.ok) {
            const data = await response.json();
            return (data.results ?? [])
              .slice(0, 5)
              .map((item) => `${item.title ?? ''}: ${item.content ?? ''}`)
              .join('\n')
              .slice(0, 3000);
          }
        }
      }
      if (engine === 'wikipedia') {
        const response = await fetch(
          `https://zh.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&format=json&srlimit=5&origin=*`,
          { signal: AbortSignal.timeout(15000) },
        );
        if (response.ok) {
          const data = await response.json();
          const hits = data?.query?.search ?? [];
          return hits
            .map((hit) => `${hit.title}: ${String(hit.snippet ?? '').replace(/<[^>]+>/g, '')}`)
            .join('\n')
            .slice(0, 3000);
        }
      }
      if (engine === 'ddg') {
        const response = await fetch(`https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`, {
          signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
          const data = await response.json();
          const parts = [data.AbstractText ?? ''];
          for (const topic of (data.RelatedTopics ?? []).slice(0, 5)) {
            if (typeof topic.Text === 'string') parts.push(topic.Text);
          }
          return parts.filter((part) => part !== '').join('\n').slice(0, 3000);
        }
      }
      if (engine === 'custom') {
        const template = String(settings.search.customUrl ?? '').trim();
        if (template !== '') {
          const response = await fetch(template.replace(/\{q\}/g, encoded), { signal: AbortSignal.timeout(15000) });
          if (response.ok) {
            const text = await response.text();
            return text.slice(0, 3000);
          }
        }
      }
    } catch (error) {
      log(`search engine ${engine} failed: ${error?.message ?? error}`);
    }
    // Always keep the host provider as the last resort.
    try {
      const result = await ctx.get('web')?.search({ query: term });
      return JSON.stringify(result ?? '').slice(0, 3000);
    } catch (error) {
      log(`web lookup failed: ${error?.message ?? error}`);
      return '';
    }
  }

  /**
   * Look a term up and answer it in her voice. Backend is either a self-hosted
   * SearXNG, Wikipedia, DuckDuckGo, a custom URL template, or the host's own
   * web provider.
   */
  async function lookupTerm(term) {
    const material = await collectSearchMaterial(term);
    if (material === undefined || material === '') return null;
    const answer = await askModel(
      '你在帮一个 QQ 聊天机器人查资料。用两三句口语把词条讲清楚，像跟朋友转述；不要列表、不要「根据资料」、不要介绍自己。',
      `词条：${term}\n\n资料：\n${material}`,
    );
    return answer.trim() === '' ? null : answer.trim();
  }

  async function answerLookup(chat, term) {
    try {
      chat.lookupDone = true;
      log(`lookup requested: ${term}`);
      const answer = await lookupTerm(term);
      if (answer === null) {
        sendText(chat, `没查到「${term}」，换个说法？`);
        return;
      }
      sendText(chat, answer);
    } catch (error) {
      log(`lookup failed: ${error?.message ?? error}`);
    }
  }

  /* ---------- voice output (offline TTS) ---------- */


  function runPowerShell(script, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
        windowsHide: true,
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new Error('powershell timeout'));
      }, timeoutMs);
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`powershell exit ${code}`));
      });
    });
  }

  /** edge-tts (Microsoft online voices) — better tone, needs network. */
  async function synthesizeEdge(text, file, voiceOverride) {
    const python = settings.voice?.pythonPath || DEFAULT_PYTHON;
    const lib = settings.voice?.pythonLib || join(cfg.dataDir, 'pylib');
    const voice = voiceOverride || settings.voice?.edgeVoice || 'zh-CN-XiaoxiaoNeural';
    const script = [
      'import asyncio, sys',
      'import edge_tts',
      'async def main():',
      '    c = edge_tts.Communicate(sys.argv[1], sys.argv[2])',
      '    await c.save(sys.argv[3])',
      'asyncio.run(main())',
    ].join('\n');
    await new Promise((resolve, reject) => {
      const child = spawn(python, ['-c', script, text, voice, file], {
        windowsHide: true,
        env: { ...process.env, PYTHONPATH: lib },
      });
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {
          /* ignore */
        }
        reject(new Error('edge-tts timeout'));
      }, 45000);
      let stderr = '';
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`edge-tts exit ${code}: ${stderr.slice(-200)}`));
      });
    });
    return existsSync(file) && statSync(file).size > 1000 ? file : null;
  }

  /** Render one line to audio with the configured engine. */
  /** One SAPI render with an explicit voice, so samples can differ. */
  async function synthesizeSapi(text, file, voiceName, rate) {
    const escaped = String(text).replace(/'/g, "''");
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      `try { $s.SelectVoice('${String(voiceName).replace(/'/g, "''")}') } catch { }`,
      `$s.Rate = ${Math.max(-10, Math.min(10, Number(rate) || 0))}`,
      `$s.SetOutputToWaveFile('${file.replace(/'/g, "''")}')`,
      `$s.Speak('${escaped}')`,
      '$s.Dispose()',
    ].join('; ');
    await runPowerShell(script);
    return existsSync(file) && statSync(file).size > 1000 ? file : null;
  }

  /** Any HTTP TTS that returns audio bytes for `{text}` (e.g. GPT-SoVITS API). */
  async function synthesizeCustomVoice(text) {
    const template = String(settings.voice?.customUrl ?? '').trim();
    if (template === '') throw new Error('没有配置自定义语音地址');
    const url = template
      .replace(/\{text\}/g, encodeURIComponent(text))
      .replace(/\{voice\}/g, encodeURIComponent(String(settings.voice?.customVoice ?? '')));
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`自定义 TTS HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1000) throw new Error('自定义 TTS 返回内容太小');
    const type = String(response.headers.get('content-type') ?? '');
    const file = join(voiceDir, `c-${Date.now()}${type.includes('wav') ? '.wav' : '.mp3'}`);
    writeFileSync(file, bytes);
    return file;
  }

  async function synthesizeVoice(text) {
    try {
      const line = String(text ?? '').trim();
      if (line === '') return null;
      mkdirSync(voiceDir, { recursive: true });
      if (settings.voice.engine === 'custom') {
        try {
          const file = await synthesizeCustomVoice(line);
          log(`voice (custom) synthesized (${statSync(file).size} bytes)`);
          return file;
        } catch (error) {
          log(`custom TTS failed, falling back to edge: ${error?.message ?? error}`);
        }
      }
      if (settings.voice.engine !== 'sapi') {
        const file = join(voiceDir, `e-${Date.now()}.mp3`);
        const rendered = await synthesizeEdge(line, file);
        if (rendered !== null) {
          log(`voice (edge) synthesized (${statSync(rendered).size} bytes)`);
          return rendered;
        }
        log('edge-tts failed, falling back to SAPI');
      }
      const file = join(voiceDir, `v-${Date.now()}.wav`);
      const voiceName = settings.voice?.voiceName || 'Microsoft Huihui Desktop';
      const rate = Number.isFinite(Number(settings.voice?.rate)) ? Number(settings.voice.rate) : 0;
      const rendered = await synthesizeSapi(line, file, voiceName, rate);
      if (rendered === null) return null;
      log(`voice synthesized (${statSync(rendered).size} bytes)`);
      return rendered;
    } catch (error) {
      log(`voice synthesis failed: ${error?.message ?? error}`);
      return null;
    }
  }

  /* ---------- long-term memory (periodic compaction) ---------- */

  const memoriesFile = join(cfg.dataDir, 'memories.json');
  // Memories are the one thing not worth regenerating: their folder is movable
  // on its own, independent of the cache.
  let memoryFile =
    typeof settings.memoryDir === 'string' && settings.memoryDir !== '' ? join(settings.memoryDir, 'memories.json') : memoriesFile;
  const compacting = new Set();
  let memories = loadMemories();

  function loadMemories() {
    try {
      const parsed = JSON.parse(readFileSync(memoryFile, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveMemories() {
    try {
      mkdirSync(dirname(memoryFile), { recursive: true });
      writeFileSync(memoryFile, JSON.stringify(memories, null, 2));
    } catch (error) {
      log(`memory save failed: ${error?.message ?? error}`);
    }
  }

  /**
   * Fold the recent chat into a short memory note, then retire the Session so
   * the next message starts clean with that note — cheaper than letting the
   * transcript grow until the window is full.
   */
  async function compactChat(chat, reason) {
    if (compacting.has(chat.key)) return null;
    compacting.add(chat.key);
    try {
      const recent = messages
        .filter((entry) => entry.chat === chat.key)
        .slice(-60)
        .map((entry) => `${entry.dir === 'in' ? '他' : '你'}：${String(entry.text ?? '').slice(0, 200)}`)
        .join('\n');
      if (recent.trim() === '') return null;
      const summary = await askModel(
        '把下面这段 QQ 聊天压成一小段"给以后的自己看"的记忆。保留：他是谁、在做什么、在意什么、你们的默契和没聊完的事。' +
          '用第三人称、不超过 6 句、不要寒暄、不要评价。',
        recent,
      );
      if (summary.trim() === '') return null;
      memories[chat.key] = {
        text: summary.trim().slice(0, settings.memory.maxChars),
        at: Date.now(),
        reason: String(reason ?? 'turns'),
      };
      saveMemories();
      // Retire the Session: next message re-creates it with the memory attached.
      const previous = state.chats[chat.key];
      if (previous !== undefined) {
        delete state.chats[chat.key];
        chats.delete(previous.sessionId);
        saveState();
      }
      log(`memory compacted for ${chat.key} (${reason})`);
      return memories[chat.key].text;
    } catch (error) {
      log(`memory compaction failed: ${error?.message ?? error}`);
      return null;
    } finally {
      compacting.delete(chat.key);
    }
  }

  /* ---------- AI helpers (same credentials as DSH) ---------- */

  /** One-shot completion over the host's own model route — no separate key. */
  async function askModel(system, userText, maxTokens = 800) {
    const llm = ctx.get('llm');
    if (llm === undefined) throw new Error('llm 服务不可用');
    let provider = cfg.model?.provider ?? 'deepseek-account';
    let model = cfg.model?.model ?? 'deepseek-flash';
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (selection?.provider) provider = selection.provider;
      if (selection?.model) model = selection.model;
    } catch {
      /* keep the configured fallback */
    }
    let text = '';
    const options = {
      provider,
      model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      maxTokens,
      signal: AbortSignal.timeout(90000),
    };
    for await (const chunk of llm.stream(options)) {
      if (chunk.type === 'text-delta') text += chunk.text;
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
        throw new Error(chunk.reason.failure?.message ?? '模型调用失败');
      }
    }
    return text.trim();
  }

  const PERSONA_SYSTEM = [
    '你是给 QQ 聊天机器人写人设的提示词工程师。',
    '用户给一句自然语言描述，你输出一个 JSON 对象，且只输出 JSON，不要解释、不要代码块。',
    '字段：name（中文名，短）、preset（只能是 "whale" 或 "chiang"）、prompt（人设提示词，150–400 字，中文）。',
    'prompt 要写成"你如何说话"的规则：口吻、长短、情绪反应、禁忌；不要写世界观设定，不要写具体剧情。',
    'whale 底座适合日常闲聊、短句、口语；chiang 底座适合训话腔、硬气。按描述挑一个更贴的。',
  ].join('\n');

  /** Pull candidate image URLs out of one page (or return the URL if it is already an image). */
  async function imageUrlsFrom(url) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (!response.ok) return [];
      const type = String(response.headers.get('content-type') ?? '');
      if (type.startsWith('image/')) return [url];
      if (!type.includes('html')) return [];
      const html = (await response.text()).slice(0, 400000);
      const found = [];
      for (const match of html.matchAll(/<img[^>]+(?:data-src|data-original|src)=["']([^"']+)["']/gi)) {
        try {
          const absolute = new URL(match[1], url).href;
          if (/\.(png|jpe?g|gif|webp)(\?|$)/i.test(absolute)) found.push(absolute);
        } catch {
          /* skip malformed */
        }
      }
      for (const match of html.matchAll(/https?:\/\/[^"'\s<>]+?\.(?:png|jpe?g|gif|webp)/gi)) found.push(match[0]);
      return [...new Set(found)];
    } catch {
      return [];
    }
  }

  /** Search the web for sticker images and install the first few that decode. */
  async function searchStickers(query, limit = 4) {
    const web = ctx.get('web');
    if (web === undefined) throw new Error('web 服务不可用');
    // GitHub first: sticker packs there are single images with stable raw URLs.
    let result = await web.search({ query: `github ${query} 表情包 sticker pack` });
    let raw = JSON.stringify(result ?? {});
    let allUrls = [...raw.matchAll(/https?:\/\/[^"'\s\\<>]+/gi)].map((m) => m[0]);
    const githubRaw = allUrls.filter((url) => /raw\.githubusercontent\.com|github\.com\/[^/]+\/[^/]+\/raw/i.test(url)).filter((url) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url));
    if (githubRaw.length === 0) {
      // No direct GitHub images: fall back to the generic search, but keep the
      // GitHub query as a second pass because it often surfaces pack READMEs
      // that list raw image links.
      result = await web.search({ query: `${query} 表情包` });
      raw = JSON.stringify(result ?? {});
      allUrls = [...raw.matchAll(/https?:\/\/[^"'\s\\<>]+/gi)].map((m) => m[0]);
    }
    const directImages = allUrls.filter((url) => /\.(png|jpe?g|gif|webp)(\?|$)/i.test(url) && !/logo|icon|avatar|badge|favicon|sprite/i.test(url));
    const pages = allUrls.filter((url) => !/\.(png|jpe?g|gif|webp|css|js)(\?|$)/i.test(url));

    const candidates = [];
    for (const url of directImages.slice(0, 8)) candidates.push(url);
    for (const page of [...new Set(pages)].slice(0, 5)) {
      const fromPage = await imageUrlsFrom(page);
      for (const url of fromPage.slice(0, 8)) candidates.push(url);
      if (candidates.length >= 24) break;
    }

    const saved = [];
    // Prefer hosts that actually host reaction images over generic article pages.
    const preferred = /biaoqing|sticker|emoji|doutu|fabiaoqing|memes|gif/i;
    const ordered = [...new Set(candidates)].sort((a, b) => Number(preferred.test(b)) - Number(preferred.test(a)));
    for (const url of ordered) {
      if (saved.length >= limit) break;
      if (/logo|icon|avatar|badge|csdn|favicon|sprite/i.test(url)) continue;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 15000 || bytes.byteLength > 4 * 1024 * 1024) continue;
        const mediaType = sniffImage(bytes);
        if (mediaType === null) continue;
        // PNG carries its own dimensions at a fixed offset; reject postage-stamp logos.
        if (mediaType === 'image/png' && bytes.length > 24) {
          const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
          const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
          if (width > 0 && height > 0 && (width < 150 || height < 150)) continue;
        }
        const extension =
          mediaType === 'image/gif' ? '.gif' : mediaType === 'image/webp' ? '.webp' : mediaType === 'image/jpeg' ? '.jpg' : '.png';
        const safe = String(query).replace(/[\\/:*?"<>|\s]/g, '').slice(0, 12) || 'sticker';
        const name = `${safe}_${saved.length + 1}`;
        mkdirSync(stickerDir, { recursive: true });
        writeFileSync(join(stickerDir, `${name}${extension}`), bytes);
        saved.push(name);
      } catch {
        /* try the next candidate */
      }
    }
    return saved;
  }

  let messages = loadMessages();

  function loadMessages() {
    try {
      const parsed = JSON.parse(readFileSync(messagesFile, 'utf8'));
      return Array.isArray(parsed) ? parsed.slice(-300) : [];
    } catch {
      return [];
    }
  }

  function logMessage(entry) {
    try {
      messages.push({ time: Date.now(), ...entry });
      if (messages.length > 300) messages = messages.slice(-300);
      mkdirSync(dirname(messagesFile), { recursive: true });
      writeFileSync(messagesFile, JSON.stringify(messages, null, 0));
    } catch (error) {
      log(`monitor write failed: ${error?.message ?? error}`);
    }
  }

  /** The persona a new Session is born with. */
  function activePersona() {
    const builtin = ['whale', 'chiang'];
    if (builtin.includes(settings.activePersonaId)) {
      return { id: settings.activePersonaId, preset: settings.activePersonaId, prompt: '' };
    }
    const chosen = settings.personae.find((item) => item.id === settings.activePersonaId);
    if (chosen !== undefined && chosen.preset !== '') {
      return { id: chosen.id, preset: chosen.preset, prompt: chosen.prompt };
    }
    return { id: 'config', preset: cfg.agentPreset, prompt: '' };
  }

  /** Last N lines of the bridge log, for the panel's log viewer. */
  function tailLog(lines) {
    try {
      const text = readFileSync(logFile, 'utf8');
      return text.trim().split(/\r?\n/).slice(-lines);
    } catch {
      return [];
    }
  }

  /* ---------------- onebot transport ---------------- */

  function action(name, params) {
    if (!socket || !socket.ready) return false;
    const echo = `b${(echoSeq += 1)}`;
    return socket.send(JSON.stringify({ action: name, params, echo }));
  }

  function sendSegments(chat, segments) {
    if (chat.kind === 'group') {
      action('send_msg', { message_type: 'group', group_id: Number(chat.chatId) || chat.chatId, message: segments });
    } else {
      action('send_msg', { message_type: 'private', user_id: Number(chat.chatId) || chat.chatId, message: segments });
    }
  }

  /** `stickers/<name>.png|gif|jpg` — the folder a human can drop memes into. */
  function resolveSticker(name) {
    const safe = name.replace(/[\\/:*?"<>|]/g, '').trim();
    if (safe === '' || stickerDir === '') return null;
    for (const extension of ['.png', '.gif', '.jpg', '.jpeg', '.webp']) {
      const file = join(stickerDir, `${safe}${extension}`);
      if (existsSync(file)) return file;
    }
    return null;
  }

  /** Any enabled image in the sticker folder — used by a bare `[表情包]`. */
  function randomSticker() {
    try {
      const files = readdirSync(stickerDir)
        .filter((name) => /\.(png|gif|jpe?g|webp)$/i.test(name))
        .filter((name) => !settings.stickerDisabled.includes(name.replace(/\.[^.]+$/, '')));
      if (files.length === 0) return null;
      return join(stickerDir, files[Math.floor(Math.random() * files.length)]);
    } catch {
      return null;
    }
  }

  /**
   * Turn one burst into OneBot segments: text, built-in faces (`[表情:白眼]`)
   * and real sticker images (`[表情包]` = any file, `[表情包:名]` = that file).
   */
  function burstSegments(burst, chat) {
    const segments = [];
    if (chat.kind === 'group' && chat.userId) segments.push({ type: 'at', data: { qq: String(chat.userId) } });
    const pattern = /\[(表情|表情包)(?::([^\]\n]{1,16}))?\]/g;
    let cursor = 0;
    let match;
    const pushText = (value) => {
      const text = value.trim();
      if (text !== '') segments.push({ type: 'text', data: { text } });
    };
    while ((match = pattern.exec(burst)) !== null) {
      pushText(burst.slice(cursor, match.index));
      const kind = match[1];
      const name = (match[2] ?? '').trim();
      if (kind === '表情') {
        const id = FACE_IDS[name];
        if (id !== undefined) segments.push({ type: 'face', data: { id: String(id) } });
        else if (name !== '') log(`unknown face "${name}" dropped`);
      } else {
        const disabled = settings.stickerDisabled.includes(name);
        if (disabled) log(`sticker "${name}" is disabled`);
        let file = null;
        if (!disabled) {
          file = name === '' ? randomSticker() : resolveSticker(name);
          if (file === null && name !== '') {
            const group = stickersInGroup(name);
            if (group.length > 0) {
              file = resolveSticker(group[Math.floor(Math.random() * group.length)]);
            }
          }
        }
        if (file !== null) {
          segments.push({ type: 'image', data: { file } });
        } else if (name !== '' && FACE_IDS[name] !== undefined) {
          segments.push({ type: 'face', data: { id: String(FACE_IDS[name]) } });
        } else {
          log(`no sticker available for "${name}" in ${stickerDir}`);
        }
      }
      cursor = match.index + match[0].length;
    }
    pushText(burst.slice(cursor));
    if (segments.length === 0) return null;
    if (segments.every((segment) => segment.type === 'at')) return null;
    return segments;
  }

  /**
   * A relayed message must read like she said it herself — no "号主让我告诉你",
   * no signature. Strip the give-aways the model likes to add.
   */
  function stripOwnerAttribution(text) {
    let out = String(text ?? '');
    const owner = '(?:号主|主人|老板)';
    const verb = '(?:跟我说|跟你说|跟你讲|给你说|告诉你|和你说|说一声|说|转告|转达|跟你|给你)';
    // Longer alternatives first, otherwise "跟你说" collapses into "跟你".
    const lead = `(?:让我|叫我|要我|吩咐我|让我来)?(?:你)?${verb}(?:你)?(?:一声|一下)?[：:，,、\\s]*`;
    out = out.replace(/[（(【\[]\s*(?:号主|主人|老板)[^）)】\]]{0,14}[）)】\]]/g, '');
    out = out.replace(new RegExp(`^\\s*${owner}(?:让你|叫你|要你)(?:${verb})?(?:你)?(?:一声|一下)?[：:，,、\\s]*`), '');
    out = out.replace(new RegExp(`^\\s*${owner}${lead}`), '');
    out = out.replace(new RegExp(`^\\s*他(?:让我|叫我|要我|吩咐我)${lead}`), '');
    out = out.replace(/(?:我)?(?:替|代|帮)(?:号主|主人|老板)(?:转告|转达|说|传话)(?:你)?(?:一声|一下)?[：:，,、\s]*/g, '');
    out = out.replace(/^\s*(?:转告|转达)(?:你)?(?:一声|一下)?[：:，,、\s]*/, '');
    out = out.replace(/(?:这是|是)(?:号主|主人)(?:发的|让发的|的意思)/g, '');
    out = out.replace(/^\s*[，,、：:；;]+\s*/, '');
    return out.trim();
  }

  /** Owner-only: deliver a message to one whitelisted person on their behalf. */
  function sendToUser(userId, text, prefix) {
    const target = String(userId).trim();
    const allowed = effectiveUsers().includes(target) || settings.owners.includes(target);
    if (!allowed) {
      log(`owner target ${target} is not in the whitelist — refused`);
      return false;
    }
    const cleaned = stripOwnerAttribution(text);
    if (cleaned === '') return false;
    sendText(
      { key: `private:${target}`, kind: 'private', chatId: target, userId: target, sendChain: Promise.resolve() },
      String(prefix ?? '') + cleaned,
    );
    logMessage({ dir: 'out', chat: `private:${target}`, text: `[号主代发] ${cleaned.slice(0, 200)}` });
    log(`owner relay -> private:${target}`);
    return true;
  }

  /**
   * Occasionally answer with a picture instead of words — the way people spam
   * each other with stickers when the mood is obvious.
   */
  function maybeSendSticker(chat, lastText) {
    if (settings.stickers.enabled !== true) return;
    const text = String(lastText ?? '');
    const emotional = /哈哈|笑死|难受|烦|累|生气|抱抱|哭|呜呜|晚安|睡觉|想你/.test(text);
    if (Math.random() > (emotional ? 0.4 : 0.1)) return;
    setTimeout(() => {
      try {
        const names = listStickers().filter((name) => !settings.stickerDisabled.includes(name));
        if (names.length === 0) return;
        const name = names[Math.floor(Math.random() * names.length)];
        const file = resolveSticker(name);
        if (file !== null) {
          sendSegments(chat, [{ type: 'image', data: { file } }]);
          log(`sent sticker ${name} unprompted`);
        }
      } catch (error) {
        log(`sticker send failed: ${error?.message ?? error}`);
      }
    }, 900 + Math.random() * 1800);
  }

  /** Names of the files currently in the sticker folder. */
  function listStickers() {
    try {
      return readdirSync(stickerDir)
        .filter((name) => /\.(png|gif|jpe?g|webp)$/i.test(name))
        .map((name) => name.replace(/\.[^.]+$/, ''));
    } catch {
      return [];
    }
  }

  function sendText(chat, text) {
    const body = String(text ?? '').trim();
    if (body === '') return;
    // Bursts are split first: a `|||` line must never reach the Markdown
    // stripper, which would read it as a table row.
    logMessage({ dir: 'out', chat: String(chat.key ?? ''), text: body.slice(0, 500) });
    const bursts = splitBursts(body, cfg.maxReplyChars);
    const chunks = (cfg.plainText ? bursts.map((burst) => renderForChat(burst)) : bursts).filter((chunk) => chunk !== '');
    if (chunks.length === 0) return;
    chat.sendChain = chat.sendChain.then(async () => {
      for (let index = 0; index < chunks.length; index += 1) {
        let chunk = chunks[index];
        if (index > 0) {
          // The pause between two bubbles is what makes it read like someone
          // typing rather than one paragraph being pasted in.
          const pause = 600 + Math.random() * 2200;
          await new Promise((resolve) => setTimeout(resolve, pause));
        }
        if (chat.isOwner === true) {
          const perms = settings.ownerPerms;
          const toOne = perms.send ? chunk.match(/^\s*\[发送[:：]\s*([0-9]{5,12})\s*\|\s*([\s\S]{1,300})\]\s*$/) : null;
          if (toOne !== null) {
            sendToUser(toOne[1], toOne[2]);
            continue;
          }
          const toAll = perms.broadcast ? chunk.match(/^\s*\[群发[:：]\s*([\s\S]{1,300})\]\s*$/) : null;
          if (toAll !== null) {
            for (const target of effectiveUsers()) sendToUser(target, toAll[1]);
            continue;
          }
          const later = perms.schedule
            ? chunk.match(/^\s*\[定时[:：]\s*(\d{1,4})\s*\|\s*([0-9]{5,12})\s*\|\s*([\s\S]{1,300})\]\s*$/)
            : null;
          if (later !== null) {
            const minutes = Math.min(1440, Number(later[1]));
            const target = later[2];
            const body = later[3];
            log(`scheduled relay to ${target} in ${minutes}min`);
            setTimeout(() => sendToUser(target, body), minutes * 60000);
            continue;
          }
        }
        // `[表情包:搜 关键词]` goes online for a fresh sticker instead of using
        // the local shelf.
        const stickerSearch = chunk.match(/^\s*\[表情包[:：]\s*搜\s*([^\]\n]{1,20})\]\s*$/);
        if (stickerSearch !== null) {
          try {
            const added = await searchStickers(stickerSearch[1].trim(), 2);
            for (const name of added) {
              const file = resolveSticker(name);
              if (file !== null) sendSegments(chat, [{ type: 'image', data: { file } }]);
              await new Promise((resolve) => setTimeout(resolve, 700));
            }
          } catch (error) {
            log(`sticker search failed: ${error?.message ?? error}`);
          }
          continue;
        }
        // `[查:词]` = she admits she doesn't know it; the bridge looks it up and
        // replies with a second, short answer in her voice.
        const lookup = chunk.match(/^\s*\[查[:：]\s*([^\]\n]{1,24})\]\s*$/);
        if (lookup !== null) {
          void answerLookup(chat, lookup[1].trim());
          continue;
        }
        // `[语音]` turns one burst into a voice message; without TTS enabled or
        // a successful render it degrades to plain text instead of vanishing.
        let voiceFile = null;
        if (/^\s*\[语音\]/.test(chunk)) {
          const spoken = chunk.replace(/^\s*\[语音\]\s*/, '');
          if (settings.voice.enabled && spoken !== '') {
            voiceFile = await synthesizeVoice(spoken);
            if (voiceFile !== null) chunk = spoken;
          } else {
            chunk = spoken;
          }
        }
        if (voiceFile !== null) {
          sendSegments(chat, [{ type: 'record', data: { file: voiceFile.replace(/\\/g, '/') } }]);
          continue;
        }
        const segments = burstSegments(chunk, chat);
        if (segments === null) continue;
        sendSegments(chat, segments);
      }
    }).catch((error) => log(`send failed: ${error?.message ?? error}`));
  }

  function connectSocket() {
    if (stopped || accountPaused) return;
    reconnectTimer = null;
    const client = new MiniWebSocket(cfg.wsUrl, {
      token: cfg.accessToken,
      onOpen: () => {
        reconnectDelay = 1000;
        log('onebot websocket connected');
        client.lastAlive = Date.now();
        heartbeat = setInterval(() => {
          if (!client.ready) return;
          if (client.pendingPing !== 0 && Date.now() - client.pendingPing > 45000) {
            log('heartbeat timed out, reconnecting');
            client.close();
            return;
          }
          client.ping();
        }, 20000);
      },
      onMessage: (text) => {
        client.lastAlive = Date.now();
        try {
          handlePayload(JSON.parse(text));
        } catch (error) {
          log(`bad onebot payload: ${error?.message ?? error}`);
        }
      },
      onClose: (error) => {
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        if (stopped || accountPaused) return;
        log(`onebot websocket closed: ${error?.message ?? error}; retrying in ${reconnectDelay}ms`);
        reconnectTimer = setTimeout(connectSocket, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 15000);
      },
    });
    socket = client;
    try {
      client.open();
    } catch (error) {
      log(`connect failed: ${error?.message ?? error}`);
      client.onClose?.(error);
    }
  }

  /* ---------------- chat -> session ---------------- */

  function chatKey(kind, id) {
    return `${kind}:${id}`;
  }

  async function ensureSession(chat) {
    const known = state.chats[chat.key];
    const persona = activePersona();
    // A different persona — or a revised preset — means a different person:
    // start a fresh Session instead of talking to the old one.
    const samePreset =
      (known?.preset ?? '') === persona.id &&
      (known?.rev ?? '') === cfg.presetRev &&
      // Owner mode is baked into the preamble, so a chat that changed status
      // needs a Session of its own.
      (known?.owner === true) === (chat.isOwner === true);
    if (known?.sessionId && samePreset) return known.sessionId;
    if (known?.sessionId) {
      log(`persona changed for ${chat.key} (${known.preset ?? 'default'} → ${persona.id}); new session`);
      delete state.chats[chat.key];
      saveState();
    }
    const pending = creating.get(chat.key);
    if (pending) return pending;
    const promise = (async () => {
      const request = { cwd: cfg.cwd };
      if (persona.preset !== '') request.agentPreset = persona.preset;
      const created = await ctx.sessionController.create(request);
      state.chats[chat.key] = {
        sessionId: created.sessionId,
        preset: persona.id,
        rev: cfg.presetRev,
        owner: chat.isOwner === true,
        title: chat.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      saveState();
      const preambleParts = [];
      const basePersona = (settings.basePersona !== '' ? settings.basePersona : DEFAULT_BASE_PERSONA).trim();
      if (basePersona !== '') preambleParts.push(`【底层准则】\n${basePersona}`);
      // A preset edited in the panel only reaches DSH after a bundle reload, so
      // replay the same text here until then; once they match, the copy is dropped.
      const presetOverride = settings.presetPrompts[persona.id];      if (typeof presetOverride === 'string' && presetOverride.trim() !== '') {
        preambleParts.push(`【本次人设以此为准，与预设里冲突的地方照这段】\n${presetOverride.trim()}`);
      }
      if (persona.prompt !== '') preambleParts.push(persona.prompt);
      if (chat.isOwner === true) {
        const roster = effectiveUsers()
          .filter((user) => !settings.owners.includes(user))
          .join('、');
        const lines = ['【号主模式】现在跟你说话的是号主本人，你有额外权限，可以直接替他办事：'];
        if (settings.ownerPerms.send) {
          lines.push(`- 给某人发消息：[发送:QQ号|要说的话]（可发给：${roster || '（白名单里只有他自己）'}）`);
        }
        if (settings.ownerPerms.broadcast) lines.push('- 同时群发：[群发:要说的话]');
        if (settings.ownerPerms.schedule) lines.push('- 定时发送：[定时:分钟|QQ号|要说的话]');
        lines.push('- 也可以直接回答他的话、改主意、拒绝；办完事回一句就行，别复述指令。');
        lines.push(
          '- **代发时别提号主**：不要说「号主让我跟你说」「他让我转告」「号主说」，也不要署名或加括号说明。' +
            '就直接用你自己的口吻把话说完，对方看起来就是你在跟他说话。',
        );
        preambleParts.push(lines.join('\n'));
      }
      const stickerNames = listStickers().filter((name) => !settings.stickerDisabled.includes(name));
      if (settings.stickers.enabled === true && stickerNames.length > 0) {
        const grouped = stickerNames
          .map((name) => (settings.stickerGroup[name] ? `${name}(${settings.stickerGroup[name]})` : name))
          .join('、');
        preambleParts.push(
          `【手边的表情包】${grouped}\n用 [表情包:名字] 发一张；想让桥接上网找新的，就写 [表情包:搜 关键词]。`,
        );
      }
      const remembered = memories[chat.key]?.text;
      if (typeof remembered === 'string' && remembered !== '') {
        preambleParts.push(`【你们之前聊过的，记着这些】\n${remembered}`);
      }
      if (preambleParts.length > 0) personaPreamble.set(created.sessionId, preambleParts.join('\n\n'));
      log(`created session ${created.sessionId} for ${chat.key} (persona=${persona.id})`);
      try {
        await ctx.sessionController.rename({ sessionId: created.sessionId, title: chat.title });
      } catch (error) {
        log(`rename skipped: ${error?.message ?? error}`);
      }
      return created.sessionId;
    })().finally(() => creating.delete(chat.key));
    creating.set(chat.key, promise);
    return promise;
  }

  /**
   * Install the Session-local model route (cheap model, thinking off by
   * default) once per Session. `selectModel` also resumes the Session, so it
   * must run before the first prompt.
   */
  /** The panel's chat-model choice wins over the patch file's route; per-chat first. */
  function effectiveModel(chatKey) {
    if (typeof chatKey === 'string' && chatKey !== '') {
      const perChat = settings.modelByChat[chatKey];
      if (perChat && typeof perChat.provider === 'string' && perChat.provider !== '') return perChat;
    }
    const chosen = settings.model;
    if (chosen && typeof chosen.provider === 'string' && chosen.provider !== '' && typeof chosen.model === 'string' && chosen.model !== '') {
      return chosen;
    }
    return cfg.model;
  }

  const INTELLIGENCE_EFFORT = { eco: 'off', standard: 'low', high: 'high', max: 'max' };

  async function configureModel(sessionId, chatKey) {
    const route = effectiveModel(chatKey);
    if (route === null || configuredModels.has(sessionId)) return;
    configuredModels.add(sessionId);
    try {
      // Priority: an effort the panel set explicitly (global or per-chat), then
      // the intelligence dial, only then the patch file's default. Without this
      // order the patch's "low" would silently pin every session.
      const panelEffort =
        (typeof chatKey === 'string' ? settings.modelByChat[chatKey]?.reasoningEffort : undefined) ??
        settings.model?.reasoningEffort;
      const effort = panelEffort ?? INTELLIGENCE_EFFORT[settings.intelligence] ?? route.reasoningEffort ?? 'low';
      const result = await ctx.sessionController.selectModel({
        sessionId,
        provider: route.provider,
        model: route.model,
        reasoningEffort: effort,
      });
      log(`model for ${sessionId}: ${JSON.stringify(result?.selected ?? { ...route, effort })}`);
    } catch (error) {
      configuredModels.delete(sessionId);
      log(`selectModel failed for ${sessionId}: ${error?.message ?? error}`);
    }
  }

  function attachChat(sessionId, chat) {
    chat.sessionId = sessionId;
    chat.turns = new Map();
    chat.sendChain = Promise.resolve();
    chats.set(sessionId, chat);
  }

  /* ---------------- inbound ---------------- */

  /**
   * Say hello once, on the first sign that the bot account is actually online
   * (OneBot `lifecycle: enable` or the first heartbeat). A websocket can be
   * accepted before login, so `connect` alone is not enough.
   */
  function greetOnce(selfId) {
    if (greeted) return;
    greeted = true;
    if (cfg.greeting.trim() === '') return;
    log(`bot online as ${selfId ?? '?'}; greeting ${effectiveUsers().length} allowed user(s)`);
    for (const userId of effectiveUsers()) {
      sendText({ kind: 'private', chatId: userId, userId, sendChain: Promise.resolve() }, cfg.greeting);
    }
  }

  function handlePayload(payload) {
    if (!payload || typeof payload !== 'object') return;
    if (payload.self_id !== undefined) lastSelfId = String(payload.self_id);
    if (payload.post_type === 'meta_event') {
      const kind = String(payload.meta_event_type ?? '');
      if (kind === 'lifecycle') {
        log(`onebot lifecycle: ${payload.sub_type ?? ''}`);
        if (payload.sub_type === 'enable') greetOnce(payload.self_id);
      } else if (kind === 'heartbeat') {
        greetOnce(payload.self_id);
      }
      return;
    }
    if (payload.post_type !== 'message') return;

    const selfId = String(payload.self_id ?? '');
    const userId = String(payload.user_id ?? '');
    if (userId === '' || userId === selfId) return;

    const isGroup = payload.message_type === 'group';
    const groupId = String(payload.group_id ?? '');
    const nickname = String(payload.sender?.card || payload.sender?.nickname || userId);

    if (isGroup) {
      if (!effectiveGroups().includes(groupId)) {
        log(`denied group ${groupId}`);
        return;
      }
      if (cfg.groupRequireAt && !mentionsSelf(payload.message, selfId)) return;
    } else if (!effectiveUsers().includes(userId)) {
      log(`denied private user ${userId}`);
      const denied = { kind: 'private', chatId: userId, userId, sendChain: Promise.resolve() };
      sendText(denied, cfg.denyReply);
      return;
    }

    const key = isGroup ? chatKey('group', groupId) : chatKey('private', userId);
    const chat = {
      key,
      kind: isGroup ? 'group' : 'private',
      chatId: isGroup ? groupId : userId,
      userId,
      title: isGroup ? `QQ 群 ${groupId}` : `QQ · ${nickname}`,
      // Whoever owns the bot gets the extra commands.
      isOwner: !isGroup && settings.owners.includes(String(userId)),
      turns: new Map(),
      sendChain: Promise.resolve(),
    };
    const text = segmentsToText(payload.message, selfId);
    const carriesImage = messageSegments(payload.message).some((segment) => segment?.type === 'image');
    if (text === '' && !carriesImage) return;

    if (text === '/new' || text === '／new' || text === '/reset') {
      const previous = state.chats[key]?.sessionId;
      if (typeof previous === 'string' && previous !== '') {
        try {
          ctx.sessionController.cancel({ sessionId: previous });
        } catch {
          /* the old session may already be idle */
        }
      }
      delete state.chats[key];
      saveState();
      const reply = { ...chat };
      sendText(reply, '好的，下一条消息会开启一个全新的会话。');
      log(`reset requested for ${key}`);
      return;
    }

    if (text === '/cancel' || text === '／cancel' || text === '/stop') {
      const sessionId = state.chats[key]?.sessionId;
      if (typeof sessionId === 'string' && sessionId !== '') {
        try {
          ctx.sessionController.cancel({ sessionId });
        } catch (error) {
          log(`cancel failed: ${error?.message ?? error}`);
        }
      }
      sendText(chat, '已尝试中止当前这一轮。');
      return;
    }

    // Explicit "查一下 xxx" is handled here so it works even if the model would
    // rather answer from memory.
    const lookupCommand = text.match(/^(?:查|搜)(?:一下|一搜)?[:：\s]+(.{1,40})$/);
    if (lookupCommand !== null) {
      const chat = {
        key,
        kind: isGroup ? 'group' : 'private',
        chatId: isGroup ? groupId : userId,
        userId,
        sendChain: Promise.resolve(),
      };
      void answerLookup(chat, lookupCommand[1].trim());
      return;
    }

    // `/档位 max` — switch without touching the panel.
    const levelCommand = text.match(/^[/／]?档位\s*(eco|standard|high|max|省|标准|高|最高)$/i);
    if (levelCommand !== null) {
      const raw = levelCommand[1].toLowerCase();
      const level = { 省: 'eco', 标准: 'standard', 高: 'high', 最高: 'max' }[raw] ?? raw;
      settings.intelligence = level;
      saveSettings();
      configuredModels.clear();
      for (const live of chats.values()) {
        try {
          ctx.sessionController.cancel({ sessionId: live.sessionId });
        } catch {
          /* best effort */
        }
      }
      chats.clear();
      state.chats = {};
      saveState();
      log(`intelligence -> ${level} via QQ command; sessions retired`);
      sendText({ ...chat, sendChain: Promise.resolve() }, `档位已切到 ${level}（${INTELLIGENCE_EFFORT[level]}），下一条消息生效。`);
      return;
    }

    void admit(chat, text, payload);
    logMessage({ dir: 'in', chat: key, text: text.slice(0, 500), image: carriesImage === true });
  }

  /**
   * Download (or read) one QQ image into a prompt upload part. The prompt
   * admission step persists the bytes and replaces them with a durable
   * attachment reference; handing over a bare reference is rejected.
   */
  async function imagePart(data, chatKey) {
    try {
      const bytes = await readImageBytes(data);
      if (bytes === null) return null;
      const mediaType = sniffImage(bytes);
      if (mediaType === null) {
        log('image skipped: unknown raster format');
        return null;
      }
      let saved = null;
      try {
        mkdirSync(messagesDir, { recursive: true });
        const extension =
          mediaType === 'image/png' ? 'png' : mediaType === 'image/gif' ? 'gif' : mediaType === 'image/webp' ? 'webp' : 'jpg';
        saved = `in-${Date.now()}.${extension}`;
        writeFileSync(join(messagesDir, saved), bytes);
      } catch {
        saved = null;
      }
      logMessage({ dir: 'in', chat: String(chatKey ?? ''), text: '[图片]', file: saved });
      return { type: 'image', data: Buffer.from(bytes).toString('base64'), mediaType, name: 'qq-image' };
    } catch (error) {
      log(`image skipped: ${error?.message ?? error}`);
      return null;
    }
  }

  async function readImageBytes(data) {
    const url = typeof data?.url === 'string' ? data.url : '';
    if (url.startsWith('http')) {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`image download HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    }
    const file = typeof data?.file === 'string' ? data.file : '';
    if (file.startsWith('base64://')) return new Uint8Array(Buffer.from(file.slice(9), 'base64'));
    if (file !== '' && existsSync(file)) return new Uint8Array(readFileSync(file));
    return null;
  }

  /** Prompt parts for one platform message: its text plus every attached image. */
  async function buildContent(payload, text, chatKey) {
    const content = [];
    if (text !== '') content.push({ type: 'text', text });
    for (const segment of messageSegments(payload.message)) {
      if (segment?.type !== 'image') continue;
      const part = await imagePart(segment.data ?? {}, chatKey);
      if (part !== null) content.push(part);
    }
    return content;
  }

  async function admit(chat, text, payload) {
    try {
      const sessionId = await ensureSession(chat);
      const existing = chats.get(sessionId);
      if (existing) {
        existing.chatId = chat.chatId;
        existing.userId = chat.userId;
        existing.lastPayload = payload;
      } else {
        attachChat(sessionId, chat);
      }
      const live = chats.get(sessionId);
      live.lastText = text.slice(0, MAX_PARTIAL_LOG);
      live.lastActivity = Date.now();
      live.lookupDone = false;
      state.chats[chat.key].updatedAt = Date.now();
      await configureModel(sessionId, chat.key);
      const content = await buildContent(payload, text, chat.key);
      if (content.some((part) => part.type === 'image')) {
        content.unshift({
          type: 'text',
          text: '（他发的是图片或表情包：先看懂它想表达什么、是什么梗，再用你的性格回一句；不要描述画面，也不要复述图里的字。）',
        });
      }
      const preamble = personaPreamble.get(sessionId);
      if (preamble !== undefined) {
        personaPreamble.delete(sessionId);
        content.unshift({
          type: 'text',
          text: `【人设设定，覆盖你此前所有设定】\n${preamble}\n【设定结束】\n\n`,
        });
      }
      if (content.length === 0) {
        log(`nothing to admit for ${chat.key} (image could not be attached)`);
        return;
      }
      // The Remote method's second parameter is a caller lifetime; it is a
      // plain in-process call here, so a fresh signal is enough.
      await ctx.sessionController.prompt(
        {
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content,
          clientTimeZone: timeZone,
        },
        new AbortController().signal,
      );
      log(`admitted prompt for ${chat.key} (${text.length} chars)`);
      pinApprovalPolicy(sessionId);
      live.nudges = 0;
      scheduleSilence(live);
    } catch (error) {
      log(`prompt failed for ${chat.key}: ${error?.message ?? error} ${JSON.stringify(error?.details ?? {})}`);
      sendText(chat, cfg.errorReply);
    }
  }

  /* ---------------- outbound ---------------- */

  ctx.on('session/event', (session, event) => {
    if (selfTest !== null && session.id === selfTest.sessionId) {
      if (event.type === 'assistant/message') {
        const text = textOfContent(event.data.message?.content);
        if (text.trim() !== '') selfTest.parts.push(text);
      } else if (event.type === 'turn/end') {
        const answer = selfTest.parts.join('\n\n').trim();
        log(`self-test reply [${event.data.reason?.kind ?? '?'}]: ${answer === '' ? '(empty)' : answer.slice(0, 400)}`);
        // Keep the sidebar clean: the probe is not a conversation.
        try {
          void ctx.get('workspaceController')?.archiveSession({ sessionId: selfTest.sessionId });
        } catch {
          /* archiving is best effort */
        }
        selfTest = null;
      }
      return;
    }
    const chat = chats.get(session.id);
    if (!chat) return;
    try {
      if (event.type === 'turn/start') {
        chat.turns.set(event.data.turn, { parts: [], startedAt: Date.now() });
        return;
      }
      if (event.type === 'assistant/message') {
        const turn = chat.turns.get(event.data.turn);
        if (event.data.usage !== undefined) recordUsage(event.data.usage, event.time);
        if (!turn) return;
        const text = textOfContent(event.data.message?.content);
        if (text.trim() !== '') turn.parts.push(text);
        return;
      }
      if (event.type === 'turn/end') {
        const turn = chat.turns.get(event.data.turn);
        chat.turns.delete(event.data.turn);
        chat.lastActivity = Date.now();
        const reason = event.data.reason ?? { kind: 'completed' };
        const spoken = (turn?.parts ?? []).join('\n\n').trim();
        // A turn this plugin started on its own initiative: the model decides
        // whether it has anything to say at all.
        if (chat.proactivePending === true) {
          chat.proactivePending = false;
          if (spoken === '' || /\[skip\]/i.test(spoken)) {
            log('proactive: model had nothing to say');
            return;
          }
          sendText(chat, spoken);
          return;
        }
        if (reason.kind === 'error') {
          const message = reason.error?.message ? `（出错了：${reason.error.message}）` : cfg.errorReply;
          sendText(chat, message);
          return;
        }
        if (reason.kind === 'aborted' || reason.kind === 'interrupted') {
          sendText(chat, '（已中止）');
          return;
        }
        const answer = spoken;
        if (answer === '') {
          sendText(chat, cfg.emptyReply);
          return;
        }
        sendText(chat, answer);
        scheduleAfterthought(chat);
        maybeSendSticker(chat, chat.lastText);
        // She answered "I don't know" without looking it up: look it up now and
        // follow with the real answer instead of leaving it at that.
        if (
          chat.lookupDone !== true &&
          /不知道|不晓得|不懂|没听过|没听说过|不清楚|查不到/.test(answer) &&
          typeof chat.lastText === 'string' &&
          chat.lastText.trim() !== ''
        ) {
          chat.lookupDone = true;
          void answerLookup(chat, chat.lastText.trim().slice(0, 40));
        }
        chat.turnsDone = (chat.turnsDone ?? 0) + 1;
        if (settings.memory.enabled && chat.turnsDone >= settings.memory.everyTurns) {
          chat.turnsDone = 0;
          void compactChat(chat, 'turns');
        }
      }
    } catch (error) {
      log(`session event handling failed: ${error?.stack ?? error}`);
    }
  });

  /* ---------------- lifecycle ---------------- */

  /**
   * Health check: build one throwaway Session with the configured preset and
   * model, ask one question, and log the answer. This is the only way to see
   * the persona + model route work without a real chat partner.
   */
  async function runSelfTest() {
    log('self-test: creating a throwaway Session');
    try {
      const request = { cwd: cfg.cwd };
      if (cfg.agentPreset !== '') request.agentPreset = cfg.agentPreset;
      const created = await ctx.sessionController.create(request);
      const sessionId = created.sessionId;
      selfTest = { sessionId, parts: [] };
      await configureModel(sessionId);
      const content = [{ type: 'text', text: cfg.selfTestPrompt }];
      if (cfg.selfTestImage !== '' && existsSync(cfg.selfTestImage)) {
        const bytes = new Uint8Array(readFileSync(cfg.selfTestImage));
        const mediaType = sniffImage(bytes);
        if (mediaType !== null) {
          content.push({ type: 'image', data: Buffer.from(bytes).toString('base64'), mediaType, name: 'self-test' });
          log(`self-test: attached ${cfg.selfTestImage}`);
        }
      }
      await ctx.sessionController.prompt(
        {
          requestId: randomUUID(),
          sessionId,
          mode: 'queue',
          content,
          clientTimeZone: timeZone,
        },
        new AbortController().signal,
      );
      log(`self-test: prompted ${sessionId}`);
    } catch (error) {
      log(`self-test failed: ${error?.name ?? ''} ${error?.code ?? ''} ${error?.message ?? error} ${JSON.stringify(error?.details ?? {})}`);
      selfTest = null;
    }
  }

  /* ---------------- speaking first ---------------- */

  function insideActiveHours(now) {
    const startHour = cfg.proactive?.startHour ?? 9;
    const endHour = cfg.proactive?.endHour ?? 23;
    const hour = now.getHours();
    return startHour <= endHour ? hour >= startHour && hour < endHour : hour >= startHour || hour < endHour;
  }

  function clearSilenceTimer(chat) {
    if (chat.silenceTimer) clearTimeout(chat.silenceTimer);
    chat.silenceTimer = null;
  }

  function clearAfterTimer(chat) {
    if (chat.afterTimer) clearTimeout(chat.afterTimer);
    chat.afterTimer = null;
  }

  /** Nudge cues carry the wall clock so time-of-day behaviour can fire. */
  function withClock(cue) {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    return `（现在是 ${hh}:${mm}）${cue}`;
  }

  /** Ask the model to say something on its own; `[skip]` means it stayed quiet. */
  async function nudge(chat, cue, kind) {
    if (stopped || chat.proactivePending === true) return;
    if (typeof chat.sessionId !== 'string') return;
    chat.proactivePending = true;
    try {
      await ctx.sessionController.prompt(
        {
          requestId: randomUUID(),
          sessionId: chat.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: withClock(cue) }],
          clientTimeZone: timeZone,
        },
        new AbortController().signal,
      );
      log(`nudge (${kind}): asked for a line`);
    } catch (error) {
      chat.proactivePending = false;
      log(`nudge (${kind}) failed: ${error?.message ?? error}`);
    }
  }

  /** He went quiet mid-conversation: she may nag, tease, or start a new topic. */
  function scheduleSilence(chat) {
    if (cfg.silence === null || stopped) return;
    clearSilenceTimer(chat);
    const { minMinutes, maxMinutes } = cfg.silence;
    const minutes = minMinutes + Math.random() * Math.max(1, maxMinutes - minMinutes);
    chat.silenceTimer = setTimeout(() => {
      chat.silenceTimer = null;
      if ((chat.nudges ?? 0) >= cfg.silence.maxNudges) return;
      if (!withinQuietHoursNow()) return;
      if (inDnd(new Date())) return;
      chat.nudges = (chat.nudges ?? 0) + 1;
      void nudge(chat, cfg.silence.cue, 'silence');
    }, Math.round(minutes * 60_000));
    log(`silence nudge armed in ~${Math.round(minutes)} min`);
  }

  /** Sometimes people send one more bubble a minute later. So does she. */
  function scheduleAfterthought(chat) {
    if (cfg.afterthought === null || stopped) return;
    clearAfterTimer(chat);
    if (Math.random() > cfg.afterthought.chance) return;
    const { minSeconds, maxSeconds } = cfg.afterthought;
    const seconds = minSeconds + Math.random() * Math.max(1, maxSeconds - minSeconds);
    chat.afterTimer = setTimeout(() => {
      chat.afterTimer = null;
      if (inDnd(new Date())) return;
      void nudge(chat, cfg.afterthought.cue, 'afterthought');
    }, Math.round(seconds * 1000));
  }

  function withinQuietHoursNow() {
    return insideActiveHours(new Date());
  }

  function scheduleProactive() {
    if (cfg.proactive === null || stopped) return;
    if (proactive.timer !== null) clearTimeout(proactive.timer);
    const { minMinutes, maxMinutes } = cfg.proactive;
    const minutes = minMinutes + Math.random() * Math.max(1, maxMinutes - minMinutes);
    proactive.timer = setTimeout(() => {
      proactive.timer = null;
      void speakFirst();
    }, Math.round(minutes * 60_000));
    log(`next unprompted message in ~${Math.round(minutes)} min`);
  }

  /**
   * Once in a while, ask the model whether it has anything to say on its own:
   * the turn's answer is sent as a normal message, and a `[skip]` answer means
   * it stayed quiet. Nothing is invented by the bridge itself.
   */
  async function speakFirst() {
    if (stopped || cfg.proactive === null) return;
    try {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (proactive.day !== day) {
        proactive.day = day;
        proactive.count = 0;
      }
      if (!insideActiveHours(now)) return;
      if (inDnd(now)) return;
      if (proactive.count >= cfg.proactive.maxPerDay) return;
      const key = Object.keys(state.chats).find((candidate) => candidate.startsWith('private:'));
      if (key === undefined) return;
      const chat = chats.get(state.chats[key]?.sessionId);
      if (chat === undefined) return;
      if (Date.now() - (chat.lastActivity ?? 0) < cfg.proactive.minIdleMinutes * 60_000) return;
      proactive.count += 1;
      chat.proactivePending = true;
      await ctx.sessionController.prompt(
        {
          requestId: randomUUID(),
          sessionId: chat.sessionId,
          mode: 'queue',
          content: [{ type: 'text', text: withClock(cfg.proactive.cue) }],
          clientTimeZone: timeZone,
        },
        new AbortController().signal,
      );
      log(`proactive: asked for a line (${proactive.count}/${cfg.proactive.maxPerDay} today)`);
    } catch (error) {
      log(`proactive failed: ${error?.stack ?? error}`);
    } finally {
      scheduleProactive();
    }
  }

  /* ---------------- management console (Web UI) ---------------- */

  // Apply the saved toggle state once, then keep the live values in `cfg`.
  const activeAccount = settings.accounts.find((item) => item.id === settings.activeAccountId);
  if (activeAccount !== undefined && activeAccount.wsUrl !== '') {
    cfg.wsUrl = activeAccount.wsUrl;
    cfg.accessToken = activeAccount.token;
  }
  if (settings.toggles.proactive === false) cfg.proactive = null;
  if (settings.toggles.silence === false) cfg.silence = null;
  if (settings.toggles.afterthought === false) cfg.afterthought = null;
  if (cfg.proactive !== null && settings.proactiveCfg !== undefined) {
    cfg.proactive.startHour = settings.proactiveCfg.startHour;
    cfg.proactive.endHour = settings.proactiveCfg.endHour;
    cfg.proactive.maxPerDay = settings.proactiveCfg.maxPerDay;
  }

  const defaults = { silence: cfg.silence, afterthought: cfg.afterthought, proactive: cfg.proactive };

  function statusPayload() {
    const persona = activePersona();
    const builtinNames = { whale: '大米鲸鱼娘', chiang: '蒋介石', config: '跟随配置' };
    const customPersona = settings.personae.find((item) => item.id === persona.id);
    const personaName = customPersona?.name ?? builtinNames[persona.id] ?? persona.id;
    return {
      connected: socket !== null && socket.ready === true,
      selfId: lastSelfId,
      preset: persona.id === 'config' ? cfg.agentPreset || 'default' : persona.id,
      personaName,
      persona: { id: persona.id, preset: persona.preset, name: personaName },
      personae: settings.personae,
      hiddenPresets: settings.hiddenPresets,
      version: '0.41.0',
      model: (() => {
        const route = effectiveModel();
        if (route === null) return null;
        // Report what will really be sent, not the patch file's default effort.
        const panelEffort = settings.model?.reasoningEffort;
        return {
          ...route,
          reasoningEffort: panelEffort ?? INTELLIGENCE_EFFORT[settings.intelligence] ?? route.reasoningEffort,
        };
      })(),
      modelByChat: settings.modelByChat,
      stickerGroup: settings.stickerGroup,
      disabledUsers: settings.disabledUsers,
      accountPaused,
      accounts: settings.accounts,
      activeAccountId: settings.activeAccountId,
      stickers: settings.stickers,
      voice: settings.voice,
      cacheDir: cacheRoot,
      memory: settings.memory,
      memories,
      basePersona: settings.basePersona,
      basePersonaDefault: DEFAULT_BASE_PERSONA,
      owner: settings.owner,
      owners: settings.owners,
      ownerPerms: settings.ownerPerms,
      autoStart: settings.autoStart === true,
      autoStartInstalled: existsSync(startupScriptPath),
      autoStartFile: startupScriptPath,
      memoryDir: settings.memoryDir,
      memoryFile,
      intelligence: settings.intelligence,
      effectiveEffort: INTELLIGENCE_EFFORT[settings.intelligence] ?? 'low',
      allowUsers: effectiveUsers(),
      allowGroups: effectiveGroups(),
      groups: settings.groups,
      dnd: settings.dnd,
      cost: {
        today: usage.day === new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10) ? usage.total : 0,
        last: usage.last,
        turns: usage.turns,
        peak: isPeak(Date.now()),
      },
      proactive: cfg.proactive !== null,
      silence: cfg.silence !== null,
      afterthought: cfg.afterthought !== null,
      chats: [...chats.values()].map((chat) => ({
        key: chat.key,
        sessionId: chat.sessionId,
        nudges: chat.nudges ?? 0,
        lastActivity: chat.lastActivity ?? 0,
      })),
      logFile: logFile,
    };
  }

  function jsonResponse(res, code, value) {
    res.statusCode = code;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(value));
  }

  const webServer = ctx.get('webServer');
  if (webServer !== undefined && typeof webServer.register === 'function') {
    // A small floating entry in the app shell, so the console is reachable from
    // the GUI without shipping a client-side module (that is what crashed it).
    if (typeof webServer.tapIndex === 'function') {
      ctx.effect(() =>
        webServer.tapIndex((html) => {
          try {
            if (typeof html !== 'string') return html;
            if (html.includes('id="dsh-im-bridge-launcher"')) return html;
            const anchor = `<a id="dsh-im-bridge-launcher" href="/im-bridge/console" target="_blank" rel="noopener" style="position:fixed;left:18px;bottom:18px;z-index:2147483000;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:999px;border:1px solid rgba(128,128,128,.35);background:rgba(22,22,26,.86);color:#fff;font:13px/1.4 -apple-system,'Segoe UI','Microsoft YaHei',sans-serif;text-decoration:none;cursor:pointer;">QQ 桥接</a>`;
            return html.includes('</body>') ? html.replace('</body>', `${anchor}</body>`) : html + anchor;
          } catch (error) {
            log(`index injection skipped: ${error?.message ?? error}`);
            return html;
          }
        }),
      );
    } else {
      log('webServer.tapIndex unavailable; console link not injected');
    }
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/status',
        handler: (_req, res) => jsonResponse(res, 200, statusPayload()),
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/settings',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 200, {
              settings,
              status: statusPayload(),
              stickerFiles: listStickers(),
              availablePresets: ['whale', 'chiang'],
              allowUsers: effectiveUsers(),
            });
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 65536) req.destroy();
          });
          req.on('end', () => {
            try {
              const patch = JSON.parse(body === '' ? '{}' : body);
              if (Array.isArray(patch.whitelist)) {
                settings.whitelist = patch.whitelist.map((value) => String(value).trim()).filter((value) => /^\d{5,12}$/.test(value));
              }
              if (Array.isArray(patch.personae)) {
                settings.personae = patch.personae
                  .filter((item) => item && typeof item.id === 'string' && item.id !== '')
                  .map((item) => ({
                    id: String(item.id),
                    name: String(item.name ?? item.id),
                    preset: String(item.preset ?? 'whale'),
                    prompt: String(item.prompt ?? ''),
                  }));
                // Editing the active persona must take effect on the next message.
                const active = settings.personae.find((item) => item.id === settings.activePersonaId);
                if (active !== undefined) {
                  for (const key of Object.keys(state.chats)) delete state.chats[key];
                  chats.clear();
                  saveState();
                }
              }
              if (typeof patch.activePersonaId === 'string') settings.activePersonaId = patch.activePersonaId;
              if (patch.stickers && typeof patch.stickers === 'object') {
                settings.stickers = { enabled: patch.stickers.enabled !== false };
              }
              if (patch.voice && typeof patch.voice === 'object') {
                const nextEngine =
                  patch.voice.engine === 'custom' ? 'custom' : patch.voice.engine === 'sapi' ? 'sapi' : patch.voice.engine === 'edge' ? 'edge' : settings.voice.engine;
                settings.voice = {
                  enabled: patch.voice.enabled === true,
                  rate: Number.isFinite(Number(patch.voice.rate)) ? Number(patch.voice.rate) : settings.voice.rate,
                  voiceName:
                    typeof patch.voice.voiceName === 'string' && patch.voice.voiceName !== ''
                      ? patch.voice.voiceName
                      : settings.voice.voiceName,
                  engine: nextEngine,
                  edgeVoice:
                    typeof patch.voice.edgeVoice === 'string' && patch.voice.edgeVoice !== ''
                      ? patch.voice.edgeVoice
                      : settings.voice.edgeVoice,
                  customUrl: typeof patch.voice.customUrl === 'string' ? patch.voice.customUrl.trim() : settings.voice.customUrl,
                  customVoice:
                    typeof patch.voice.customVoice === 'string' ? patch.voice.customVoice.trim() : settings.voice.customVoice,
                  pythonPath: typeof patch.voice.pythonPath === 'string' ? patch.voice.pythonPath : settings.voice.pythonPath,
                  pythonLib: typeof patch.voice.pythonLib === 'string' ? patch.voice.pythonLib : settings.voice.pythonLib,
                };
              }
              if (patch.search && typeof patch.search === 'object') {
                settings.search = {
                  engine:
                    patch.search.engine === 'searx' || patch.search.engine === 'wikipedia' || patch.search.engine === 'ddg' || patch.search.engine === 'custom'
                      ? patch.search.engine
                      : patch.search.engine === 'host'
                        ? 'host'
                        : settings.search.engine,
                  searxUrl: typeof patch.search.searxUrl === 'string' ? patch.search.searxUrl.trim() : settings.search.searxUrl,
                  customUrl: typeof patch.search.customUrl === 'string' ? patch.search.customUrl.trim() : settings.search.customUrl,
                };
              }
              if (patch.memory && typeof patch.memory === 'object') {
                const clampInt = (input, fallback, min, max) => {
                  const number = Number(input);
                  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
                };
                settings.memory = {
                  enabled: patch.memory.enabled !== false,
                  everyTurns: clampInt(patch.memory.everyTurns, settings.memory.everyTurns, 5, 500),
                  maxChars: clampInt(patch.memory.maxChars, settings.memory.maxChars, 120, 2000),
                };
              }
              if (typeof patch.autoStart === 'boolean') setAutoStart(patch.autoStart);
              if (typeof patch.owner === 'string' || Array.isArray(patch.owners)) {
                const list = Array.isArray(patch.owners)
                  ? patch.owners
                  : String(patch.owner)
                      .split(/[,，\s]+/)
                      .filter((value) => value !== '');
                settings.owners = list.map(String).map((value) => value.trim()).filter((value) => value !== '');
                settings.owner = settings.owners[0] ?? '';
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
              }
              if (patch.ownerPerms && typeof patch.ownerPerms === 'object') {
                settings.ownerPerms = {
                  send: patch.ownerPerms.send !== false,
                  broadcast: patch.ownerPerms.broadcast !== false,
                  schedule: patch.ownerPerms.schedule !== false,
                };
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
              }
              if (typeof patch.intelligence === 'string' && ['eco', 'standard', 'high', 'max'].includes(patch.intelligence)) {
                settings.intelligence = patch.intelligence;
                configuredModels.clear();
                // Effort is baked into a Session when it is created, so running
                // sessions have to be retired for the change to be visible.
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
              }
              if (typeof patch.basePersona === 'string') {
                settings.basePersona = patch.basePersona;
                // Baseline rules only reach a Session when it is created.
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
              }
              if (typeof patch.memoryDir === 'string') {
                const target = patch.memoryDir.trim();
                const nextFile = target === '' ? memoriesFile : join(target, 'memories.json');
                if (nextFile !== memoryFile) {
                  try {
                    mkdirSync(dirname(nextFile), { recursive: true });
                    if (existsSync(memoryFile) && !existsSync(nextFile)) cpSync(memoryFile, nextFile);
                    if (existsSync(memoryFile) && existsSync(nextFile) && nextFile !== memoriesFile) rmSync(memoryFile, { force: true });
                    memoryFile = nextFile;
                    settings.memoryDir = target;
                    memories = loadMemories();
                    log(`memories relocated to ${memoryFile}`);
                  } catch (error) {
                    log(`memory relocation failed: ${error?.message ?? error}`);
                  }
                }
              }
              if (Array.isArray(patch.stickerDisabled)) settings.stickerDisabled = patch.stickerDisabled.map(String);
              if (patch.stickerGroup && typeof patch.stickerGroup === 'object' && !Array.isArray(patch.stickerGroup)) {
                settings.stickerGroup = Object.fromEntries(
                  Object.entries(patch.stickerGroup).map(([name, group]) => [String(name), String(group)]),
                );
              }
              if (Array.isArray(patch.stickerGroups)) {
                settings.stickerGroups = patch.stickerGroups.map(String).filter((name) => name.trim() !== '');
              }
              if (Array.isArray(patch.disabledUsers)) settings.disabledUsers = patch.disabledUsers.map(String);
              if (typeof patch.cacheDir === 'string') {
                const nextRoot = patch.cacheDir.trim();
                try {
                  if (nextRoot === '') {
                    moveCache(cfg.dataDir);
                    repoint('');
                    settings.cacheDir = '';
                    log('cache restored to the default directory');
                  } else if (nextRoot !== cacheRoot) {
                    moveCache(nextRoot);
                    repoint(nextRoot);
                    settings.cacheDir = nextRoot;
                    log(`cache moved to ${nextRoot}`);
                  }
                } catch (error) {
                  log(`cache move failed: ${error?.message ?? error}`);
                }
              }
              if (Array.isArray(patch.hiddenPresets)) settings.hiddenPresets = patch.hiddenPresets.map(String);
              if (patch.model === null) {
                settings.model = null;
                configuredModels.clear();
              } else if (patch.model && typeof patch.model === 'object' && typeof patch.model.provider === 'string' && typeof patch.model.model === 'string') {
                settings.model = {
                  provider: patch.model.provider,
                  model: patch.model.model,
                  ...(typeof patch.model.reasoningEffort === 'string' && patch.model.reasoningEffort !== ''
                    ? { reasoningEffort: patch.model.reasoningEffort }
                    : {}),
                };
                // Re-select on the next message for every live chat.
                configuredModels.clear();
              }
              if (patch.modelByChat && typeof patch.modelByChat === 'object' && !Array.isArray(patch.modelByChat)) {
                settings.modelByChat = Object.fromEntries(
                  Object.entries(patch.modelByChat)
                    .filter(([, route]) => route && typeof route.provider === 'string' && typeof route.model === 'string')
                    .map(([key, route]) => [
                      key,
                      {
                        provider: route.provider,
                        model: route.model,
                        ...(typeof route.reasoningEffort === 'string' && route.reasoningEffort !== '' ? { reasoningEffort: route.reasoningEffort } : {}),
                      },
                    ]),
                );
                configuredModels.clear();
              }
              if (Array.isArray(patch.accounts)) {
                settings.accounts = patch.accounts
                  .filter((item) => item && typeof item.wsUrl === 'string' && item.wsUrl.trim() !== '')
                  .map((item, index) => ({
                    id: typeof item.id === 'string' && item.id !== '' ? item.id : `acc${Date.now()}${index}`,
                    name: String(item.name ?? `账号 ${index + 1}`),
                    wsUrl: String(item.wsUrl).trim(),
                    token: String(item.token ?? ''),
                  }));
              }
              if (typeof patch.activeAccountId === 'string') {
                settings.activeAccountId = patch.activeAccountId;
                const account = settings.accounts.find((item) => item.id === patch.activeAccountId);
                if (account !== undefined) {
                  cfg.wsUrl = account.wsUrl;
                  cfg.accessToken = account.token;
                  log(`account switched: ${account.name} @ ${account.wsUrl}`);
                  socket?.close();
                }
              }
              if (Array.isArray(patch.groups)) {
                settings.groups = patch.groups.map((value) => String(value).trim()).filter((value) => /^\d{5,12}$/.test(value));
              }
              if (patch.dnd && typeof patch.dnd === 'object') {
                const clamp = (input, fallback, min, max) => {
                  const number = Number(input);
                  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
                };
                settings.dnd = {
                  enabled: patch.dnd.enabled === true,
                  startHour: clamp(patch.dnd.startHour, settings.dnd.startHour, 0, 23),
                  endHour: clamp(patch.dnd.endHour, settings.dnd.endHour, 0, 24),
                };
              }
              if (patch.proactiveCfg && typeof patch.proactiveCfg === 'object') {
                const clamp = (input, fallback, min, max) => {
                  const number = Number(input);
                  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
                };
                settings.proactiveCfg = {
                  startHour: clamp(patch.proactiveCfg.startHour, settings.proactiveCfg.startHour, 0, 23),
                  endHour: clamp(patch.proactiveCfg.endHour, settings.proactiveCfg.endHour, 1, 24),
                  maxPerDay: clamp(patch.proactiveCfg.maxPerDay, settings.proactiveCfg.maxPerDay, 1, 20),
                };
                for (const target of [cfg.proactive, defaults.proactive]) {
                  if (target !== null && target !== undefined) {
                    target.startHour = settings.proactiveCfg.startHour;
                    target.endHour = settings.proactiveCfg.endHour;
                    target.maxPerDay = settings.proactiveCfg.maxPerDay;
                  }
                }
              }
              if (patch.toggles && typeof patch.toggles === 'object') {
                settings.toggles = { ...settings.toggles, ...patch.toggles };
                if (patch.toggles.proactive !== undefined) {
                  cfg.proactive = patch.toggles.proactive ? defaults.proactive : null;
                  if (cfg.proactive !== null) scheduleProactive();
                }
                if (patch.toggles.silence !== undefined) cfg.silence = patch.toggles.silence ? defaults.silence : null;
                if (patch.toggles.afterthought !== undefined) {
                  cfg.afterthought = patch.toggles.afterthought ? defaults.afterthought : null;
                }
              }
              if (typeof patch.activePersonaId === 'string') {
                // Never leave the pointer dangling on a persona that no longer
                // exists — fall back to the built-in so deletion really uninstalls.
                const requested = patch.activePersonaId;
                const exists =
                  ['whale', 'chiang'].includes(requested) || settings.personae.some((item) => item.id === requested);
                settings.activePersonaId = exists ? requested : 'whale';
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
              }
              saveSettings();
              jsonResponse(res, 200, { ok: true, settings, status: statusPayload() });
            } catch (error) {
              jsonResponse(res, 400, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/stickers',
        handler: (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
              if (body.length > 8192) req.destroy();
            });
            req.on('end', () => {
              try {
                const action = JSON.parse(body === '' ? '{}' : body);
                if (action.action === 'delete' && typeof action.name === 'string') {
                  const safe = action.name.replace(/[\\/:*?"<>|]/g, '');
                  const file = join(stickerDir, `${safe}.png`);
                  if (existsSync(file)) unlinkSync(file);
                }
                if (action.action === 'upload') {
                  const safe = String(action.name ?? '')
                    .replace(/[\\/:*?"<>|]/g, '')
                    .trim();
                  const bytes = Buffer.from(String(action.data ?? ''), 'base64');
                  if (safe === '' || bytes.length === 0) throw new Error('需要名字和图片数据');
                  if (bytes.length > 8 * 1024 * 1024) throw new Error('图片超过 8MB');
                  const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
                  const extension =
                    mediaType === 'image/gif'
                      ? '.gif'
                      : mediaType === 'image/webp'
                        ? '.webp'
                        : mediaType === 'image/jpeg'
                          ? '.jpg'
                          : mediaType === 'image/png'
                            ? '.png'
                            : null;
                  if (extension === null) throw new Error('只支持 PNG / JPEG / GIF / WebP');
                  mkdirSync(stickerDir, { recursive: true });
                  writeFileSync(join(stickerDir, `${safe}${extension}`), bytes);
                  log(`sticker uploaded: ${safe}${extension} (${bytes.length} bytes)`);
                }
                jsonResponse(res, 200, { ok: true, files: listStickers() });
              } catch (error) {
                jsonResponse(res, 400, { error: String(error?.message ?? error) });
              }
            });
            return;
          }
          jsonResponse(res, 200, { files: listStickers(), enabled: settings.stickers.enabled });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/sticker',
        handler: (req, res) => {
          try {
            const query = String(req.url ?? '').split('?')[1] ?? '';
            const name = decodeURIComponent((query.match(/(?:^|&)name=([^&]*)/)?.[1] ?? '').replace(/[\\/:*?"<>|]/g, ''));
            if (name === '') {
              res.statusCode = 400;
              res.end('name required');
              return;
            }
            let file = null;
            for (const extension of ['.png', '.gif', '.jpg', '.jpeg', '.webp']) {
              const candidate = join(stickerDir, `${name}${extension}`);
              if (existsSync(candidate)) {
                file = candidate;
                break;
              }
            }
            if (file === null) {
              res.statusCode = 404;
              res.end('not found');
              return;
            }
            const type = file.endsWith('.gif')
              ? 'image/gif'
              : file.endsWith('.jpg') || file.endsWith('.jpeg')
                ? 'image/jpeg'
                : file.endsWith('.webp')
                  ? 'image/webp'
                  : 'image/png';
            res.statusCode = 200;
            res.setHeader('Content-Type', type);
            res.setHeader('Cache-Control', 'max-age=60');
            res.end(readFileSync(file));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message ?? error));
          }
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/messages',
        handler: (req, res) => {
          if (req.method === 'POST') {
            let body = '';
            req.on('data', (chunk) => {
              body += chunk;
              if (body.length > 4096) req.destroy();
            });
            req.on('end', () => {
              try {
                const action = JSON.parse(body === '' ? '{}' : body);
                if (action.action === 'clear') {
                  messages = [];
                  writeFileSync(messagesFile, '[]');
                  log('monitor cleared');
                }
                jsonResponse(res, 200, { ok: true, messages });
              } catch (error) {
                jsonResponse(res, 400, { error: String(error?.message ?? error) });
              }
            });
            return;
          }
          jsonResponse(res, 200, {
            messages,
            disclaimer: '仅供本机自测与调试。这里保存的是你和机器人之间的聊天记录（含图片副本），请勿用于公开或商用；删除 messages.json 与 messages/ 目录即可全部清除。',
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/msg-image',
        handler: (req, res) => {
          try {
            const query = String(req.url ?? '').split('?')[1] ?? '';
            const file = (query.match(/(?:^|&)file=([^&]*)/)?.[1] ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
            if (file === '') {
              res.statusCode = 400;
              res.end('file required');
              return;
            }
            const path = join(messagesDir, file);
            if (!existsSync(path)) {
              res.statusCode = 404;
              res.end('not found');
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', file.endsWith('.gif') ? 'image/gif' : file.endsWith('.webp') ? 'image/webp' : file.endsWith('.jpg') ? 'image/jpeg' : 'image/png');
            res.setHeader('Cache-Control', 'max-age=60');
            res.end(readFileSync(path));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message ?? error));
          }
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/usage',
        handler: (_req, res) => jsonResponse(res, 200, { usage, peak: isPeak(Date.now()) }),
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/bench',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const levels = Array.isArray(request.levels) && request.levels.length > 0
                  ? request.levels.filter((level) => ['eco', 'standard', 'high', 'max'].includes(level))
                  : ['eco', 'standard', 'high', 'max'];
                const llm = ctx.get('llm');
                if (llm === undefined) throw new Error('llm 服务不可用');
                let provider = cfg.model?.provider ?? 'deepseek-account';
                let model = cfg.model?.model ?? 'deepseek-flash';
                try {
                  const selection = ctx.get('agentDefaultModel')?.currentSelection();
                  if (selection?.provider) provider = selection.provider;
                  if (selection?.model) model = selection.model;
                } catch {
                  /* keep fallback */
                }
                const easy = [
                  { id: 'q1', prompt: '一箱苹果 24 个，吃掉三分之一，又买了 6 个，现在几个？只回答数字。', expect: '22' },
                  { id: 'q2', prompt: '0.9 和 0.11 哪个大？只回答那个数。', expect: '0.9' },
                  { id: 'q3', prompt: '所有 A 都是 B，有些 B 是 C。能否推出「有些 A 是 C」？只回答能或不能。', expect: '不能' },
                  { id: 'q4', prompt: '小明有 3 个苹果，又买了原来数量的 2 倍，吃掉 5 个，还剩几个？只回答数字。', expect: '4' },
                  { id: 'q5', prompt: '今天是周三，100 天后是周几？只回答周几。', expect: '周五' },
                ];
                const hard = [
                  { id: 'h1', prompt: '鸡兔同笼，共 35 个头、94 只脚，兔子有几只？只回答数字。', expect: '12' },
                  { id: 'h2', prompt: '抛三次硬币，至少出现一次正面的概率是多少？用最简分数回答。', expect: '7/8' },
                  { id: 'h3', prompt: '3 个人 3 天做 3 个零件，9 个人 9 天做几个零件？只回答数字。', expect: '27' },
                  { id: 'h4', prompt: '一件商品先涨价 20%，再降价 20%，最终价格和原价比是变高、变低还是不变？只回答三个词之一。', expect: '变低' },
                  { id: 'h5', prompt: '所有的猫都怕水。这只动物怕水。能否推出它是猫？只回答能或不能。', expect: '不能' },
                ];
                const questions = request.mode === 'hard' ? hard : request.mode === 'both' ? [...easy, ...hard] : easy;
                const normalizeAnswer = (value) =>
                  String(value)
                    .replace(/\s+/g, '')
                    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '$1/$2')
                    .replace(/\\[a-z]+/gi, '')
                    .replace(/[（）()「」【】"'`]/g, '');
                const report = [];
                for (const level of levels) {
                  const effort = INTELLIGENCE_EFFORT[level];
                  const rows = [];
                  for (const question of questions) {
                    const started = Date.now();
                    let text = '';
                    let usage = null;
                    try {
                      const stream = llm.stream({
                        provider,
                        model,
                        reasoningEffort: effort,
                        messages: [{ role: 'user', content: [{ type: 'text', text: question.prompt }] }],
                        maxTokens: 2000,
                        signal: AbortSignal.timeout(120000),
                      });
                      for await (const chunk of stream) {
                        if (chunk.type === 'text-delta') text += chunk.text;
                        if (chunk.type === 'usage') usage = chunk.usage;
                        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
                          throw new Error(chunk.reason.failure?.message ?? 'call failed');
                        }
                      }
                    } catch (error) {
                      rows.push({ id: question.id, error: String(error?.message ?? error) });
                      continue;
                    }
                    const elapsed = Date.now() - started;
                    const cached = usage?.cacheReadTokens ?? 0;
                    const miss = Math.max(0, (usage?.inputTokens ?? 0) - cached);
                    const out = usage?.outputTokens ?? 0;
                    const tier = isPeak(Date.now()) ? 1 : 0;
                    const cost = (cached / 1e6) * PRICE.hit[tier] + (miss / 1e6) * PRICE.miss[tier] + (out / 1e6) * PRICE.out[tier];
                    rows.push({
                      id: question.id,
                      answer: text.trim().slice(0, 60),
                      ok: normalizeAnswer(text).includes(normalizeAnswer(question.expect)),
                      ms: elapsed,
                      in: usage?.inputTokens ?? 0,
                      cached,
                      out,
                      reasoning: usage?.reasoningTokens ?? 0,
                      cost,
                    });
                  }
                  const graded = rows.filter((row) => row.ok !== undefined);
                  report.push({
                    level,
                    effort,
                    score: `${graded.filter((row) => row.ok).length}/${graded.length}`,
                    avgMs: graded.length === 0 ? 0 : Math.round(graded.reduce((sum, row) => sum + row.ms, 0) / graded.length),
                    avgIn: graded.length === 0 ? 0 : Math.round(graded.reduce((sum, row) => sum + row.in, 0) / graded.length),
                    avgOut: graded.length === 0 ? 0 : Math.round(graded.reduce((sum, row) => sum + row.out, 0) / graded.length),
                    totalCost: rows.reduce((sum, row) => sum + (row.cost ?? 0), 0),
                    rows,
                  });
                }
                log(`bench done: ${report.map((item) => `${item.level}=${item.score}`).join(' ')}`);
                jsonResponse(res, 200, { provider, model, peak: isPeak(Date.now()), report });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/debug/session-model',
        handler: (_req, res) => {
          void (async () => {
            try {
              const key = Object.keys(state.chats)[0];
              if (key === undefined) throw new Error('还没有会话，先发一条消息');
              const sessionId = state.chats[key].sessionId;
              // The request header is what the provider actually received — the
              // only honest answer to "did the dial apply?".
              const inspection = await ctx.sessionController.inspect(sessionId);
              const headers = (inspection?.events ?? []).filter((event) => event.type === 'request/header');
              const last = headers[headers.length - 1];
              jsonResponse(res, 200, {
                key,
                sessionId,
                headers: headers.length,
                config: last?.data?.header?.config ?? null,
              });
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) });
            }
          })();
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/debug/simulate',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on('end', () => {
            try {
              const request = JSON.parse(body === '' ? '{}' : body);
              const from = String(request.from ?? effectiveUsers()[0] ?? '');
              const text = String(request.text ?? '').trim();
              if (from === '' || text === '') throw new Error('需要 from 和 text');
              handlePayload({
                post_type: 'message',
                message_type: 'private',
                sub_type: 'friend',
                time: Math.floor(Date.now() / 1000),
                self_id: Number(lastSelfId) || 0,
                message_id: Date.now(),
                user_id: Number(from),
                raw_message: text,
                sender: { user_id: Number(from), nickname: 'sim', card: '' },
                message: [{ type: 'text', data: { text } }],
              });
              jsonResponse(res, 200, { ok: true, injected: text });
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/preview',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const text = String(request.text ?? '').trim();
                if (text === '') throw new Error('先说一句');
                const id = String(request.personaId ?? settings.activePersonaId ?? 'whale');
                let personaPrompt = '';
                const custom = settings.personae.find((item) => item.id === id);
                if (custom !== undefined) {
                  personaPrompt = custom.prompt;
                } else if (id === 'whale' || id === 'chiang') {
                  personaPrompt = settings.presetPrompts[id] ?? readPresetPrompt(id);
                }
                const base = (settings.basePersona !== '' ? settings.basePersona : DEFAULT_BASE_PERSONA).trim();
                const system = [base === '' ? '' : `【底层准则】\n${base}`, personaPrompt]
                  .filter((part) => part !== '')
                  .join('\n\n');
                const started = Date.now();
                const reply = await askModel(system, text, 500);
                log(`preview (${id}) ${Date.now() - started}ms, system ${system.length} chars`);
                jsonResponse(res, 200, {
                  reply,
                  ms: Date.now() - started,
                  systemChars: system.length,
                  persona: id,
                  name: custom?.name ?? ({ whale: '大米鲸鱼娘', chiang: '蒋介石' }[id] ?? id),
                });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/memory',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 200, { config: settings.memory, memories });
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const key = String(request.key ?? '');
                if (key === '') throw new Error('缺少会话 key');
                if (request.action === 'clear') {
                  delete memories[key];
                  saveMemories();
                  jsonResponse(res, 200, { ok: true, memories });
                  return;
                }
                if (request.action !== 'compact') throw new Error('unsupported action');
                const live = chats.get(state.chats[key]?.sessionId) ?? { key };
                const text = await compactChat(live, 'manual');
                jsonResponse(res, 200, { ok: true, text, memories });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/send',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 16384) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const rawTarget = String(request.target ?? '').trim();
                if (rawTarget === '') throw new Error('先选一个发送对象');
                const isGroup = rawTarget.startsWith('group:');
                const chatId = rawTarget.replace(/^(private|group):/, '');
                const chat = {
                  key: `${isGroup ? 'group' : 'private'}:${chatId}`,
                  kind: isGroup ? 'group' : 'private',
                  chatId,
                  userId: request.atUser ? String(request.atUser) : '',
                  sendChain: Promise.resolve(),
                };
                const segments = [];
                const voiceText = String(request.voice ?? '').trim();
                if (voiceText !== '') {
                  const file = await synthesizeVoice(voiceText);
                  if (file === null) throw new Error('语音合成失败');
                  segments.push({ type: 'record', data: { file: file.replace(/\\/g, '/') } });
                }
                const text = String(request.text ?? '').trim();
                if (text !== '') segments.push({ type: 'text', data: { text } });
                const stickerName = String(request.sticker ?? '').trim();
                if (stickerName !== '') {
                  const file = resolveSticker(stickerName);
                  if (file === null) throw new Error(`没有叫「${stickerName}」的表情`);
                  segments.push({ type: 'image', data: { file } });
                }
                if (segments.length === 0) throw new Error('没有要发的内容');
                if (chat.kind === 'group' && chat.userId !== '') {
                  segments.unshift({ type: 'at', data: { qq: chat.userId } });
                }
                sendSegments(chat, segments);
                logMessage({ dir: 'out', chat: chat.key, text: `[手动] ${text || voiceText || stickerName}` });
                log(`manual send to ${chat.key}: ${segments.map((s) => s.type).join('+')}`);
                jsonResponse(res, 200, { ok: true, target: chat.key, segments: segments.map((s) => s.type) });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/voice/samples',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const text = String(request.text ?? '喂，今天吃什么，我饿了').trim();
                const samples = [
                  { id: 'sapi', label: 'Windows 慧慧（离线）', engine: 'sapi', voice: 'Microsoft Huihui Desktop' },
                  { id: 'xiaoxiao', label: 'edge 晓晓 · 女 · 自然', engine: 'edge', voice: 'zh-CN-XiaoxiaoNeural' },
                  { id: 'xiaoyi', label: 'edge 晓伊 · 女 · 偏嫩', engine: 'edge', voice: 'zh-CN-XiaoyiNeural' },
                  { id: 'yunxi', label: 'edge 云希 · 男 · 年轻', engine: 'edge', voice: 'zh-CN-YunxiNeural' },
                  { id: 'yunyang', label: 'edge 云扬 · 男 · 播音', engine: 'edge', voice: 'zh-CN-YunyangNeural' },
                ];
                const results = [];
                mkdirSync(voiceDir, { recursive: true });
                for (const sample of samples) {
                  try {
                    let file = null;
                    if (sample.engine === 'edge') {
                      const target = join(voiceDir, `sample-${sample.id}-${Date.now()}.mp3`);
                      file = await synthesizeEdge(text, target, sample.voice);
                    } else {
                      const target = join(voiceDir, `sample-${sample.id}-${Date.now()}.wav`);
                      file = await synthesizeSapi(text, target, sample.voice, 0);
                    }
                    results.push({ ...sample, ok: file !== null, name: file === null ? '' : file.split(/[\\/]/).pop() });
                  } catch (error) {
                    results.push({ ...sample, ok: false, name: '', error: String(error?.message ?? error) });
                  }
                }
                log(`voice samples generated: ${results.filter((r) => r.ok).length}/${results.length}`);
                jsonResponse(res, 200, { ok: true, samples: results });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/audio',
        handler: (req, res) => {
          try {
            if (req.method === 'POST') {
              let body = '';
              req.on('data', (chunk) => {
                body += chunk;
                if (body.length > 4096) req.destroy();
              });
              req.on('end', () => {
                try {
                  const request = JSON.parse(body === '' ? '{}' : body);
                  const name = String(request.name ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
                  const target = String(request.target ?? '').trim();
                  if (name === '' || target === '') throw new Error('需要 name 和 target');
                  const path = join(voiceDir, name);
                  if (!existsSync(path)) throw new Error('文件不存在');
                  const isGroup = target.startsWith('group:');
                  const chatId = target.replace(/^(private|group):/, '');
                  sendSegments(
                    { kind: isGroup ? 'group' : 'private', chatId, userId: '', key: target, sendChain: Promise.resolve() },
                    [{ type: 'record', data: { file: path.replace(/\\/g, '/') } }],
                  );
                  jsonResponse(res, 200, { ok: true, target, name });
                } catch (error) {
                  jsonResponse(res, 500, { error: String(error?.message ?? error) });
                }
              });
              return;
            }
            const query = String(req.url ?? '').split('?')[1] ?? '';
            const name = (query.match(/(?:^|&)name=([^&]*)/)?.[1] ?? '').replace(/[^A-Za-z0-9_.-]/g, '');
            if (name === '') {
              res.statusCode = 400;
              res.end('name required');
              return;
            }
            const path = join(voiceDir, name);
            if (!existsSync(path)) {
              res.statusCode = 404;
              res.end('not found');
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', name.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav');
            res.setHeader('Cache-Control', 'no-store');
            res.end(readFileSync(path));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message ?? error));
          }
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/storage',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 200, {
              cacheDir: cacheRoot,
              defaultDir: cfg.dataDir,
              sizes: {
                sticker: sizeOf(stickerDir),
                voice: sizeOf(voiceDir),
                messages: sizeOf(messagesDir),
                log: sizeOf(logFile),
              },
            });
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            try {
              const request = JSON.parse(body === '' ? '{}' : body);
              if (request.action === 'clean') {
                const removed = cleanCache();
                jsonResponse(res, 200, { ok: true, removed, cacheDir: cacheRoot });
                return;
              }
              jsonResponse(res, 400, { error: 'unsupported action' });
            } catch (error) {
              jsonResponse(res, 400, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/voice',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                if (request.action !== 'test') {
                  jsonResponse(res, 400, { error: 'unsupported action' });
                  return;
                }
                const text = String(request.text ?? '喂，听得见吗？').trim();
                const file = await synthesizeVoice(text);
                if (file === null) throw new Error('合成失败（看日志）');
                const target = effectiveUsers()[0];
                if (target === undefined) throw new Error('白名单为空，没人可发');
                sendSegments(
                  { kind: 'private', chatId: target, userId: target, key: `private:${target}`, sendChain: Promise.resolve() },
                  [{ type: 'record', data: { file: file.replace(/\\/g, '/') } }],
                );
                jsonResponse(res, 200, { ok: true, file, target });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/presets',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 200, {
              presets: [
                { id: 'whale', name: '大米鲸鱼娘', prompt: readPresetPrompt('whale'), override: settings.presetPrompts.whale ?? '' },
                { id: 'chiang', name: '蒋介石', prompt: readPresetPrompt('chiang'), override: settings.presetPrompts.chiang ?? '' },
              ],
            });
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 65536) req.destroy();
          });
          req.on('end', () => {
            try {
              const request = JSON.parse(body === '' ? '{}' : body);
              const id = String(request.id ?? '');
              if (!['whale', 'chiang'].includes(id)) throw new Error('未知预设');
              if (request.action === 'restore') {
                const file = join(cfg.presetDir, `${id}-preset`, 'cordis.patch.yml');
                const backup = `${file}.orig`;
                if (existsSync(backup)) cpSync(backup, file);
                delete settings.presetPrompts[id];
                saveSettings();
                for (const key of Object.keys(state.chats)) delete state.chats[key];
                chats.clear();
                saveState();
                log(`preset ${id} restored from backup`);
                jsonResponse(res, 200, { ok: true, prompt: readPresetPrompt(id) });
                return;
              }
              if (request.action !== 'save') throw new Error('unsupported action');
              const prompt = String(request.prompt ?? '');
              if (prompt.trim() === '') throw new Error('内容不能为空');
              writePresetPrompt(id, prompt);
              // Keep a copy for the running process: DSH only re-reads preset
              // YAML when the bundle reloads, so this makes the edit effective now.
              settings.presetPrompts[id] = prompt;
              saveSettings();
              for (const key of Object.keys(state.chats)) delete state.chats[key];
              chats.clear();
              saveState();
              log(`preset ${id} text edited (${prompt.length} chars)`);
              jsonResponse(res, 200, { ok: true });
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/models',
        handler: (_req, res) => {
          void (async () => {
            try {
              const catalog = await ctx.sessionController.modelCatalog();
              jsonResponse(res, 200, {
                default: catalog.default,
                current: effectiveModel(),
                groups: (catalog.groups ?? []).map((group) => ({
                  id: group.id,
                  name: group.name,
                  models: (group.models ?? []).map((model) => ({
                    id: model.id,
                    name: model.name,
                    efforts: (model.reasoning?.efforts ?? []).map((effort) => effort.id),
                    defaultEffort: model.reasoning?.defaultEffort ?? null,
                  })),
                })),
                failures: catalog.failures ?? [],
              });
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) });
            }
          })();
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/ai/persona',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const description = String(request.description ?? '').trim();
                if (description === '') throw new Error('先写一句你想要的人设');
                const answer = await askModel(PERSONA_SYSTEM, description);
                const cleaned = answer.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
                const match = cleaned.match(/\{[\s\S]*\}/);
                if (match === null) throw new Error(`模型没有返回 JSON：${cleaned.slice(0, 120)}`);
                const persona = JSON.parse(match[0]);
                if (typeof persona.name !== 'string' || typeof persona.prompt !== 'string') throw new Error('返回的人设缺少 name/prompt');
                const preset = persona.preset === 'chiang' ? 'chiang' : 'whale';
                log(`ai persona generated: ${persona.name} (${preset})`);
                jsonResponse(res, 200, { ok: true, persona: { name: persona.name, preset, prompt: persona.prompt } });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/ai/stickers',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const query = String(request.query ?? '').trim();
                if (query === '') throw new Error('先写搜索关键词');
                const added = await searchStickers(query, 4);
                if (added.length === 0) throw new Error('没找到能用的图片（可能都被防盗链拦了）');
                log(`ai sticker search "${query}" added ${added.length}`);
                jsonResponse(res, 200, { ok: true, added, files: listStickers() });
              } catch (error) {
                jsonResponse(res, 500, { error: String(error?.message ?? error) });
              }
            })();
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/log',
        handler: (req, res) => {
          const query = String(req.url ?? '').split('?')[1] ?? '';
          const wanted = Number((query.match(/(?:^|&)lines=(\d+)/)?.[1] ?? '40'));
          jsonResponse(res, 200, { lines: tailLog(Number.isFinite(wanted) ? Math.min(200, Math.max(5, wanted)) : 40) });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/login',
        handler: (req, res) => {
          const launcher = cfg.napcat.launcher !== '' ? cfg.napcat.launcher : join(cfg.napcat.dir, 'launcher.bat');
          if (req.method !== 'POST') {
            let qrUpdatedAt = 0;
            try {
              qrUpdatedAt = statSync(join(cfg.napcat.dir, 'cache', 'qrcode.png')).mtimeMs;
            } catch {
              qrUpdatedAt = 0;
            }
            jsonResponse(res, 200, {
              connected: socket !== null && socket.ready === true,
              qq: cfg.napcat.qq,
              dir: cfg.napcat.dir,
              launcher,
              launcherExists: existsSync(launcher),
              qrUpdatedAt,
              qrAgeSeconds: qrUpdatedAt === 0 ? null : Math.round((Date.now() - qrUpdatedAt) / 1000),
            });
            return;
          }
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            try {
              const action = JSON.parse(body === '' ? '{}' : body);
              if (action.action === 'register') {
                // One-time: create a highest-privilege task so later starts need no UAC.
                // The script goes to a file first — quoting a whole PowerShell
                // program through Start-Process -ArgumentList is a losing game.
                const ps1 = join(cfg.dataDir, 'register-napcat-task.ps1');
                mkdirSync(cfg.dataDir, { recursive: true });
                const script = [
                  `$a = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c "${launcher}" ${cfg.napcat.qq}'`,
                  "Register-ScheduledTask -TaskName 'DSH-NapCat' -Action $a -RunLevel Highest -Force | Out-Null",
                  "Write-Output 'registered'",
                ].join('\r\n');
                writeFileSync(ps1, script, 'utf8');
                const command = `Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1}' -Verb RunAs`;
                const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                });
                child.unref();
                log('console: registering DSH-NapCat scheduled task (UAC prompt waiting)');
                jsonResponse(res, 200, { ok: true, registering: true });
                return;
              }
              if (action.action !== 'start') {
                jsonResponse(res, 400, { error: 'unsupported action' });
                return;
              }
              if (socket !== null && socket.ready === true) {
                jsonResponse(res, 200, { ok: true, already: true });
                return;
              }
              if (!existsSync(launcher)) throw new Error(`找不到启动器：${launcher}`);
              // Fast path: the non-elevated launcher works as long as QQ's app
              // directory is already patched (it is, since the first install).
              const userBat = join(cfg.napcat.dir, 'launcher-user.bat');
              if (existsSync(userBat)) {
                // wscript with window style 0 keeps the console from flashing up.
                mkdirSync(cfg.dataDir, { recursive: true });
                const vbs = join(cfg.dataDir, 'start-napcat.vbs');
                writeFileSync(
                  vbs,
                  `CreateObject("WScript.Shell").Run "cmd /c ""${userBat}"" ${cfg.napcat.qq}", 0, False\r\n`,
                  'utf8',
                );
                const hidden = spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true });
                hidden.unref();
                log('console: started NapCat hidden via launcher-user.bat (no UAC, no console window)');
                jsonResponse(res, 200, { ok: true, started: true, via: 'direct' });
                return;
              }
              // Fallback: pre-registered task, then an explicit UAC prompt.
              const runTask = spawn('schtasks.exe', ['/Run', '/TN', 'DSH-NapCat'], { windowsHide: true, stdio: 'ignore' });
              let answered = false;
              const fallback = () => {
                if (answered) return;
                answered = true;
                const command = `Start-Process -FilePath "${launcher}" -ArgumentList "${cfg.napcat.qq}" -WorkingDirectory "${cfg.napcat.dir}" -Verb RunAs`;
                const child = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
                  detached: true,
                  stdio: 'ignore',
                  windowsHide: true,
                });
                child.unref();
                log(`console: launched NapCat for ${cfg.napcat.qq} (UAC prompt waiting)`);
                jsonResponse(res, 200, { ok: true, started: true, via: 'uac' });
              };
              runTask.on('error', fallback);
              runTask.on('exit', (code) => {
                if (code === 0) {
                  answered = true;
                  log('console: started NapCat via scheduled task (no UAC)');
                  jsonResponse(res, 200, { ok: true, started: true, via: 'task' });
                } else {
                  fallback();
                }
              });
            } catch (error) {
              jsonResponse(res, 500, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/qr',
        handler: (_req, res) => {
          try {
            const file = join(cfg.napcat.dir, 'cache', 'qrcode.png');
            if (!existsSync(file)) {
              res.statusCode = 404;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: 'no qr yet' }));
              return;
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'no-store');
            res.end(readFileSync(file));
          } catch (error) {
            res.statusCode = 500;
            res.end(String(error?.message ?? error));
          }
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/debug/graph',
        handler: (_req, res) => {
          try {
            const graph = ctx.get('clientModules')?.graph?.();
            const text = JSON.stringify(graph ?? null);
            jsonResponse(res, 200, {
              hasOurModule: text.includes('dsh-im-bridge'),
              bytes: text.length,
            });
          } catch (error) {
            jsonResponse(res, 500, { error: String(error?.message ?? error) });
          }
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/console',
        handler: (_req, res) => {
          let html = CONSOLE_HTML;
          try {
            const file = join(dirname(fileURLToPath(import.meta.url)), 'console.html');
            if (existsSync(file)) html = readFileSync(file, 'utf8');
          } catch {
            /* keep the inline fallback */
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(html);
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/action',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on('end', () => {
            try {
              const action = JSON.parse(body === '' ? '{}' : body);
              if (action.kind === 'switchLevel') {
                const level = String(action.level ?? '');
                if (!['eco', 'standard', 'high', 'max'].includes(level)) throw new Error('未知档位');
                settings.intelligence = level;
                saveSettings();
                configuredModels.clear();
                let retired = 0;
                for (const live of chats.values()) {
                  try {
                    ctx.sessionController.cancel({ sessionId: live.sessionId });
                  } catch {
                    /* best effort */
                  }
                  retired += 1;
                }
                chats.clear();
                state.chats = {};
                saveState();
                log(`intelligence -> ${level} (${INTELLIGENCE_EFFORT[level]}); retired ${retired} session(s)`);
                jsonResponse(res, 200, { ok: true, level, effort: INTELLIGENCE_EFFORT[level], retired });
                return;
              }
              switch (action.kind) {
                case 'reconnect':
                  accountPaused = false;
                  socket?.close();
                  break;
                case 'pause':
                  accountPaused = true;
                  socket?.close();
                  log('console: connection paused (config kept)');
                  break;
                case 'resume':
                  accountPaused = false;
                  log('console: connection resumed');
                  connectSocket();
                  break;
                case 'test':
                  for (const userId of effectiveUsers()) {
                    sendText(
                      { kind: 'private', chatId: userId, userId, sendChain: Promise.resolve() },
                      '测试：桥接正常。',
                    );
                  }
                  break;
                case 'toggle':
                  if (action.target === 'silence') cfg.silence = cfg.silence === null ? defaults.silence : null;
                  if (action.target === 'afterthought') cfg.afterthought = cfg.afterthought === null ? defaults.afterthought : null;
                  if (action.target === 'proactive') {
                    cfg.proactive = cfg.proactive === null ? defaults.proactive : null;
                    if (cfg.proactive !== null) scheduleProactive();
                  }
                  break;
                case 'reset': {
                  const key = String(action.key ?? '');
                  const entry = state.chats[key];
                  if (entry !== undefined) {
                    clearSilenceTimer(chats.get(entry.sessionId) ?? {});
                    chats.delete(entry.sessionId);
                    delete state.chats[key];
                    saveState();
                    log(`console: reset conversation for ${key}`);
                  }
                  break;
                }
                case 'preset':
                  // Switching persona starts a fresh Session at the next message;
                  // the running one keeps the persona it was born with.
                  if (typeof action.value === 'string' && action.value.trim() !== '') {
                    cfg.agentPreset = action.value.trim();
                    for (const key of Object.keys(state.chats)) {
                      clearSilenceTimer(chats.get(state.chats[key]?.sessionId) ?? {});
                      delete state.chats[key];
                    }
                    chats.clear();
                    saveState();
                    log(`console: persona switched to ${cfg.agentPreset}`);
                  }
                  break;
                default:
                  jsonResponse(res, 400, { error: `unknown action ${String(action.kind)}` });
                  return;
              }
              log(`console action: ${String(action.kind)} ${String(action.target ?? '')}`);
              jsonResponse(res, 200, statusPayload());
            } catch (error) {
              jsonResponse(res, 400, { error: String(error?.message ?? error) });
            }
          });
        },
      }),
    );
  }

  connectSocket();
  if (cfg.selfTest) void runSelfTest();
  scheduleProactive();

  ctx.effect(() => () => {
    stopped = true;
    if (proactive.timer !== null) clearTimeout(proactive.timer);
    proactive.timer = null;
    for (const chat of chats.values()) {
      clearSilenceTimer(chat);
      clearAfterTimer(chat);
    }
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    socket?.close();
    socket = null;
    saveState();
    log('plugin disposed');
  });
}
