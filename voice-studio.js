export function normalizeVoiceEngine(engine){return ['none','minimax','breeze','localai','custom'].includes(engine)?engine:'none';}
import {createHash} from 'node:crypto';
export const VOICE_MOODS=[{id:'auto',name:'跟随内容'},{id:'natural',name:'自然'},{id:'happy',name:'开心'},{id:'gentle',name:'轻柔 / 安慰'},{id:'sad',name:'低落'},{id:'surprised',name:'惊喜'},{id:'serious',name:'认真'}];
const bound=(n,defaultValue,min,max)=>Number.isFinite(Number(n))?Math.max(min,Math.min(max,Number(n))):defaultValue;
const text=(v,max=200)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,max);
/** Breeze TTS 2：官方 API 走 /v1/text-to-speech/{voice_id}，自建 vLLM-Omni 走 OpenAI 兼容 /v1/audio/speech。 */
export const BREEZE_MODES=[{id:'official',name:'Breeze 官方 API'},{id:'openai',name:'自建 vLLM-Omni（OpenAI 兼容）'}];
const BREEZE_DEFAULT_BASE={official:'https://api.breeze.blue',openai:'http://127.0.0.1:8091'};
function breezeRoot(value,fallback) {
 const raw=String(value??'').trim();if(raw==='')return fallback;
 try{const url=new URL(raw);if(url.protocol!=='http:'&&url.protocol!=='https:')return fallback;return (url.origin+url.pathname).replace(/\/v1\/?$/,'').replace(/\/+$/,'')||fallback;}catch{return fallback;}
}
export function breezeExtras(input={}) {
 const raw=input.breeze&&typeof input.breeze==='object'?input.breeze:{};
 const mode=BREEZE_MODES.some(m=>m.id===raw.mode)?raw.mode:'official';
 const language=String(raw.language??'').trim().toLowerCase();
 return {mode,baseUrl:breezeRoot(raw.baseUrl,BREEZE_DEFAULT_BASE[mode]),apiKey:text(raw.apiKey,600),voiceId:text(raw.voiceId,120),
  model:text(raw.model,160)||(mode==='openai'?'BreezeBlue/Breeze-TTS-2':'breeze-tts-2'),
  language:/^[a-z]{2}$/.test(language)?language:'zh',
  instructions:text(raw.instructions,600),guidance:bound(raw.guidance,2,1,10)};
}
export function voiceExtras(input={}) {
 const mini=input.minimax&&typeof input.minimax==='object'?input.minimax:{};
 return {emotion:VOICE_MOODS.some(v=>v.id===input.emotion)?input.emotion:'auto',
 minimax:{apiKey:text(mini.apiKey,600),model:['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo'].includes(mini.model)?mini.model:'speech-2.8-hd',voiceId:text(mini.voiceId,120)||'female-tianmei',speed:bound(mini.speed,1,0.7,1.3)},
 breeze:breezeExtras(input)};
}
export function safeVoiceConfig(config={}) {const extras=voiceExtras(config);return{...config,...extras,minimax:{...extras.minimax,apiKey:'',hasKey:!!extras.minimax.apiKey},breeze:{...extras.breeze,apiKey:'',hasKey:!!extras.breeze.apiKey}};}
export function cleanVoiceError(error,key='') {let value=String(error?.message||error||'语音合成失败');if(key)value=value.split(key).join('[已隐藏]');return value.replace(/Bearer\s+\S+|sk[-_][\w-]+|brz_[\w-]+|https?:\/\/\S+/gi,'[已隐藏]').slice(0,220);}
async function voiceFetch(url,options,fetchImpl,label) {
 for(let attempt=0;attempt<2;attempt++){
  try{return await fetchImpl(url,options)}catch(error){
   const causes=[error,error?.cause,...(error?.cause?.errors||[])],codes=causes.map(e=>e?.code).filter(Boolean);
   const connecting=codes.some(code=>['EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','UND_ERR_CONNECT_TIMEOUT'].includes(code));
   // Retry only failures before connecting. Never repeat an uncertain POST or an HTTP rejection.
   if(attempt===0&&connecting&&!options.signal?.aborted){await new Promise(resolve=>setTimeout(resolve,350));continue}
   const hint=codes.some(c=>['EAI_AGAIN','ENOTFOUND'].includes(c))?'（手机网络域名解析失败）':codes.includes('UND_ERR_CONNECT_TIMEOUT')?'（连接服务超时，请检查网络）':codes.some(c=>['ENETUNREACH','EHOSTUNREACH','ECONNREFUSED'].includes(c))?'（当前网络无法连接该服务）':'';
   throw Error(label+'连接失败或超时'+hint);
  }
 }
}
export function voiceMood(value='auto',line='') {
 const aliases={'温柔':'gentle','轻柔':'gentle','安慰':'gentle','开心':'happy','自然':'natural','低落':'sad','难过':'sad','惊喜':'surprised','认真':'serious'};
 value=aliases[value]||value;
 if(value!=='auto'&&VOICE_MOODS.some(v=>v.id===value))return value;
 if(/别难过|不要难过|不开心|没关系|慢慢来|辛苦|我在(?:听|呢|这)|我陪|抱抱|不着急/.test(line))return'gentle';
 if(/对不起|抱歉|舍不得|失落/.test(line))return'sad';
 if(/太好了|好耶|哈哈|嘿嘿|真开心|好开心/.test(line))return'happy';
 if(/没想到|居然|真的呀|哇[，！!]/.test(line))return'surprised';
 return'natural';
}
export function breezeDelivery(line,config={},options={}) {
 const extras=voiceExtras(config),requested=options.emotion||extras.emotion,mood=voiceMood(requested,line);
 const english=!/[\p{Script=Han}]/u.test(String(line));
 const zh={natural:'自然地接着对话说这句话，按句意停顿，不用播音腔。',happy:'略带开心，轻快自然，不过分兴奋。',gentle:'温和自然，情绪克制，不带哭腔，不刻意气声。',sad:'略显低落但保持自然，不夸张哭泣。',surprised:'略有惊讶，重音自然，不尖叫。',serious:'认真清楚地说话，节奏稳，不嬉笑。'};
 const en={natural:'Continue this conversation naturally, with pauses shaped by this line.',happy:'Sound lightly happy, without exaggerated excitement.',gentle:'Sound warm and restrained, without a tearful or breathy performance.',sad:'Sound slightly subdued, without dramatic crying.',surprised:'Express mild surprise with natural emphasis, without shouting.',serious:'Speak clearly and seriously at a steady conversational pace.'};
 const direction=String(options.instructions||'').trim();
 if(options.performance==='sing')return{mood:'natural',instructions:english?'Keep this same voice and sing the supplied words as a short, tuneful unaccompanied song. Use a simple original melody, sustained vowels, clear pitch changes and a gentle steady beat. Sing rather than recite, with no spoken introduction or accompaniment.':'保持当前音色，把下面的文字清唱成一小段歌。使用简单的原创旋律、清楚的音高变化和稳定节拍，元音自然延长；不要朗诵歌词，不加口头开场，不加伴奏。'};
 // One contextual direction wins. Do not stack a stale fixed performance and
 // multiple contradictory mood recipes onto the same utterance.
 return{mood,instructions:direction||(mood==='natural'&&extras.breeze.instructions?extras.breeze.instructions:[extras.breeze.instructions,(english?en:zh)[mood]].filter(Boolean).join('\n'))};
}
export function resolveVoiceDelivery(config={},options={},review={}){
 const requested=options.emotion||config.emotion||'auto';
 const allowed=VOICE_MOODS.map(v=>v.id).filter(v=>v!=='auto');
 const mood=requested==='auto'?(allowed.includes(review?.delivery?.emotion)?review.delivery.emotion:'natural'):voiceMood(requested);
 let instructions=String(options.instructions||review?.delivery?.instructions||'').trim();
 if(requested!=='auto')instructions=breezeDelivery(options.text||'',{...config,breeze:{...config.breeze,instructions:''}},{emotion:mood}).instructions;
 if(!instructions)instructions=breezeDelivery(options.text||'',config,{emotion:'natural'}).instructions;
 return{emotion:mood,instructions,performance:options.performance||'speech'};
}
export async function breezeBalance(config={},fetchImpl=globalThis.fetch){
 const breeze=breezeExtras(config);
 if(breeze.mode==='openai')return{status:'free',reason:'Breeze 自建服务不消耗官方账户积分'};
 if(!breeze.apiKey)return{status:'unknown',reason:'尚未配置 Breeze API Key，无法查询积分'};
 let response;try{response=await fetchImpl(breeze.baseUrl+'/v1/balance',{method:'GET',headers:{'xi-api-key':breeze.apiKey,accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw Error('Breeze 积分查询连接失败');}
 if(!response.ok)throw Error('Breeze 积分查询失败（HTTP '+response.status+'）');
 const raw=await response.text();if(raw.length>256000)throw Error('Breeze 积分响应过大');
 let value;try{value=JSON.parse(raw);}catch{throw Error('Breeze 积分返回格式无效');}
 if(value.balance===null||value.balance===undefined||String(value.balance).trim()===''||!Number.isFinite(Number(value.balance)))throw Error('Breeze 未返回可验证的积分余额');
 return{status:'ok',entries:[{amount:String(value.balance),currency:'积分',kind:'quota'}]};
}
export function voiceCacheKey(line,config,plan) {return createHash('sha256').update(JSON.stringify({line,engine:config.engine,plan,accountKey:voiceExtras(config).minimax.apiKey,breezeKey:voiceExtras(config).breeze.apiKey})).digest('hex').slice(0,32);}
export async function miniMaxSpeech(line,config={},options={},fetchImpl=globalThis.fetch) {
 const mini=voiceExtras(config).minimax;if(!mini.apiKey)throw Error('情绪增强需要单独填写 MiniMax API Key');
 const override=String(options.voiceOverride||'');const voiceId=override&&!/^zh-/.test(override)?text(override,120):mini.voiceId;
 const requested=options.emotion||config.emotion||'auto';const mood=voiceMood(requested,line);
 const emotion={natural:'calm',happy:'happy',gentle:'calm',sad:'sad',surprised:'surprised',serious:'calm'}[mood];
 const payload={model:mini.model,text:String(line).trim(),stream:false,output_format:'hex',language_boost:'Chinese',voice_setting:{voice_id:voiceId,speed:mini.speed,vol:1,pitch:0,...(requested==='auto'?{}:{emotion})},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}};
 if(!payload.text||payload.text.length>3000)throw Error('语音文本需为 1 到 3000 字');
 const response=await voiceFetch('https://api.minimax.cn/v1/t2a_v2',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+mini.apiKey,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)},fetchImpl,'情绪语音接口');
 const raw=await response.text();if(raw.length>42*1024*1024)throw Error('情绪语音返回过大');
 let result;try{result=JSON.parse(raw);}catch{throw Error('情绪语音接口没有返回有效结果');}
 if(!response.ok||Number(result.base_resp?.status_code)!==0)throw Error('情绪语音失败：'+cleanVoiceError(result.base_resp?.status_msg||'服务不可用',mini.apiKey));
 const hex=result.data?.audio;if(typeof hex!=='string'||hex.length<2000||hex.length%2||!/^[\da-f]+$/i.test(hex))throw Error('情绪语音没有返回有效音频');
 const bytes=Buffer.from(hex,'hex');if(!(bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224))throw Error('情绪语音返回的内容不是 MP3');
 return {bytes,engine:'minimax',voice:voiceId,mood:requested==='auto'?'auto':mood,capability:'emotion'};
}
/** Breeze 单次请求上限 1000 字，长文本按句切成不超过 900 字的段。 */
export function breezeChunks(value,limit=900){
 const body=String(value??'').trim();if(body==='')return [];
 if(body.length<=limit)return [body];
 const parts=[];let rest=body;
 while(rest.length>limit){
  const window=rest.slice(0,limit),cut=Math.max(window.lastIndexOf('。'),window.lastIndexOf('！'),window.lastIndexOf('？'),window.lastIndexOf('!'),window.lastIndexOf('?'),window.lastIndexOf('\n'),window.lastIndexOf('；'),window.lastIndexOf('，'));
  const end=cut>=limit*0.4?cut+1:limit;
  parts.push(rest.slice(0,end).trim());rest=rest.slice(end).trim();
 }
 if(rest!=='')parts.push(rest);
 return parts.filter(p=>p!=='');
}
export function isBreezeCapacityError(detail){return /generation capacity is currently exhausted|generation_capacity_exhausted|capacity_exhausted|generation capacity exhausted/i.test(String(detail||''));}
const breezeQueues=new Map();
function capacityError(){return Object.assign(Error('Breeze 当前合成容量已满'),{code:'BREEZE_CAPACITY_EXHAUSTED',retryable:true});}
async function breezePause(ms,options){
 if(options.sleep){await options.sleep(ms);options.assertCurrent?.();return;}
 const end=Date.now()+ms;while(Date.now()<end){options.signal?.throwIfAborted();options.assertCurrent?.();await new Promise(resolve=>setTimeout(resolve,Math.min(1000,end-Date.now())));}
 options.signal?.throwIfAborted();options.assertCurrent?.();
}
/** Follow the one admitted job; never resubmit a timed-out paid POST. */
async function breezeJobAudio(response,breeze,fetchImpl,options={}){
 let job;try{job=await response.json()}catch{throw Error('Breeze 异步任务没有返回有效信息')}
 const id=String(job?.generation_job_id||'');if(!/^job_[\w-]{1,120}$/.test(id))throw Error('Breeze 异步任务缺少任务编号');
 const base=breeze.baseUrl+'/v1/generation-jobs/'+encodeURIComponent(id),headers={'xi-api-key':breeze.apiKey};
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  const r=await voiceFetch(base,{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(15000)},fetchImpl,'Breeze 任务查询');
  let state;try{state=await r.json()}catch{throw Error('Breeze 任务状态无效，未重复合成')}
  if(!r.ok)throw Error('Breeze 任务查询失败（HTTP '+r.status+'），未重复合成');
  const status=String(state.status||state.state||'').toLowerCase();
  if(['failed','error','cancelled','canceled'].includes(status)){
   const detail=state.error?.detail||state.error?.code||status;
   if(status==='failed'&&isBreezeCapacityError(detail))throw capacityError();
   throw Object.assign(Error('Breeze 合成任务失败：'+cleanVoiceError(detail,breeze.apiKey)),{terminalFailure:true});
  }
  if(['ready','completed','complete','succeeded','success'].includes(status))return voiceFetch(base+'/audio',{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(30000)},fetchImpl,'Breeze 音频下载');
  await new Promise(resolve=>setTimeout(resolve,1200));
 }
 throw Object.assign(Error('Breeze 异步合成仍未完成，未重复提交任务'),{deliveryUnknown:true});
}
/** Breeze TTS 2：官方 api.breeze.blue，或自建 vLLM-Omni 的 OpenAI 兼容 /v1/audio/speech。 */
export async function breezeSpeech(line,config={},options={},fetchImpl=globalThis.fetch) {
 const b=breezeExtras(config),key=createHash('sha256').update(b.baseUrl+'\n'+b.apiKey).digest('hex'),prior=breezeQueues.get(key);
 const task=(async()=>{if(prior)await prior.catch(()=>{});options.assertCurrent?.();options.signal?.throwIfAborted();return breezeSpeechNow(line,config,options,fetchImpl);})();
 breezeQueues.set(key,task);try{return await task;}finally{if(breezeQueues.get(key)===task)breezeQueues.delete(key);}
}
async function breezeSpeechNow(line,config={},options={},fetchImpl=globalThis.fetch) {
 const breeze=breezeExtras(config),body=String(line??'').trim();
 if(body==='')throw Error('语音文本为空');
 const override=String(options.voiceOverride||'').trim();
 const voice=override&&!/^zh-/.test(override)?override:breeze.voiceId;
 const delivery=breezeDelivery(body,config,options),instructions=delivery.instructions.trim();
 if(breeze.mode==='official'&&!breeze.apiKey)throw Error('先在语音设置里填写 Breeze API Key，或把合成模式改成自建 vLLM');
 if(breeze.mode==='official'&&!voice)throw Error('先填写 Breeze 音色 ID（voc_…，在 breeze.blue 里设计或克隆音色后复制）');
 const parts=breezeChunks(body),buffers=[];let format='mp3';
 for(const part of parts){
  let url,headers,payload;
  if(breeze.mode==='official'){
   url=breeze.baseUrl+'/v1/text-to-speech/'+encodeURIComponent(voice)+'?output_format=mp3&delivery=async';
   headers={'xi-api-key':breeze.apiKey,'content-type':'application/json',accept:'audio/mpeg'};
   payload={text:part,model_id:breeze.model,language_code:breeze.language,voice_settings:{guidance_scale:options.performance==='sing'?Math.max(4,breeze.guidance):breeze.guidance}};
   if(instructions!=='')payload.instructions=instructions;
  }else{
   url=breeze.baseUrl+'/v1/audio/speech';
   headers={'content-type':'application/json',accept:'audio/mpeg'};
   if(breeze.apiKey!=='')headers.authorization='Bearer '+breeze.apiKey;
   payload={model:breeze.model,input:part,voice:voice||'S0',response_format:'mp3'};
   if(instructions!=='')payload.instructions=instructions;
  }
  let buffer;
  for(let attempt=0;;attempt++){
   options.signal?.throwIfAborted();options.assertCurrent?.();
   let admitted=false;
   try{
    let response;
    try{response=await voiceFetch(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)},fetchImpl,'Breeze 语音接口');}catch(error){error.deliveryUnknown=true;throw error;}
    if(breeze.mode==='official'&&response.status===202){admitted=true;response=await breezeJobAudio(response,breeze,fetchImpl,options);}
    buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>42*1024*1024)throw Error('Breeze 语音返回过大');
  if(!response.ok){
   let detail='';try{const parsed=JSON.parse(buffer.toString('utf8'));detail=parsed.detail||parsed.error?.message||parsed.error||parsed.message||'';}catch{}
   const code=String(response.status),hint={
    '401':'密钥被拒绝：到 breeze.blue 开发者控制台复制完整密钥（brz_ 开头），别填 Key ID 或名字',
    '403':'密钥权限不足或被风控拦截：确认 Key 已启用，必要时换网络重试',
    '404':breeze.mode==='official'?'音色不存在：voc_ 音色可能属于别的账号或已被删除':'接口不存在：检查自建地址，vLLM-Omni 应为 /v1/audio/speech',
    '429':'超出速率限制或积分不足，稍后再试',
   }[code];
   if([429,503].includes(response.status)&&isBreezeCapacityError(detail))throw capacityError();
   throw Error('Breeze 语音失败（HTTP '+code+'）'+(hint?'：'+hint:'')+(detail!==''?'（'+cleanVoiceError(detail,breeze.apiKey)+'）':''));
  }
    break;
   }catch(error){
    if(admitted&&!error.terminalFailure&&error.code!=='BREEZE_CAPACITY_EXHAUSTED')error.deliveryUnknown=true;
    if(error.code!=='BREEZE_CAPACITY_EXHAUSTED'||attempt>=2)throw error;
    options.assertCurrent?.();const delay=[20000,45000][attempt];options.onRetry?.({attempt:attempt+1,delay,nextAt:Date.now()+delay,reason:'capacity'});await breezePause(delay,options);
   }
  }
  if(buffer.length<1000)throw Error('Breeze 没有返回有效音频');
  const chunkFormat=buffer.subarray(0,4).toString('binary')==='RIFF'?'wav':'mp3';
  if(chunkFormat==='mp3'&&!(buffer.subarray(0,3).toString()==='ID3'||buffer[0]===255&&(buffer[1]&224)===224))throw Error('Breeze 返回的内容不是音频');
  if(chunkFormat==='wav'&&parts.length>1)throw Error('Breeze 返回了 WAV，长文本无法拼接，请把这段话缩短或分词发送');
  format=chunkFormat;buffers.push(buffer);
 }
 options.assertCurrent?.();options.signal?.throwIfAborted();
 const bytes=buffers.length===1?buffers[0]:Buffer.concat(buffers);
 return {bytes,format,engine:'breeze',voice:voice||'S0',mode:breeze.mode,capability:'emotion',mood:delivery.mood,parts:parts.length};
}
