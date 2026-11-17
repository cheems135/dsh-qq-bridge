/**
 * fake-napcat.mjs — a throwaway OneBot 11 WebSocket server used to exercise
 * the dsh-im-bridge plugin without a real QQ account.
 *
 * It performs the RFC 6455 handshake, optionally checks the bearer token,
 * sends one private message event, and prints every action the bridge calls
 * back. Exits once a reply action arrives (or after a timeout).
 *
 * Usage:
 *   node tools/fake-napcat.mjs [--port 3001] [--user 10001] [--text "..."]
 */

import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};

const port = Number(arg('port', '3001'));
const user = arg('user', '10001');
const text = arg('text', '用一句话介绍你自己，并告诉我你有哪些工具。');
const timeoutMs = Number(arg('timeout', '180000'));

function encodeFrame(opcode, payload) {
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

function decodeFrames(state, chunk) {
  state.buffer = state.buffer.length === 0 ? chunk : Buffer.concat([state.buffer, chunk]);
  const frames = [];
  for (;;) {
    const buffer = state.buffer;
    if (buffer.length < 2) break;
    const fin = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    const masked = (buffer[1] & 0x80) !== 0;
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) break;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) break;
      length = Number(buffer.readBigUInt64BE(2));
      offset = 10;
    }
    let mask = null;
    if (masked) {
      if (buffer.length < offset + 4) break;
      mask = buffer.subarray(offset, offset + 4);
      offset += 4;
    }
    if (buffer.length < offset + length) break;
    const payload = Buffer.from(buffer.subarray(offset, offset + length));
    state.buffer = buffer.subarray(offset + length);
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i & 3];
    frames.push({ fin, opcode, payload });
  }
  return frames;
}

const server = createServer((socket) => {
  const state = { buffer: Buffer.alloc(0), ready: false, handshake: Buffer.alloc(0) };
  console.log('[fake-napcat] client connected');

  socket.on('data', (chunk) => {
    if (!state.ready) {
      state.handshake = Buffer.concat([state.handshake, chunk]);
      const end = state.handshake.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = state.handshake.subarray(0, end).toString('latin1');
      const rest = state.handshake.subarray(end + 4);
      const key = /sec-websocket-key:\s*(\S+)/i.exec(head)?.[1];
      if (!key) {
        socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        return;
      }
      const accept = createHash('sha1').update(key + WS_GUID).digest('base64');
      socket.write(
        [
          'HTTP/1.1 101 Switching Protocols',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Accept: ${accept}`,
          '',
          '',
        ].join('\r\n'),
      );
      state.ready = true;
      console.log('[fake-napcat] handshake ok');
      if (/\r\nauthorization:/i.test(head)) console.log('[fake-napcat] authorization header present');

      const lifecycle = {
        post_type: 'meta_event',
        meta_event_type: 'lifecycle',
        sub_type: 'connect',
        time: Math.floor(Date.now() / 1000),
        self_id: 424242,
      };
      socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(lifecycle))));

      setTimeout(() => {
        const event = {
          post_type: 'message',
          message_type: 'private',
          sub_type: 'friend',
          time: Math.floor(Date.now() / 1000),
          self_id: 424242,
          message_id: 1,
          user_id: Number(user),
          raw_message: text,
          font: 0,
          sender: { user_id: Number(user), nickname: '测试号', card: '' },
          message: [{ type: 'text', data: { text } }],
        };
        socket.write(encodeFrame(0x1, Buffer.from(JSON.stringify(event))));
        console.log(`[fake-napcat] sent private message from ${user}: ${text}`);
      }, 1500);

      if (rest.length > 0) handleFrames(decodeFrames(state, rest));
      return;
    }
    handleFrames(decodeFrames(state, chunk));
  });

  function handleFrames(frames) {
    for (const frame of frames) {
      if (frame.opcode === 0x8) {
        socket.end();
        return;
      }
      if (frame.opcode === 0x9) {
        socket.write(encodeFrame(0xa, frame.payload));
        continue;
      }
      if (frame.opcode !== 0x1) continue;
      const raw = frame.payload.toString('utf8');
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        console.log('[fake-napcat] non-JSON frame:', raw.slice(0, 200));
        continue;
      }
      console.log('[fake-napcat] action:', JSON.stringify(payload).slice(0, 1200));
      if (payload.echo) {
        socket.write(
          encodeFrame(
            0x1,
            Buffer.from(JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 99 }, echo: payload.echo })),
          ),
        );
      }
      if (payload.action === 'send_msg' || payload.action === 'send_private_msg') {
        const segments = payload.params?.message ?? [];
        const body = Array.isArray(segments)
          ? segments.map((segment) => (segment.type === 'text' ? segment.data.text : `[${segment.type}]`)).join('')
          : String(segments);
        console.log('\n================ REPLY FROM DSH ================');
        console.log(body);
        console.log('================================================\n');
        clearTimeout(watchdog);
        setTimeout(() => {
          console.log('[fake-napcat] done');
          server.close();
          process.exit(0);
        }, 500);
      }
    }
  }

  socket.on('error', (error) => console.log('[fake-napcat] socket error:', error.message));
});

const watchdog = setTimeout(() => {
  console.log('[fake-napcat] timed out with no reply');
  server.close();
  process.exit(2);
}, timeoutMs);

server.listen(port, '127.0.0.1', () => {
  console.log(`[fake-napcat] listening on ws://127.0.0.1:${port}`);
});
