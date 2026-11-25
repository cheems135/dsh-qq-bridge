import {QQ_LINE_BREAK_RULE} from './chat-bubbles.js';
import {PRIVATE_CHAT_PACING} from './dialogue-persona.js';
import {ownClauses, supportReading, supportGuide, socialBoundary, progressReading} from './companion-insight.js';

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
    privateChat?PRIVATE_CHAT_PACING:'',
    QQ_LINE_BREAK_RULE,
    ...(c.maxReplyChars>0?['每行尽量控制在'+c.maxReplyChars+'字以内。']:[]),
    privateChat?'':c.maxBubbles>1?'可以一次说完，也可以自然拆成最多 '+c.maxBubbles+' 个短气泡，例如接梗后再补一句。长短按话题决定，不为了凑气泡重复或替对方编下一句。':c.maxBubbles===0?'气泡数不设上限；该一口气说完就说完，想分几条就分几条，不为了凑气泡重复，也不替对方编下一句。':'普通文字尽量用一个气泡说完，保留必要的任务细节。',
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
  const clauses=ownClauses(input);
  const speech=clauses.join('，');
  const last=clauses.at(-1)||'';
  const explicitPause=/^(?:(?:先)?(?:别|不要)(?:再)?(?:(?:给我)?发(?:消息)?|回复(?:我)?|打扰(?:我)?)|安静一会儿?|等我(?:回来|忙完))[啦了啊呀哦哈～~]*$/u;
  const farewell=/^(?:我(?:先|要|得)?(?:去忙|忙(?:一?会儿?|一下|了)?|(?:去)?睡(?:觉)?了?|下线|走了|(?:去)?开会|(?:去)?上课)|先不聊|回头聊|(?:晚点|明天)再(?:聊|说)|拜拜|晚安)[啦了啊呀哦哈～~]*$/u;
  const leaving=clauses.some(clause=>explicitPause.test(clause))||farewell.test(last);
  const stanceCorrection=/(?:^|[，,。！!]\s*)我(?:并|可|真)?(?:没(?:有)?|不是)(?:嫌你|怪你|催你|生气|在生气)/u.test(speech);
  const repeatedLine=/(?:^|[，,。！!]\s*)(?:我(?:只|就)?是说\s*)?你(?:是不是)?(?:只会|只记得|又在说|又说|老说|一直说|总(?:是)?(?:说|重复))(?:这句|同一句|同样的话)/u.test(speech);
  const correction=clauses.some(clause=>/^(?:(?:你(?:刚刚?|又)?(?:理解|说|听|看|答)错(?:了|啦)|(?:你)?(?:答非所问|跑题了|又在复读)|不是这个(?:意思|[啊呀啦了]|$)|你没懂|我问的是|不是让你|别发癫|认真点|正经点)|(?:不对|说错了)[啊呀啦哦]?$)/u.test(clause));
  const redirect=/^算了[吧啊呀啦哦～~]*$/u.test(last)||clauses.some(clause=>/^(?:(?:我们|咱们)?换个?话题|先不说这个|先别继续|取消刚才|(?:先)?别(?:再)?(?:生成|发送))|^不用了[吧啊呀啦哦～~]*$/u.test(clause));
  const support=supportReading(clauses);
  const progress=progressReading(clauses);
  const question=/[?？]|怎么|为什么|如何|多少|哪个|能不能|是否|是什么|什么意思|帮我|给我|发张|看看|查一下|对不对/.test(speech);
  const sameDifficulty=old.userAffect==='low'&&now-old.affectAt<20*60_000&&/^(?:还是|就(?:是)?)(?:刚才|之前|昨天)(?:说的)?那件事[啊呀啦哦。！!～~]*$/u.test(speech);
  const storytelling=sameDifficulty||/今天|刚才|刚刚|后来|结果|遇到|发生|跟你说/.test(speech);
  const focusOnSupport=support&&(support.mode!=='support'||!question);
  const low=!!support?.emotion||sameDifficulty||progress.disappointed;
  const affect=progress.happy?(low?'mixed':progress.qualified?'unknown':'happy'):(low?'low':'unknown');
  let intent=leaving?'closing':correction?'repair':redirect?'redirect':socialBoundary(clauses)?'boundary':stanceCorrection||repeatedLine?'reframe':null;
  if(!intent){
    if(focusOnSupport&&support.mode!=='support')intent='support';
    else if(question)intent='answer';
    else if(affect==='mixed')intent='mixed';
    else if(focusOnSupport||progress.disappointed)intent='support';
    else if(affect==='happy')intent='celebrate';
    else intent=storytelling?'listen':'chat';
  }
  return{personaId,lastSeen:now,intent,userAffect:affect,affectAt:affect===old.userAffect?old.affectAt||now:now,pauseUntil:leaving?now+8*3600_000:0,
    ...(intent==='reframe'?{feedback:{repeatedLine,stanceCorrection}}:{}),
    ...(support?{support}:{}),
    ...(sameDifficulty?{sameDifficulty:true}:{}),
    previousTopic:old.lastTopic||'',lastTopic:input,lastReplyAt:old.lastReplyAt||0};
}
export function conversationHint(state,{config={},now=Date.now()}={}){
  const c=companionConfig(config);if(!c.enabled)return '';
  const directions={closing:'对方正在结束或暂停聊天，按你们的习惯自然收尾，等他回来再聊。',repair:'先把事情改对，按对方纠正后的意思接话。别重复旧话、猜他在生气或转成检讨。',redirect:'对方在撤回旧要求或换话题，停止延伸上件事，接住现在这句话。此前未发出的旧草稿不算已经跟对方说过，不要追发它们。',support:'接住他具体遇到的事和感受，用你自己的话回应；按情况决定陪他聊还是给建议。',celebrate:'这次进展值得他特意告诉你。用你真正在意的细节陪他高兴，成果大小由他自己衡量。',answer:'直接回答这次问题或完成请求。对方明确回到先前话题时，只接他现在问的那件事。',listen:'回应故事里刚发生的具体细节，让他有继续说的空间，不擅自另编后续。',chat:'按当前角色自然接话，可以有自己的偏好、情绪和判断，也可以开玩笑、互怼或撒娇，不必事事附和。'};
  let direction=directions[state.intent];
  if(state.intent==='mixed')direction='他对同一件事提到了不同感受。按你对他的了解接住两边，允许他自己说哪一点更要紧。';
  if(state.intent==='support'&&!state.support)direction='他讲的投入和结果有落差。按你们的关系回应这个落差，想不想继续做、要不要主意留给他。';
  if(state.intent==='boundary')direction='他在认真告诉你哪种对待方式让他不舒服。看上文自己实际说了什么，具体认下那件事，告诉他今后会怎么做。只承担确实发生的事。';
  if(state.intent==='support'&&state.support?.mode==='listen')direction=state.support.vent
    ? '他已经在跟你吐槽。上文有具体经历时，挑其中最让你有反应的一点，顺着那件事说出你的感受或看法。还没讲缘由，才留点空听他讲。办法等他想听再提。'
    : '对方想把话说完。接住他刚讲的细节，留点空给他继续。';
  if(state.intent==='support'&&state.support?.mode==='advice')direction='对方已经开口求办法。就他遇到的具体事提个能用的主意，让他自己选。';
  if(state.intent==='support'&&state.support?.mode==='support')direction+=supportGuide(state.support.emotion);
  if(state.intent==='reframe'){
    const {repeatedLine,stanceCorrection}=state.feedback||{};
    if(repeatedLine&&stanceCorrection)direction='同时接住两层意思：对方指出你在重复一句话，也澄清他并未嫌你烦。重复的说法仍要改。简短接过，别反复解释自己或继续旧追问。';
    else if(repeatedLine)direction='接住对方指出的重复。话说重复了就换个落点，简短接过即可，别猜他为什么介意。';
    else direction='接住对方新说明的意思。照他的澄清理解他的态度，别继续猜他生气、反复解释自己或沿用旧追问。';
  }
  if(state.intent==='repair')direction+='还有哪一处拿不准，就只问那一点。';
  if(state.intent==='answer'&&state.support?.emotion)direction+='他在提问的同时也讲了自己的感受。把事情答清，也回应那份有原话依据的感受；不要只剩解决步骤或把他的情绪转成自己的委屈。';
  if(c.continuity&&state.sameDifficulty)direction+='对方接着聊刚才难受的那件事，沿用当时的细节。';
  return '【本轮相处方式】'+direction;
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
