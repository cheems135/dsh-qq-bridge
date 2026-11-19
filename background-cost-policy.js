const shortAcknowledgement=/^(?:好[呀啊的吧嘛]?|可以[呀啊的吧]?|行[呀啊的吧]?|嗯+|对[呀啊吧]?|来吧|来一个|来一个吧|当然|没问题)[！!～~。.\s]*$/u;
const mediaOffer=/(?:唱(?:歌|一首|一段|一小段|给你听)|弹一段|讲(?:个|一段|一个)?故事|哄你睡|念一段|发(?:你|给你)?(?:个|张|一张|段|一段)?(?:图(?:片)?|照片|语音)|用语音(?:说|讲|念)|拍(?:张|一张|给你看|照|自拍)|录(?:段|一段|给你听|语音)|看看我|听我(?:说|唱|读)|看我(?:的)?(?:照片|自拍))/u;
const invitation=/(?:要不要|想不想|要不|你想|你要|我(?:给|发|拍)|给你|给你看看|给你听听)/u;
const negatedOffer=/(?:还是算了|先不发|今天不发|别发|不用发|不给你|不打算发|不唱了)/u;

export function isShortAcknowledgement(words){
 return shortAcknowledgement.test(String(words||'').trim());
}

export function mediaPreviewNeeded(words,context=[]){
 const text=String(words||'').trim();
 if(isShortAcknowledgement(text)){
  const last=context.at(-1);
  return last?.role==='assistant'&&mediaOffer.test(last.text||'')&&invitation.test(last.text||'')&&!negatedOffer.test(last.text||'');
 }
 if(/(?:代码|文稿|教程|文档|文章|日志|报错|设置|接口|网页|链接|新闻|搜索)/u.test(text)&&
    !/(?:用|发|录).{0,5}语音|拍.{0,5}(?:照|自拍)/u.test(text))return false;
 return /(?:想|要|能否|能不能|可不可以|可以|给我|给你|让我|我想).{0,16}(?:听你|听听你|听你的声音|用语音|发语音|发个语音|唱(?:个|段|首|一段|一首|歌)|看看你|看你现在的样子|看你的穿搭|照片|自拍|哄睡|讲.{0,2}故事)|给我看看.{0,10}(?:样子|穿搭|你今天)|^讲(?:个|一段|一个)?故事|^哄我睡/u.test(text);
}
