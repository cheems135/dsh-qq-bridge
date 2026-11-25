// Offline catch-up appends older QQ events to the same ledger as live delivery.
// Keep the stored rows intact; order and scope them when reading dialogue history.
export function dialogueHistoryRows(rows, {key, accountId='', personaId='', floor=0, now=Date.now(), excludeIds=[]}={}) {
  if (!key || !Array.isArray(rows)) return [];
  const excluded = new Set(excludeIds.filter(id => id != null && id !== '').map(String));
  const selected = rows.filter(row => {
    if (row.chat !== key || (row.accountId || '') !== accountId || (row.personaId || '') !== personaId) return false;
    if (!(row.time > floor && row.time <= now) || row.retracted || row.deliveryRole === 'progress') return false;
    if (!['in','out'].includes(row.dir) || (row.delivery && row.delivery !== 'sent')) return false;
    return !excluded.size || (!excluded.has(String(row.messageId)) && !row.sourceMessageIds?.some(id => excluded.has(String(id))));
  });
  return selected.sort((a,b) => a.time - b.time);
}

// The display copy can include other people's forwarded words and a shared
// card's title. Preserve that reference without assigning it to the sender.
export function dialogueHistoryText(row) {
  const display = String(row.text ?? '').trim();
  if (row.dir !== 'in' || typeof row.userText !== 'string') return display;
  const words = row.userText.trim();
  if (!display || words === display) return words;
  // Only carry a difference as a reference if the QQ renderer identified it.
  // Older records can have a stale display copy alongside the correct words.
  if (!/^(?:\[(?:转发|合并转发|分享卡片|引用消息|语音|视频|文件|表情|图片|离线附件)\]|@\d+\s*$)/m.test(display)) return words;
  const lines = new Set(words.split('\n'));
  const reference = display.split('\n').filter(line => !lines.has(line)).join('\n').trim();
  if (!reference) return words;
  return [words, '【QQ附带资料】\n' + reference].filter(Boolean).join('\n');
}
