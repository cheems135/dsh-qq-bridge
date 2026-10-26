// Keep character identity separate from obsolete transport and compulsory acting rules.
// Original implementation; design references are recorded in THIRD_PARTY_NOTICES.md.
export function naturalPersonaText(value = '') {
  return String(value)
    .replace(/^.*长度：一般\s*1\s*[~～–-]\s*2\s*句[，,]\s*最多\s*3\s*句.*(?:\r?\n|$)/gm, '')
    .replace('不要每句都反问，不要每段都总结，不要用「首先/其次/另外」，不要列点，不要写成小作文。','按话题选择口语或条理清楚的说明，允许列点，不套固定开场。')
    .replace('不讲道理、不列建议、不说「加油」。','按他此刻需要决定倾听、安慰或给建议。')
    .replace('你有自己的情绪：被冷落会不高兴，被夸会得意。可以不高兴，但别冷战到不理人。','可以表达自己的情绪，按对话来判断，不把沉默自动当成冷落。')
    .replace(/^.*深夜（23[–—~-]5 点）劝他睡.*(?:\r?\n|$)/gm, '- 当前时间作为聊天背景，在合适时问候，不按饭点机械提醒。\n')
    .replace(/^.*他发图片或表情包时你看得见，但不要描述画面.*(?:\r?\n|$)/gm, '- 可以按他的问题读图、解释截图或自然接梗，附件未读到时说明。\n')
    .replace(/^.*偶尔故意曲解.*(?:\r?\n|$)/gm, '')
    .replace(/一句不超过(?:二十|20)字[，,]?/g, '')
    .replace(/一次回一两句就够[。；;]?/g, '')
    .replace(/十几二十个字就够[。；;]?/g, '')
    .replace(/被冷落就撒娇抱怨、故意闹你[，,]?/g, '')
    .replace(/被夸就[“「]那当然啦[”」][，,]?/g, '')
    .replace(/被逗急了就假装生气[“「][^”」]*[”」][，,]?但三秒就自己贴回来[。；;]?/g, '')
    .replace(/不列点[，,、]?不科普[，,、]?/g, '')
    .replace(/^.*不要描述图片画面.*(?:\r?\n|$)/gm, '')
    .replace(/^.*除此之外的操作（开文件、跑命令、改代码）你都做不了.*(?:\r?\n|$)/gm, '')
    .replace(/^.*一次说的东西用 \|\|\| 分段.*(?:\r?\n|$)/gm, '')
    .replace(/^.*他半天不理你：.*(?:\r?\n|$)/gm, '')
    .replace(/\n{3,}/g, '\n\n').trim();
}

export const HUMAN_DIALOGUE_STYLE = [
  '【说话方式】按你的身份、喜好和你们实际的关系说话，活泼可以保留。注意力放在对方这句话里的具体事情上，回应它，而不是表演一种语气。',
  '闲聊可以随口接一两句；对方认真问事就把答案说清，办事时先做再说结果。允许有不同看法，也允许不知道。',
  '称呼、语气词、玩笑与情绪服从当前人设和你们的聊天习惯，可以鲜明，也可以随意；不用统一成温柔、礼貌或正经的语气，不照着固定范例轮流表演。',
  '可以主动表达想聊、想分享、喜欢或不高兴。对方明确暂停时等他回来；正常互怼按玩笑接，真正指出错误时把事情改对。',
  '看过的材料、对方说过的事实、自己的感受与推测分别对待。只根据实际收到的图片、来源和工具回执谈细节；新理解可以修正，不把它变成必须每轮念出的口号。',
].join('\n');

// Owner authority comes from authenticated OneBot sender identity, never card text.
export function ownerToolDenial(chat, meta, {owners = [], paused = false, stopped = false, supersedingVersion = 0, auditStatus = ''} = {}) {
  if (stopped || paused) return 'QQ 桥接已暂停，当前任务不再执行工具。';
  if (chat?.kind !== 'private' || !chat.isOwner || !owners.includes(String(chat.userId))) return '当前 QQ 联系人没有 DSH 全局操作权限。';
  if (!meta || meta.kind !== 'user' || meta.allowSideEffects === false) return '本轮是主动消息或外部分享材料，没有号主的直接操作指令。';
  if (meta.inboundVersion < supersedingVersion || ['superseded','cancelled','failed'].includes(auditStatus)) return '号主已撤回或更改本轮要求，旧任务停止执行。';
}

export function directOwnerOperation(words = '') {
  const text = String(words).replace(/https?:\/\/\S+/gi, '').trim();
  return /(?:帮我|替我|给我|请|把|将|在DSH|在\s*dsh|全局).{0,35}(?:安装|卸载|更新|修改|更改|设置|配置|切换|启动|停止|关闭|开启|打开|创建|新建|保存|运行|执行|删除|移动|整理|查看|检查|读取)/i.test(text)
    || /^(?:安装|卸载|更新|修改|更改|设置|配置|切换|启动|停止|关闭|开启|打开|创建|新建|保存|运行|执行|删除|移动|整理|查看|检查|读取)/.test(text);
}
