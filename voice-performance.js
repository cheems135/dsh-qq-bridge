// Emotion is carried by several acoustic channels at once, and the channels differ
// in how well each one survives a full spoken line:
//  - Banse & Scherer (1996): emotion is indexed by F0 mean/variability, energy,
//    duration and voice quality together, not by pitch alone.
//  - Juslin & Laukka (2003): those cue patterns are consistent across vocal and
//    musical expression, and anger/sadness are the most reliably decoded.
//  - Lausen & Hammerschmidt (2020): vocal bursts are decoded better than emotion
//    embedded in running speech, which is diluted over a longer utterance.
//  - Chang et al. (2023), Wang et al. (2018): in Mandarin lexical tone competes
//    for F0, so emotional F0 movement is tighter while duration and amplitude
//    carry more of the load; ANGRY is the best recognised.
// Practical rules for this bridge:
//  1. The caller's direction is never dropped; it is merged, once.
//  2. Keep the direction to one short sentence, like the official examples.
//     Long, labelled, bullet-style directions are read aloud by the model.
//  3. Ordinary speech uses directions; event tags require an explicit selection.
//  4. Respect the saved speech guidance and speed rather than scaling by emotion.

export const VOICE_PERFORMANCE_REVISION = '20261116-contextual-voice-v12';

// 情绪方向描述表演，音色身份仍由所选声音决定；不能把音色漂移视为已验收。
// arousal describes a profile; it does not override saved synthesis parameters.
// Each profile keeps two short cue phrases: the least ambiguous ones for that state.
const PROFILES = {
  angry: {arousal: .95, mood:'生气', cues:['音量提一档、字咬实','语速略快、停顿短而硬'], scene:'真的被惹到了，但还留着一分克制', note:''},
  crying: {arousal: .95, mood:'哭腔', cues:['说话断断续续、吸气很浅','句尾抖着散掉'], scene:'被人弄哭、还在硬撑着说话，想让他心软', note:''},
  afraid: {arousal: .9, mood:'害怕', scene:'被吓到，缩在那儿想让人来又怕他靠近', cues:['忍不住漏出来的哭，不是撒娇','话断断续续、吸气很浅'], note:''},
  excited: {arousal: .9, mood:'兴奋', cues:['语速快、音高跳得开','带笑的气声'], scene:'憋不住的好消息，抢着说', note:''},
  surprised: {arousal: .8, mood:'惊讶', scene:'被打了个措手不及', cues:['开口先高一下再回落','语气急'], note:''},
  happy: {arousal: .75, mood:'开心', cues:['笑着说话的声音','语速轻快、句尾轻轻上扬'], note:''},
  playful: {arousal: .7, mood:'俏皮', cues:['节奏有点跳','重音落在关键词'], note:''},
  teasing: {arousal: .7, mood:'挑逗', cues:['带笑的气声','重音故意放偏'], scene:'故意逗他，想看他的反应', note:''},
  nervous: {arousal: .7, mood:'紧张', scene:'心里没底，急着把话说圆', cues:['换气浅、句首抢字','语速忽快忽慢'], note:''},
  anxiety: {arousal: .7, mood:'不安', cues:['越说越急但音量不大','句中塞短停顿'], note:''},
  jealousy: {arousal: .65, mood:'吃醋', cues:['字咬得比平时紧','尾音往下压'], note:''},
  anticipation: {arousal: .65, mood:'期待', cues:['语速快半拍','笑意先出来'], note:''},
  commanding: {arousal: .6, mood:'强势', cues:['音量足、句尾往下砸','停顿短而硬'], note:''},
  disgust: {arousal: .6, mood:'嫌弃', cues:['鼻子先哼一声','尾字往外吐'], note:''},
  smug: {arousal: .55, mood:'得意', cues:['语速慢而稳、尾音往上挑','带笑'], scene:'心里已经赢了，慢慢说给他听', note:''},
  sarcastic: {arousal: .55, mood:'嘲讽', cues:['拖腔、重音故意放错','笑意没到眼睛里'], note:''},
  curiosity: {arousal: .55, mood:'好奇', cues:['句尾往上勾','语速偏快'], note:''},
  serious: {arousal: .5, mood:'认真', cues:['音高稳、起伏很小','咬字清楚、停顿干脆'], note:''},
  moved: {arousal: .5, mood:'感动', scene:'被戳到心里那一下，忍不住', cues:['声音发颤、压着','中途停一下再说完'], note:''},
  confused: {arousal: .45, mood:'疑惑', cues:['句尾往上扬、找不到落点','边想边说'], note:''},
  natural: {arousal: .45, mood:'自然', cues:['平时说话的声音','按句意自然停顿'], note:''},
  cold: {arousal: .4, mood:'冷淡', cues:['音高平直、几乎不起伏','尾音干脆砍断'], note:''},
  tender: {arousal: .4, mood:'撒娇', cues:['尾音软下来','语速慢、句间停半拍'], scene:'贴着他耳朵撒娇，想被宠', note:''},
  shy: {arousal: .4, mood:'害羞', cues:['音量小、气息浅','句尾含糊地化掉'], scene:'有点难为情，还是想说出来', note:''},
  gentle: {arousal: .35, mood:'轻柔', cues:['音量压低一档','语速慢半拍、句尾轻轻收住'], scene:'在哄一个正在难过的人', note:''},
  relieved: {arousal: .35, mood:'松口气', cues:['开口先吐一口气','后半句比前半句轻'], note:''},
  trust: {arousal: .35, mood:'安心', cues:['语速平缓、句尾落住','音量不高但稳'], note:''},
  sad: {arousal: .3, mood:'低落', cues:['语速明显放慢、停顿拉长','音量偏低、重音弱'], scene:'把难过压在心里，不想说得太满', note:''},
  guilt: {arousal: .3, mood:'愧疚', scene:'知道自己做错了，怕被丢下', cues:['音量很小','说一半就停'], note:''},
  pity: {arousal: .3, mood:'心疼', cues:['音量压低放软','语速慢、像怕碰疼对方'], note:''},
  whisper: {arousal: .3, mood:'耳语', cues:['几乎全是气声','语速慢、字贴着气出来'], scene:'旁边有人，只能用气声说', note:''},
  helpless: {arousal: .25, mood:'无奈', scene:'怎么说都没用，已经不想争了', cues:['先叹一口','句尾无力地垂下去'], note:''},
  lonely: {arousal: .25, mood:'孤单', scene:'很久没人理，想被听见', cues:['声音空、尾音飘着','句子之间空很久'], note:''},
  tired: {arousal: .2, mood:'疲惫', cues:['音量低、句尾往下垂','越说越慢'], note:''},
  boredom: {arousal: .15, mood:'无聊', cues:['拖长音、起伏敷衍','句间空白久'], note:''},
  pained: {arousal: .85, mood:'吃痛', cues:['字尾咬紧、气从牙缝出来','到用力处咬字变形'], scene:'正在忍着痛说完整句话，不想显得太狼狈', note:''},
  breathless: {arousal: .85, mood:'急促', cues:['句子切得很短、字间都是喘气的缝','句首抢气'], scene:'刚被折腾得喘不上气，急着把话说完', note:''},
  moan: {arousal: .8, mood:'气息断续', cues:['气声压住嗓音、句子断成几截','尾音含在喉咙里'], scene:'被撩到说不出整句，还想让他继续', note:''},
  laugh: {arousal: .8, mood:'带笑', cues:['笑声混在字里','字被笑意带散'], note:''},
};
const FALLBACK = PROFILES.natural;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// 已经合并过的方向不再二次合并，避免越写越长被念出来。
const MARK = '；只改表演，不改台词。';
const MAX_DIRECTION = 160;

export function emotionProfile(mood) {
  return { mood, ...(PROFILES[mood] || FALLBACK) };
}

// Speech uses the saved guidance value; an emotion label does not authorize
// changing it. Keep the existing singing behavior separate from speech.
export function guidanceFor(mood, base = 2, performance = 'speech') {
  const value = clamp(Number.isFinite(Number(base)) ? Number(base) : 2, 1, 10);
  return performance === 'sing' ? Math.max(value, 4) : value;
}

export function composeDirection({ mood, userDirection = '', language = 'zh', extra = '', profile: given, maxLength = MAX_DIRECTION } = {}) {
  const profile = given || PROFILES[mood] || FALLBACK;
  const end = language === 'zh' ? '；保留所选声音的音色身份和口音，只改表演，不改台词。' : ' Keep the selected voice and accent. Keep the words unchanged.';
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
    .split(end.trim()).join('').split(MARK).join('')
    .replace(/[；。;\s]+$/, '').trim();
  const own=clean(userDirection),added=clean(extra);
  const parts=[own,added].filter(Boolean).filter((value,index,list)=>list.indexOf(value)===index);
  let lead=parts.join(language==='zh'?'；':'. ');
  // An actual contextual direction is complete. Defaults only fill the case
  // where there is no direction, and do not invent a relationship or event.
  if(!lead){
    const cues=(Array.isArray(profile.cues)?profile.cues:[]).slice(0,2).filter(Boolean);
    lead=language==='zh'?'用'+profile.mood+'的语气说'+(cues.length?'，'+cues.join('，'):''):'Speak naturally with the requested '+String(mood||'natural')+' emotion.';
  }
  const limit=Math.max(MAX_DIRECTION,Math.min(1000,Number(maxLength)||MAX_DIRECTION))-end.length;
  if(lead.length>limit){const cut=lead.slice(0,limit),at=Math.max(cut.lastIndexOf('；'),cut.lastIndexOf('。'),cut.lastIndexOf('，'),language==='zh'?-1:cut.lastIndexOf(' '));lead=(at>limit*.6?cut.slice(0,at):cut).trim();}
  return lead+end;
}

const BRACKET = /\[[^\]]{1,12}\]/;

// A single vocal-event tag at the head of the line. Extra anchors inside the text
// risk being read out loud on voices/models that do not support the tag set, and
// one clearly audible event at the start already carries the burst.
export function anchorTags(text, tag) {
  const body = String(text ?? '').trim();
  if (!body || !tag) return body;
  if (BRACKET.test(body)) return body;
  return tag + body;
}

export function performanceRevision() {
  return VOICE_PERFORMANCE_REVISION;
}
