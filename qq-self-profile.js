const qqIdPattern = /^\d{5,20}$/;
const profileTtl = 5 * 60_000;
const partialTtl = 60_000;

// NapCat's documented status and extStatus values. Unknown values carry no label.
const presence = new Map([
  [10, '在线'], [20, '离线'], [30, '离开'], [40, '隐身'],
  [50, '忙碌'], [60, 'Q我吧'], [70, '请勿打扰'],
]);
const extendedPresence = new Map([
  [1000, '我的电量'], [1011, '信号弱'], [1016, '睡觉中'], [1018, '学习中'],
  [1021, '追剧中'], [1027, 'timi中'], [1028, '听歌中'], [1030, '今日天气'],
  [1032, '熬夜中'], [1051, '恋爱中'], [1052, '我没事'], [1056, '嗨到飞起'],
  [1058, '元气满满'], [1059, '悠哉哉'], [1060, '无聊中'], [1061, '想静静'],
  [1062, '我太难了'], [1063, '一言难尽'], [1070, '宝宝认证'], [1071, '好运锦鲤'],
  [1201, '水逆退散'], [1300, '摸鱼中'], [1401, 'emo中'], [2001, '难得糊涂'],
  [2003, '出去浪'], [2006, '爱你'], [2012, '肝作业'], [2013, '我想开了'],
  [2014, '被掏空'], [2015, '去旅行'], [2019, '我crash了'], [2023, '搬砖中'],
  [2025, '一起元梦'], [2026, '求星搭子'], [2037, '春日限定'],
]);

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').trim().slice(0, max) : '';
}

function qqPresence(data) {
  const status = Number(data?.status);
  if (status !== 10) return presence.get(status) || '';
  const ext = Number(data?.extStatus ?? data?.ext_status);
  if (ext === 2000) return cleanText(data.customStatus?.wording, 80) || '在线（自定义状态）';
  if (Number.isSafeInteger(ext) && ext > 0) return extendedPresence.get(ext) || '在线（扩展状态 ' + ext + '）';
  return '在线';
}

export function boundSelfProfileScope({accountId, connection, paused, stopped}) {
  let state = 'ready';
  if (paused) state = 'paused';
  else if (stopped || !connection?.ready) state = 'offline';
  else if (connection.qqAccountId !== accountId || !qqIdPattern.test(connection.qqSenderId || '')) state = 'unbound';
  const bound = state === 'ready';
  return {
    state, accountId, selfId: bound ? String(connection.qqSenderId) : '',
    connection: bound ? connection : null, revision: bound ? connection.qqReceiverRevision : 0,
  };
}

function sameBinding(a, b) {
  return b.state === 'ready' && a.connection === b.connection && a.revision === b.revision &&
    a.accountId === b.accountId && a.selfId === b.selfId;
}

function identityFields(scope) {
  const login = scope.connection?.qqProfileLogin;
  const bound = scope.state === 'ready';
  return {
    state: bound ? 'partial' : scope.state, accountId: scope.accountId, selfId: scope.selfId,
    nickname: bound && login?.revision === scope.revision && login?.selfId === scope.selfId ? cleanText(login.nickname, 80) : '',
    avatarUrl: bound ? 'https://q.qlogo.cn/headimg_dl?dst_uin=' + scope.selfId + '&spec=640&img_type=jpg' : '',
    signature: '', onlineStatus: '', updatedAt: 0,
  };
}

export function createSelfProfileReader({getScope, request, now = Date.now}) {
  // Only the current binding is retained. Ordinary status polling never calls this reader.
  let entry = null;

  async function load(scope) {
    const result = identityFields(scope);
    const params = {user_id: scope.selfId};
    let profile;
    try { profile = await request('get_stranger_info', params, 3500); } catch {}
    if (!sameBinding(scope, getScope())) return result;
    // A response with no matching identity must never supply another person's fields.
    const returnedId = profile?.user_id;
    const verified = (typeof returnedId === 'string' || Number.isSafeInteger(returnedId)) && String(returnedId) === scope.selfId;
    const signature = verified ? (profile.long_nick ?? profile.longNick) : undefined;
    if (verified) {
      result.nickname = cleanText(profile.nickname, 80) || cleanText(profile.nick, 80) || result.nickname;
      result.signature = cleanText(signature, 512);
      result.onlineStatus = qqPresence(profile);
    }
    if (!result.onlineStatus && Number.isSafeInteger(Number(scope.selfId))) {
      try { result.onlineStatus = qqPresence(await request('nc_get_user_status', params, 2500)); } catch {}
    }
    if (verified || result.onlineStatus) result.updatedAt = now();
    if (verified && typeof signature === 'string' && result.nickname && result.onlineStatus) result.state = 'ready';
    return result;
  }

  const read = async function read() {
    const scope = getScope();
    if (scope.state !== 'ready') {
      entry = null;
      return identityFields(scope);
    }
    if (!entry || !sameBinding(entry.scope, scope) || now() >= entry.expires) {
      const next = {scope, expires: Infinity, pending: null};
      entry = next;
      next.pending = load(scope).then(result => {
        next.expires = now() + (result.state === 'ready' ? profileTtl : partialTtl);
        return result;
      });
    }
    const value = await entry.pending;
    const current = getScope();
    return sameBinding(scope, current) ? {...value} : identityFields(current);
  };
  read.invalidate = () => { entry = null; };
  return read;
}
