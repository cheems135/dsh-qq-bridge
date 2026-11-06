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
 ['mem-sleep',/失眠|睡不着|睡不著|熬夜|入睡|没睡|睡觉|睡眠|醒着|sleep|insomnia/i],
 ['mem-music',/歌曲|音乐|歌词|唱歌|旋律|节拍|曲子|听歌|music|song|lyrics/i],
 ['mem-art',/画画|绘画|速写|插画|画册|画作|草稿|涂鸦|draw|paint|sketch/i],
 ['mem-reading',/阅读|读书|看书|小说|文章|书籍|读过|read|book/i],
 ['mem-meeting',/见面|相遇|认识|初次|第一次|meet/i],
 ['mem-promise',/答应|约定|承诺|说好|约好|promise/i],
];
const stop=new Set(['聊天','群聊','群友','角色','人设','消息','回复','继续','你好','我们','你们','记忆','之前','现在','一个','时候','第一','第二','第三','接着','招呼','一段','一下','昨天','前天','今天','上周','上个月','最近']);
export function continuityTokens(value){
  const raw=String(value||'').normalize('NFKC').toLowerCase().replace(/【[^】\n]*(?:关注|群友|聊天背景|想接|说话者)[^】\n]*】/g,' ');
  const terms=memoryTokens(raw).filter(t=>!stop.has(t));
  // Indexing overlapping pairs makes Chinese rewording less dependent on one
  // segmenter's word boundaries. Pairs are used only alongside actual terms.
  const pairs=terms.flatMap(t=>/^[\u3400-\u9fff]{3,12}$/.test(t)?Array.from({length:t.length-1},(_,i)=>t.slice(i,i+2)):[]);
  return [...new Set([...terms,...pairs,...aliases.filter(([,re])=>re.test(raw)).map(([id])=>id)])];
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
