import {calendarNow} from './life-memory.js';

const hour = 60 * 60_000;
const greeting = /^(?:早|早安|早上好|上午好|中午好|午安|下午好|晚上好)[呀啊哦喔啦呢～~]*$/u;
const goodnight = /^晚安[呀啊哦喔啦呢～~]*$/u;
const waking = /^(?:(?:我)?(?:刚刚?|才|这才)(?:睡醒|醒来|醒|起床)(?:了)?|(?:我)?(?:睡醒|醒|起床)了)[呀啊哦啦呢～~]*$/u;
const routines = [
  {
    activity: '休息',
    says: /^(?:我)?(?:先|要|得|准备|打算|马上|这就)?(?:去)?(?:睡(?:觉|会儿)?|补个觉|午睡|午休|休息)(?:了|啦|一会儿|一下)?[呀啊哦啦呢～~]*$/u,
    asks: /(?:睡醒|起床|醒|睡着)(?:了)?(?:没|吗|嘛|了[？?])|还没睡[吗嘛？?]/u,
  },
  {
    activity: '洗澡',
    says: /^(?:我)?(?:先|要|得|准备|打算|这就)?(?:去)?洗(?:个|一下)?澡(?:了|去)?[呀啊哦啦呢～~]*$/u,
    asks: /(?:澡?洗完|洗好)(?:澡)?(?:了)?(?:没|吗|嘛|了[？?])/u,
  },
  {
    activity: '吃饭',
    says: /^(?:我)?(?:先|要|得|准备|打算|这就|马上)?(?:去)?吃(?:早饭|早餐|午饭|午餐|晚饭|晚餐|饭)(?:了|去)?[呀啊哦啦呢～~]*$/u,
    asks: /(?:饭?吃完|吃好)(?:早饭|午饭|晚饭|饭)?(?:了)?(?:没|吗|嘛|了[？?])/u,
  },
  {
    activity: '修东西',
    says: /^(?:等(?:一下|一会儿)?我(?:先|再)?|我(?:先|再|去|要|得|这就))修|^我修(?:修|一下|一会儿)/u,
    asks: /(?:修好|修完)(?:了)?(?:没|吗|嘛|了[？?])|修到哪(?:里|儿|一步)|修得怎么样/u,
  },
];

export const conversationTime = at => calendarNow(at, 'Asia/Shanghai');

function withoutQuotes(value) {
  return String(value ?? '').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, ' ').trim();
}

function clauses(words) {
  return withoutQuotes(words).split(/[，,。！!；;\n]/u)
    .map(clause => clause.trim().replace(/^(?:得了\s*){1,2}/u, ''))
    .filter(clause => clause && !/[？?]/u.test(clause));
}

function routineDeparture(words, turns = clauses(words)) {
  if (/提醒我|问我|叫醒我|催我/u.test(withoutQuotes(words))) return null;
  return routines.find(({says}) => turns.some(turn => says.test(turn))) || null;
}

export function conversationTimingHint(words, {now = Date.now(), receivedAt = now} = {}) {
  const turns = clauses(words);
  let guidance = '';
  if (turns.some(turn => waking.test(turn))) {
    guidance = '对方说自己刚醒。顺着这句话问候或接个轻松的梗。入睡时间、醒来的原因、睡了多久和是否吃过饭都未知。钟点已给出，留作背景，不用再问几点。';
  } else if (turns.some(turn => goodnight.test(turn))) {
    guidance = '晚安用于休息或道别。顺着回句晚安，留出结束聊天的空间。省去自己的离线状态、接下来的计划和续聊问题。';
  } else if (greeting.test(turns[0] || '')) {
    guidance = '顺着对方回个招呼。早安也可以接刚醒的人，晚上好用于开场。简单问好可以就此停住，自己的近况只提已有依据的，省掉无话找话的追问。';
  } else if (routineDeparture(words, turns)) {
    guidance = '对方提到接下来要做的事。若话在收尾，接一句就够了。让对方去忙，休息时顺着道别，不布置任务或催他回来。';
  }
  if (!guidance) return '';
  const current = conversationTime(now);
  const sent = Number(receivedAt) > 0 && now - Number(receivedAt) >= hour ? conversationTime(Number(receivedAt)) : null;
  return '【问候与收尾】现在 '+current.clock+'。'+(sent?'这句话发于 '+sent.day+' '+sent.clock+'，按当时的语境接。':'')+guidance;
}

export function initiativeTimingHint(lastUser, now = Date.now()) {
  if (!lastUser) return '';
  const elapsed = now - Number(lastUser.at);
  const earlierDay = elapsed >= hour && conversationTime(Number(lastUser.at)).day !== conversationTime(now).day;
  const routine = routineDeparture(lastUser.text);
  return [
    (earlierDay || elapsed >= 6 * hour) && '上次对方发言已隔了很久。旧话当背景，开场贴合当前时段。是否已醒、已吃饭或正在忙都未知。',
    routine && '对方之前说要'+routine.activity+'，进度未知。让这段话自然收尾，有具体的新想法可照常分享。',
  ].filter(Boolean).join('');
}

export function routineFollowupDenial(words, lastUser) {
  const routine = lastUser && routineDeparture(lastUser.text);
  if (!routine) return '';
  const text = withoutQuotes(words).replace(/\[[^\]\n]*\]/gu, '');
  return routine.asks.test(text) ? '对方说要'+routine.activity+'，未要求追问进度' : '';
}
