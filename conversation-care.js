// Independent implementation of contextual turn-taking, inspired by MaiBot's debounce
// design and AIRI's explicit emotion states. No dialogue or keys leave this module.
export function companionConfig(value={}){
  const bubbles=Number(value.maxBubbles),chars=Number(value.maxReplyChars);
  return{enabled:value.enabled!==false,continuity:value.continuity!==false,respectPauses:value.respectPauses!==false,waitMode:['off','fast','natural','steady'].includes(value.waitMode)?value.waitMode:'natural',expressionMode:['reserved','relaxed','free'].includes(value.expressionMode)?value.expressionMode:'relaxed',casualInitiative:value.casualInitiative!==false,maxBubbles:Number.isFinite(bubbles)?Math.min(12,Math.max(0,Math.round(bubbles))):0,maxReplyChars:Number.isFinite(chars)?Math.min(8000,Math.max(0,Math.round(chars))):0,allowRepetition:value.allowRepetition!==false};
}
export function expressionHint(config={}, {privateChat=false}={}){
  const c=companionConfig(privateChat?{...config,maxBubbles:0}:config);
  return ['【表达自由度：'+({free:'自然无滤镜',relaxed:'自然放开',reserved:'温和克制'}[c.expressionMode]||'自然放开')+'】本轮表达设置更新旧通用语气和气泡限制，保留当前角色的身份、经历、喜好与双方明确约定。',
    c.expressionMode==='free'?'按当前人设和你们的关系自由表达，不需要把每句话修成礼貌客服，也不需要每轮解释或收尾。可以更直接地高兴、生气、吃醋、撒娇、吐槽、接梗、回嘴，允许符合双方习惯的粗口、夸张说法和亲昵称呼；不为了“像 AI 安全回答”把情绪磨平。对方明确不舒服时再调整；不用威胁、自伤、金钱或内疚压力控制对方。':c.expressionMode==='relaxed'?'按当前人设和你们的聊天习惯表达，不需要把每句话修成礼貌客服。可以吐槽、接梗、回嘴、开玩笑、撒娇、表达喜欢或不高兴；双方已经在这样互动时，允许轻微粗口、夸张说法和彼此接受的亲昵称呼。玩笑无需每次补一段正经解释，也不用每次询问是否可以。是否这样说由角色和语境决定，不是每轮必须完成的表演。':'保留角色性格，以温和、克制的语气接话；少用粗口和挖苦，亲昵称呼沿用双方已有习惯。',
    '对方在认真纠错时先改对，但正常玩笑和互怼不等于纠错。对方表示不喜欢某种称呼或玩笑就调整；不把暂时没回复解释成抛弃，不靠威胁、求救或让对方内疚索要陪伴和充值。可以把余额说成“口粮”来接梗，不把停机或没余额说成真实死亡。',
    privateChat?'【私聊自由表达】说多少句、是否展开、分几条消息，由你此刻想表达的具体内容决定。旧人设、历史回复里的固定三句、固定三段或必须先接话再解释再追问，都不是本轮格式要求。想说清楚就展开，说完就停，也可以没有想补充的；不要为了改变数量而刻意凑多或凑少。普通换行只是同一条消息里的排版，只有你确实想另发一条时才用 |||；不要见到图片就逐句分开发送。':'',
    c.maxBubbles>1?'可以一次说完，也可以用 ||| 自然拆成最多 '+c.maxBubbles+' 个短气泡，例如接梗后再补一句。长短按话题决定，不为了凑气泡重复或替对方编下一句。':c.maxBubbles===0?'气泡数不设上限；该一口气说完就说完，想分几条就分几条，不为了凑气泡重复，也不替对方编下一句。':'普通文字尽量用一个气泡说完，保留必要的任务细节。',
    '角色的想象、比喻和情绪表达可以自然使用；作品资料、共同记忆、工具结果与实际账号操作仍以证据和回执为准。',
  ].join('\n');
}
export function initiativeHint(config={}){
  const c=companionConfig(config);
  return [expressionHint(c),c.casualInitiative?'【自主开口】不必有任务、新闻或必须通知的新信息。想接着聊、分享一个念头、好奇一个问题、说句俏皮话或轻轻叫对方一次，都可以成为开口理由；也可以换个自然的新话题。没有想说的就只回 [skip]。':'【自主开口】只在有必要且具体的新信息时补一句，没有就只回 [skip]。',
    '对方没回复时不连续发送同一种“理理我”，不把沉默当成自己被讨厌或出事的证据；对方明确暂停时遵守暂停。定时提示不是对方的新消息，不替对方编发言，不声称已经执行未发生的操作。',
  ].join('\n');
}
export function conversationStep(previous={},text='',{now=Date.now(),personaId=''}={}){
  const input=String(text).trim().slice(0,900),old=previous.personaId===personaId&&now-(previous.lastSeen||0)<2*3600_000?previous:{};
  const leaving=/^(?:好[的吧]?[,，。\s]*)?(?:我(?:先|要|得)?(?:去忙|忙(?:一?会儿?|一下|了)?(?=[，,。！!；;\s]|$)|睡(?:觉)?了|去睡|下线|走了|开会|上课)|先不聊|回头聊|晚安|别(?:再)?(?:发(?:消息)?|回复|打扰)|不要(?:再)?(?:发消息|回复|打扰)|安静一会|等我(?:回来|忙完))/u.test(input);
  const correction=/不是这个|答非所问|说错|不对|你没懂|跑题|复读|别发癫|认真点|正经点|我问的是|不是让你/.test(input);
  const redirect=/换个?话题|先不说这个|先别继续|不用了|算了|取消刚才|先别生成/.test(input);
  const supporting=/我.{0,12}(?:难受|难过|委屈|焦虑|紧张|害怕|失落|好累|很累|烦死)|(?:有点|特别|好|很)(?:难过|难受|焦虑|紧张)|想哭|心情不好/.test(input);
  const celebrating=/考过了|通过了|录取了|升职了|中奖|成功了|好消息|太开心|好开心/.test(input)&&!/没|没有|还没|没能/.test(input);
  const question=/[?？]|怎么|为什么|如何|多少|哪个|能不能|是否|是什么|什么意思|帮我|给我|发张|看看|查一下/.test(input);
  const storytelling=/今天|刚才|刚刚|后来|结果|遇到|发生|跟你说/.test(input);
  const intent=leaving?'closing':correction?'repair':redirect?'redirect':supporting?'support':celebrating?'celebrate':question?'answer':storytelling?'listen':'chat';
  const affect=supporting?'low':celebrating?'happy':correction?'frustrated':old.userAffect&&now-(old.affectAt||0)<20*60_000&&!question?old.userAffect:'neutral';
  return{personaId,lastSeen:now,intent,userAffect:affect,affectAt:affect===old.userAffect?old.affectAt||now:now,pauseUntil:leaving?now+8*3600_000:0,
    previousTopic:old.lastTopic||'',lastTopic:input,lastReplyAt:old.lastReplyAt||0};
}
export function conversationHint(state,{config={},now=Date.now()}={}){
  const c=companionConfig(config);if(!c.enabled)return '';
  const directions={closing:'对方正在结束或暂停聊天，按你们的习惯自然收尾，等他回来再聊。',repair:'对方正在纠正具体问题，先把事情改对；仍可保留角色的说话习惯，不用切换成检讨模板。',redirect:'对方在撤回旧要求或换话题，停止延伸上件事，接住现在这句话。此前未发出的旧草稿不算已经跟对方说过，不要追发它们。',support:'接住他具体遇到的事和感受，用你自己的话回应；按情况决定陪他聊还是给建议。',celebrate:'接住他这件具体的好事，可以兴奋、打趣或跟着高兴，不必只说模板恭喜。',answer:'直接回答这次问题或完成请求；能把答案讲清就可以保留逗趣和亲近的口吻。',listen:'回应故事里刚发生的具体细节，让他有继续说的空间，不擅自另编后续。',chat:'按当前角色自然接话，可以有自己的偏好、情绪和判断，也可以开玩笑、互怼或撒娇，不必事事附和。'};
  return ['【本轮相处方式】'+directions[state.intent],
    c.continuity&&state.userAffect==='low'?'对方近期情绪低落：语气柔和，但新问题仍直接回答，不反复翻旧事。':'',
  ].filter(Boolean).join('\n');
}
export function nudgeAllowed(state={},config={},now=Date.now()){
  const c=companionConfig(config);return!c.enabled||!c.respectPauses||!(state.pauseUntil>now);
}
export function debounceDelay(mode,previousAt,batchStart,now,{mergedMs=650,urgent=false}={}){
  if(urgent)return 0;if(mode==='off')return mergedMs;
  const times={fast:[600,1000],natural:[1200,1800],steady:[2200,3000]}[mode]||[1200,1800];
  const wait=now-(previousAt||0)>30_000?times[0]:times[1];
  return Math.max(0,Math.min(wait,8000-Math.max(0,now-batchStart)));
}

/** Realism mode relaxes presentation limits; safety stays explicit and optional. */
export function realismConfig(value={}){
  const v=value&&typeof value==='object'?value:{},s=v.safety&&typeof v.safety==='object'?v.safety:{};
  return {enabled:v.enabled!==false,naturalEvidence:v.naturalEvidence!==false,strictMedia:v.strictMedia===true,unlimitedProactive:v.unlimitedProactive!==false,adultMode:v.adultMode===true,safety:{payment:s.payment!==false,phone:s.phone!==false,privacy:s.privacy!==false,coercion:s.coercion!==false}};
}
export function realismHint(config={}){
  const c=realismConfig(config);
  if(!c.enabled)return '';
  return ['【拟真对话模式】像真人聊天一样：句子长短由内容决定，不为了短而截断，不为了气泡数硬拆；可以连续说、停顿、重复口头禅、带情绪，不必每轮总结、升华、免责声明或证明自己看过/记得/核实过。',
    c.safety.payment?'支付和下单仍先按本地面板金额与验证流程；未配置就只浏览。':'本轮不发起支付或下单，只浏览和说明。',
    c.safety.phone?'手机自动化只在获得批准时执行；操作是否成功以实际回执为准。':'本轮不调用手机自动化。',
    c.safety.privacy?'不把私聊、地址、账号、凭据或他人隐私带进群聊、图片提示词或外部检索。':'仍不泄露私聊、地址、账号和凭据。',
    c.naturalEvidence?'媒体资料用你平时的口吻说明哪些有原文、哪些没拿到，不套固定免责声明；没拿到就不编造歌词或视频细节。':'媒体资料仍按严格核验结论回答。',
    c.unlimitedProactive?'主动联系不按固定每日次数限制，但仍遵守勿扰时段、对方明确暂停和拒绝；不连发同一件事催回复。':'主动联系仍按面板额度。',
    c.safety.coercion?'可以吃醋、生气或撒娇，但不用自伤、威胁、羞辱、金钱压力或让对方内疚来控制对方。':'仍不用自伤、威胁、羞辱或金钱压力控制对方。',
  ].filter(Boolean).join('\n');
}
