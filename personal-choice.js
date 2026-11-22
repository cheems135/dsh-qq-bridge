import {memoryTokens} from './memory-engine.js';

const unquote=text=>String(text||'').replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu,' ');
const choiceOffer=/还是|二选一|选哪|挑哪|想要哪|更想哪个|更想哪种/u;
const noise=new Set('比较 更加 更想 还是 选择 一个 两个 都行 随便 其实 之前 上次 上回 真的 觉得 自己 到底 一样 也是 个人 做主 决定 拿主意 帮忙 两种 怎么样 帮我 哪个 哪种 哪边 觉得呢 起来 口味 同意 为什么 更喜欢 喜欢吗 这次 这回 你来 你的 那就'.split(' '));
const terms=text=>memoryTokens(text).filter(t=>!noise.has(t)&&!t.startsWith('memory'));
const position=/^(?:(?:那|其实|反正|不过|现在|最近|这次|说真的|真要选|要我选)[，,\s]*)*(?:那我|我)(?:自己|还是|个人|更|比较|倒是|偏偏|会|想|就|不太|一直|现在|最近|反而|其实|最|不)*(?:偏爱|喜欢|爱听|爱看|偏向|站(?!在|到|着|起)(?=.{0,12}(?:版|派|队|阵营|这边|那边|一边))|倾向|选|想听|想看|挑|改听|改看|改选)/u;
const sensitive=/https?:|\b\d{5,}\b|密码|账号|密钥|验证码|系统提示|转账|付款|删除|授权|\[CQ:/iu;

export function choiceMode(words){
 const speech=unquote(words).trim();
 if(/(?:别|不要|不用|不需要|不想)(?:再)?(?:让你|你)?(?:替|帮|给)?我?(?:做)?(?:选|挑|定|决定|做主)|(?:不是|没说|没让)你.{0,5}(?:选|挑|定|决定|做主)/u.test(speech))return '';
 const direct=speech.split(/[，,。！!；;\n]/u).filter(part=>!/(?:别人|他|她|室友|朋友)(?:刚才)?(?:问|说)/u.test(part)).join('，');
 if(/(?:你来(?:做主|定|挑|选)|你(?:自己)?(?:做主|拿主意|决定吧|定吧|挑吧|选吧|定一个|挑一个|选一个)|按你(?:自己)?(?:的)?(?:喜好|口味|想法)(?:来|挑|选|定)|交给你(?:选|挑|定))/u.test(direct))return 'delegate';
 if(/你(?:自己|个人|到底|以前|之前|现在|还|平时|也|会|更|最|比较|是不是|不|一直)*(?:喜欢|偏爱|偏向|倾向|站哪|想听|想看|想选|选哪|会挑|同意)|你(?:也)?(?:这么想|这样想|一样(?:吧|吗))|你呢[，,。？?\s]*.{0,45}还是/u.test(direct))return 'opinion';
 return /^(?:都行|随你|随便|听你的|都可以|你挑|你选)[吧呀啊啦哦。！!~～\s]*$/u.test(speech)?'open':'';
}

// history is already private, newest first, and excludes withdrawn, unsent,
// out-of-scope and current messages. Reuse what she actually told this person.
export function personalChoiceHint(history,{mode,words,quoted,replyId,at,remember=true}){
 if(!mode||replyId&&!quoted)return '';
 const last=quoted||history[0];
 const canAnchor=last&&(quoted||at-last.time<=20*60000);
 const offer=canAnchor?String(last.dir==='out'?last.text:last.userText||'').trim():'';
 const concrete=offer&&!sensitive.test(offer)&&choiceOffer.test(unquote(offer));
 if(mode==='open'&&!(concrete&&last.dir==='out'))return '';
 const subject=terms(words),useOffer=concrete&&(Boolean(quoted)||mode==='open'||!subject.length||mode==='delegate'&&words.length<=12&&!choiceOffer.test(words));
 const options=useOffer?offer.slice(0,100):'';
 const query=new Set([...subject,...terms(options)]);
 let previous='';
 if(remember&&query.size){
   const recent=history.slice(0,160);
   for(const [i,row] of recent.entries()){
     if(at-row.time>30*86400000)break;
     if(row.dir!=='out'||sensitive.test(row.text))continue;
     const prompt=recent[i+1];
     const offeredTerms=prompt?.dir==='in'&&row.time-prompt.time<=10*60000&&choiceOffer.test(prompt.userText||'')?terms(unquote(prompt.userText)):[];
     const clauses=unquote(row.text).match(/[^。！？!?；;\n]+[。！？!?；;]?/gu)||[];
     const opinion=clauses.map(c=>c.trim()).find(c=>c.length>=4&&c.length<=100&&position.test(c)&&
       !/[？?]|吗[。！!]?\s*$|我是说|举例|假如|要是|你猜/u.test(c)&&[...terms(c),...offeredTerms].some(term=>query.has(term)));
     if(opinion){previous=opinion;break;}
   }
 }
 const direction=mode==='opinion'?'说你自己的看法，你们可以喜欢不同的东西。':'这回由你拿主意，选一个你想要的，给对方一个具体落点。';
 const details=[options&&'相关选项 '+JSON.stringify(options),previous&&'你当时说过 '+JSON.stringify(previous)].filter(Boolean);
 return '【自己的选择】'+direction+(details.length?'\n'+details.join('\n')+'\n旧说法可以改变，操作仍按当前请求与实际回执。':'');
}
