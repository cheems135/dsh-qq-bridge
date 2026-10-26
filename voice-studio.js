import {createHash} from 'node:crypto';
export const SWEET_VOICES=[
 {id:'sweet-girl',name:'轻甜 · 晓伊',voice:'zh-CN-XiaoyiNeural',rate:-2,pitch:2,description:'轻快年轻女声，适合日常聊天',sample:'sweet-natural.mp3'},
 {id:'soft-girl',name:'温柔 · 晓晓',voice:'zh-CN-XiaoxiaoNeural',rate:-4,pitch:2,description:'温暖柔和女声，适合陪伴与安慰',sample:'soft-natural.mp3'},
];
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
 return {sweetPreset:SWEET_VOICES.some(v=>v.id===input.sweetPreset)?input.sweetPreset:'sweet-girl',emotion:VOICE_MOODS.some(v=>v.id===input.emotion)?input.emotion:'auto',sweetSetupRevision:String(input.sweetSetupRevision||''),
 minimax:{apiKey:text(mini.apiKey,600),model:['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo'].includes(mini.model)?mini.model:'speech-2.8-hd',voiceId:text(mini.voiceId,120)||'female-tianmei',speed:bound(mini.speed,1,0.7,1.3)},
 breeze:breezeExtras(input)};
}
export function safeVoiceConfig(config={}) {const extras=voiceExtras(config);return{...config,...extras,minimax:{...extras.minimax,apiKey:'',hasKey:!!extras.minimax.apiKey},breeze:{...extras.breeze,apiKey:'',hasKey:!!extras.breeze.apiKey}};}
export function cleanVoiceError(error,key='') {let value=String(error?.message||error||'语音合成失败');if(key)value=value.split(key).join('[已隐藏]');return value.replace(/Bearer\s+\S+|sk[-_][\w-]+|brz_[\w-]+|https?:\/\/\S+/gi,'[已隐藏]').slice(0,220);}
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
 const zh={natural:'像日常聊天一样自然说话，停顿随句意，不用播音腔。',happy:'带一点真实的开心，语气轻快、有自然起伏，不过分兴奋。',gentle:'正在温柔安慰对方，语速稍缓，声音柔和，不哭腔、不说教。',sad:'有一点低落，语速稍缓、语气收敛，不夸张哭泣。',surprised:'带着轻微惊喜，重音自然，不尖叫。',serious:'认真清楚地说话，节奏稳，重点自然强调。'};
 const en={natural:'Speak like a natural conversation, with pauses shaped by the sentence.',happy:'Sound quietly happy and lightly animated, without exaggerated excitement.',gentle:'Reassure the listener gently, slightly slower and warm, without sounding tearful.',sad:'Sound a little subdued and slower, without dramatic crying.',surprised:'Express a little pleasant surprise with natural emphasis, without shouting.',serious:'Speak clearly and thoughtfully with steady pacing and natural emphasis.'};
 return{mood,instructions:options.instructions!==undefined?String(options.instructions):[extras.breeze.instructions,mood==='natural'&&extras.breeze.instructions?'':(english?en:zh)[mood]].filter(Boolean).join('\n')};
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
export function planSweetVoice(line,config={},options={}) {
 const extras=voiceExtras(config),preset=SWEET_VOICES.find(v=>v.id===(options.preset||extras.sweetPreset))||SWEET_VOICES[0];
 const mood=voiceMood(options.emotion||extras.emotion,line);
 const delta={natural:[0,0],happy:[4,3],gentle:[-5,-2],sad:[-7,-4],surprised:[3,4],serious:[-2,-1]}[mood];
 const signed=(n,unit)=>(n>=0?'+':'')+Math.round(n)+unit;
 const voice=/^zh-(?:CN|TW|HK)-[\w-]+Neural$/.test(options.voiceOverride||'')?options.voiceOverride:preset.voice;
 return {preset:preset.id,label:preset.name,voice,mood,rate:signed(preset.rate+delta[0],'%'),pitch:signed(preset.pitch+delta[1],'Hz'),volume:'+0%',engine:'sweet',capability:'prosody'};
}
export function voiceCacheKey(line,config,plan) {return createHash('sha256').update(JSON.stringify({line,engine:config.engine,plan,accountKey:voiceExtras(config).minimax.apiKey,breezeKey:voiceExtras(config).breeze.apiKey})).digest('hex').slice(0,32);}
export async function miniMaxSpeech(line,config={},options={},fetchImpl=globalThis.fetch) {
 const mini=voiceExtras(config).minimax;if(!mini.apiKey)throw Error('情绪增强需要单独填写 MiniMax API Key；免费甜妹无需 Key');
 const override=String(options.voiceOverride||'');const voiceId=override&&!/^zh-/.test(override)?text(override,120):mini.voiceId;
 const requested=options.emotion||config.emotion||'auto';const mood=voiceMood(requested,line);
 const emotion={natural:'calm',happy:'happy',gentle:'calm',sad:'sad',surprised:'surprised',serious:'calm'}[mood];
 const payload={model:mini.model,text:String(line).trim(),stream:false,output_format:'hex',language_boost:'Chinese',voice_setting:{voice_id:voiceId,speed:mini.speed,vol:1,pitch:0,...(requested==='auto'?{}:{emotion})},audio_setting:{sample_rate:32000,bitrate:128000,format:'mp3',channel:1}};
 if(!payload.text||payload.text.length>3000)throw Error('语音文本需为 1 到 3000 字');
 let response;try{response=await fetchImpl('https://api.minimax.cn/v1/t2a_v2',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+mini.apiKey,'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(45000)});}catch{throw Error('情绪语音接口连接失败或超时');}
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
/** Breeze TTS 2：官方 api.breeze.blue，或自建 vLLM-Omni 的 OpenAI 兼容 /v1/audio/speech。 */
export async function breezeSpeech(line,config={},options={},fetchImpl=globalThis.fetch) {
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
   url=breeze.baseUrl+'/v1/text-to-speech/'+encodeURIComponent(voice)+'?output_format=mp3';
   headers={'xi-api-key':breeze.apiKey,'content-type':'application/json',accept:'audio/mpeg'};
   payload={text:part,model_id:breeze.model,language_code:breeze.language,voice_settings:{guidance_scale:breeze.guidance}};
   if(instructions!=='')payload.instructions=instructions;
  }else{
   url=breeze.baseUrl+'/v1/audio/speech';
   headers={'content-type':'application/json',accept:'audio/mpeg'};
   if(breeze.apiKey!=='')headers.authorization='Bearer '+breeze.apiKey;
   payload={model:breeze.model,input:part,voice:voice||'S0',response_format:'mp3'};
   if(instructions!=='')payload.instructions=instructions;
  }
  let response;
  try{response=await fetchImpl(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)});}catch{throw Error('Breeze 语音接口连接失败或超时');}
  const buffer=Buffer.from(await response.arrayBuffer());
  if(buffer.length>42*1024*1024)throw Error('Breeze 语音返回过大');
  if(!response.ok){
   let detail='';try{const parsed=JSON.parse(buffer.toString('utf8'));detail=parsed.detail||parsed.error?.message||parsed.error||parsed.message||'';}catch{}
   const code=String(response.status),hint={
    '401':'密钥被拒绝：到 breeze.blue 开发者控制台复制完整密钥（brz_ 开头），别填 Key ID 或名字',
    '403':'密钥权限不足或被风控拦截：确认 Key 已启用，必要时换网络重试',
    '404':breeze.mode==='official'?'音色不存在：voc_ 音色可能属于别的账号或已被删除':'接口不存在：检查自建地址，vLLM-Omni 应为 /v1/audio/speech',
    '429':'超出速率限制或积分不足，稍后再试',
   }[code];
   throw Error('Breeze 语音失败（HTTP '+code+'）'+(hint?'：'+hint:'')+(detail!==''?'（'+cleanVoiceError(detail,breeze.apiKey)+'）':''));
  }
  if(buffer.length<1000)throw Error('Breeze 没有返回有效音频');
  const chunkFormat=buffer.subarray(0,4).toString('binary')==='RIFF'?'wav':'mp3';
  if(chunkFormat==='mp3'&&!(buffer.subarray(0,3).toString()==='ID3'||buffer[0]===255&&(buffer[1]&224)===224))throw Error('Breeze 返回的内容不是音频');
  if(chunkFormat==='wav'&&parts.length>1)throw Error('Breeze 返回了 WAV，长文本无法拼接，请把这段话缩短或分词发送');
  format=chunkFormat;buffers.push(buffer);
 }
 const bytes=buffers.length===1?buffers[0]:Buffer.concat(buffers);
 return {bytes,format,engine:'breeze',voice:voice||'S0',mode:breeze.mode,capability:'emotion',mood:delivery.mood,parts:parts.length};
}
