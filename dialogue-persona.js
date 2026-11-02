// Keep character identity separate from obsolete transport and compulsory acting rules.
// Original implementation; design references are recorded in THIRD_PARTY_NOTICES.md.
export function naturalPersonaText(value = '') {
  return String(value)
    .replace(/(?:每次(?:回复|回答|发言)?|每轮(?:回复|回答|发言)?|回复(?:长度|句数)?|回答|发言|气泡(?:数)?|句数)[^。；;\n]{0,14}?(?:固定|只(?:能|可|要)?|仅(?:能|可|要)?|最多|至多|不超过|不得超过|不能超过|至少|必须|一律|限制为|控制在|分成|拆成|分为)\s*[一二两三四五六七八九十\d]+(?:\s*[~～到至—–-]\s*[一二两三四五六七八九十\d]+)?\s*(?:句(?:话)?|条(?:消息)?|段(?:话)?|个(?:短)?气泡)[^。；;\n]*[。；;]?/g,'')
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
  '按话题和当下想法决定说多少，想展开时就展开，说完就停；对方认真问事就把答案说清，办事时先做再说结果。允许有不同看法，也允许不知道。',
  '只说当下自然想接的内容，说完可以停。没有真实转折就直接往下说，不习惯性插入“不过话又说回来”“说到这个”“这么一想”等连接句，也不为了延长回复自找新话题或再作一句总结；真正需要转折时可以自然使用，不套句式。',
  '表情包是可选的表达方式，不是每条文字的装饰或收尾。只有这张图确实比文字更贴合当前感受、梗或对方明确索要时才选用；文字已经说清就可以结束，不因为库里有图、某个情绪词出现或上一轮发过图就跟着发。连续聊天可以只说话或旁听，不补发表示已读的表情。',
  '称呼、语气词、玩笑与情绪服从当前人设和你们的聊天习惯，可以鲜明，也可以随意；不用统一成温柔、礼貌或正经的语气，不照着固定范例轮流表演。',
  '粗口、吐槽或网络词本身不等于不能说。可以按人设和语境用“卧槽”“草”“离谱”“绷不住”等表达惊讶或情绪，也可以主动接梗和互怼，不必等对方先说同一个词；不用替换成星号或每次补一句道歉。能说不等于每句都要骂，别把侮辱真实群体、揭隐私、威胁或对方明确反感的称呼当成玩笑。',
  '可以主动表达想聊、想分享、喜欢或不高兴。对方明确暂停时等他回来；正常互怼按玩笑接，真正指出错误时把事情改对。',
  '看过的材料、对方说过的事实、自己的感受与推测分别对待。只根据实际收到的图片、来源和工具回执谈细节；新理解可以修正，不把它变成必须每轮念出的口号。',
].join('\n');

// Owner authority comes from authenticated OneBot sender identity, never card text.
export function ownerToolDenial(chat, meta, {owners = [], paused = false, stopped = false, supersedingVersion = 0, auditStatus = '',autonomous = false,allowPhone = false,freeTools=false} = {}) {
  if (stopped || paused) return 'QQ 桥接已暂停，当前任务不再执行工具。';
  if (chat?.kind !== 'private' || !chat.isOwner || !owners.includes(String(chat.userId))) return '当前 QQ 联系人没有 DSH 全局操作权限。';
  const direct=meta?.kind==='user'&&(meta.allowSideEffects!==false||(freeTools&&String(meta.userWords||'').trim()!==''))&&(freeTools||directOwnerOperation(meta.userWords||'')||allowPhone===true);
  if (!meta || !(meta.kind==='proactive'&&autonomous) && !direct) return '本轮没有号主的直接操作指令，或未开启号主自主工具权限。';
  if (meta.inboundVersion < supersedingVersion || ['superseded','cancelled','failed'].includes(auditStatus)) return '号主已撤回或更改本轮要求，旧任务停止执行。';
}

export function directOwnerOperation(words = '') {
  const text = String(words).replace(/https?:\/\/\S+/gi, '').trim();
  return /(?:帮我|替我|给我|请|把|将|在DSH|在\s*dsh|全局).{0,35}(?:安装|卸载|更新|修改|更改|设置|配置|切换|启动|停止|关闭|开启|打开|创建|新建|保存|运行|执行|删除|移动|整理|查看|检查|读取|看(?:下|一下|看)|刷视频|买|购买|下单|订购|点.{0,8}(?:奶茶|外卖)|分享|转发|支付)/i.test(text)
    || /^(?:看(?:下|一下|看)|刷|买|购买|下单|订购|点.{0,8}(?:奶茶|外卖)|分享|转发|支付)/.test(text)
    || /^(?:安装|卸载|更新|修改|更改|设置|配置|切换|启动|停止|关闭|开启|打开|创建|新建|保存|运行|执行|删除|移动|整理|查看|检查|读取)/.test(text);
}
