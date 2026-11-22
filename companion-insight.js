import {readFileSync} from 'node:fs';

// These cues only decide whether to add a short direction to a model turn.
// Quoted dialogue stays in the actual message but never sets the sender's state.
export function speakerText(text) {
  return String(text).replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu, '〔引文〕');
}

const ownFeeling = /^(?:唉[，, ]*)?(?:(?:其实|说真的|可是|但是|不过|可)?我(?:自己)?|(?:今天|这会儿|现在)我)(?:这两天|这几天|今天|现在|心里|最近|还是|真的|突然|其实|觉得|也|有点儿?|有些|特别|非常|很|挺|好|太|真)*(难过|难受|委屈|焦虑|紧张|害怕|失落|孤单|孤独|好累|累(?:了|坏了|死了|得|$)|烦死|想哭|心情不好)/u;
const bareFeeling = /^(?:唉[ ，,]*)?(?:有点儿?|有些|好|很|太|特别|真的)?(难过|难受|委屈|焦虑|紧张|害怕|失落|孤独|孤单|好累|累死|烦死|想哭|心情不好)(?:了|啊|呀|唉|死了|得很)*$/u;
const wantsListening = /^(?:我(?:现在)?(?:只|就)(?:是)?想(?:跟你)?(?:吐槽|抱怨|说说话)|(?:你)?(?:先)?听我(?:说完|吐槽|讲完)|(?:先)?(?:别|不用)(?:给我)?(?:出主意|提建议|讲道理)|(?:你)?(?:能不能)?陪我(?:待|坐|聊)(?:一会儿?)?)/u;
const requestsAdvice = /(?:怎么办|该怎么(?:办|做|回)|有什么办法|帮我(?:想[个想]?办法|出(?:个)?主意)|(?:能不能|可以|请)?给我(?:些|一点|个|点)?建议)/u;
// A comma can introduce someone else's unquoted words (e.g. “室友说，我只想吐槽”).
const reportedSpeech = /^(?:[我你他她]的?|那个)?(?:他|她|别人|朋友|室友|同事|同学|家人|老师)(?:之前|刚才|刚刚|刚|还|也)?(?:跟我|对我|给我)?(?:说|问)(?:我)?[：:]?(.*)$/u;
const jokeBoundary = /^(?:你)?(?:以后|下次)?(?:能不能)?(?:别|不要)(?:再)?(?:拿.{1,16}(?:开玩笑|打趣|说笑)|(?:把|当).{1,16}(?:当笑话|当段子)|开我(?:的)?玩笑|这样(?:开玩笑|打趣我))/u;
const nameBoundary = /^(?:(?:你)?(?:以后|下次)?(?:能不能)?(?:别|不要)(?:再)?(?:(?:这样|这么|那样|那么)叫我|叫我〔引文〕|给我(?:起|取)外号)|我(?:真的|是(?:真的)?)?不喜欢(?:你(?:这样|这么|那样|那么)叫我|这个称呼|这个外号))/u;
const emotionKeys = {sad:/难过|难受|委屈|失落|想哭|心情不好/u, lonely:/孤单|孤独/u, tired:/累/u, annoyed:/烦死/u, anxious:/焦虑|紧张|害怕/u};
let emotionGuide;

function isReported(clauses,i) {
  return reportedSpeech.test(clauses[i]) || reportedSpeech.exec(clauses[i-1]||'')?.[1] === '';
}

export function supportReading(clauses) {
  let feeling = '';
  let preference = '';
  let askedToListen = false;
  let vent = false;
  for (const [index, clause] of clauses.entries()) {
    if (isReported(clauses,index)) continue;
    if (wantsListening.test(clause)) {
      preference = 'listen';
      askedToListen = true;
      vent = /吐槽|抱怨/u.test(clause);
    }
    else if (requestsAdvice.test(clause) && !/^(?:(?:我)?不(?:是)?(?:想|要)|别|不用)/u.test(clause)) preference = 'advice';
    // A question about a feeling and reported speech do not establish a disclosure.
    if (/才怪|(?:现在|已经)(?:没事了|好多了|不难过了)/u.test(clause)) { feeling = ''; continue; }
    if (/[?？]|(?:吗|么|嘛)[呀啊呢]?$|的(?:意思|人|时候)|是什么(?:意思|感觉)/u.test(clause)) continue;
    const stated = ownFeeling.exec(clause) || (index === 0 && bareFeeling.exec(clause));
    if (stated) feeling = stated[1];
  }
  const emotion=Object.keys(emotionKeys).find(id=>emotionKeys[id].test(feeling));
  return askedToListen||emotion ? {mode:preference||'support',emotion,...(vent&&preference==='listen'?{vent:true}:{})} : null;
}

export function socialBoundary(clauses) {
  return clauses.some((clause,i) => !isReported(clauses,i) &&
    !/是什么意思|怎么翻译|怎么说|举个例子/u.test(clause) && (jokeBoundary.test(clause)||nameBoundary.test(clause)));
}

// Use only the guide's specific wording advice after an actual disclosure.
// Its descriptions of how people might feel or behave are never presented as facts.
export function supportGuide(emotion) {
  if(!emotion) return '';
  if(!emotionGuide) {
    try { emotionGuide=JSON.parse(readFileSync(new URL('./assets/emotion-guide.json',import.meta.url),'utf8')).emotions; }
    catch { emotionGuide=[]; }
    if(!Array.isArray(emotionGuide)) emotionGuide=[];
  }
  const avoid=emotionGuide.find(row=>row?.id===emotion)?.avoid;
  return typeof avoid==='string'&&avoid.trim() ? '避开'+avoid.trim().slice(0,36)+'。' : '';
}
