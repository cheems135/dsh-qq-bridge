export function mediaPreviewNeeded(words,context=[]){
 const text=String(words||'').trim();
 if(/(?:听|看|声音|语气|样子|穿搭|唱|哄睡|讲故事|给我瞧|给我瞅)/.test(text))return true;
 const last=context.filter(r=>r.role==='assistant').at(-1)?.text||'';
 return /^(?:好[呀啊的吧]?|可以[呀啊]?|行[呀啊]?|想[呀啊]?|要[呀啊]?|嗯+|来吧|来一个|当然)[！!～~。\s]*$/.test(text)&&/(?:语音|照片|图片|拍|唱|讲故事|给你看|给你听)/.test(last);
}
