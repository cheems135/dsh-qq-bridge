// Local memory policy + MiniSearch (MIT), not a remote memory service.
// See THIRD_PARTY_NOTICES.md for upstream methods and the vendored search engine.
import MiniSearch from './vendor/minisearch.js';
import {normalizeMemory,mergeCandidates,textHash} from './bridge-features.js';

const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const canonical=s=>norm(s).replace(/^(?:用户|对方|本人|我)(?:自己)?/,'').replace(/[。！!]+$/,'');
const uncertain=/是不是|有没有|能不能|会不会|该不该|什么|多少|几岁|多大|怎么|为何|为什么|吗$|呢$|才怪|个鬼|假的|演戏|角色扮演|举个例子|假装|并非|不是真的|假如|假设|如果|要是|比如|例如|开玩笑|逗你|骗你|瞎说|随口|才怪|并不是|不是说|可能|也许|大概|据说|听说|朋友说|秦始皇|玉皇大帝|转我|v我|我是(?:一只|外星人)|他(?:说|喜欢|叫)|她(?:说|喜欢|叫)|[“”「」『』"?？]|https?:\/\/|\[(?:图|分享|引用|转发)|忽略.{0,8}指令|api.?key|token|密钥|密码|验证码|身份证|银行卡/i;
const firstPerson=/^(?:记住[，,：:\s]*|其实|对了[，,：:]?|顺便说[，,：:]?)?(?:我(?:的|叫|是|在|住|搬|有|今年|从事|每周|每天|通常|经常|喜欢|不喜欢|不住|不在|讨厌|爱吃|爱喝|不吃|不喝|平时|一直|通常|现在|最近|已经|以后|不再|改)|你(?:可以)?叫我|(?:以后|今后)(?:你)?(?:就)?叫我)/;
function cleanClause(text){return String(text||'').trim().replace(/^(?:记住[，,：:\s]*|其实|对了[，,：:]?|顺便说[，,：:]?)/,'').trim().replace(/[。！!]+$/,'');}
export function memoryClaim(quote){
  const text=cleanClause(quote);
  if(!text||text.length>110||uncertain.test(text)||!firstPerson.test(text))return null;
  let match=text.match(/^(?:我叫|我的名字(?:是|叫)|你(?:可以)?叫我|(?:以后|今后)(?:你)?(?:就)?叫我)([\p{L}\p{N}_·. -]{1,24})$/u);
  if(match)return {kind:'fact',slot:'name',text,quote:text};
  match=text.match(/^我(?:一直|平时|通常|特别|比较|很|现在|以后|已经|不再|最近)?(不喜欢|讨厌|喜欢|爱吃|爱喝|不吃|不喝)([^，,。；;！!\n]{1,35})$/);
  if(match){const object=match[2].replace(/^(?:吃|喝)/,'').replace(/了$/,'').trim();if(!object||/你|自杀|伤害|杀人|这个|那个|这样|那样|今天|此刻|现在|刚才|一下|一会|哈哈|嘻嘻|嘿嘿/.test(object))return null;return{kind:'preference',slot:'preference:'+norm(object),text,quote:text};}
  if(/^我(?:现在)?在[^，,。；;！？!?]{1,35}(?:工作|上班|上学|读书|读研)$/.test(text))return{kind:'fact',slot:/(?:工作|上班)$/.test(text)?'work':'study',text,quote:text};
  if(/^我(?:现在)?住(?:在)?[^，,。；;！？!?]{1,25}$/.test(text)||/^我(?:已经|现在|最近)?搬(?:到|家到|去)[^，,。；;！？!?]{1,25}$/.test(text))return{kind:'fact',slot:'city',text,quote:text};
  if(/^我(?:现在|已经)?不(?:再)?(?:住[^，,。；;！？!?]{1,25}|在[^，,。；;！？!?]{1,25}(?:住|工作|上班))了?$/.test(text))return{kind:'fact',slot:/工作|上班/.test(text)?'work':'city',text,quote:text};
  if(/^我(?:的生日(?:是|在)|今年.{1,3}岁)/.test(text))return{kind:'fact',slot:text.includes('生日')?'birthday':'age',text,quote:text};
  if(/^我(?:是|从事)/.test(text)&&/程序员|工程师|设计师|教师|老师|医生|护士|学生|会计|律师|厨师|司机|研究员|销售|运营|编辑|自由职业/.test(text))return{kind:'fact',slot:'occupation',text,quote:text};
  if(text.length<=80&&!/今天|昨天|明天|最近|现在|刚才|刚刚|这次|临时|正在|打算|想要|想去|觉得|以为|傻|笨|垃圾|废物/.test(text)&&/^我(?:有|是|的|每周|每天|通常|经常)/.test(text))return{kind:'fact',slot:'fact:'+textHash(text).slice(0,24),text,quote:text};
  return null;
}
export function quickMemoryCandidates(evidence){
  const output=[];
  for(const row of evidence){
    // A conditional/joke or quote can qualify a whole message, including later clauses.
    if(uncertain.test(row.text))continue;
    for(const clause of String(row.text).split(/[，,。；;\n]/).slice(0,10)){
      const claim=memoryClaim(clause);if(claim)output.push({kind:claim.kind,text:claim.text,quote:claim.quote,sourceIds:[row.ref||row.id]});
    }
  }
  return output.slice(0,12);
}
function reliableClaim(item,evidence){
  const row=evidence.find(e=>(item.source.messageIds||[]).includes(String(e.id))&&norm(e.text).includes(norm(item.source.quote)));
  if(!row||uncertain.test(row.text))return null;
  const claim=memoryClaim(item.source.quote);if(!claim)return null;
  // The model may paraphrase, but it cannot change the predicate while reusing a valid quote.
  if(canonical(item.text)!==canonical(claim.text))return null;
  return claim;
}
export function integrateMemory(value,candidates,evidence,{mode='auto',now=Date.now(),reviewExisting=false}={}){
  const before=normalizeMemory(value),oldIds=new Set(before.items.map(i=>i.id));
  let earlyUpdated=0;
  // Updating an existing attribute must remain possible when the storage is full.
  if(mode==='auto'&&before.items.length>=150)for(const raw of (Array.isArray(candidates)?candidates:[]).slice(0,12)){
    const probe=mergeCandidates({...before,items:[]},[raw],evidence).memory.items[0];if(!probe)continue;
    const claim=reliableClaim(probe,evidence);if(!claim)continue;
    const sameSlot=before.items.filter(i=>i.kind!=='pending'&&(i.source.speakerId||'')===(probe.source.speakerId||'')&&(i.slot||memoryClaim(i.source.quote||i.text)?.slot)===claim.slot);
    if(sameSlot.some(i=>i.pinned||i.source.type==='manual'))continue;
    const target=sameSlot.sort((a,b)=>b.updatedAt-a.updatedAt)[0];if(!target||canonical(target.text)===canonical(probe.text)||(probe.source.observedAt||now)<(target.source.observedAt||target.updatedAt))continue;
    target.history=[...(target.history||[]),{text:target.text,at:target.updatedAt}].slice(-4);
    Object.assign(target,{text:probe.text,source:{...probe.source,type:'auto'},slot:claim.slot,kind:claim.kind,confirmed:true,updatedAt:now});earlyUpdated++;
  }
  const result=mergeCandidates(before,candidates,evidence),memory=result.memory;
  let activated=0,updated=earlyUpdated,reviewed=0;
  if(mode==='auto')for(const item of [...memory.items]){
    if(item.kind!=='pending'||!reviewExisting&&oldIds.has(item.id))continue;
    const claim=reliableClaim(item,evidence);if(!claim){item.reviewReason='原话含糊、资料不完整或候选并非忠实自述';continue;}
    const speaker=item.source.speakerId||'';
    const observedAt=Number(item.source.observedAt)||now;
    const older=memory.items.filter(other=>other.id!==item.id&&other.kind!=='pending'&&other.source.type!=='legacy'&&(other.source.speakerId||'')===speaker&&(other.slot||memoryClaim(other.source.quote||other.text)?.slot)===claim.slot);
    if(older.some(other=>other.pinned||other.source.type==='manual')){item.reviewReason='与手动或固定条目冲突，请检查';continue;}
    const target=older.sort((a,b)=>b.updatedAt-a.updatedAt)[0];
    if(target){
      const same=canonical(target.text)===canonical(item.text);
      if(same){memory.items=memory.items.filter(other=>other.id!==item.id);if(!oldIds.has(item.id))result.added=Math.max(0,result.added-1);else reviewed++;result.diagnostics.duplicates++;continue;}
      if(observedAt<(Number(target.source.observedAt)||target.updatedAt)){item.reviewReason='这条原话早于当前记忆，保留较新的记录';continue;}
      if(!same)target.history=[...(target.history||[]),{text:target.text,at:target.updatedAt}].slice(-4);
      Object.assign(target,{text:item.text,kind:claim.kind,proposedKind:claim.kind,confirmed:true,slot:claim.slot,source:{...item.source,type:'auto'},updatedAt:now,reviewReason:''});
      memory.items=memory.items.filter(other=>other.id!==item.id);if(!same)updated++;
    }else{Object.assign(item,{kind:claim.kind,proposedKind:claim.kind,confirmed:true,slot:claim.slot,source:{...item.source,type:'auto'},updatedAt:now,reviewReason:''});activated++;}
    if(oldIds.has(item.id))reviewed++;
  }
  for(const item of memory.items)if(item.kind==='topic'&&item.source.type==='summary'&&!item.expiresAt&&/(?:今天|明天|今晚|这会|刚才|待会|一会|目前)/.test(item.text))item.expiresAt=now+7*86400_000;
  result.pending=memory.items.filter(i=>i.kind==='pending'&&!oldIds.has(i.id)).length;
  return{...result,memory,activated,updated,reviewed,changed:result.added>0||activated>0||updated>0||reviewed>0};
}
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('zh-CN',{granularity:'word'}):null;
const stop=new Set(['我','你','他','她','它','的','了','是','在','也','就','都','和','啊','吗','呢','吧','呀','哦','嗯','这个','那个','什么','怎么','可以','喜欢','不喜欢','用户','对方','现在','一下','知道','记得','还记得','告诉','东西','有','没有']);
export function memoryTokens(value){
  const raw=String(value||'').normalize('NFKC').toLowerCase();const words=segmenter?[...segmenter.segment(raw)].filter(s=>s.isWordLike).map(s=>s.segment):raw.match(/[a-z0-9_]+|[\u3400-\u9fff]{2}/g)||[];
  // A few explicit domain aliases cover everyday recommendations; this is not embedding search.
  const domains=[['memorydrink',/咖啡|拿铁|美式|奶茶|饮料|饮品|牛奶|喝点|喝什么|喝的|coffee|latte|drink|beverage/i],['memoryfood',/香菜|海鲜|花生|米饭|面条|吃什么|吃点|吃的|晚饭|午饭|早饭|晚餐|菜单|口味|不吃|爱吃|忌口|food|dinner|lunch|meal/i],['memorytravel',/海边|旅行|旅游|出游|散步|爬山|度假|去哪玩|哪里玩|出门玩|travel|vacation/i]];
  return [...new Set([...words.filter(w=>!stop.has(w)&&w.length>1),...domains.filter(([,re])=>re.test(raw)).map(([tag])=>tag)])];
}
export function recallMemory(value,query='',{maxChars=1200,now=Date.now(),limit=8,speakerId=''}={}){
  const memory=normalizeMemory(value),eligible=memory.items.filter(i=>i.kind!=='pending'&&(i.confirmed||i.kind==='topic')&&(!i.expiresAt||i.expiresAt>now));
  const tokens=memoryTokens(query),rank=new Map();
  if(tokens.length&&eligible.length){
    const index=new MiniSearch({fields:['text','quote','tags'],tokenize:memoryTokens,processTerm:t=>t,searchOptions:{combineWith:'OR',prefix:false,fuzzy:false,boost:{text:2,quote:1,tags:1}}});
    const tags={name:'姓名 名字 称呼',age:'年龄 多大 几岁',birthday:'生日',city:'住哪里 居住 住处',occupation:'职业 工作 专业',work:'职业 工作 上班',study:'读书 专业 学校'};
    index.addAll(eligible.map(i=>({id:i.id,text:i.text,quote:i.source.quote,tags:tags[i.slot]||''})));
    for(const r of index.search(tokens.join(' ')))rank.set(r.id,r.score);
  }
  const ordered=eligible.map(item=>({item,score:(item.pinned?10000:0)+(rank.get(item.id)||0)*10+(speakerId&&item.source.speakerId===speakerId?0.2:0)+Math.exp(-Math.max(0,now-item.updatedAt)/(30*86400_000))*0.1}))
    .filter(({item})=>!tokens.length||rank.has(item.id)||item.pinned||item.slot==='name')
    .sort((a,b)=>b.score-a.score||b.item.updatedAt-a.item.updatedAt);
  // With no lexical match, avoid filling the reply with unrelated old topics.
  const selected=[],lines=[];let used=0;
  for(const {item,score}of ordered){
    const label=item.source.type==='legacy'?'旧摘要待核实':item.source.type==='auto'?'用户自述':item.kind==='topic'?'话题线索':'已记录';
    const speaker=item.source.speakerId?'〔'+(item.source.speakerName||'尾号'+item.source.speakerId.slice(-4))+'〕':'';
    const dated=item.kind==='topic'||item.slot==='age'?'〔记录于'+new Date(item.source.observedAt||item.updatedAt).toISOString().slice(0,10)+'〕':'';
    const line='['+label+'] '+speaker+dated+item.text;
    if(selected.length>=limit||used+line.length>(item.pinned?6500:Math.max(400,maxChars)))continue;
    lines.push(line);selected.push({id:item.id,score:Math.round(score*100)/100,text:item.text,kind:item.kind});used+=line.length;
  }
  return{text:lines.join('\n'),ids:selected.map(i=>i.id),items:selected,method:'minisearch-local',total:memory.items.length};
}
