import { randomUUID } from 'node:crypto';
import { mediaExecutionSummary } from './media-execution.js';

// One lifecycle for group/private, scheduled/chat and local/API media. Storage,
// routing and audits are supplied by the host; this module does not send QQ.
export function createMediaTaskLifecycle({ state, account, persona, source, audit, record, persist, now = Date.now, id = randomUUID }) {
  const activeStatuses = new Set(['pending', 'waiting_service', 'generated', 'queued', 'sent', 'unknown']);
  function refresh(auditId) {
    const entry = audit(auditId);
    if (!entry) return;
    const data = state();
    const tasks = (data.mediaTasks || []).filter(task => task.auditId === auditId && task.accountId === entry.accountId && task.personaId === entry.persona);
    entry.mediaExecution = mediaExecutionSummary(tasks, data.outbox || []);
  }
  function recordTask(task) {
    const kind = task.kind === 'voice' ? 'speech' : task.kind;
    const backend = task.backend || (source(kind) === 'local' ? 'local' : 'api');
    task.backend = backend;
    record({
      id: 'media-task:' + task.id, tool: 'media.' + task.kind, kind,
      purpose: '媒体任务：生成 → 入队 → QQ回执 → 读回核对',
      mediaExecution: mediaExecutionSummary([task], state().outbox || []),
      status: ['failed', 'cancelled'].includes(task.status) ? task.status : task.status === 'unknown' ? 'failed' : task.status === 'sent' ? 'returned' : 'submitted',
      arguments: { auditId: task.auditId, mediaTaskId: task.id },
      result: { stage: task.status, deliveryId: task.deliveryId || '', files: task.file ? [task.file] : [], verification: task.verification || null },
      error: task.error || '',
    }, { accountId: task.accountId, personaId: task.personaId, chat: task.chat, auditId: task.auditId, backend });
    refresh(task.auditId);
  }
  return {
    refresh, record: recordTask,
    begin(chat, kind) {
      const data = state();
      const rows = data.mediaTasks = Array.isArray(data.mediaTasks) ? data.mediaTasks : [];
      const accountId = account() || '', personaId = persona(chat.key);
      const old = chat.auditId ? rows.find(task => task.accountId === accountId && task.personaId === personaId && task.chat === chat.key && task.auditId === chat.auditId && task.kind === kind && activeStatuses.has(task.status)) : null;
      if (old) return { duplicate: true, task: old };
      const task = { id: id(), at: now(), accountId, personaId, chat: chat.key, auditId: chat.auditId || '', kind, status: 'pending' };
      rows.push(task);
      recordTask(task);
      persist();
      return { duplicate: false, task };
    },
    finish(task, status, details = {}) {
      if (!task) return;
      Object.assign(task, details, { status, updatedAt: now() });
      recordTask(task);
      persist();
    },
  };
}
