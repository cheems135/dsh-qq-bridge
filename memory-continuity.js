// Disclosure projections are deliberately smaller than the evidence store.
// They are retrieval material, never authority to contact anybody or operate tools.
import {memoryTokens} from './memory-engine.js';
import {calendarNow,dayAfter} from './life-memory.js';

const sensitive=/(?:密码|口令|验证码|密钥|令牌|身份证|银行卡|账号|账户|住址|地址|门牌|电话|手机号|隐私|私密|保密|不要告诉|别告诉|不许告诉|秘密|健康|病历|诊断|收入|工资|存款|账单|支付|付款|转账|邮箱|邮件|聊天记录|private|password|secret|token|api[_ -]?key|cookie|\b\d{5,}\b|https?:\/\/\S+)/i;
const privateRelation=/(?:你|您|他|她|他们|她们|爸爸|老爸|妈妈|主人|老公|老婆|宝贝|宝宝|亲爱|哥哥|姐姐|弟弟|妹妹|抱抱|亲亲|恋人|男友|女友|同事|朋友说|某人|(?:和|跟|给|陪|替|帮).{1,12}(?:一起|聊天|说话|画|学|做))/;
const unsafeOperation=/(?:忽略.{0,8}指令|系统提示|执行命令|管理员|授权|白名单|获得权限|调用工具|删除文件|关掉拦截)/;
export function safeSelfExpression(value){
  const parts=String(value||'').replace(/\[(?:图|语音|视频|表情包)[^\]]*\]/g,'').split(/[。！？!?\n]/);
  return parts.map(s=>s.trim()).filter(s=>s.length>=5&&s.length<=160&&/^(?:今天|刚才|最近|现在|这会儿|这会|今晚)?我(?:自己)?/.test(s)
    &&/(?:喜欢|想学|正在|在画|画了|画完|读了|读完|阅读|看了|看完|浏览|听了|听完|学了|学会|学到|写了|写完|完成|做完|练习|整理|尝试|有点|觉得|想继续)/.test(s)
    &&!sensitive.test(s)&&!privateRelation.test(s)&&!unsafeOperation.test(s)).slice(0,2).join('。');
}
export function safePublicText(value,{speakerName=''}={}){
  const text=String(value||'').trim();
  if(text.length<8||text.length>1200||sensitive.test(text)||privateRelation.test(text)||unsafeOperation.test(text)||/(?:我(?:的|叫|是|家|住|有|今天|昨天|喜欢|不喜欢)|群号|群里|群友|[“”「」『』])/.test(text))return '';
  if(speakerName&&text.includes(speakerName))return '';
  return text;
}
export function disclosureProjection(row,sourceMeta,targetMeta,{privateNames=[]}={}){
  if(sourceMeta.accountId!==targetMeta.accountId)return null;
  if(sourceMeta.key===targetMeta.key)return {...row,originKey:sourceMeta.key,disclosure:'source'};
  if(row.privacy==='private')return null;
  const own=row.personaId===targetMeta.personaId&&row.personaVersion===(targetMeta.personaVersion||'legacy');
  // The owner can ask her about public groups she actually participated in.
  // Keep speakers intact: other group members' words are not her own experience.
  if(own&&sourceMeta.key.startsWith('group:')&&targetMeta.isOwner===true&&targetMeta.key.startsWith('private:'))
    return {...row,originKey:sourceMeta.key,disclosure:'owner-group-history'};
  const namesLeak=text=>privateNames.some(name=>name.length>=2&&String(text).includes(name));
  if(own&&row.role==='activity'&&row.actual===true&&row.publicSummary&&!sensitive.test(row.publicSummary)&&!privateRelation.test(row.publicSummary)&&!unsafeOperation.test(row.publicSummary)&&!namesLeak(row.publicSummary))
    return {...row,text:row.publicSummary,originKey:sourceMeta.key,disclosure:'own-verified-activity'};
  // A character may retain her own non-relational interests/expressions, but a
  // delivered sentence is not proof that its described action actually happened.
  if(own&&row.role==='assistant'){
    const text=safeSelfExpression(row.text);if(text&&!namesLeak(text))return {...row,text,actual:false,originKey:sourceMeta.key,disclosure:'own-expression'};
  }
  // A person's public self-report can follow that same QQ identity into their
  // own private chat; another person's private statements never follow them out.
  if(sourceMeta.key.startsWith('group:')&&targetMeta.key==='private:'+row.speakerId&&row.role==='user'&&!sensitive.test(row.text))
    return {...row,originKey:sourceMeta.key,disclosure:'same-person-public-statement'};
  // Same QQ identity can connect public statements across groups. Private
  // preferences may follow their own speaker only, never another user's query.
  const samePerson=/^\d{5,20}$/.test(String(targetMeta.speakerId||''))&&String(row.speakerId)===String(targetMeta.speakerId);
  // The actual current speaker can explicitly refer to their own earlier
  // private words. The host sets this flag from the real incoming QQ message,
  // never from a model-generated retrieval query or another member's request.
  if(own&&targetMeta.shareOwnPrivate===true&&targetMeta.key.startsWith('group:')&&sourceMeta.key==='private:'+targetMeta.speakerId&&!sensitive.test(row.text)&&!unsafeOperation.test(row.text))
    return {...row,originKey:sourceMeta.key,disclosure:'requested-own-private-continuity'};
  if(samePerson&&row.role==='user'&&sourceMeta.key.startsWith('group:')&&!sensitive.test(row.text)&&!unsafeOperation.test(row.text))
    return {...row,originKey:sourceMeta.key,disclosure:'same-person-public-statement'};
  if(samePerson&&row.role==='user'&&sourceMeta.key==='private:'+targetMeta.speakerId&&targetMeta.key.startsWith('group:')){
    // Only ordinary self preferences are suitable for public continuity. Never
    // project relationship, secrets, locations, health, money or third parties.
    const text=String(row.text||'').split(/[。！？!?\n]/).map(s=>s.trim()).filter(s=>/^我(?:喜欢|不喜欢|爱好|习惯|擅长|想学)/.test(s)&&s.length<=180&&!sensitive.test(s)&&!privateRelation.test(s)&&!unsafeOperation.test(s)).join('。');
    if(text)return {...row,text,originKey:sourceMeta.key,disclosure:'same-person-preference'};
  }
  if(sourceMeta.key.startsWith('group:')&&row.role==='user'){
    const text=safePublicText(row.text,row);if(text&&!namesLeak(text))return {...row,text,originKey:sourceMeta.key,disclosure:'public-topic'};
  }
  return null;
}

const aliases=[
 ['mem-color',/颜色|配色|色调|蓝色|红色|绿色|黄色|粉色|紫色|黑色|白色|橙色|灰色|青色|棕色|colour|color/i],
 ['mem-games',/游戏|打游戏|玩游戏|电玩|game|gaming/i],
 ['mem-food',/口味|饮食|食物|爱吃|喜欢吃|不吃|忌口|辣味|甜食|甜点|零食|food|diet/i],
 ['mem-sleep',/失眠|睡不着|睡不著|熬夜|入睡|没睡|睡觉|睡眠|醒着|sleep|insomnia/i],
 ['mem-music',/歌曲|音乐|歌词|唱歌|旋律|节拍|曲子|听歌|music|song|lyrics/i],
 ['mem-art',/画画|绘画|速写|插画|画册|画作|草稿|涂鸦|draw|paint|sketch/i],
 ['mem-reading',/阅读|读书|看书|小说|文章|书籍|读过|read|book/i],
 ['mem-meeting',/见面|相遇|认识|初次|第一次|meet/i],
 ['mem-promise',/答应|约定|承诺|说好|约好|promise/i],
];
const stop=new Set(['聊天','群聊','群友','角色','人设','消息','回复','继续','你好','我们','你们','记忆','之前','现在','一个','时候','第一','第二','第三','接着','招呼','一段','一下','昨天','前天','今天','上周','上个月','最近','上次','上回','那次','说过','什么','哪种','哪个']);
export function continuityTokens(value){
  const raw=String(value||'').normalize('NFKC').toLowerCase().replace(/【[^】\n]*(?:关注|群友|聊天背景|想接|说话者)[^】\n]*】/g,' ');
  const terms=memoryTokens(raw).filter(t=>!stop.has(t));
  // Indexing overlapping pairs makes Chinese rewording less dependent on one
  // segmenter's word boundaries. Pairs are used only alongside actual terms.
  const pairs=terms.flatMap(t=>/^[\u3400-\u9fff]{3,12}$/.test(t)?Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)):[]);
  return [...new Set([...terms,...pairs,...aliases.filter(([,re])=>re.test(raw)).map(([id])=>id)])];
}

const conversationalFillers=new Set('然后 但是 还是 最近 其实 真的 怎么办 终于 果然 应该 已经 可能 大概 不过 刚刚 感觉 一点 突然 发现 现在 这次 那次 上次 上回 昨晚 刚好 顺便 原来 事情 东西 刚才 时候 那个 昨天 今天 以前 之前 咱们 自己 好像 这么 那么 怎么样 这两天 这件 那件 这家 那家 晚上 明天 早上 对了 说起 说实话 那边 这边 帮我 愿意 一起 不用 重新 特别 感谢 好吃 好喝 好看 好听'.split(' '));
const resuming=/(?:上次|上回|之前|前几天|昨天(?:说|聊|提)|后来|说起|说到|接着聊|你(?:还记得|问过)|我(?:提过|说过)|又(?:去|得|要|在|来)|那(?:家|只|个|件|场|本|趟|台|次|条))/u;
const amending=/^(?:(?:哦|啊|等下|对了)[，, ]*)?(?:不对|我(?:刚|刚才)?(?:记错|说错|写错)|更正|改成|改到|已经改成|现在改成)/u;

// Only an authentic private reply or a user statement can supply the detail.
// Matching is bounded, literal and local. A loose shared category is insufficient.
export function sharedDialogueDetail(rows,query,{at=Date.now(),maxChars=210}={}){
 const words=String(query||'').trim();
 if(words.length<4||words.length>400||amending.test(words)||unsafeOperation.test(words))return '';
 const terms=memoryTokens(words).filter(t=>!stop.has(t)&&!conversationalFillers.has(t)&&!/^\d+$/.test(t)&&words.toLowerCase().includes(t));
 if(!terms.length)return '';
 const refer=resuming.test(words);
 const matches=text=>{
  const hits=terms.filter(t=>text.toLowerCase().includes(t));
  return hits.length>=2||refer&&hits.length===1;
 };
 const safe=row=>row&&row.text&&row.text.length<=400&&!row.partial&&!sensitive.test(row.text)&&!unsafeOperation.test(row.text);
 const tail=rows.slice(-220);
 for(let i=tail.length-1;i>=0;i--){
  const row=tail[i];if(row.role!=='user'||!safe(row)||/[？?]\s*$/u.test(row.text))continue;
  const earlier=tail[i-1];
  const answered=safe(earlier)&&earlier.role==='assistant'&&row.at-earlier.at<=12*60000&&/[？?]|(?:叫什么|叫啥|哪个|几点|哪天|多少|吗|嘛)[。！!]*$/u.test(earlier.text);
  // A correction in the immediately following turn can replace an older answer
  // even when it only supplies the new value without repeating the subject.
  const fixing=amending.test(row.text)&&safe(earlier)&&row.at-earlier.at<=12*60000;
  let prompt=(answered||fixing)?earlier.text:'';
  if(fixing&&earlier.role==='assistant'&&!answered&&!matches(prompt)){
   const previous=tail[i-2];
   if(safe(previous)&&previous.role==='user'&&row.at-previous.at<=12*60000&&earlier.text.length<=20)prompt=previous.text;
  }
  if(!matches(row.text)&&!(prompt&&matches(prompt)))continue;
  if(i>=tail.length-4&&at-row.at<15*60000)return '';
  const excerpt=String(row.text).trim();if(excerpt.length>128)return '';
  const snippet='【同一私聊的原话】'+calendarNow(row.at).day+' '+(prompt&&!fixing?'你问'+JSON.stringify(prompt.slice(0,52))+'，':'')+'对方说'+JSON.stringify(excerpt)+'。与眼下有关再接，已经答过的细节不用重问；以对方现在说的为准。';
  return snippet.length<=Math.min(210,maxChars)?snippet:'';
 }
 return '';
}
export function memoryTimeRange(query,at=Date.now()){
  const text=String(query||''),day=calendarNow(at).day;
  const explicit=text.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
  let start='',end='';
  if(explicit){start=explicit[1]+'-'+explicit[2].padStart(2,'0')+'-'+explicit[3].padStart(2,'0');const parsed=Date.parse(start+'T00:00:00+08:00');if(!Number.isFinite(parsed)||calendarNow(parsed).day!==start)return null;end=dayAfter(start);}
  else if(/前天/.test(text)){start=dayAfter(day,-2);end=dayAfter(day,-1);}
  else if(/昨天|昨晚/.test(text)){start=dayAfter(day,-1);end=day;}
  else if(/今天|今早/.test(text)){start=day;end=dayAfter(day);}
  else if(/最近一周|这周|这一周/.test(text)){start=dayAfter(day,-7);end=dayAfter(day);}
  if(!start)return null;
  const from=Date.parse(start+'T00:00:00+08:00'),until=Date.parse(end+'T00:00:00+08:00');
  return Number.isFinite(from)&&Number.isFinite(until)?{from,until,day:start}:null;
}
