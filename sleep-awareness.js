import {createHash, randomUUID} from 'node:crypto';

// Observations only: no model calls, wake-up decisions or message sends here.
// A scheduled rest and an unavailable runtime are different intervals, including
// when the runtime disappears during a rest. Never backfill an unobserved sleep.
const scope = meta => createHash('sha256').update(JSON.stringify([meta.accountId || '', meta.personaId])).digest('hex');
const copy = value => structuredClone(value);
const clean = value => String(value || '').replace(/[\r\n]/g, ' ').slice(0, 100);
const WEEK = 7 * 86400000;
const labels = {
  disconnected: 'QQ连接中断', paused: '桥接暂停', inactive: '当前账号或角色未在本机运行',
  runtime_closed: '插件或宿主退出', runtime_restart: '服务重启，未留下正常退出记录',
  startup: '服务启动后等待QQ连接',
};

export function createSleepAwareness({storage, now = () => Date.now(), runtimeId = randomUUID()} = {}) {
  let state;
  try { state = storage.read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (!state || state.version !== 1 || !state.scopes || typeof state.scopes !== 'object') state = {version: 1, scopes: {}};
  let closed = false;
  const save = () => storage.write(state);

  function finish(row, at, endedBy, estimatedEnd = false) {
    if (!row.current) return;
    const end = Math.max(row.current.startedAt, at);
    const event = {...row.current, endedAt: end, durationMs: end - row.current.startedAt, endedBy, estimatedEnd};
    row.history = [...(row.history || []).filter(item => item.endedAt >= now() - WEEK), event].slice(-24);
    row.lastRest = event;
    row.current = null;
  }

  function offline(row, at, reason, estimatedStart = false) {
    if (row.current?.kind === 'passive_offline') {
      if (reason === 'runtime_closed' || reason === 'runtime_restart') row.current.runtimeStopped = true;
      return;
    }
    const precededBySleep = row.current?.kind === 'scheduled_sleep';
    finish(row, at, 'interrupted', estimatedStart);
    row.current = {kind: 'passive_offline', startedAt: at, reason, estimatedStart, precededBySleep, runtimeStopped: reason.startsWith('runtime_')};
    row.mode = 'passive_offline';
  }

  function observe(meta, {connected = false, sleeping = false, scene, wakeReason = '', reason = 'disconnected', at = now()} = {}) {
    if (closed || !meta?.personaId || !Number.isFinite(at)) return null;
    const key = scope(meta);
    const row = state.scopes[key] ||= {meta: {accountId: meta.accountId || '', personaId: meta.personaId}, history: []};
    // A new runtime cannot know the exact kill/power-off time. The final durable
    // heartbeat is an estimate, not evidence that she chose to sleep until boot.
    if (row.runtimeId && row.runtimeId !== runtimeId && row.lastSeen && at > row.lastSeen) {
      offline(row, row.lastSeen, 'runtime_restart', true);
    }
    if (!connected) {
      offline(row, at, row.lastSeen ? reason : 'startup');
    } else if (sleeping) {
      if (row.current?.kind !== 'scheduled_sleep') {
        finish(row, at, 'connection_restored');
        row.current = {kind: 'scheduled_sleep', startedAt: at, reason: 'schedule', activity: clean(scene?.activity)};
      }
      row.mode = 'scheduled_sleep';
    } else {
      finish(row, at, clean(wakeReason) || (row.mode === 'passive_offline' ? 'connection_restored' : 'schedule_or_state_changed'));
      row.mode = 'awake';
    }
    row.runtimeId = runtimeId;
    row.lastSeen = at;
    row.history = (row.history || []).filter(item => item.endedAt >= at - WEEK).slice(-24);
    if (row.lastRest?.endedAt < at - WEEK) delete row.lastRest;
    save();
    return snapshot(meta);
  }

  function snapshot(meta) {
    const row = meta?.personaId && state.scopes[scope(meta)];
    if (!row) return {mode: 'unknown', history: [], coverage: '尚无实际观察，不能推断之前睡过多久'};
    return copy({mode: row.mode, observedAt: row.lastSeen, current: row.current || null, lastRest: row.lastRest || null, history: row.history || [], coverage: '主动睡眠来自实际睡眠状态；被动离线来自连接或服务记录。重启缺少退出记录时起点为估计，不能断言是电脑关机，也不能把离线期间的计划当成已执行'});
  }

  function reconcile(metas) {
    if (closed) return;
    const active = new Set(metas.map(scope));
    let changed = false;
    for (const [key, row] of Object.entries(state.scopes)) {
      if (row.runtimeId === runtimeId && !active.has(key) && row.mode !== 'passive_offline') {
        offline(row, now(), 'inactive'); row.lastSeen = now(); changed = true;
      }
    }
    if (changed) save();
  }

  function hint(meta, {question = '', at = now(), dialogue = false} = {}) {
    if (dialogue) {
      const clauses=String(question).replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu,'').split(/[，,。！!；;\n]/u);
      const directed=/(?:你(?!的?(?:室友|朋友|同事|同学|家人))|桥接|机器人|插件|服务)(?:是|怎么|为什么|刚才|刚刚|刚|今天|昨天|昨晚|之前|这会儿|现在|到底|到底是|又|还|也|已经|还没|一直|几时|几点|什么时候|是不是|有没有|都|才|就|从几点)*(?:醒|睡|在线|不在|没在|离线|掉线|重启|关机|开机|没回|没理|断[线开])/u;
      const bareState=/^(?:还|刚|昨晚|之前|刚才|又|已经|是不是|怎么|为什么|什么时候|几点)*(?:睡醒|睡着|睡觉|醒|睡|离线|掉线|断线|重启|关机|开机|在线)/u;
      const asks=clauses.some(part=>{
        const clause=part.trim();
        return directed.test(clause)||bareState.test(clause)&&/[?？]|吗|嘛|么|没|多久|多长|几点|怎么|什么时候|是不是/u.test(clause);
      });
      if (!asks) return '';
    }
    const value = snapshot(meta), last = value.lastRest;
    const relevant = dialogue || /睡|醒|离线|掉线|关机|开机|断线|重启|不在|没在线/.test(question);
    // Brief recent recovery facts are shared by private/group, API/local. Older
    // facts are retrieved on demand instead of adding a permanent long prompt.
    if (!value.current && (!last || (!relevant && at - last.endedAt > 30 * 60000))) return '';
    const stamp = ms => new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(ms);
    const describe = event => {
      const name = event.kind === 'scheduled_sleep' ? '主动睡眠（日程休息）' : '被动离线';
      const start = (event.estimatedStart ? '约' : '') + stamp(event.startedAt);
      const end = event.endedAt ? (event.estimatedEnd ? '约' : '') + stamp(event.endedAt) : '现在';
      const minutes = Math.floor(Math.max(0, (event.endedAt || at) - event.startedAt) / 60000);
      return `${name} ${start}—${end}（${minutes < 1 ? '不足1分钟' : minutes + '分钟'}）${event.kind === 'passive_offline' ? '，' + (labels[event.reason] || '未连接') : ''}${event.precededBySleep ? '；此前确实处于日程睡眠，中途服务/连接中断' : ''}${event.runtimeStopped && event.reason !== 'runtime_closed' && event.reason !== 'runtime_restart' ? '；期间服务也停止过' : ''}`;
    };
    const previous = value.history.at(-2);
    const contiguous = previous && last && Math.abs(previous.endedAt - last.startedAt) < 1000 && previous.kind !== last.kind;
    const facts = [contiguous && describe(previous), last && describe(last), value.current && describe(value.current)].filter(Boolean).join('；');
    return `【实际睡眠与离线】角色当前${value.mode === 'awake' ? '清醒' : value.mode === 'scheduled_sleep' ? '按日程休息' : '离线'}。${facts}。这是状态资料，不要求汇报；按当前话题自然回应。离线原因不明时不要说是自己想睡，也不要假装期间看过消息或完成任务。`;
  }

  function close() {
    if (closed) return;
    for (const row of Object.values(state.scopes)) if (row.runtimeId === runtimeId) {
      offline(row, now(), 'runtime_closed'); row.lastSeen = now();
    }
    save(); closed = true;
  }
  return {observe, snapshot, hint, reconcile, close};
}
