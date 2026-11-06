const READ_TIMEOUT_MS = 5000;
const MEDIA_TYPES = new Map([
  ['image', 'image'],
  ['record', 'audio'],
  ['audio', 'audio'],
  ['video', 'video'],
  ['file', 'file'],
  ['mface', 'mface'],
  ['forward', 'forward'],
]);
const IDENTIFIER_TYPES = new Set(['at', 'reply', 'face']);

function idText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  if(typeof value==='number'&&!Number.isSafeInteger(value))return '';
  const text = String(value);
  return /^-?\d+$/.test(text) && !/^-?0+$/.test(text) ? text : '';
}

function sameId(left, right) {
  const a = idText(left);
  const b = idText(right);
  return Boolean(a && b && a === b);
}

function normalizeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').trim();
}

function decodeCq(value) {
  return String(value)
    .replaceAll('&#44;', ',')
    .replaceAll('&#91;', '[')
    .replaceAll('&#93;', ']')
    .replaceAll('&amp;', '&');
}

function parseCqParams(value) {
  const data = {};
  for (const pair of String(value || '').split(',')) {
    const splitAt = pair.indexOf('=');
    if (splitAt <= 0) continue;
    data[pair.slice(0, splitAt)] = decodeCq(pair.slice(splitAt + 1));
  }
  return data;
}

function contentSegments(content) {
  if (Array.isArray(content)) {
    return content.flatMap(segment => {
      if (!segment || typeof segment !== 'object') return [{type: 'unknown'}];
      const data = segment.data && typeof segment.data === 'object' ? segment.data : segment;
      return [{type: String(segment.type || ''), data}];
    });
  }
  if (typeof content !== 'string') return null;

  const segments = [];
  let start = 0;
  for (const match of content.matchAll(/\[CQ:([^\]]*)\]/g)) {
    if (match.index > start) {
      segments.push({type: 'text', data: {text: decodeCq(content.slice(start, match.index))}});
    }
    const comma = match[1].indexOf(',');
    const type = comma < 0 ? match[1] : match[1].slice(0, comma);
    segments.push({type, data: parseCqParams(comma < 0 ? '' : match[1].slice(comma + 1))});
    start = match.index + match[0].length;
  }
  if (start < content.length || segments.length === 0) {
    segments.push({type: 'text', data: {text: decodeCq(content.slice(start))}});
  }
  return segments;
}

function contentTokens(content) {
  const segments = contentSegments(content);
  if (!segments) return null;

  const tokens = [];
  for (const segment of segments) {
    const type = String(segment.type || '').toLowerCase();
    const data = segment.data || {};
    if (type === 'text') {
      const text = String(data.text??'').replace(/\r\n?/g,'\n');
      if (!text) continue;
      const previous = tokens.at(-1);
      if (previous?.kind === 'text') previous.value += text;
      else tokens.push({kind: 'text', value: text});
      continue;
    }
    if (MEDIA_TYPES.has(type)) {
      tokens.push({kind: 'media', type: MEDIA_TYPES.get(type)});
      continue;
    }
    if (IDENTIFIER_TYPES.has(type)) {
      const key = type === 'at' ? 'qq' : 'id';
      const value = data[key] == null ? '' : String(data[key]);
      tokens.push({kind: type, value});
      continue;
    }
    return null;
  }
  return tokens.map(t=>t.kind==='text'?{...t,value:normalizeText(t.value)}:t).filter(t=>t.kind!=='text'||t.value);
}

function sameTokens(expected, actual) {
  if (!expected || !actual || expected.length !== actual.length) return false;
  return expected.every((left, index) => {
    const right = actual[index];
    if (left.kind !== right.kind) return false;
    if (left.kind === 'text') return left.value === right.value;
    if (left.kind === 'media') return left.type === right.type;
    // Identifiers matter when the outbound segment specifies one.
    return !left.value || left.value === right.value;
  });
}

function messageObject(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.message_id != null || value.message_type != null || value.sender || value.message != null) {
    return value;
  }
  return value.data && typeof value.data === 'object' ? messageObject(value.data) : null;
}

function privateTargetMatches(message, chatId) {
  const targets = [message.peer_id, message.target_id].filter(value => value != null);
  return {
    present: targets.length > 0,
    matches: targets.length > 0 && targets.every(value => sameId(value, chatId)),
  };
}

export function compareDeliveryMessage(
  job,
  message,
  {selfId, historyScoped = false} = {},
) {
  const candidate = messageObject(message);
  if (!candidate) return {matched: false, reason: 'message is unavailable'};
  if (job?.kind !== 'private' && job?.kind !== 'group') {
    return {matched: false, reason: 'delivery kind is invalid'};
  }

  const expectedId = idText(job.messageId);
  const actualId = idText(candidate.message_id);
  if (!expectedId) return {matched: false, reason: 'expected message id is invalid'};
  if (!actualId || actualId !== expectedId) {
    return {matched: false, reason: 'message id does not match'};
  }

  const senderIds = [candidate.sender?.user_id, candidate.user_id]
    .filter(value => value !== undefined && value !== null);
  if (senderIds.length === 0 || senderIds.some(value => !sameId(value, selfId))) {
    return {matched: false, reason: 'sender does not match self'};
  }
  if (candidate.message_type !== job.kind) {
    return {matched: false, reason: 'message type does not match'};
  }

  if (job.kind === 'group') {
    if (!sameId(candidate.group_id, job.chatId)) {
      return {matched: false, reason: 'group scope does not match'};
    }
  } else {
    const target = privateTargetMatches(candidate, job.chatId);
    if (target.present && !target.matches) {
      return {matched: false, reason: 'private target does not match'};
    }
    if (!target.present && !historyScoped) {
      return {matched: false, reason: 'private target is not proven'};
    }
  }

  const content = candidate.message ?? candidate.content;
  const expected = contentTokens(job.segments);
  const actual = contentTokens(content);
  if (!expected) return {matched: false, reason: 'expected content contains an unsupported segment'};
  if (!actual) return {matched: false, reason: 'observed content is unreadable or unsupported'};
  if (!sameTokens(expected, actual)) {
    return {matched: false, reason: 'message content does not match'};
  }
  return {matched: true, reason: 'exact sender-side readback matched'};
}

function unwrapData(value) {
  let current = value;
  for (let depth = 0; depth < 3 && current?.data !== undefined; depth += 1) {
    current = current.data;
  }
  return current;
}

function historyMessages(response) {
  const value = unwrapData(response);
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return null;
  for (const key of ['messages', 'message_list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return value.message_id != null ? [value] : null;
}

function explicitlyUnsupported(value, error) {
  if (error) {
    const message = String(error.message || '').trim();
    return error.unsupported === true
      || /^(?:unsupported|not supported|not_supported|action_not_supported)$/i.test(message);
  }
  const source = value && typeof value === 'object' ? value : {};
  const code = String(source.code ?? source.retcode ?? source.error?.code ?? '').toLowerCase();
  const status = String(source.status ?? source.error?.status ?? '').toLowerCase();
  const message = String(source.message ?? source.error?.message ?? '').trim();
  return source.unsupported === true
    || ['1404', 'unsupported', 'not_supported', 'unsupported_action', 'action_not_supported'].includes(code)
    || ['unsupported', 'not_supported'].includes(status)
    || /\b(?:unsupported|not supported|not_supported|unsupported_action|action_not_supported)\b/i.test(message);
}

function outcome(state, method, reason, checkedAt) {
  return {
    state,
    method,
    checkedAt,
    reason,
    recipient: 'unknown',
    read: 'unknown',
  };
}

export async function verifyDelivery(job, {request, selfId, signal} = {}) {
  if (signal?.aborted) {
    return outcome('unconfirmed', 'none', 'verification aborted', Date.now());
  }
  if (typeof request !== 'function') {
    return outcome('unconfirmed', 'none', 'readback request is unavailable', Date.now());
  }
  if (job?.kind !== 'private' && job?.kind !== 'group') {
    return outcome('unconfirmed', 'none', 'delivery kind is invalid', Date.now());
  }

  if(!idText(job.messageId)||!idText(job.chatId)||!idText(selfId))return outcome('unconfirmed','none','message, sender or target id is unavailable',Date.now());
  const historyName = job.kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history';
  const historyParams = job.kind === 'group'
    ? {group_id: String(job.chatId), count: 30}
    : {user_id: String(job.chatId), count: 30};
  let method = historyName;
  let historyUnsupported = false;
  let historyMissing = false;

  try {
    const response = await request(historyName, historyParams, READ_TIMEOUT_MS);
    if (signal?.aborted) {
      return outcome('unconfirmed', historyName, 'verification aborted', Date.now());
    }
    const messages = historyMessages(response);
    if (messages) {
      const exact = messages
        .map(messageObject)
        .filter(message => message && idText(message.message_id) === idText(job.messageId));
      if (exact.length > 0) {
        for (const message of exact) {
          const comparison = compareDeliveryMessage(job, message, {selfId, historyScoped: true});
          if (comparison.matched) {
            return outcome('observed', historyName, comparison.reason, Date.now());
          }
        }
        return outcome(
          'unconfirmed',
          historyName,
          compareDeliveryMessage(job, exact[0], {selfId, historyScoped: true}).reason,
          Date.now(),
        );
      }
      historyMissing = true;
    } else {
      historyMissing = true;
    }
    historyUnsupported = explicitlyUnsupported(response);
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return outcome('unconfirmed', historyName, 'verification aborted', Date.now());
    }
    historyUnsupported = explicitlyUnsupported(null, error);
    // One failed read does not prove the exact-ID action is unavailable.
    historyMissing = !historyUnsupported;
  }

  if (signal?.aborted) {
    return outcome('unconfirmed', method, 'verification aborted', Date.now());
  }
  // A completely unsupported history action still gets one exact-ID fallback.
  const shouldFallback = historyUnsupported || historyMissing;
  if (!shouldFallback) {
    return outcome('unconfirmed', historyName, 'no exact matching message was found', Date.now());
  }

  method = 'get_msg';
  try {
    const response = await request('get_msg', {message_id: String(job.messageId)}, READ_TIMEOUT_MS);
    if (signal?.aborted) {
      return outcome('unconfirmed', method, 'verification aborted', Date.now());
    }
    const message = messageObject(response);
    if (!message) {
      const fallbackUnsupported = explicitlyUnsupported(response);
      const reason = historyUnsupported && fallbackUnsupported
        ? 'delivery readback actions are unsupported'
        : 'exact message readback is unavailable';
      return outcome(
        historyUnsupported && fallbackUnsupported ? 'unsupported' : 'unconfirmed',
        method,
        reason,
        Date.now(),
      );
    }
    const comparison = compareDeliveryMessage(job, message, {selfId, historyScoped: false});
    return outcome(
      comparison.matched ? 'observed' : 'unconfirmed',
      method,
      comparison.reason,
      Date.now(),
    );
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      return outcome('unconfirmed', method, 'verification aborted', Date.now());
    }
    const unsupported = historyUnsupported && explicitlyUnsupported(null, error);
    return outcome(
      unsupported ? 'unsupported' : 'unconfirmed',
      method,
      unsupported ? 'delivery readback actions are unsupported' : 'exact message request failed',
      Date.now(),
    );
  }
}
