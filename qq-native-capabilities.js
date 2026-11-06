const freezeEntry = entry => Object.freeze({
  ...entry,
  required: Object.freeze([...entry.required]),
});

export const QQ_NATIVE_CATALOG = Object.freeze([
  {action: 'get_login_info', title: '获取登录账号信息', scope: 'self', write: false, required: []},
  {action: 'get_status', title: '获取运行状态', scope: 'self', write: false, required: []},
  {action: 'get_version_info', title: '获取版本信息', scope: 'self', write: false, required: []},
  {action: 'get_friend_list', title: '获取好友列表', scope: 'self', write: false, required: []},
  {action: 'get_group_list', title: '获取群列表', scope: 'self', write: false, required: []},
  {action: 'get_stranger_info', title: '获取陌生人信息', scope: 'private', write: false, required: ['user_id']},
  {action: 'send_like', title: '给好友点赞', scope: 'private', write: true, required: ['user_id']},
  {action: 'friend_poke', title: '私聊戳一戳', scope: 'private', write: true, required: ['user_id']},
  {action: 'get_group_info', title: '获取群信息', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_group_member_list', title: '获取群成员列表', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_group_member_info', title: '获取群成员信息', scope: 'group', write: false, required: ['group_id', 'user_id']},
  {action: 'get_group_honor_info', title: '获取群荣誉信息', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_essence_msg_list', title: '获取群精华消息列表', scope: 'group', write: false, required: ['group_id']},
  {action: '_get_group_notice', title: '获取群公告', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_group_file_system_info', title: '获取群文件系统信息', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_group_root_files', title: '获取群根目录文件', scope: 'group', write: false, required: ['group_id']},
  {action: 'get_group_files_by_folder', title: '获取群文件夹文件', scope: 'group', write: false, required: ['group_id', 'folder_id']},
  {action: 'get_group_file_url', title: '获取群文件地址', scope: 'group', write: false, required: ['group_id', 'file_id']},
  {action: 'group_poke', title: '群聊戳一戳', scope: 'group', write: true, required: ['group_id', 'user_id']},
  {action: 'set_group_card', title: '设置群名片', scope: 'group', write: true, required: ['group_id', 'user_id', 'card']},
  {action: 'set_group_name', title: '设置群名称', scope: 'group', write: true, required: ['group_id', 'group_name']},
  {action: 'set_group_ban', title: '禁言群成员', scope: 'group', write: true, required: ['group_id', 'user_id', 'duration']},
  {action: 'set_group_whole_ban', title: '设置全员禁言', scope: 'group', write: true, required: ['group_id', 'enable']},
  {action: 'set_group_special_title', title: '设置群专属头衔', scope: 'group', write: true, required: ['group_id', 'user_id', 'special_title']},
  {action: '_send_group_notice', title: '发送群公告', scope: 'group', write: true, required: ['group_id', 'content']},
].map(freezeEntry));

const HONOR_TYPES = new Set(['all', 'talkative', 'performer', 'legend', 'strong_newbie', 'emotion']);
const OWNER_ONLY = new Set(['get_friend_list', 'get_group_list']);
const WRITE_ACTIONS = new Set(QQ_NATIVE_CATALOG.filter(entry => entry.write).map(entry => entry.action));
const CATALOG_BY_ACTION = new Map(QQ_NATIVE_CATALOG.map(entry => [entry.action, entry]));
const SENSITIVE_KEY = /password|passwd|pwd|passphrase|cookie|token|secret|credential|authorization|api[_-]?key|session[_-]?key|access[_-]?key|refresh[_-]?key|csrf|(?:^|[_-])s?key(?:$|[_-])|(?:^|[_-])qrsig(?:$|[_-])|(?:^|[_-])bkn(?:$|[_-])/i;
const SENSITIVE_TEXT = /(?:^|[;\s])(?:cookie|set-cookie|authorization|password|passwd|pwd|passphrase|token|secret|api[_-]?key|csrf|p_skey|skey|qrsig|bkn)\s*[:=]\s*\S+|bearer\s+[a-z0-9._~+/=-]{8,}/i;

const schema = (required, keys) => ({required, keys});
const SCHEMAS = new Map([
  ['get_login_info', schema([], {})],
  ['get_status', schema([], {})],
  ['get_version_info', schema([], {})],
  ['get_friend_list', schema([], {no_cache: 'boolean'})],
  ['get_group_list', schema([], {no_cache: 'boolean'})],
  ['get_stranger_info', schema(['user_id'], {user_id: 'user_id', no_cache: 'boolean'})],
  ['send_like', schema(['user_id'], {user_id: 'user_id', times: 'like_times'})],
  ['friend_poke', schema(['user_id'], {user_id: 'user_id'})],
  ['get_group_info', schema(['group_id'], {group_id: 'group_id', no_cache: 'boolean'})],
  ['get_group_member_list', schema(['group_id'], {group_id: 'group_id'})],
  ['get_group_member_info', schema(['group_id', 'user_id'], {group_id: 'group_id', user_id: 'user_id', no_cache: 'boolean'})],
  ['get_group_honor_info', schema(['group_id'], {group_id: 'group_id', type: 'honor_type'})],
  ['get_essence_msg_list', schema(['group_id'], {group_id: 'group_id'})],
  ['_get_group_notice', schema(['group_id'], {group_id: 'group_id'})],
  ['get_group_file_system_info', schema(['group_id'], {group_id: 'group_id'})],
  ['get_group_root_files', schema(['group_id'], {group_id: 'group_id'})],
  ['get_group_files_by_folder', schema(['group_id', 'folder_id'], {group_id: 'group_id', folder_id: 'file_id'})],
  ['get_group_file_url', schema(['group_id', 'file_id'], {group_id: 'group_id', file_id: 'file_id', busid: 'unsigned_integer'})],
  ['group_poke', schema(['group_id', 'user_id'], {group_id: 'group_id', user_id: 'user_id'})],
  ['set_group_card', schema(['group_id', 'user_id', 'card'], {group_id: 'group_id', user_id: 'user_id', card: 'card'})],
  ['set_group_name', schema(['group_id', 'group_name'], {group_id: 'group_id', group_name: 'group_name'})],
  ['set_group_ban', schema(['group_id', 'user_id', 'duration'], {group_id: 'group_id', user_id: 'user_id', duration: 'duration'})],
  ['set_group_whole_ban', schema(['group_id', 'enable'], {group_id: 'group_id', enable: 'boolean'})],
  ['set_group_special_title', schema(['group_id', 'user_id', 'special_title'], {group_id: 'group_id', user_id: 'user_id', special_title: 'special_title', duration: 'duration'})],
  ['_send_group_notice', schema(['group_id', 'content'], {group_id: 'group_id', content: 'notice'})],
]);

function activeContext(context) {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return null;
  }
  const accountId = contextId(context.accountId);
  const personaId = contextId(context.personaId);
  const key = typeof context.key === 'string' ? context.key.trim() : '';
  if (!accountId || !personaId || !key) return null;
  return {accountId, personaId, key};
}

function contextId(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  return '';
}

function contextScope(context) {
  const value = context?.scope ?? context?.kind ?? context?.type ?? context?.chatType ?? context?.chat?.type;
  const normalized = String(value ?? '').toLowerCase();
  if (['group', 'group_message', 'groupmessage'].includes(normalized)) return 'group';
  if (['private', 'friend', 'c2c', 'direct', 'private_message', 'privatemessage'].includes(normalized)) {
    return 'private';
  }
  return '';
}

function numericId(value) {
  if (Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return '';
  return value;
}

function currentGroupId(context) {
  return numericId(
    context?.groupId
      ?? context?.group_id
      ?? context?.chat?.groupId
      ?? context?.chat?.group_id
      ?? (contextScope(context) === 'group' ? context?.chatId : undefined),
  );
}

function currentPrivateUserId(context) {
  if (contextScope(context) !== 'private') return '';
  return numericId(
    context?.userId
      ?? context?.user_id
      ?? context?.peerId
      ?? context?.peer_id
      ?? context?.targetId
      ?? context?.target_id
      ?? context?.chat?.userId
      ?? context?.chat?.user_id
      ?? context?.chatId,
  );
}

function idSet(value) {
  const values = value instanceof Set ? value : Array.isArray(value) ? value : [];
  return new Set([...values].map(numericId).filter(Boolean));
}

async function callbackValue(callback, context, fallback) {
  if (typeof callback !== 'function') return fallback;
  try {
    return await callback(context);
  } catch {
    return fallback;
  }
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function primitive(value) {
  return (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    && (typeof value !== 'number' || Number.isFinite(value));
}

function boundedText(value, max) {
  return primitive(value)
    && (typeof value === 'string' || typeof value === 'number')
    && String(value).length <= max;
}

function validateValue(kind, value) {
  switch (kind) {
    case 'group_id':
    case 'user_id':
      return numericId(value);
    case 'file_id':
      if (!boundedText(value, 512)) return null;
      return String(value);
    case 'unsigned_integer':
      if (
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        || (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
      ) {
        return Number(value);
      }
      return null;
    case 'like_times':
      if (
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= 10)
        || (typeof value === 'string' && /^[1-9]\d*$/.test(value) && Number(value) <= 10)
      ) {
        return Number(value);
      }
      return null;
    case 'duration':
      if (
        (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
        || (typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)))
      ) {
        return Number(value);
      }
      return null;
    case 'boolean':
      return typeof value === 'boolean' ? value : null;
    case 'honor_type': {
      const text = typeof value === 'string' ? value.toLowerCase() : '';
      return HONOR_TYPES.has(text) ? text : null;
    }
    case 'card':
      return boundedText(value, 128) ? String(value) : null;
    case 'group_name':
      return boundedText(value, 128) && String(value).trim() ? String(value) : null;
    case 'special_title':
      return boundedText(value, 128) ? String(value) : null;
    case 'notice':
      return boundedText(value, 10000) && String(value).trim() ? String(value) : null;
    default:
      return null;
  }
}

function validateParams(def, params) {
  if (!plainObject(params)) return null;
  const schemaDefinition = SCHEMAS.get(def.action);
  if (!schemaDefinition) return null;

  const normalized = {};
  for (const key of Object.keys(params)) {
    if (!Object.hasOwn(schemaDefinition.keys, key)) return null;
    const value = params[key];
    if (value === undefined || value === null || !primitive(value)) return null;
    const checked = validateValue(schemaDefinition.keys[key], value);
    if (checked === null) return null;
    normalized[key] = checked;
  }

  for (const key of schemaDefinition.required) {
    if (params[key] === undefined || !Object.hasOwn(params, key)) return null;
  }
  return normalized;
}

function listId(item, keys) {
  if (typeof item === 'number' || typeof item === 'string') return numericId(item);
  if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
  for (const key of keys) {
    const id = numericId(item[key]);
    if (id) return id;
  }
  return '';
}

function filterList(action, value, allowed) {
  if (!Array.isArray(value)) return [];
  const keys = action === 'get_friend_list'
    ? ['user_id', 'uin', 'id']
    : ['group_id', 'group', 'id'];
  return value.filter(item => {
    const id = listId(item, keys);
    return Boolean(id && allowed.has(id));
  });
}

function sanitize(value, depth = 0) {
  if (depth > 20) return null;
  if (typeof value === 'string') return SENSITIVE_TEXT.test(value) ? '[redacted]' : value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return null;

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) output[key] = '[redacted]';
    else output[key] = sanitize(item, depth + 1);
  }
  return output;
}

function resultData(response) {
  if (response && typeof response === 'object' && !Array.isArray(response) && Object.hasOwn(response, 'data')) {
    return response.data;
  }
  return response;
}

function failureCode(response) {
  const values = [
    response?.retcode,
    response?.code,
    response?.error?.retcode,
    response?.error?.code,
  ];
  const value = values.find(item => item !== undefined && item !== null);
  return value === undefined ? '' : String(value);
}

function explicitlyUnsupported(response) {
  const code = failureCode(response);
  if (code === '1404') return true;
  const status = String(response?.status ?? response?.error?.status ?? '').toLowerCase();
  const message = String(response?.message ?? response?.error?.message ?? response?.wording ?? '');
  return ['unsupported', 'not_supported', 'unknown_action'].includes(status)
    || /(?:unsupported|not[_ ]supported|unknown[_ ]action|action[_ ]not[_ ]found)/i.test(message);
}

function requestFailed(response) {
  if (response === undefined) return true;
  if (response === null || typeof response !== 'object' || Array.isArray(response)) return false;
  if (response.ok === false || response.unsupported === true) return true;
  const status = String(response.status ?? '').toLowerCase();
  if (['failed', 'error', 'unsupported', 'not_supported'].includes(status)) return true;
  const code = failureCode(response);
  return Boolean(code && code !== '0');
}

function safeFailure(action, kind) {
  const messages = {
    context: '需要有效的账号、角色和调用上下文',
    denied: '当前上下文不允许执行此 QQ 能力',
    params: 'QQ 能力参数无效',
    failed: 'QQ 平台请求失败，未返回可信结果',
    unsupported: 'QQ 平台明确表示不支持此能力',
  };
  return {
    ok: false,
    action: typeof action === 'string'
      && action.length <= 128
      && !/https?:\/\//i.test(action)
      && !SENSITIVE_TEXT.test(action)
      ? action
      : null,
    error: messages[kind],
    status: kind === 'unsupported' ? 'unsupported' : kind === 'failed' ? 'failed' : 'rejected',
    verified: false,
  };
}

export function createQqNativeCapabilities({
  request,
  allowedUsers = () => [],
  allowedGroups = () => [],
  isOwner = () => false,
  now = Date.now,
} = {}) {
  const statuses = new Map();

  const identity = context => {
    const active = activeContext(context);
    if (!active) return '';
    return JSON.stringify([active.accountId, active.personaId, active.key]);
  };

  const statusFor = (context, action) => {
    const scoped = statuses.get(identity(context));
    return scoped?.get(action) ?? {status: 'unknown', checkedAt: null};
  };

  const setStatus = (context, action, status) => {
    const scope = identity(context);
    if (!scope) return;
    let scoped = statuses.get(scope);
    if (!scoped) {
      scoped = new Map();
      statuses.set(scope, scoped);
    }
    const timestamp = typeof now === 'function' ? now() : Date.now();
    scoped.set(action, {
      status,
      checkedAt: Number.isFinite(timestamp) ? timestamp : Date.now(),
    });
  };

  return {
    catalog(context) {
      if (!activeContext(context)) throw new Error('需要有效的 QQ 调用上下文');
      return QQ_NATIVE_CATALOG.map(entry => ({
        ...entry,
        required: [...entry.required],
        ...statusFor(context, entry.action),
      }));
    },

    async call({action, params = {}} = {}, context) {
      if (!activeContext(context)) return safeFailure(action, 'context');
      const def = CATALOG_BY_ACTION.get(action);
      if (!def) return safeFailure(action, 'denied');

      const normalized = validateParams(def, params);
      if (!normalized) return safeFailure(action, 'params');

      const users = idSet(await callbackValue(allowedUsers, context, []));
      const groups = idSet(await callbackValue(allowedGroups, context, []));

      let owner = await callbackValue(isOwner, context, false);
      owner = owner === true;

      if (OWNER_ONLY.has(action) && !owner) return safeFailure(action, 'denied');

      if (def.scope === 'group') {
        const groupId = normalized.group_id;
        if (!groups.has(groupId)) return safeFailure(action, 'denied');

        const origin = contextScope(context);
        if (origin === 'group') {
          if (currentGroupId(context) !== groupId) return safeFailure(action, 'denied');
        } else if (origin === 'private') {
          if (!owner) return safeFailure(action, 'denied');
        } else {
          return safeFailure(action, 'denied');
        }
      }

      if (def.scope === 'private') {
        const userId = normalized.user_id;
        if (!users.has(userId)) return safeFailure(action, 'denied');
        const origin = contextScope(context);
        if (origin === 'group') return safeFailure(action, 'denied');
        if (origin !== 'private') return safeFailure(action, 'denied');
        if (!owner && currentPrivateUserId(context) !== userId) return safeFailure(action, 'denied');
      }

      if (WRITE_ACTIONS.has(action) && !owner) return safeFailure(action, 'denied');
      if (typeof request !== 'function') return safeFailure(action, 'failed');

      let response;
      try {
        response = await request(action, normalized, context);
      } catch (error) {
        const kind=explicitlyUnsupported(error)?'unsupported':'failed';
        setStatus(context, action, kind);
        return safeFailure(action, kind);
      }

      if (explicitlyUnsupported(response)) {
        setStatus(context, action, 'unsupported');
        return safeFailure(action, 'unsupported');
      }
      if (requestFailed(response)) {
        setStatus(context, action, 'failed');
        return safeFailure(action, 'failed');
      }

      setStatus(context, action, 'supported');
      let result = resultData(response);
      if (action === 'get_friend_list') result = filterList(action, result, users);
      if (action === 'get_group_list') result = filterList(action, result, groups);
      result = sanitize(result);

      if (def.write) {
        return {
          ok: true,
          action,
          result,
          verified: false,
          coverage: '平台已接收普通操作，未作读回',
        };
      }
      return {
        ok: true,
        action,
        result,
        verified: true,
        coverage: '平台已返回普通只读结果',
      };
    },
  };
}
