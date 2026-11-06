import {createHash} from 'node:crypto';

// Only internal delivery syntax is removed. Ordinary links, numbers and short
// acknowledgements remain intact; private diagnostics never become chat prose.
export function cleanOutgoingText(value='') {
  if(/"nodeInfoList"\s*:|"generation_job_id"\s*:/.test(String(value)))return '';
  let text=String(value).replace(/(?:\[|【)(?:语音|声音)(?:[:：\]】]|$)[\s\S]*/g,'')
    .replace(/\[(?:图|图片|照片)[:：][^\]]*\]/g,'')
    .replace(/\[(?:发送|群发|定时|设置|查|收藏表情)[:：][^\]]*\]/g,'')
    // 内部提示词块与签名标记绝不能出现在对话里
    .replace(/⟦\/?qqctx[^⟧]*⟧/g, '')
    .replace(/(?:^|\n)[ \t]*【(?:当前情绪底色|近期心情|本轮相处方式|本轮群聊分寸|对方现在|你刚才想接的话|说话方式|自然对话与留白|群聊自主参与|群聊表达|图片语境)[^】]*】[^\n]*/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    // Emoji pictographs render as QQ's yellow faces and are not part of her
    // text voice; kaomoji and ordinary punctuation are untouched.
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu,'');
  text=text.split(/\r?\n/).filter(line=>!/^\s*(?:\{?\s*"(?:nodeInfoList|fieldName|fieldValue|apiKey|authorization|generation_job_id)"\s*:|(?:file:\/\/\/)?[A-Z]:[\\/].*(?:photos[\\/](?:gen|requests)|voice[\\/]|speech[\\/]))/i.test(line)).join('\n');
  return text.replace(/\n{3,}/g,'\n\n').trim();
}

export function deliveryFingerprint(segments=[]) {
  return createHash('sha256').update(JSON.stringify(segments.map(s=>({type:s.type,data:s.type==='text'?{text:String(s.data?.text||'').normalize('NFKC').trim()}:s.data||{}})))).digest('hex');
}

export function existingDelivery(jobs, candidate) {
  if(!candidate.auditId&&!candidate.deliveryKey)return null;
  return jobs.find(job=>job.accountId===candidate.accountId&&job.personaId===candidate.personaId&&job.chat===candidate.chat&&
    (candidate.auditId?job.auditId===candidate.auditId&&(!(candidate.deliveryKey||job.deliveryKey)||job.deliveryKey===candidate.deliveryKey):job.deliveryKey===candidate.deliveryKey)&&
    ['queued','sending','sent','unknown'].includes(job.status)&&
    (job.fingerprint||deliveryFingerprint(job.segments))===candidate.fingerprint)||null;
}

export function removeDuplicatePassages(value='',request='') {
  if(/再(?:说|讲|发|念|读)(?:一遍|一次)|复述|逐字|歌词|唱|绕口令|repeat/i.test(request))return String(value);
  const seen=new Set();
  return String(value).split(/(\n\s*\n|\|\|\|)/).filter(part=>{
    const key=part.normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu,'');
    if(key.length<16)return true;
    if(seen.has(key))return false;seen.add(key);return true;
  }).join('').replace(/(?:\|\|\|\s*){2,}/g,'|||').replace(/\n{3,}/g,'\n\n').trim();
}

export function parseQzoneResponse(raw='') {
  const source=String(raw).trim(),start=source.indexOf('{'),end=source.lastIndexOf('}');
  if(start<0||end<start)throw Object.assign(Error('空间没有返回可核验的发布结果，状态未知，请先检查空间，勿直接重发'),{deliveryUnknown:true});
  let value;try{value=JSON.parse(source.slice(start,end+1));}catch{throw Object.assign(Error('空间返回无法解析，发布状态未知，请先检查空间，勿直接重发'),{deliveryUnknown:true});}
  const code=value.code??value.ret??value.retcode;
  if(!['number','string'].includes(typeof code)||!/^[-+]?\d+$/.test(String(code)))throw Object.assign(Error('空间返回缺少明确状态，发布结果未知，请先检查空间'),{deliveryUnknown:true});
  if(Number(code)!==0)throw Error('空间拒绝发布，code='+String(code));
  const itemId=String(value.tid||value.data?.tid||value.data?.id||'');
  return {ok:true,status:'accepted',verified:false,itemId,coverage:'平台返回接收成功；尚未读回核验实际说说，不能声称已核实发布'};
}

export function qqActionTarget(params={}) {
  const value={};for(const key of ['user_id','group_id','message_id','id','domain'])if(params[key]!==undefined)value[key]=String(params[key]).slice(0,160);
  return value;
}

export function qqActionResult(name,result) {
  if(/^send_(?:msg|private_msg|group_msg)$/.test(name)){const id=String(result?.message_id??''),valid=/^-?\d{1,24}$/.test(id)&&!/^-?0+$/.test(id);return {status:valid?'accepted':'unknown',messageId:valid?id:'',verified:false,transportAccepted:valid,recipient:'unknown',read:'unknown'};}
  return {status:/^(?:get_|can_|check_)/.test(name)?'completed':'accepted',verified:/^(?:get_|can_|check_)/.test(name)};
}
