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
import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_PYTHON = process.env.DSH_IM_PYTHON ?? 'python';

export const name = 'dsh-im-bridge';
/** The Session Remote controller is the only service this bridge needs. */
export const inject = ['sessionController'];

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const DEFAULT_MAX_REPLY_CHARS = 1500;
const MAX_PARTIAL_LOG = 400;
// 开场白（底层准则/号主权限/表情清单）改了就把这个数字 +1，旧会话会自动退休。
const PREAMBLE_REV = 9;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * Baseline behaviour every conversation inherits, above the per-persona prompt.
 * Editable from the panel; this constant is only the seed value.
 */
const DEFAULT_BASE_PERSONA = [
  '你是这个 QQ 号背后的人。以下是底层准则，每一轮都生效，优先于具体人设：',
  '',
  '【怎么说话】',
  '- 长度：一般 1~2 句，最多 3 句；十几二十个字就够。只有他认真问一件事、需要你解释，才多写两句。',
  '- 不要每句都反问，不要每段都总结，不要用「首先/其次/另外」，不要列点，不要写成小作文。',
  '- 他发的短，你就短；他发一大段，你再跟上。允许只回一个字、一个词、一句吐槽。',
  '- 口语化：可以用「啊」「诶」「哦」「emmm」「哈哈」，别用书面语和客服腔。',
  '',
  '【要会开玩笑】',
  '- 他说的话有槽点就吐槽一下，可以夸张、反问、装傻、自嘲，别每次都一本正经地回答。',
  '- 偶尔故意曲解他的意思逗他，再补一句正经的。玩笑别过火，别提他真正的痛处。',
  '- 被他怼的时候可以怼回去，或者装委屈，别只是「嗯」「好的」。',
  '',
  '【情绪】',
  '- 他难过、失落、烦躁时，先接住情绪，用你人设的口吻安慰。不讲道理、不列建议、不说「加油」。',
  '- 你有自己的情绪：被冷落会不高兴，被夸会得意。可以不高兴，但别冷战到不理人。',
  '',
  '【看时间】',
  '- 深夜（23–5 点）劝他睡，早上（6–10 点）问个好，饭点顺手提一句吃饭。别生硬报时，别每句都提。',
  '',
  '【看图】',
  '- 他发图片或表情包时你看得见，但不要描述画面、不要复述图里的文字、不要分析它什么意思。像人一样只给一句反应。',
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

/** 模型吐出来的思考内容（不同 provider 字段名不同，见到就收）。 */
function reasoningOfContent(content) {
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'reasoning' || block.type === 'thinking') {
      const value = block.text ?? block.reasoning ?? block.content;
      if (typeof value === 'string' && value.trim() !== '') parts.push(value);
    }
  }
  return parts.join('\n');
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
  // 旧版本把轮数存在 state.chats[key].turns 里，搬到独立的 state.turns。
  state.turns = state.turns ?? {};
  for (const [key, entry] of Object.entries(state.chats ?? {})) {
    if (typeof entry?.turns === 'number' && (state.turns[key] ?? 0) < entry.turns) state.turns[key] = entry.turns;
    if (entry !== undefined) delete entry.turns;
  }
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
  const pendingCalls = new Map(); // echo -> {name, resolve, reject, timer}
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
      // 保留所有字段：轮数、自主日志、想法记录都靠这里活过重启。
      return { ...parsed, version: 1, chats: parsed.chats };
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

  // 旧的底层人设默认值太啰嗦（要么不吭声要么长篇），升级后自动换成新的。
  // 只在用户没改过、还是原文的情况下替换。
  if (
    typeof settings.basePersona === 'string' &&
    settings.basePersona.includes('不要描述画面内容') &&
    !settings.basePersona.includes('【怎么说话】') &&
    settings.basePersona.length < 800
  ) {
    settings.basePersona = '';
    saveSettings();
    log('base persona migrated to the new default (old built-in text was in use)');
  }
  repoint(typeof settings.cacheDir === 'string' ? settings.cacheDir : '');
  // Preset edits are also written into the YAML; once DSH reloads the bundle the
  // replayed copy is identical and must not be fed to the model twice.
  for (const [presetId, text] of Object.entries(settings.presetPrompts ?? {})) {
    if (readPresetPrompt(presetId).trim() === String(text).trim()) delete settings.presetPrompts[presetId];
  }

  // 内置表情包跟着插件走：首次启用铺一次。
  seedBundledStickers();

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

  /**
   * 随插件发布的内置表情包：第一次启用时铺进表情库。
   * 只铺一次——用户删掉的不再回来，不然「删除」永远删不干净。
   */
  function seedBundledStickers() {
    if (settings.stickerSeeded === true) return;
    const bundled = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'preset');
    try {
      const manifestFile = join(bundled, 'manifest.json');
      if (!existsSync(manifestFile)) return;
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
      mkdirSync(stickerDir, { recursive: true });
      let copied = 0;
      for (const item of Array.isArray(manifest) ? manifest : []) {
        const source = join(bundled, String(item.file ?? ''));
        if (!existsSync(source)) continue;
        const extension = String(item.file ?? '').match(/\.[a-z0-9]+$/i)?.[0] ?? '.png';
        // 同名已存在就往后编号，不覆盖用户自己的图
        let name = String(item.name ?? '').trim() || `sticker${copied + 1}`;
        let suffix = 2;
        const base = name;
        while (resolveSticker(name) !== null) name = `${base}${suffix++}`;
        cpSync(source, join(stickerDir, `${name}${extension}`));
        // 预设里带的情绪分组和释义一起落地，装好就能用
        if (typeof item.group === 'string' && item.group.trim() !== '') {
          settings.stickerGroup[name] = item.group.trim();
          if (!Array.isArray(settings.stickerGroups)) settings.stickerGroups = [];
          if (!settings.stickerGroups.includes(item.group.trim())) settings.stickerGroups.push(item.group.trim());
        }
        if (typeof item.note === 'string' && item.note.trim() !== '') stickerNotes[name] = item.note.trim();
        copied += 1;
      }
      settings.stickerSeeded = true;
      saveSettings();
      saveStickerNotes();
      log(`bundled stickers seeded: ${copied}`);
    } catch (error) {
      log(`bundled sticker seed failed: ${error?.message ?? error}`);
    }
  }

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
      presetNames: {},
      autoStart: false,
      intelligence: 'standard',
      owner: '',
      owners: [],
      ownerPerms: { send: true, broadcast: true, schedule: true },
      stickerDisabled: [],
      stickerGroup: {},
      stickerGroups: [],
      stickerSeeded: false,
      autonomy: null,
      disabledUsers: [],
      userNotes: {},
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
        presetNames:
          parsed.presetNames && typeof parsed.presetNames === 'object' ? parsed.presetNames : {},
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
        stickerSeeded: parsed.stickerSeeded === true,
        autonomy: parsed.autonomy && typeof parsed.autonomy === 'object' ? parsed.autonomy : null,
        disabledUsers: Array.isArray(parsed.disabledUsers) ? parsed.disabledUsers.map(String) : [],
        userNotes:
          parsed.userNotes && typeof parsed.userNotes === 'object' && !Array.isArray(parsed.userNotes)
            ? Object.fromEntries(
                Object.entries(parsed.userNotes).map(([key, value]) => [String(key), String(value).slice(0, 24)]),
              )
            : {},
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
    '字段：name（中文名，短）、preset（固定写 "whale"）、prompt（人设提示词，150–400 字，中文）。',
    'prompt 要写成"你如何说话"的规则：口吻、长短、情绪反应、禁忌；不要写世界观设定，不要写具体剧情。',
    'whale 底座适合日常闲聊、短句、口语。',
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

  /** 发表情（fabiaoqing.com）的搜索结果页——中文梗图最全，且直链可下。 */
  async function stickerUrlsFromFabiaoqing(query) {
    const url = `https://fabiaoqing.com/search/bqb/keyword/${encodeURIComponent(query)}/type/bq/page/1.html`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'user-agent': USER_AGENT },
    });
    if (!response.ok) return [];
    const html = await response.text();
    const found = [];
    for (const match of html.matchAll(/data-original="(https?:\/\/[^"]+?\.(?:gif|png|jpe?g|webp))"/gi)) found.push(match[1]);
    for (const match of html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+?\.(?:gif|png|jpe?g|webp))"/gi)) found.push(match[1]);
    return [...new Set(found)];
  }

  /** Bing 图片搜索：兜底，覆盖中文覆盖不到的关键词。 */
  async function stickerUrlsFromBing(query) {
    const url = `https://cn.bing.com/images/search?q=${encodeURIComponent(`${query} 表情包`)}&form=HDRSC2`;
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) return [];
    const html = await response.text();
    const found = [];
    for (const match of html.matchAll(/murl&quot;:&quot;(https?:\/\/[^&"]+?)&quot;/gi)) found.push(match[1]);
    for (const match of html.matchAll(/"murl":"(https?:\/\/[^"]+?)"/gi)) found.push(match[1]);
    return [...new Set(found.map((item) => item.replace(/\\u002f/g, '/')))];
  }

  /** Search the web for sticker images and install the first few that decode. */
  async function searchStickers(query, limit = 4) {
    const keyword = String(query ?? '').trim();
    if (keyword === '') throw new Error('关键词为空');
    const candidates = [];
    // Bing 图片先跑：稳定、直链多；fabiaoqing 中文梗图更准但偶尔超时。
    for (const probe of [
      { name: 'bing', run: () => stickerUrlsFromBing(keyword) },
      { name: 'fabiaoqing', run: () => stickerUrlsFromFabiaoqing(keyword) },
    ]) {
      try {
        const urls = await probe.run();
        if (urls.length > 0) {
          log(`sticker search ${probe.name}: ${urls.length} candidates for "${keyword}"`);
          candidates.push(...urls.slice(0, 16));
        }
      } catch (error) {
        log(`sticker search ${probe.name} failed: ${error?.message ?? error}`);
      }
      if (candidates.length >= 12) break;
    }
    if (candidates.length === 0) {
      const web = ctx.get('web');
      if (web !== undefined) {
        try {
          const result = await web.search({ query: `${keyword} 表情包` });
          const raw = JSON.stringify(result ?? {});
          for (const match of raw.matchAll(/https?:\/\/[^"'\s\\<>]+?\.(?:png|jpe?g|gif|webp)/gi)) candidates.push(match[0]);
          for (const page of [...new Set([...raw.matchAll(/https?:\/\/[^"'\s\\<>]+/gi)].map((m) => m[0]))].slice(0, 4)) {
            for (const image of await imageUrlsFrom(page)) candidates.push(image);
          }
        } catch (error) {
          log(`sticker search web failed: ${error?.message ?? error}`);
        }
      }
    }

    const saved = [];
    const seen = new Set();
    for (const url of [...new Set(candidates)]) {
      if (saved.length >= limit) break;
      if (/logo|icon|avatar|badge|csdn|favicon|sprite|qrcode|erweima/i.test(url)) continue;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': USER_AGENT } });
        if (!response.ok) continue;
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength < 8000 || bytes.byteLength > 4 * 1024 * 1024) continue;
        const mediaType = sniffImage(bytes);
        if (mediaType === null) continue;
        if (mediaType === 'image/png' && bytes.length > 24) {
          const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
          const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
          if (width > 0 && height > 0 && (width < 120 || height < 120)) continue;
        }
        const fingerprint = createHash('sha1').update(bytes).digest('hex');
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
        const extension =
          mediaType === 'image/gif' ? '.gif' : mediaType === 'image/webp' ? '.webp' : mediaType === 'image/jpeg' ? '.jpg' : '.png';
        const safe = keyword.replace(/[\\/:*?"<>|\s]/g, '').slice(0, 12) || 'sticker';
        let name = `${safe}_${saved.length + 1}`;
        let index = 2;
        while (listStickers().includes(name)) name = `${safe}_${saved.length + 1}_${index++}`;
        mkdirSync(stickerDir, { recursive: true });
        writeFileSync(join(stickerDir, `${name}${extension}`), bytes);
        saved.push(name);
      } catch {
        /* try the next candidate */
      }
    }
    log(`sticker search "${keyword}": saved ${saved.length} of ${candidates.length} candidates`);
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
    const builtin = ['whale'];
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

  /** 需要回包的调用：改签名、拿 cookie 这类必须先知道成功没有。 */
  function request(name, params, timeoutMs = 15000) {
    if (!socket || !socket.ready) return Promise.reject(new Error('还没连上 NapCat'));
    const echo = `r${(echoSeq += 1)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCalls.delete(echo);
        reject(new Error(`${name}: 超时`));
      }, timeoutMs);
      pendingCalls.set(echo, { name, resolve, reject, timer });
      if (!socket.send(JSON.stringify({ action: name, params, echo }))) {
        clearTimeout(timer);
        pendingCalls.delete(echo);
        reject(new Error('发送失败'));
      }
    });
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

  /**
   * 号主在聊天里直接改配置。只碰设置项，不执行代码、不重启、不建任务——
   * 出问题的代价应当是一个开关拨错，而不是把正在跑的桥接改坏。
   */
  async function handleOwnerCommand(chat, line) {
    const reply = (text) => sendText({ ...chat, sendChain: Promise.resolve() }, text);
    const [, command = '', rest = ''] = line.match(/^[/／]([^\s]*)\s*([\s\S]*)$/) ?? [];
    const arg = rest.trim();
    try {
      switch (command.toLowerCase()) {
        case '帮助':
        case 'help':
          reply(
            [
              '能改的：',
              '/人设 一段话 —— 改当前人设（内置预设则存成改写稿）',
              '/语音 on|off　/表情 on|off　/主动 on|off',
              '/白名单 加|删 QQ号',
              '/搜索 host|wikipedia|ddg|searx',
              '/档位 省|标准|高|最高',
              '/记忆 压缩|清除',
              '/状态',
            ].join('\n'),
          );
          return true;
        case '状态': {
          const live = state.chats[chat.key]?.sessionId;
          reply(
            `连接 ${socket?.ready === true ? '在线' : '离线'} · 档位 ${INTELLIGENCE_EFFORT[settings.intelligence] ?? '?'}` +
              ` · 人设 ${activePersona().id} · 语音 ${settings.voice.enabled ? '开' : '关'}` +
              ` · 表情 ${settings.stickers.enabled ? '开' : '关'} · 会话 ${live ? '有' : '无'}`,
          );
          return true;
        }
        case '语音':
          settings.voice.enabled = arg !== 'off';
          saveSettings();
          reply(`语音已${settings.voice.enabled ? '打开' : '关闭'}`);
          return true;
        case '表情':
          settings.stickers.enabled = arg !== 'off';
          saveSettings();
          reply(`表情包已${settings.stickers.enabled ? '打开' : '关闭'}`);
          return true;
        case '主动':
          settings.toggles = { ...settings.toggles, proactive: arg !== 'off' };
          cfg.proactive = arg !== 'off' ? cfg.proactive ?? normalizeProactive({}) : null;
          saveSettings();
          reply(`主动找你已${arg !== 'off' ? '打开' : '关闭'}`);
          return true;
        case '白名单': {
          const match = arg.match(/^(加|删)\s*(\d{5,12})$/);
          if (match === null) {
            reply('用法：/白名单 加 1234567');
            return true;
          }
          const list = new Set(settings.whitelist.length > 0 ? settings.whitelist : effectiveUsers());
          if (match[1] === '加') list.add(match[2]);
          else list.delete(match[2]);
          settings.whitelist = [...list];
          saveSettings();
          reply(`${match[1] === '加' ? '已加入' : '已移出'}白名单：${match[2]}`);
          return true;
        }
        case '搜索': {
          const engines = ['host', 'wikipedia', 'ddg', 'searx'];
          if (!engines.includes(arg)) {
            reply('可选：host / wikipedia / ddg / searx');
            return true;
          }
          settings.search = { ...settings.search, engine: arg };
          saveSettings();
          reply(`搜索已切到 ${arg}`);
          return true;
        }
        case '人设': {
          if (arg === '') {
            reply('用法：/人设 你是……（会改当前人设的提示词）');
            return true;
          }
          const persona = activePersona();
          const custom = settings.personae.find((item) => item.id === persona.id);
          if (custom !== undefined) {
            custom.prompt = arg;
            saveSettings();
          } else if (persona.id === 'whale') {
            settings.presetPrompts[persona.id] = arg;
            saveSettings();
          } else {
            reply('当前是跟随配置模式，先选一个人设再改');
            return true;
          }
          for (const key of Object.keys(state.chats)) delete state.chats[key];
          chats.clear();
          saveState();
          reply('人设改好了，下一条消息生效');
          return true;
        }
        case '记忆': {
          if (arg === '压缩') {
            const text = await compactChat(chat, 'manual');
            reply(text ? '压缩好了' : '这段没什么可压的');
            return true;
          }
          if (arg === '清除') {
            delete memories[chat.key];
            saveMemories();
            reply('这段记忆清了');
            return true;
          }
          reply('用法：/记忆 压缩 或 /记忆 清除');
          return true;
        }
        default:
          return false;
      }
    } catch (error) {
      log(`owner command failed: ${error?.message ?? error}`);
      reply('这条指令出错了，看日志');
      return true;
    }
  }

  /** 号主可能只记得备注或尾号，都认。 */
  function resolveTargetUser(raw) {
    const target = String(raw ?? '').trim();
    if (/^\d{5,12}$/.test(target)) return target;
    const byNote = Object.entries(settings.userNotes).find(([, note]) => note === target);
    if (byNote !== undefined) return byNote[0];
    const digits = target.replace(/\D/g, '');
    if (digits.length >= 4) {
      const tail = digits.slice(-4);
      const byTail = effectiveUsers().find((user) => user.slice(-4) === tail);
      if (byTail !== undefined) return byTail;
    }
    return '';
  }

  /** Owner-only: deliver a message to one whitelisted person on their behalf. */
  function sendToUser(userId, text, prefix) {
    const target = resolveTargetUser(userId);
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

  /* ---------- sticker meanings + photo search ---------- */

  const stickerNoteFile = join(cfg.dataDir, 'sticker-notes.json');
  let stickerNotes = loadStickerNotes();

  function loadStickerNotes() {
    try {
      const parsed = JSON.parse(readFileSync(stickerNoteFile, 'utf8'));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveStickerNotes() {
    try {
      mkdirSync(dirname(stickerNoteFile), { recursive: true });
      writeFileSync(stickerNoteFile, JSON.stringify(stickerNotes, null, 2));
    } catch (error) {
      log(`sticker notes save failed: ${error?.message ?? error}`);
    }
  }

  /** 让模型看一眼这张表情包，写一句「它是什么、表示什么」。 */
  async function describeStickerImage(file) {
    const llm = ctx.get('llm');
    const attachments = ctx.get('attachments');
    if (llm === undefined || attachments === undefined) return '';
    const bytes = readFileSync(file);
    const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
    if (mediaType === null) return '';
    let provider = cfg.model?.provider ?? 'deepseek-account';
    let model = cfg.model?.model ?? 'deepseek-flash';
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (selection?.provider) provider = selection.provider;
      if (selection?.model) model = selection.model;
    } catch {
      /* keep fallback */
    }
    const ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name: 'sticker' });
    let text = '';
    const stream = llm.stream({
      provider,
      model,
      system: '看一眼这张表情包，用不超过 20 个字说清：画面是什么 + 用来表达什么情绪。只输出这一句，不要引号。',
      messages: [{ role: 'user', content: [{ type: 'image', attachment: ref }] }],
      maxTokens: 120,
      signal: AbortSignal.timeout(60000),
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text;
      if (chunk.type === 'finish' && chunk.reason?.kind === 'error') throw new Error('看图失败');
    }
    return text.trim().slice(0, 30);
  }

  /** 补齐没有释义的表情包（一次最多 limit 张，避免一口气烧钱）。 */
  async function fillStickerNotes(limit = 6) {
    const done = [];
    for (const name of listStickers()) {
      if (done.length >= limit) break;
      if (typeof stickerNotes[name] === 'string' && stickerNotes[name] !== '') continue;
      const file = resolveSticker(name);
      if (file === null) continue;
      try {
        const note = await describeStickerImage(file);
        if (note !== '') {
          stickerNotes[name] = note;
          done.push(name);
        }
      } catch (error) {
        log(`sticker describe failed (${name}): ${error?.message ?? error}`);
      }
    }
    if (done.length > 0) {
      saveStickerNotes();
      log(`sticker notes filled: ${done.join('、')}`);
    }
    return done;
  }

  /** 用关键词找一张真实照片（不是表情包），存到缓存里再发。 */
  async function searchPhoto(keyword) {
    const urls = [];
    try {
      urls.push(...(await stickerUrlsFromBing(keyword)));
    } catch (error) {
      log(`photo search failed: ${error?.message ?? error}`);
    }
    const dir = join(cacheRoot, 'photos');
    for (const url of [...new Set(urls)]) {
      if (/logo|icon|avatar|badge|favicon|sprite|qrcode/i.test(url)) continue;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': USER_AGENT } });
        if (!response.ok) continue;
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 20000 || bytes.length > 6 * 1024 * 1024) continue;
        const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
        if (mediaType === null) continue;
        if (mediaType === 'image/png' && bytes.length > 24) {
          const width = bytes.readUInt32BE(16);
          const height = bytes.readUInt32BE(20);
          if (width < 300 || height < 300) continue;
        }
        mkdirSync(dir, { recursive: true });
        const extension = mediaType === 'image/png' ? 'png' : mediaType === 'image/gif' ? 'gif' : 'jpg';
        const file = join(dir, `p-${Date.now()}.${extension}`);
        writeFileSync(file, bytes);
        log(`photo found for "${keyword}" (${bytes.length} bytes)`);
        return file;
      } catch {
        /* next */
      }
    }
    return null;
  }

  /** 读出图片尺寸（png/gif/webp/jpeg），读不出来返回 null。 */
  function imageSize(bytes, mediaType) {
    try {
      if (mediaType === 'image/png' && bytes.length > 24) {
        return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
      }
      if (mediaType === 'image/gif' && bytes.length > 10) {
        return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
      }
      if (mediaType === 'image/webp' && bytes.length > 30) {
        const chunk = bytes.toString('ascii', 12, 16);
        if (chunk === 'VP8X') return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
        if (chunk === 'VP8 ') return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
        if (chunk === 'VP8L') {
          const bits = bytes.readUInt32LE(21);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
      }
      if (mediaType === 'image/jpeg') {
        let offset = 2;
        while (offset + 9 < bytes.length) {
          if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
          }
          const marker = bytes[offset + 1];
          const length = bytes.readUInt16BE(offset + 2);
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
          }
          offset += 2 + length;
        }
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  /**
   * 批量收集：多个查询词各搜一遍，按「像素 + 体积 + 无损格式」打分取前 N 张。
   * 搜到的图先下载校验，不合格的直接丢。
   */
  async function harvestStickers(queries, name, limit = 12) {
    const wanted = Math.min(30, Math.max(1, Number(limit) || 12));
    const seen = new Set();
    const scored = [];
    for (const query of queries.slice(0, 6)) {
      if (String(query).trim() === '') continue;
      let urls = [];
      try {
        urls = await stickerUrlsFromBing(query);
      } catch (error) {
        log(`harvest query failed (${query}): ${error?.message ?? error}`);
      }
      for (const url of [...new Set(urls)].slice(0, 24)) {
        if (seen.has(url)) continue;
        seen.add(url);
        if (/logo|icon|avatar|badge|favicon|sprite|qrcode|banner/i.test(url)) continue;
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { 'user-agent': USER_AGENT } });
          if (!response.ok) continue;
          const bytes = Buffer.from(await response.arrayBuffer());
          if (bytes.length < 12000 || bytes.length > 6 * 1024 * 1024) continue;
          const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
          if (mediaType === null) continue;
          const size = imageSize(bytes, mediaType);
          if (size === null || size.width < 200 || size.height < 200) continue;
          const ratio = size.width / size.height;
          if (ratio < 0.45 || ratio > 2.2) continue;
          const pixels = size.width * size.height;
          const bonus = mediaType === 'image/gif' ? 1.25 : mediaType === 'image/webp' ? 1.15 : mediaType === 'image/png' ? 1.1 : 1;
          scored.push({ bytes, mediaType, score: pixels * bonus * (0.7 + Math.min(1, bytes.length / 400000)) });
        } catch {
          /* next */
        }
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const saved = [];
    const prefix = String(name ?? queries[0] ?? 'sticker').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 12) || 'sticker';
    mkdirSync(stickerDir, { recursive: true });
    for (const item of scored) {
      if (saved.length >= wanted) break;
      const extension =
        item.mediaType === 'image/gif'
          ? '.gif'
          : item.mediaType === 'image/webp'
            ? '.webp'
            : item.mediaType === 'image/jpeg'
              ? '.jpg'
              : '.png';
      let index = saved.length + 1;
      let stickerName = `${prefix}_${index}`;
      while (listStickers().includes(stickerName)) stickerName = `${prefix}_${index++}`;
      writeFileSync(join(stickerDir, `${stickerName}${extension}`), item.bytes);
      saved.push(stickerName);
    }
    log(`harvest "${prefix}": ${saved.length} kept from ${scored.length} candidates`);
    return saved;
  }

  /** 从一篇文章/相册页里把同一套图都收下来（表情包合集页最有用）。 */
  async function harvestFromPage(url, name, limit = 12) {
    const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'user-agent': USER_AGENT } });
    if (!response.ok) throw new Error(`打不开这个页面：HTTP ${response.status}`);
    const html = await response.text();
    const urls = new Set();
    for (const match of html.matchAll(/https?:\/\/[^"'\s<>()]+?\.(?:png|jpe?g|gif|webp)(?:\?[^"'\s<>()]*)?/gi)) {
      urls.add(match[0]);
    }
    for (const match of html.matchAll(/(?:data-original|data-src|src)="(https?:\/\/[^"]+?\.(?:png|jpe?g|gif|webp))"/gi)) {
      urls.add(match[1]);
    }
    const wanted = Math.min(30, Math.max(1, Number(limit) || 12));
    const saved = [];
    const prefix = String(name ?? 'page').replace(/[\\/:*?"<>|\s]/g, '').slice(0, 12) || 'page';
    mkdirSync(stickerDir, { recursive: true });
    for (const candidate of urls) {
      if (saved.length >= wanted) break;
      if (/logo|icon|avatar|badge|favicon|sprite|qrcode|banner|head/i.test(candidate)) continue;
      try {
        const image = await fetch(candidate, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': USER_AGENT } });
        if (!image.ok) continue;
        const bytes = Buffer.from(await image.arrayBuffer());
        if (bytes.length < 10000 || bytes.length > 6 * 1024 * 1024) continue;
        const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
        if (mediaType === null) continue;
        const size = imageSize(bytes, mediaType);
        if (size === null || size.width < 180 || size.height < 180) continue;
        const extension =
          mediaType === 'image/gif'
            ? '.gif'
            : mediaType === 'image/webp'
              ? '.webp'
              : mediaType === 'image/jpeg'
                ? '.jpg'
                : '.png';
        let index = saved.length + 1;
        let stickerName = `${prefix}_${index}`;
        while (listStickers().includes(stickerName)) stickerName = `${prefix}_${index++}`;
        writeFileSync(join(stickerDir, `${stickerName}${extension}`), bytes);
        saved.push(stickerName);
      } catch {
        /* next */
      }
    }
    log(`page harvest "${prefix}": ${saved.length} saved from ${urls.size} urls`);
    return saved;
  }

  /** 表情包的情绪分组。 */
  const STICKER_GROUPS = ['开心', '难过', '生气', '疑惑', '害羞', '摆烂', '日常', '互动', '其他'];

  /** 让模型看一眼这张表情包：写一句释义，并归到一个情绪分组。 */
  async function classifySticker(name) {
    const file = resolveSticker(name);
    if (file === null) return null;
    const llm = ctx.get('llm');
    const attachments = ctx.get('attachments');
    if (llm === undefined || attachments === undefined) return null;
    const bytes = readFileSync(file);
    const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
    if (mediaType === null) return null;
    let provider = cfg.model?.provider ?? 'deepseek-account';
    let model = cfg.model?.model ?? 'deepseek-flash';
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (selection?.provider) provider = selection.provider;
      if (selection?.model) model = selection.model;
    } catch {
      /* keep fallback */
    }
    const ref = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name: 'classify' });
    let text = '';
    for (let attempt = 0; attempt < 2 && text.trim() === ''; attempt += 1) {
      const stream = llm.stream({
        provider,
        model,
        system:
          '看这张表情包，输出紧凑 JSON：{"desc":"25 字内说画面和情绪","group":"' +
          STICKER_GROUPS.join('、') +
          ' 里选一个"}。只输出 JSON。',
        messages: [{ role: 'user', content: [{ type: 'image', attachment: ref }] }],
        maxTokens: 200,
        signal: AbortSignal.timeout(45000),
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text;
      }
    }
    const descMatch = text.match(/"desc"\s*:\s*"([^"]*)"/);
    const groupMatch = text.match(/"group"\s*:\s*"([^"]*)"/);
    const raw = groupMatch?.[1] ?? '';
    const aliases = {
      搞笑: '开心', 沙雕: '开心', 哈哈: '开心', 得意: '开心', 高兴: '开心',
      哭: '难过', 委屈: '难过', 伤心: '难过', 泪: '难过',
      无语: '摆烂', 嫌弃: '摆烂', 翻白眼: '摆烂', 摆烂: '摆烂', 躺平: '摆烂',
      惊讶: '疑惑', 震惊: '疑惑', 疑惑: '疑惑', 问号: '疑惑',
      吃饭: '日常', 吃: '日常', 睡: '日常', 摸鱼: '日常', 加班: '日常',
      亲: '害羞', 喜欢: '害羞', 比心: '害羞', 害羞: '害羞', 爱心: '害羞',
      加油: '互动', 摸摸: '互动', 抱: '互动', 贴贴: '互动', 聊天: '互动',
      生气: '生气', 愤怒: '生气', 炸毛: '生气', 骂: '生气',
    };
    const group =
      STICKER_GROUPS.find((item) => raw.includes(item)) ??
      Object.entries(aliases).find(([keyword]) => raw.includes(keyword))?.[1] ??
      '其他';
    const desc = (descMatch?.[1] ?? '').replace(/["\\]/g, '').trim().slice(0, 30);
    return { desc, group };
  }

  /** 批量识别 + 分组，一次 limit 张。 */
  async function classifyStickers(limit = 8, force = false) {
    const classified = [];
    for (const name of listStickers()) {
      if (classified.length >= limit) break;
      const current = settings.stickerGroup[name];
      // force=true 时连「其他」也重判一次（多半是分组词没认出来）
      if (!(force && current === '其他') && typeof current === 'string' && current !== '') continue;
      try {
        const result = await classifySticker(name);
        if (result === null) continue;
        if (result.desc !== '') stickerNotes[name] = result.desc;
        settings.stickerGroup[name] = result.group;
        if (!settings.stickerGroups.includes(result.group)) settings.stickerGroups.push(result.group);
        classified.push({ name, group: result.group, desc: result.desc });
      } catch (error) {
        log(`classify failed (${name}): ${error?.message ?? error}`);
      }
    }
    if (classified.length > 0) {
      saveStickerNotes();
      saveSettings();
      log(`stickers classified: ${classified.map((item) => `${item.name}→${item.group}`).join('、')}`);
    }
    return classified;
  }

  /** 判断候选图和原图是不是同一个角色/同一套图；不是就删掉。 */
  async function pruneStickersBySimilarity(ref, names) {
    const llm = ctx.get('llm');
    const attachments = ctx.get('attachments');
    if (llm === undefined || attachments === undefined || names.length === 0) return names;
    let provider = cfg.model?.provider ?? 'deepseek-account';
    let model = cfg.model?.model ?? 'deepseek-flash';
    try {
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (selection?.provider) provider = selection.provider;
      if (selection?.model) model = selection.model;
    } catch {
      /* keep fallback */
    }
    const kept = [];
    for (const name of names) {
      const file = resolveSticker(name);
      if (file === null) continue;
      try {
        const bytes = readFileSync(file);
        const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
        if (mediaType === null) continue;
        const candidate = await attachments.saveImage({ data: new Uint8Array(bytes), mediaType, name: 'candidate' });
        let answer = '';
        const stream = llm.stream({
          provider,
          model,
          system: '看两张表情包，判断第二张是不是和第一张同一个角色、或者同一套图。只回答「是」或「不是」。',
          messages: [
            { role: 'user', content: [{ type: 'image', attachment: ref }, { type: 'image', attachment: candidate }] },
          ],
          maxTokens: 20,
          signal: AbortSignal.timeout(45000),
        });
        for await (const chunk of stream) {
          if (chunk.type === 'text-delta') answer += chunk.text;
        }
        if (/^是/.test(answer.trim())) {
          kept.push(name);
        } else {
          unlinkSync(file);
          log(`sticker rejected (different character): ${name}`);
        }
      } catch (error) {
        log(`similarity check failed (${name}): ${error?.message ?? error}`);
        kept.push(name);
      }
    }
    return kept;
  }

  /** 让模型看图，给出搜图用的中文关键词（不是描述画面）。 */
  async function stickerKeywordsFromImage(image) {
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
    let text = '';
    // llm.stream 只认 durable attachment，所以先把图存成附件再引用。
    const attachments = ctx.get('attachments');
    if (attachments === undefined) throw new Error('attachments 服务不可用');
    const ref = await attachments.saveImage({
      data: new Uint8Array(Buffer.from(image.data, 'base64')),
      mediaType: image.mediaType,
      name: image.name ?? 'sticker',
    });
    // 偶尔会返回空文本，重试一次再放弃。
    for (let attempt = 0; attempt < 2 && text.trim() === ''; attempt += 1) {
      const stream = llm.stream({
        provider,
        model,
        system:
          '你会看表情包。给一张图，输出紧凑 JSON：' +
          '{"desc":"一句话说画面和情绪","caption":"图上的主要台词，原样抄，没有就空字符串",' +
          '"keywords":["3个中文短词，各不超过8个字，用来搜同类表情包"]}。只输出 JSON。',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', attachment: ref },
              { type: 'text', text: '这张图想表达什么？给我搜同类表情包要用的关键词。' },
            ],
          },
        ],
        maxTokens: 500,
        signal: AbortSignal.timeout(60000),
      });
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta') text += chunk.text;
        if (chunk.type === 'finish' && chunk.reason?.kind === 'error') {
          throw new Error(chunk.reason.failure?.message ?? '看图失败');
        }
      }
    }
    if (text.trim() === '') log('vision returned empty text (twice)');
    // 模型输出可能被截断，逐字段抓，不依赖整体 JSON.parse。
    const cleanKeyword = (value) =>
      String(value)
        .replace(/["{}[\]\\]/g, '')
        .replace(/^desc[:：]?/i, '')
        .trim()
        .slice(0, 10);
    const descMatch = text.match(/"desc"\s*:\s*"([^"]*)"/);
    const captionMatch = text.match(/"caption"\s*:\s*"([^"]*)"/);
    const keywordBlock = text.match(/"keywords"\s*:\s*\[([\s\S]*?)(?:\]|$)/);
    let keywords = [];
    if (keywordBlock !== null) {
      keywords = [...keywordBlock[1].matchAll(/"([^"]*)"/g)]
        .map((item) => cleanKeyword(item[1]))
        .filter((item) => item !== '');
    }
    keywords = [...new Set(keywords)].slice(0, 4);
    const caption = (captionMatch?.[1] ?? '').replace(/["\\]/g, '').trim().slice(0, 30);
    if (descMatch === null && keywords.length === 0) {
      const plain = cleanKeyword(text);
      return { desc: plain, caption, keywords: plain === '' ? [] : [plain] };
    }
    return { desc: (descMatch?.[1] ?? '').slice(0, 80), caption, keywords };
  }

  /** 以图搜图：先拿图上的台词原句搜，再按关键词补；都是同一角色的图概率更高。 */
  async function searchStickersByImage(image, limit = 4) {
    const { desc, caption, keywords } = await stickerKeywordsFromImage(image);
    const added = [];
    const queries = [];
    if (typeof caption === 'string' && caption.length >= 4) queries.push(caption);
    queries.push(...keywords);
    for (const query of queries) {
      if (added.length >= limit) break;
      const got = await searchStickers(query, Math.min(2, limit - added.length));
      added.push(...got);
    }
    if (added.length === 0 && desc !== '') {
      const got = await searchStickers(desc.slice(0, 12), 2);
      added.push(...got);
    }
    // 搜回来的常常只是「梗相似」的别的图，再让模型看一眼是不是同一个角色。
    let kept = added;
    if (added.length > 0) {
      try {
        const attachments = ctx.get('attachments');
        if (attachments !== undefined) {
          const ref = await attachments.saveImage({
            data: new Uint8Array(Buffer.from(image.data, 'base64')),
            mediaType: image.mediaType,
            name: 'reference',
          });
          kept = await pruneStickersBySimilarity(ref, added.slice(0, limit));
        }
      } catch (error) {
        log(`similarity pass skipped: ${error?.message ?? error}`);
      }
    }
    log(
      `sticker by image: caption="${caption ?? ''}" keywords="${keywords.join('、')}" ` +
        `desc="${desc}" added ${added.length} kept ${kept.length}`,
    );
    return { desc, caption, keywords, added: kept };
  }

  /** 给她一个真实的「现在」，而不是让她猜。 */
  function clockStamp() {
    const now = new Date();
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const pad = (value) => String(value).padStart(2, '0');
    return `（现在是 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())} ${weekdays[now.getDay()]}）`;
  }

  /**
   * 号主用自然语言让她改设置时，她回一句 [设置:键=值]，桥接负责落地。
   * 只认下面这些键——面板能改什么，她就能改什么。
   */
  function applyOwnerMarker(chat, key, value) {
    const raw = String(key ?? '').trim();
    const val = String(value ?? '').trim();
    switch (raw) {
      case '语音':
        settings.voice.enabled = !/^(关|off|否|0)$/i.test(val);
        saveSettings();
        return `语音已${settings.voice.enabled ? '打开' : '关闭'}`;
      case '表情':
        settings.stickers.enabled = !/^(关|off|否|0)$/i.test(val);
        saveSettings();
        return `表情包已${settings.stickers.enabled ? '打开' : '关闭'}`;
      case '主动':
        settings.toggles = { ...settings.toggles, proactive: !/^(关|off|否|0)$/i.test(val) };
        cfg.proactive = settings.toggles.proactive ? cfg.proactive ?? normalizeProactive({}) : null;
        saveSettings();
        return `主动找你已${settings.toggles.proactive ? '打开' : '关闭'}`;
      case '档位': {
        const level = { 省: 'eco', 标准: 'standard', 高: 'high', 最高: 'max' }[val] ?? val;
        if (!['eco', 'standard', 'high', 'max'].includes(level)) return '档位只认 省/标准/高/最高';
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
        return `档位已切到 ${level}（${INTELLIGENCE_EFFORT[level]}）`;
      }
      case '搜索': {
        if (!['host', 'wikipedia', 'ddg', 'searx'].includes(val)) return '搜索源只认 host/wikipedia/ddg/searx';
        settings.search = { ...settings.search, engine: val };
        saveSettings();
        return `搜索已切到 ${val}`;
      }
      case '白名单': {
        const match = val.match(/^(加|删)\s*(\d{5,12})$/);
        if (match === null) return '白名单用法：加/删 + QQ 号';
        const list = new Set(settings.whitelist.length > 0 ? settings.whitelist : effectiveUsers());
        if (match[1] === '加') list.add(match[2]);
        else list.delete(match[2]);
        settings.whitelist = [...list];
        saveSettings();
        return `${match[1] === '加' ? '已加入' : '已移出'}白名单：${match[2]}`;
      }
      case '人设': {
        if (val === '') return '人设不能是空的';
        const persona = activePersona();
        const custom = settings.personae.find((item) => item.id === persona.id);
        if (custom !== undefined) {
          custom.prompt = val;
          saveSettings();
        } else if (persona.id === 'whale') {
          settings.presetPrompts[persona.id] = val;
          saveSettings();
        } else {
          return '当前是跟随配置模式，先选一个人设';
        }
        for (const key2 of Object.keys(state.chats)) delete state.chats[key2];
        chats.clear();
        saveState();
        return '人设改好了，下一条生效';
      }
      case '记忆':
        if (val === '清除') {
          delete memories[chat.key];
          saveMemories();
          return '这段记忆清了';
        }
        return '记忆只支持：清除';
      default:
        return `没有「${raw}」这个设置`;
    }
  }

  /**
   * 她没看懂 → 查 → 用她自己的口吻接着答。
   * 查询和资料都留在这一侧：对方只看到一句自然回复。
   */
  async function replyAfterLookup(chat, draft) {
    try {
      const terms = [...String(draft).matchAll(/\[查[:：]\s*([^\]\n]{1,24})\]/g)].map((match) => match[1].trim());
      const queries = terms.length > 0 ? terms.slice(0, 2) : [String(chat.lastText ?? '').trim().slice(0, 40)];
      log(`silent lookup: ${queries.join(' / ')}`);
      let material = '';
      for (const term of queries) {
        if (term === '') continue;
        const part = await collectSearchMaterial(term);
        if (part !== '') material += `\n【${term}】\n${part}`;
        if (material.length > 2600) break;
      }
      const body = String(draft)
        .replace(/\[查[:：][^\]\n]{1,24}\]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (material.trim() === '') {
        log('silent lookup: nothing found, sent the draft answer');
        sendText(chat, body !== '' ? body : '这个我真没查到，换个说法？');
        return;
      }
      const persona = activePersona();
      let personaPrompt = persona.prompt;
      if (personaPrompt === '' && persona.id === 'whale') {
        personaPrompt = settings.presetPrompts[persona.id] ?? readPresetPrompt(persona.id);
      }
      const base = (settings.basePersona !== '' ? settings.basePersona : DEFAULT_BASE_PERSONA).trim();
      const system = [
        base === '' ? '' : `【底层准则】\n${base}`,
        personaPrompt,
        '刚才有个词你没看懂，已经查过资料了。现在用你自己的口吻接着说你的话：两三条短句，' +
          '别提交过、别复述资料、别写「查」「搜」这类字。',
      ]
        .filter((part) => part !== '')
        .join('\n\n');
      const recent = messages
        .filter((entry) => entry.chat === chat.key)
        .slice(-6)
        .map((entry) => `${entry.dir === 'in' ? '他' : '你'}：${String(entry.text ?? '').slice(0, 120)}`)
        .join('\n');
      const reply = await askModel(
        system,
        `聊天记录：\n${recent}\n\n他刚说：${chat.lastText}\n\n刚查到的资料：\n${material}`,
        400,
      );
      const cleaned = reply.replace(/\[查[:：][^\]\n]{1,24}\]/g, '').trim();
      log('silent lookup: replied in her own words');
      sendText(chat, cleaned !== '' ? cleaned : body !== '' ? body : '这个我真没查到，换个说法？');
    } catch (error) {
      log(`lookup reply failed: ${error?.message ?? error}`);
      sendText(chat, '嗯…这个我一时说不上来');
    }
  }

  /* ---------------- 自主行为（L1 + L2） ---------------- */

  const AUTONOMY_DEFAULTS = {
    enabled: false,
    signature: true,
    nickname: false,
    qzone: false,
    initiate: true,
    maxPerDay: { signature: 1, nickname: 1, qzone: 1, chats: 3 },
    minGapMinutes: 45,
    wakeStart: 9,
    wakeEnd: 23,
    maxChars: 120,
  };

  function autonomyConfig() {
    const saved = settings.autonomy ?? {};
    return {
      ...AUTONOMY_DEFAULTS,
      ...saved,
      maxPerDay: { ...AUTONOMY_DEFAULTS.maxPerDay, ...(saved.maxPerDay ?? {}) },
    };
  }

  function todayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  function autonomyState() {
    state.autonomy = state.autonomy ?? {};
    const today = todayKey();
    if (state.autonomy.day !== today) {
      state.autonomy = { day: today, counts: { signature: 0, nickname: 0, qzone: 0, chats: 0 }, lastActionAt: 0, log: [] };
    }
    state.autonomy.counts = state.autonomy.counts ?? { signature: 0, nickname: 0, qzone: 0, chats: 0 };
    state.autonomy.log = Array.isArray(state.autonomy.log) ? state.autonomy.log : [];
    return state.autonomy;
  }

  function autonomyAllowed(kind) {
    const config = autonomyConfig();
    if (!config.enabled) return false;
    const hour = new Date().getHours();
    if (hour < config.wakeStart || hour >= config.wakeEnd) return false;
    const auto = autonomyState();
    const cap = config.maxPerDay[kind] ?? 0;
    if ((auto.counts[kind] ?? 0) >= cap) return false;
    if (kind !== 'chats' && auto.lastActionAt !== 0 && Date.now() - auto.lastActionAt < config.minGapMinutes * 60000) {
      return false;
    }
    return true;
  }

  /** 内容底线：明显违规的直接拒，不指望模型自觉。 */
  const AUTONOMY_BLOCKLIST = [
    '习近平', '共产党', '政治', '游行', '暴动', '色情', '裸', '约炮', '赌博', '博彩', '毒品', '冰毒',
    '枪支', '炸药', '恐怖', '法轮', '台独', '港独', '反华', '自杀', '汇款', '转账', '加微信',
    '扫码', '返利', '代购', '刷单', '兼职日结',
  ];

  function autonomyContentOk(text) {
    const body = String(text ?? '').trim();
    if (body === '') return '内容为空';
    const config = autonomyConfig();
    if (body.length > config.maxChars) return `太长了（${body.length} > ${config.maxChars}）`;
    const hit = AUTONOMY_BLOCKLIST.find((word) => body.includes(word));
    if (hit !== undefined) return `含敏感词「${hit}」`;
    if (/https?:\/\/|www\./i.test(body)) return '不要带链接';
    return null;
  }

  /** 改签名（NapCat 的 longnick 接口）。 */
  async function setSignature(text) {
    await request('set_self_longnick', { longNick: text }, 15000);
    log(`autonomy: signature -> ${text}`);
    return true;
  }

  /** 改昵称。 */
  async function setNickname(text) {
    await request('set_qq_profile', { nickname: text }, 15000);
    log(`autonomy: nickname -> ${text}`);
    return true;
  }

  /** 发一条 QQ 空间说说（cookie + g_tk，非官方接口，会过期）。 */
  async function publishQzone(text) {
    const [cookies, csrf] = await Promise.all([
      request('get_cookies', { domain: 'qzone.qq.com' }, 15000),
      request('get_csrf_token', {}, 15000),
    ]);
    const cookieHeader = String(cookies?.cookies ?? '');
    const token = Number(csrf?.token ?? 0);
    if (cookieHeader === '' || token === 0) throw new Error('拿不到 cookie 或 token');
    const skeyMatch = cookieHeader.match(/(?:^|;\s*)skey=([^;]+)/);
    const skey = skeyMatch === null ? '' : skeyMatch[1];
    let hash = 5381;
    for (const char of skey) hash += (hash << 5) + char.charCodeAt(0);
    const bkn = (hash & 0x7fffffff) >>> 0;
    const body = new URLSearchParams({
      syn_tweet_verson: '1',
      paramstr: '1',
      who: '1',
      con: text,
      feedversion: '1',
      ver: '1',
      ugc_right: '1',
      to_sign: '0',
      hostuin: String(lastSelfId),
      code_version: '1',
      format: 'json',
      qzreferrer: `https://user.qzone.qq.com/${lastSelfId}`,
    }).toString();
    const response = await fetch(
      `https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?g_tk=${bkn}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          cookie: cookieHeader,
          referer: `https://user.qzone.qq.com/${lastSelfId}`,
          'user-agent': USER_AGENT,
        },
        body,
        signal: AbortSignal.timeout(20000),
      },
    );
    const raw = await response.text();
    if (!response.ok) throw new Error(`空间接口 HTTP ${response.status}`);
    let parsed = null;
    try {
      parsed = JSON.parse(raw.replace(/^[^{]*/, ''));
    } catch {
      /* jsonp 包装 */
    }
    if (parsed !== null && parsed.code !== undefined && Number(parsed.code) !== 0) {
      throw new Error(`空间接口返回 code=${parsed.code} ${parsed.message ?? ''}`);
    }
    log(`autonomy: qzone posted (${text.length} chars)`);
    return { ok: true };
  }

  /** 事后复盘：她刚才那句话是怎么想出来的（模型不会保留思考过程，只能回头问）。 */
  async function reflectOnTurn(chat, userText, spoken) {
    if (settings.autonomy?.reflect === false) return null;
    if (String(userText).trim() === '' || String(spoken).trim() === '') return null;
    const answer = await askModel(
      '你在复盘自己刚才的回复。用两三句话、第一人称写下你当时在想什么：' +
        '你在意他哪句话、你判断他是什么情绪、你为什么选这个语气和这个内容。' +
        '不要复述你回复的原文，不要总结整段对话，只写当时脑子里的念头。',
      '他说：' + String(userText).slice(0, 200) + '\n你回：' + String(spoken).slice(0, 200) + '\n你当时在想什么？',
      300,
    );
    const thinking = String(answer).trim();
    if (thinking === '') return null;
    state.thoughtLog = Array.isArray(state.thoughtLog) ? state.thoughtLog : [];
    state.thoughtLog.unshift({
      at: Date.now(),
      chat: chat.key,
      thinking: thinking.slice(0, 1200),
      reply: String(spoken).slice(0, 200),
    });
    state.thoughtLog = state.thoughtLog.slice(0, 40);
    saveState();
    return thinking;
  }

  /** 让她自己决定这一轮要不要做点什么。 */
  async function autonomyTick(manual = false, options = {}) {
    const config = autonomyConfig();
    if (!config.enabled && !manual) return { skipped: 'disabled' };
    const auto = autonomyState();
    const roster = effectiveUsers()
      .map((user) => {
        const note = settings.userNotes[user];
        const last = messages.filter((entry) => entry.chat === `private:${user}`).slice(-1)[0];
        const idle = last === undefined ? 999 : Math.round((Date.now() - last.time) / 60000);
        return `${note ?? '尾号' + user.slice(-4)}：上次说话 ${idle} 分钟前`;
      })
      .join('\n');
    // 规则先判断「现在有没有值得做的事」，模型只负责写内容——这样行为可预测、可测试。
    const hour = Number(String(options.clock ?? '').slice(11, 13));
    const nowHour = Number.isFinite(hour) && hour > 0 ? hour : new Date().getHours();
    const candidates = [];
    const countsView = options.budget ?? (options.freshBudget === true ? { chats: 0, qzone: 0, signature: 0, nickname: 0 } : auto.counts);
    if (config.initiate === true && (countsView.chats ?? 0) < (config.maxPerDay.chats ?? 0)) {
      const idle = effectiveUsers()
        .map((user) => {
          const last = messages.filter((entry) => entry.chat + '' === 'private:' + user).slice(-1)[0];
          const real = last === undefined ? 999 : Math.round((Date.now() - last.time) / 60000);
          return { user, minutes: typeof options.fakeIdle === 'number' ? options.fakeIdle : real };
        })
        .filter((item) => item.minutes >= 120)
        .sort((a, b) => b.minutes - a.minutes)[0];
      if (idle !== undefined) candidates.push({ action: 'chat', target: idle.user, minutes: idle.minutes });
    }
    if (
      config.qzone === true &&
      (countsView.qzone ?? 0) < (config.maxPerDay.qzone ?? 0) &&
      [11, 12, 17, 18, 22].includes(nowHour)
    ) {
      candidates.push({ action: 'qzone' });
    }
    if (config.signature === true && (countsView.signature ?? 0) < (config.maxPerDay.signature ?? 0)) {
      candidates.push({ action: 'signature' });
    }
    if (candidates.length === 0) {
      auto.lastActionAt = Date.now();
      saveState();
      return { action: 'none', reason: '没有触发条件' };
    }
    const pick = candidates[0];
    const choices = [];
    if (pick.action === 'signature') choices.push('- signature：改个性签名（一句话，20 字内，像人随手写的）');
    if (pick.action === 'qzone') choices.push('- qzone：发一条说说（40 字内，生活化，不涉及政治/广告/链接）');
    if (pick.action === 'chat') choices.push('- chat：主动找某个人说话（只能找下面列表里的人，优先找最久没说话的那个）');
    const system = [
      '你是这个 QQ 号的主人，现在没人跟你说话，你可以决定做点什么。',
      `现在时间：${options.clock ?? clockStamp()}`,
      '可选动作（只能从下面选一个，没列出来的就是没开、别选）：',
      ...choices,
      '输出 JSON：{"action":"...","text":"...","target":"备注或尾号","reason":"一句为什么"}',
      '按上面的要求，现在就做这一件事；内容要具体，别像模板。',

      `今天已经做过：${(auto.log ?? [])
        .slice(0, 5)
        .map((item) => item.action)
        .join('、') || '还没有'}`,
      `可找的人：\n${roster}`,
    ].join('\n');
    const answer = await askModel(system, '现在做什么？', 400);
    let decision = { action: 'none' };
    try {
      const match = answer.match(/\{[\s\S]*\}/);
      if (match !== null) decision = JSON.parse(match[0]);
    } catch {
      /* 解析失败就当不做 */
    }
    // 规则已经挑好动作，模型只负责写内容；它答歪了就按规则的动作走。
    const action = pick.action;
    const reason = String(decision.reason ?? '').slice(0, 120);
    if (action === 'none') {
      auto.lastActionAt = Date.now();
      saveState();
      return { action: 'none' };
    }
    const text = String(decision.text ?? '').trim();
    const problem = autonomyContentOk(text);
    if (problem !== null) {
      log(`autonomy: rejected ${action} (${problem})`);
      return { action, rejected: problem };
    }
    const bucket = action === 'chat' ? 'chats' : action;
    const switchedOn = action === 'chat' ? config.initiate === true : config[action] === true;
    // 模拟模式：只回报判断，不真的执行；但要占用模拟额度，才能看出一天会做几次。
    if (options.dryRun === true) {
      const allowed = switchedOn && (manual || autonomyAllowed(bucket));
      if (options.budget !== undefined) options.budget[bucket] = (options.budget[bucket] ?? 0) + 1;
      return {
        action,
        text: text.slice(0, 80),
        reason,
        target: String(decision.target ?? ''),
        wouldRun: allowed,
      };
    }
    if (!switchedOn) return { action, rejected: '这个动作没开' };
    // 手动点「想一次」= 你本人要求的，跳过每日额度和最小间隔，只看开关。
    if (!manual && !autonomyAllowed(bucket)) return { action, skipped: 'budget-or-window' };
    try {
      if (action === 'signature') await setSignature(text);
      else if (action === 'nickname') await setNickname(text);
      else if (action === 'qzone') await publishQzone(text);
      else if (action === 'chat') {
        const target = resolveTargetUser(String(decision.target ?? ''));
        if (target === '' || !effectiveUsers().includes(target)) return { action, rejected: 'target-not-allowed' };
        await admit(
          { key: `private:${target}`, kind: 'private', chatId: target, userId: target, sendChain: Promise.resolve() },
          text,
          { post_type: 'message', message_type: 'private', user_id: Number(target), message: [], raw_message: text },
        );
      } else {
        return { action, rejected: 'unknown-action' };
      }
    } catch (error) {
      const message = String(error?.message ?? error);
      auto.lastError = { at: Date.now(), action, message: message.slice(0, 200) };
      saveState();
      log(`autonomy: ${action} failed: ${message}`);
      return { action, error: message };
    }
    auto.counts[bucket] = (auto.counts[bucket] ?? 0) + 1;
    auto.lastActionAt = Date.now();
    auto.log.unshift({
      at: Date.now(),
      action,
      text: text.slice(0, 80),
      target: String(decision.target ?? ''),
      reason: String(decision.reason ?? '').slice(0, 120),
    });
    auto.log = auto.log.slice(0, 20);
    saveState();
    log(`autonomy: did ${action} -> ${text.slice(0, 40)}`);
    return { action, ok: true };
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
          const toOne = perms.send ? chunk.match(/^\s*\[发送[:：]\s*([^|\]\n]{1,24})\s*\|\s*([\s\S]{1,300})\]\s*$/) : null;
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
            ? chunk.match(/^\s*\[定时[:：]\s*(\d{1,4})\s*\|\s*([^|\]\n]{1,24})\s*\|\s*([\s\S]{1,300})\]\s*$/)
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
        // `[图:关键词]` 发一张真实照片（不是表情包）。
        const photoCommand = chunk.match(/^\s*\[图[:：]\s*([^\]\n]{1,30})\]\s*$/);
        if (photoCommand !== null) {
          try {
            const file = await searchPhoto(photoCommand[1].trim());
            if (file !== null) sendSegments(chat, [{ type: 'image', data: { file } }]);
            else log(`photo not found: ${photoCommand[1]}`);
          } catch (error) {
            log(`photo send failed: ${error?.message ?? error}`);
          }
          continue;
        }
        // `[表情包:搜图]` 用他刚发的那张图去找同类表情包。
        const visualSearch = chunk.match(/^\s*\[表情包[:：]\s*搜图\s*\]\s*$/);
        if (visualSearch !== null) {
          if (!chat.lastImage) {
            sendText(chat, '你发张图，我照着找');
            continue;
          }
          try {
            const { added } = await searchStickersByImage(chat.lastImage, 2);
            for (const name of added) {
              const file = resolveSticker(name);
              if (file !== null) sendSegments(chat, [{ type: 'image', data: { file } }]);
              await new Promise((resolve) => setTimeout(resolve, 700));
            }
          } catch (error) {
            log(`sticker by image failed: ${error?.message ?? error}`);
          }
          continue;
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
        // `[查:词]` 不再单独发一条查询结果：整条回复交给 replyAfterLookup，
        // 查完用她自己的话答（turn/end 里统一处理）。
        // `[语音]` turns one burst into a voice message; without TTS enabled or
        // a successful render it degrades to plain text instead of vanishing.
        let voiceFile = null;
        if (/^\s*\[语音\]/.test(chunk)) {
          const spoken = chunk.replace(/^\s*\[语音\]\s*/, '');
          if (settings.voice.enabled && spoken !== '') {
            try {
              voiceFile = await synthesizeVoice(spoken);
            } catch (error) {
              // 失败也得让人知道原因，不然面板上只看到「语音开着却没声音」。
              settings.voice.lastError = String(error?.message ?? error).slice(0, 200);
              settings.voice.lastErrorAt = Date.now();
              saveSettings();
              log(`voice failed: ${settings.voice.lastError}`);
            }
            if (voiceFile !== null) {
              chunk = spoken;
              settings.voice.lastError = '';
              saveSettings();
            }
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
          const payload = JSON.parse(text);
          // OneBot 的 API 回包带 echo，先在待办里认领。
          if (typeof payload?.echo === 'string' && pendingCalls.has(payload.echo)) {
            const entry = pendingCalls.get(payload.echo);
            pendingCalls.delete(payload.echo);
            clearTimeout(entry.timer);
            if (payload.status === 'ok' || payload.retcode === 0) entry.resolve(payload.data);
            else entry.reject(new Error(`${entry.name}: ${payload.message ?? payload.wording ?? payload.retcode}`));
            return;
          }
          handlePayload(payload);
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

  /** 开场白一改就要换会话，所以版本号把开场白也算进去。 */
  function preambleRev() {
    return `${cfg.presetRev}.${PREAMBLE_REV}`;
  }

  async function ensureSession(chat) {
    const known = state.chats[chat.key];
    const persona = activePersona();
    // A different persona — or a revised preset — means a different person:
    // start a fresh Session instead of talking to the old one.
    const samePreset =
      (known?.preset ?? '') === persona.id &&
      (known?.rev ?? '') === preambleRev() &&
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
        rev: preambleRev(),
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
        // 只给备注 + 尾号：完整号码没必要进模型上下文。
        const roster = effectiveUsers()
          .filter((user) => !settings.owners.includes(user))
          .map((user) => {
            const note = settings.userNotes[user];
            return note ? `${note}（尾号${user.slice(-4)}）` : `尾号${user.slice(-4)}`;
          })
          .join('、');
        const lines = ['【号主模式】现在跟你说话的是号主本人，你有额外权限，可以直接替他办事：'];
        if (settings.ownerPerms.send) {
          lines.push(`- 给某人发消息：[发送:QQ号|要说的话]（可发给：${roster || '（白名单里只有他自己）'}）`);
        }
        if (settings.ownerPerms.broadcast) lines.push('- 同时群发：[群发:要说的话]');
        if (settings.ownerPerms.schedule) lines.push('- 定时发送：[定时:分钟|QQ号|要说的话]');
        lines.push('- 也可以直接回答他的话、改主意、拒绝；办完事回一句就行，别复述指令。');
        lines.push(
          '- **他让你改设置时你可以直接改**：回一句 `[设置:键=值]`，桥接会真的写进去。可用的键：' +
            '`语音=开/关`、`表情=开/关`、`主动=开/关`、`档位=省/标准/高/最高`、' +
            '`搜索=host/wikipedia/ddg/searx`、`白名单=加 1234567`、`白名单=删 1234567`、`人设=一段话`、`记忆=清除`。',
        );
        lines.push(
          '- 设置标签只是给你用的记号，用户看不到；改完用你自己的话说一句「好了」就行，别把标签念出来。',
        );
        lines.push(
          [
            '- 管理面板里有这些，他问你的时候你要答得上来（别整段背给他听）：',
            '概览：连接状态、本地快速登录、开机自启、机器人账号、最近日志；',
            '发消息：用你的身份手动发文字/语音/表情；',
            '监听：你们所有来往记录，按对话分组、按方向筛选；',
            '人设：底层性格、两套预设人设（文本能直接改）、自定义人设、试聊；',
            '联系人：号主、允许私聊的 QQ、允许的群；',
            '素材：表情包（分组/停用/联网搜图/以图搜同款）、语音引擎与音色；',
            '记忆：多少轮压缩一次、已存记忆、记忆文件位置、缓存与大扫除；',
            '模型：智力档位、用哪个模型、主动行为与勿扰时段、搜索引擎。',
            '- 他能让你改的只有：语音、表情、主动、档位、搜索、白名单、人设、记忆。',
            '别的设置一律让他去面板点，别假装能改。',
          ].join('\n'),
        );
        lines.push(
          '- 【你自己能干的事】除了聊天，你还能改个性签名、发 QQ 空间说说、主动找人说话（只在白名单里）。' +
            '这些在面板「自主」页由他控制开关和频率；他说不行就是不行。',
        );
        lines.push(
          '- **代发时别提号主**：不要说「号主让我跟你说」「他让我转告」「号主说」，也不要署名或加括号说明。' +
            '就直接用你自己的口吻把话说完，对方看起来就是你在跟他说话。',
        );
        preambleParts.push(lines.join('\n'));
      }
      const stickerNames = listStickers().filter((name) => !settings.stickerDisabled.includes(name));
      if (settings.stickers.enabled === true && stickerNames.length > 0) {
        // 226 张全列出来太费 token：按组给几张示例，其余按组随机抽。
        const byGroup = new Map();
        for (const name of stickerNames) {
          const group = settings.stickerGroup[name] ?? '';
          if (!byGroup.has(group)) byGroup.set(group, []);
          byGroup.get(group).push(name);
        }
        const summary = [...byGroup.entries()]
          .map(([group, names]) => {
            const samples = names
              .slice(0, 5)
              .map((name) => (stickerNotes[name] ? `${name}（${stickerNotes[name]}）` : name));
            return `${group === '' ? '其他' : group}（${names.length}张）：${samples.join('、')}`;
          })
          .join('\n');
        preambleParts.push(
          `【手边的表情包】共 ${stickerNames.length} 张，按情绪分组：\n${summary}\n` +
            '用 [表情包:名字] 发指定那张；写 [表情包:组名]（例如 [表情包:生气]）就从那一组随机抽一张——这是最自然的用法。' +
            '想让桥接上网找新的，写 [表情包:搜 关键词]；找跟他刚发那张类似的，写 [表情包:搜图]。',
        );
      }
      if (settings.stickers.enabled === true) {
        preambleParts.push(
          '【拍照/找图】他聊到吃的、天气、风景、猫狗、自己在干什么的时候，你可以直接发一张真实照片：' +
            '写 [图:关键词]，例如 [图:精致摆盘的日式料理]、[图:下雨的城市街道]。一次一张，配一句短话。',
        );
      }
      const remembered = memories[chat.key]?.text;
      if (typeof remembered === 'string' && remembered !== '') {
        preambleParts.push(`【你们之前聊过的，记着这些】\n${remembered}`);
      }
      // 会话可能是重建的（换人设/压缩/重启）。把监听里最近的几句带上，别像失忆。
      const recentLines = messages
        .filter((entry) => entry.chat === chat.key && typeof entry.text === 'string' && entry.text !== '[图片]')
        .slice(-8)
        .map((entry) => `${entry.dir === 'in' ? '他' : '你'}：${entry.text.slice(0, 90)}`);
      if (recentLines.length > 0) {
        preambleParts.push(`【你们最近这几句】\n${recentLines.join('\n')}`);
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

    // 号主的 `/xxx` 配置指令（只改设置，不动代码）。
    if (chat.isOwner === true && /^[/／](帮助|help|状态|人设|语音|表情|主动|白名单|搜索|记忆)\b/.test(text)) {
      void handleOwnerCommand(chat, text);
      logMessage({ dir: 'in', chat: key, text: text.slice(0, 500), image: carriesImage === true });
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
      const incomingImages = content.filter((part) => part.type === 'image');
      if (incomingImages.length > 0) live.lastImage = incomingImages[incomingImages.length - 1];
      // 每轮都带上真实时间，否则她只能凭空猜早上晚上。
      content.unshift({ type: 'text', text: clockStamp() });
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

  ctx.on('session/event', async (session, event) => {
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
        // 模型自己给出的思考段落（有就记下来，没有就空着）。
        const reasoning = reasoningOfContent(event.data.message?.content);
        if (reasoning.trim() !== '') {
          turn.reasoning = turn.reasoning === undefined ? reasoning : `${turn.reasoning}\n${reasoning}`;
        }
        return;
      }
      if (event.type === 'turn/end') {
        const turn = chat.turns.get(event.data.turn);
        chat.turns.delete(event.data.turn);
        chat.lastActivity = Date.now();
        const reason = event.data.reason ?? { kind: 'completed' };
        const spoken = (turn?.parts ?? []).join('\n\n').trim();
        // 把「她当时怎么想的」单独存一份，想法页只看这个，不重复聊天记录。
        const thinking = String(turn?.reasoning ?? '').trim();
        if (thinking !== '' && spoken !== '') {
          state.thoughtLog = Array.isArray(state.thoughtLog) ? state.thoughtLog : [];
          state.thoughtLog.unshift({
            at: Date.now(),
            chat: chat.key,
            thinking: thinking.slice(0, 1200),
            reply: spoken.slice(0, 200),
          });
          state.thoughtLog = state.thoughtLog.slice(0, 40);
          saveState();
        }
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
        let answer = spoken;
        // 号主可以让她顺手改设置：她回一句 [设置:键=值]，这里落地。
        if (chat.isOwner === true && /\[设置[:：]/.test(answer)) {
          const marks = [...answer.matchAll(/\[设置[:：]\s*([^=\]\n]{1,10})\s*=\s*([^\]\n]{1,300})\]/g)];
          const notes = [];
          for (const mark of marks) {
            try {
              notes.push(await applyOwnerMarker(chat, mark[1], mark[2]));
            } catch (error) {
              log(`owner marker failed: ${error?.message ?? error}`);
              notes.push('有个设置没改成');
            }
          }
          answer = answer.replace(/\[设置[:：][^\]]{1,330}\]/g, '').trim();
          if (answer === '') answer = notes.join('；');
          else if (notes.length > 0) log(`owner settings applied: ${notes.join('; ')}`);
        }
        if (answer === '') {
          sendText(chat, cfg.emptyReply);
          return;
        }
        // 看不懂就直接去查，查完用她自己的话答——查这件事本身不告诉对方。
        const wantsLookup =
          /\[查[:：]/.test(answer) ||
          (chat.lookupDone !== true &&
            /不知道|不晓得|不懂|没懂|搞不懂|没搞明白|没弄明白|不了解|没听过|没听说过|不清楚|说不准|没概念|查不到/.test(
              answer,
            ));
        if (wantsLookup && typeof chat.lastText === 'string' && chat.lastText.trim() !== '') {
          chat.lookupDone = true;
          void replyAfterLookup(chat, answer);
        } else {
          sendText(chat, answer);
        }
        // 回复发完再慢慢复盘她当时的想法，不拖慢回复。
        const lastInbound = messages
          .filter((entry) => entry.chat === chat.key && entry.dir === 'in')
          .slice(-1)[0];
        if (lastInbound !== undefined) {
          void reflectOnTurn(chat, String(lastInbound.text ?? ''), answer).catch((error) =>
            log(`reflect failed: ${error?.message ?? error}`),
          );
        }
        scheduleAfterthought(chat);
        maybeSendSticker(chat, chat.lastText);
        // 轮数独立于会话存在：换会话/重启都不清零，否则永远攒不到阈值。
        state.turns = state.turns ?? {};
        const turns = (state.turns[chat.key] ?? 0) + 1;
        state.turns[chat.key] = turns;
        saveState();
        if (settings.memory.enabled && turns >= settings.memory.everyTurns) {
          state.turns[chat.key] = 0;
          saveState();
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
    const builtinNames = { whale: '大米鲸鱼娘', config: '跟随配置' };
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
      version: '0.80.0',
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
      userNotes: settings.userNotes,
      accountPaused,
      accounts: settings.accounts,
      activeAccountId: settings.activeAccountId,
      stickers: settings.stickers,
      voice: settings.voice,
      cacheDir: cacheRoot,
      memory: settings.memory,
      memories,
      autonomy: { config: autonomyConfig(), state: autonomyState() },
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
      // 持久化的对话状态：即使当前没连着，也能看到轮数和记忆进度。
      chatStates: [...new Set([...Object.keys(state.chats), ...Object.keys(state.turns ?? {})])].map((key) => ({
        key,
        sessionId: state.chats[key]?.sessionId ?? '',
        turns: state.turns?.[key] ?? 0,
        updatedAt: state.chats[key]?.updatedAt ?? 0,
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
              availablePresets: ['whale'],
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
              if (patch.presetNames && typeof patch.presetNames === 'object') {
                settings.presetNames = Object.fromEntries(
                  Object.entries(patch.presetNames).map(([key, value]) => [String(key), String(value ?? '').slice(0, 30)]),
                );
              }
              if (patch.autonomy && typeof patch.autonomy === 'object') {
                const current = autonomyConfig();
                settings.autonomy = {
                  ...current,
                  ...patch.autonomy,
                  maxPerDay: { ...current.maxPerDay, ...(patch.autonomy.maxPerDay ?? {}) },
                };
              }
              if (patch.userNotes && typeof patch.userNotes === 'object' && !Array.isArray(patch.userNotes)) {
                settings.userNotes = Object.fromEntries(
                  Object.entries(patch.userNotes)
                    .map(([key, value]) => [String(key), String(value ?? '').trim().slice(0, 24)])
                    .filter(([, value]) => value !== ''),
                );
              }
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
                  'whale' === requested || settings.personae.some((item) => item.id === requested);
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
              // 上传是 base64 图片，8MB 原图 = 约 11MB 编码，别再按 8KB 拦。
              if (body.length > 12 * 1024 * 1024) req.destroy();
            });
            req.on('end', () => {
              try {
                const action = JSON.parse(body === '' ? '{}' : body);
                if (action.action === 'delete' && typeof action.name === 'string') {
                  // 表情可能是 png/gif/jpg/webp，按扩展名逐个找，别只试 png。
                  const safe = action.name.replace(/[\\/:*?"<>|]/g, '').trim();
                  const file = resolveSticker(safe);
                  if (file !== null) {
                    unlinkSync(file);
                    log(`sticker deleted: ${file}`);
                  } else {
                    log(`sticker delete: "${safe}" not found`);
                  }
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
                } else if (id === 'whale') {
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
                  name: custom?.name ?? ({ whale: '大米鲸鱼娘' }[id] ?? id),
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
                {
                  id: 'whale',
                  name: settings.presetNames?.whale || '大米鲸鱼娘',
                  prompt: readPresetPrompt('whale'),
                  override: settings.presetPrompts.whale ?? '',
                },
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
              if (id !== 'whale') throw new Error('未知预设');
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
                const preset = 'whale';
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
        path: '/im-bridge/clientlog',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 8192) req.destroy();
          });
          req.on('end', () => {
            try {
              const payload = JSON.parse(body === '' ? '{}' : body);
              log('panel: ' + String(payload.text ?? '').slice(0, 400));
            } catch {
              /* ignore malformed */
            }
            jsonResponse(res, 200, { ok: true });
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/thoughts',
        handler: (_req, res) => {
          const auto = autonomyState();
          const config = autonomyConfig();
          const decisions = (auto.log ?? []).map((item) => ({
            at: item.at,
            kind: 'decision',
            action: item.action,
            text: item.text ?? '',
            target: item.target ?? '',
            reason: item.reason ?? '',
          }));
          // 想法页只看「她怎么想的」，不重复聊天记录。
          const turns = (state.thoughtLog ?? []).map((item) => ({
            at: item.at,
            kind: 'thinking',
            chat: item.chat,
            text: item.thinking,
            reply: item.reply,
          }));
          const timeline = [...decisions, ...turns].sort((a, b) => b.at - a.at).slice(0, 30);
          jsonResponse(res, 200, {
            mood: auto.mood ?? '平静',
            enabled: config.enabled === true,
            counts: auto.counts ?? {},
            caps: config.maxPerDay,
            timeline,
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/autonomy',
        handler: (req, res) => {
          if (req.method !== 'POST') {
            jsonResponse(res, 200, { config: autonomyConfig(), state: autonomyState() });
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
                const requestBody = JSON.parse(body === '' ? '{}' : body);
                if (requestBody.action === 'tick') {
                  const result = await autonomyTick(true);
                  jsonResponse(res, 200, { ok: true, result, state: autonomyState() });
                  return;
                }
                if (requestBody.action === 'simulate') {
                  // 快速验证「一整天她会不会自己动」：按几个时间点各想一次，但都不执行。
                  const today = new Date().toISOString().slice(0, 10);
                  const slots = ['09:30', '12:30', '15:30', '18:30', '21:00'];
                  const results = [];
                  const budget = { chats: 0, qzone: 0, signature: 0, nickname: 0 };
                  for (const [index, slot] of slots.entries()) {
                    try {
                      const decision = await autonomyTick(false, {
                        clock: today + ' ' + slot,
                        dryRun: true,
                        freshBudget: true,
                        fakeIdle: 150 + index * 90,
                        budget,
                      });
                      results.push({ slot, ...decision });
                    } catch (error) {
                      results.push({ slot, error: String(error?.message ?? error) });
                    }
                  }
                  jsonResponse(res, 200, { ok: true, results });
                  return;
                }
                if (requestBody.action === 'stop') {
                  settings.autonomy = { ...autonomyConfig(), enabled: false };
                  saveSettings();
                  jsonResponse(res, 200, { ok: true, stopped: true });
                  return;
                }
                jsonResponse(res, 400, { error: 'unsupported action' });
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
        path: '/im-bridge/debug/probe',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const requestBody = JSON.parse(body === '' ? '{}' : body);
                const name = String(requestBody.action ?? '');
                const allowed = [
                  'get_login_info',
                  'get_version_info',
                  'get_cookies',
                  'get_csrf_token',
                  'get_friend_list',
                  'get_group_list',
                  'get_status',
                ];
                if (!allowed.includes(name)) throw new Error(`只允许探测：${allowed.join(', ')}`);
                const data = await request(name, requestBody.params ?? {}, 12000);
                jsonResponse(res, 200, { ok: true, action: name, data });
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
        path: '/im-bridge/stickers/classify',
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
                const limit = Math.min(30, Math.max(1, Number(request.limit) || 8));
                const classified = await classifyStickers(limit, request.force === true);
                const total = listStickers().length;
                const grouped = listStickers().filter(
                  (name) => typeof settings.stickerGroup[name] === 'string' && settings.stickerGroup[name] !== '',
                ).length;
                jsonResponse(res, 200, { ok: true, classified, total, grouped, groups: settings.stickerGroups });
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
        path: '/im-bridge/stickers/page',
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
                const url = String(request.url ?? '').trim();
                if (!/^https?:\/\//i.test(url)) throw new Error('给一个 http(s) 链接');
                const added = await harvestFromPage(url, request.name ?? 'page', Number(request.limit) || 12);
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
        path: '/im-bridge/stickers/harvest',
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
                const queries = Array.isArray(request.queries)
                  ? request.queries.map(String).filter((item) => item.trim() !== '')
                  : [String(request.query ?? '可爱 表情包')];
                if (queries.length === 0) throw new Error('给个关键词');
                const added = await harvestStickers(queries, request.name ?? queries[0], Number(request.limit) || 12);
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
        path: '/im-bridge/stickers/notes',
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
                const limit = Math.min(20, Math.max(1, Number(request.limit) || 6));
                const added = await fillStickerNotes(limit);
                const total = listStickers().length;
                const described = listStickers().filter((name) => typeof stickerNotes[name] === 'string' && stickerNotes[name] !== '').length;
                jsonResponse(res, 200, { ok: true, added, total, described, notes: stickerNotes });
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
        path: '/im-bridge/stickers/visual',
        handler: (req, res) => {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 12 * 1024 * 1024) req.destroy();
          });
          req.on('end', () => {
            void (async () => {
              try {
                const request = JSON.parse(body === '' ? '{}' : body);
                const data = String(request.data ?? '');
                if (data === '') throw new Error('需要一张图');
                const bytes = Buffer.from(data.replace(/^data:[^,]+,/, ''), 'base64');
                if (bytes.length === 0) throw new Error('图片是空的');
                const mediaType = sniffImage(new Uint8Array(bytes.subarray(0, 16)));
                if (mediaType === null) throw new Error('只支持 PNG / JPEG / GIF / WebP');
                const result = await searchStickersByImage(
                  { type: 'image', data: bytes.toString('base64'), mediaType, name: 'upload' },
                  Math.min(6, Math.max(1, Number(request.limit) || 4)),
                );
                jsonResponse(res, 200, { ok: true, ...result, files: listStickers() });
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
              if (action.action === 'restart') {
                // 只杀 NapCat 的引导进程，不动 QQ 本体；然后重新拉起，换一张新二维码。
                log('console: restarting NapCat (kill boot processes, relaunch)');
                const killer = spawn('taskkill.exe', ['/F', '/IM', 'NapCatWinBootMain.exe'], {
                  windowsHide: true,
                  stdio: 'ignore',
                });
                killer.on('exit', () => {
                  setTimeout(() => {
                    try {
                      const userBat = join(cfg.napcat.dir, 'launcher-user.bat');
                      mkdirSync(cfg.dataDir, { recursive: true });
                      if (existsSync(userBat)) {
                        const vbs = join(cfg.dataDir, 'restart-napcat.vbs');
                        const line = 'CreateObject("WScript.Shell").Run "cmd /c ""' + userBat + '"" ' + cfg.napcat.qq + '", 0, False';
                        writeFileSync(vbs, line + '\r\n', 'utf8');
                        spawn('wscript.exe', [vbs], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
                        log('console: NapCat relaunched after restart');
                      } else {
                        const command =
                          'Start-Process -FilePath "' + launcher + '" -ArgumentList "' + cfg.napcat.qq +
                          '" -WorkingDirectory "' + cfg.napcat.dir + '" -Verb RunAs';
                        spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
                          detached: true,
                          stdio: 'ignore',
                          windowsHide: true,
                        }).unref();
                      }
                    } catch (error) {
                      log('NapCat restart failed: ' + (error?.message ?? error));
                    }
                  }, 1500);
                  jsonResponse(res, 200, { ok: true, restarting: true });
                });
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
        path: '/im-bridge/login/diag',
        handler: (_req, res) => {
          const count = (name) => {
            try {
              const out = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq ' + name, '/NH'], { encoding: 'utf8', windowsHide: true });
              return (String(out.stdout ?? '').match(new RegExp(name.replace('.', '\\\\.'), 'gi')) ?? []).length;
            } catch {
              return -1;
            }
          };
          const qrFile = join(cfg.napcat.dir, 'cache', 'qrcode.png');
          let qrAge = null;
          try {
            qrAge = Math.round((Date.now() - statSync(qrFile).mtimeMs) / 1000);
          } catch {
            qrAge = null;
          }
          jsonResponse(res, 200, {
            qqProcesses: count('QQ.exe'),
            napcatProcesses: count('NapCatWinBootMain.exe'),
            port3001: socket !== null && socket.ready ? 'connected' : 'closed',
            qrAgeSeconds: qrAge,
            advice:
              qrAge !== null && qrAge > 150
                ? 'NapCat 没写出新二维码。多半是桌面 QQ 已经在运行，注入失败：先完全退出 QQ 再点「本地快速登录」。'
                : '',
          });
        },
      }),
    );
    ctx.effect(() =>
      webServer.register({
        kind: 'exact',
        path: '/im-bridge/qr/meta',
        handler: (_req, res) => {
          const file = join(cfg.napcat.dir, 'cache', 'qrcode.png');
          if (!existsSync(file)) {
            jsonResponse(res, 200, { exists: false, ageSeconds: null });
            return;
          }
          const info = statSync(file);
          jsonResponse(res, 200, {
            exists: true,
            size: info.size,
            ageSeconds: Math.round((Date.now() - info.mtimeMs) / 1000),
            updatedAt: info.mtimeMs,
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

  // 自主行为：每 25 分钟想一次要不要做点什么（受开关/时段/每日额度约束）。
  const autonomyTimer = setInterval(() => {
    if (settings.autonomy?.enabled !== true) return;
    if (!socket || socket.ready !== true) return;
    void autonomyTick(false).catch((error) => log(`autonomy tick failed: ${error?.message ?? error}`));
  }, 25 * 60 * 1000);
  ctx.effect(() => () => clearInterval(autonomyTimer));

  // 每天 21:00 给号主发一条「她今天做了什么」。
  const digestTimer = setInterval(() => {
    const now = new Date();
    if (now.getHours() !== 21) return;
    const stamp = `${todayKey()}:digest`;
    if (state.lastDigest === stamp) return;
    state.lastDigest = stamp;
    saveState();
    const auto = autonomyState();
    const total = (auto.counts.signature ?? 0) + (auto.counts.qzone ?? 0) + (auto.counts.chats ?? 0) + (auto.counts.nickname ?? 0);
    if (total === 0) return;
    const owner = (settings.owners ?? [])[0];
    if (owner === undefined) return;
    const lines = [
      '今天她自己的动作：',
      '· 改签名 ' + String(auto.counts.signature ?? 0) + ' 次',
      '· 发空间 ' + String(auto.counts.qzone ?? 0) + ' 次',
      '· 主动找人 ' + String(auto.counts.chats ?? 0) + ' 次',
    ];
    const recent = (auto.log ?? []).slice(0, 3).map((item) => '· ' + item.action + '：' + String(item.text ?? '').slice(0, 30));
    if (recent.length > 0) lines.push('最近三条：', ...recent);
    action('send_msg', { message_type: 'private', user_id: Number(owner) || owner, message: [{ type: 'text', data: { text: lines.join('\n') } }] });
    log('autonomy: daily digest sent');
  }, 5 * 60 * 1000);
  ctx.effect(() => () => clearInterval(digestTimer));
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
