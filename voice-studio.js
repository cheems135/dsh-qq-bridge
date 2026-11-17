export function normalizeVoiceEngine(engine){return ['none','minimax','breeze','localai','custom'].includes(engine)?engine:'none';}
import{recipePayload}from'./voice-recipes.js';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {guidanceFor,composeDirection,emotionProfile,anchorTags,VOICE_PERFORMANCE_REVISION} from './voice-performance.js';
import {readFileSync as _readSceneFile} from 'node:fs';
/** 场景预设：官方 audio-tags 的 34 个事件里挑出常用的组合，标签必须原样使用。 */
const SCENE_TABLE=(()=>{try{return JSON.parse(_readSceneFile(new URL('./voice-scenes.json',import.meta.url),'utf8')).scenes||{}}catch{return {}};})();
const SCENE_RUNTIME=(()=>{try{return JSON.parse(_readSceneFile(new URL('./tools/media-runtime-'+(process.platform==='win32'?'desktop':'mobile')+'.json',import.meta.url),'utf8'));}catch{return {};}})();
export const VOICE_SCENE_REVISION='20261111-scene-trigger-v2';
export function voiceScene(name=''){const k=String(name||'').trim();return k&&SCENE_TABLE[k]?{id:k,...SCENE_TABLE[k]}:null;}
export function sceneNames(){return Object.keys(SCENE_TABLE);}
import {appendFileSync,writeFileSync} from 'node:fs';
const voiceDbg=(m)=>{try{appendFileSync('/tmp/dsh-voice-debug.log',new Date().toISOString()+' '+m+'\n')}catch{}};

/* 官方音频标签（Breeze TTS 2，zh）：必须写进文本才会真的带出动作 */
export const MOOD_TAGS={crying:'[抽泣]',sad:'[呜咽][抽泣]',lonely:'[叹气]',helpless:'[叹气]',guilt:'[叹气]',
 moan:'[呻吟]',pained:'[呻吟]',tender:'[耳语]',whisper:'[耳语]',shy:'[耳语]',breathless:'[喘息]',tired:'[喘息]',
 afraid:'[惊呼]',nervous:'[吸气]',anxiety:'[喘息]',surprised:'[惊呼]',angry:'[闷哼]',sarcastic:'[冷笑]',disgust:'[闷哼]',
 happy:'[轻笑]',smug:'[轻笑]',teasing:'[轻笑]',laugh:'[咯咯笑]',excited:'[轻笑]',relieved:'[叹气]',moved:'[呜咽]',
 jealousy:'[冷笑]',boredom:'[叹气]',confused:'[吸气]',curiosity:'[吸气]',anticipation:'[吸气]',commanding:'[喊叫]'};
export const VOICE_MOODS=[{id:'auto',name:'跟随内容'},{id:'natural',name:'自然'},{id:'happy',name:'开心'},{id:'gentle',name:'轻柔 / 安慰'},{id:'sad',name:'低落'},{id:'surprised',name:'惊喜'},{id:'serious',name:'认真'},{id:'tender',name:'撒娇 / 黏'},{id:'shy',name:'害羞'},{id:'teasing',name:'挑逗'},{id:'whisper',name:'耳语 / 小声'},{id:'tired',name:'慵懒 / 累'},{id:'excited',name:'兴奋'},{id:'angry',name:'有点气'},{id:'afraid',name:'害怕 / 恐惧'},{id:'breathless',name:'急促 / 抢话'},{id:'moan',name:'娇喘 / 气息断续'},{id:'pained',name:'吃痛 / 用力'},{id:'crying',name:'哭腔 / 委屈'},{id:'smug',name:'得意 / 欠揍'},{id:'cold',name:'冷淡 / 没起伏'},{id:'relieved',name:'释然 / 松口气'},{id:'confused',name:'疑惑 / 拿不准'},{id:'commanding',name:'强势 / 命令'},{id:'nervous',name:'紧张 / 慌'},{id:'laugh',name:'带笑 / 轻笑'},{id:'trust',name:'信任 / 依赖'},{id:'anticipation',name:'期待 / 盼望'},{id:'disgust',name:'嫌弃 / 厌恶'},{id:'guilt',name:'愧疚 / 自责'},{id:'anxiety',name:'焦虑 / 没底'},{id:'boredom',name:'无聊 / 兴致缺缺'},{id:'curiosity',name:'好奇 / 想知道'},{id:'moved',name:'感动 / 鼻酸'},{id:'lonely',name:'孤单 / 想人陪'},{id:'jealousy',name:'吃醋 / 酸'},{id:'helpless',name:'无奈 / 没辙'},{id:'sarcastic',name:'嘲讽 / 翻白眼'},{id:'pity',name:'心疼 / 怜惜'}];
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
  instructions:text(raw.instructions,600),guidance:bound(raw.guidance,6,1,10),speed:bound(raw.speed??1,1,.5,2)};
}
export function voiceExtras(input={}) {
 const mini=input.minimax&&typeof input.minimax==='object'?input.minimax:{};
 return {emotion:VOICE_MOODS.some(v=>v.id===input.emotion)||voiceScene(input.emotion)||voiceMoodList(input.emotion).length?input.emotion:'auto',
 minimax:{apiKey:text(mini.apiKey,600),model:['speech-2.8-hd','speech-2.8-turbo','speech-2.6-hd','speech-2.6-turbo'].includes(mini.model)?mini.model:'speech-2.8-hd',voiceId:text(mini.voiceId,120)||'female-tianmei',speed:bound(mini.speed,1,0.7,1.3)},
 breeze:breezeExtras(input)};
}
export function safeVoiceConfig(config={}) {const extras=voiceExtras(config);return{...config,...extras,minimax:{...extras.minimax,apiKey:'',hasKey:!!extras.minimax.apiKey},breeze:{...extras.breeze,apiKey:'',hasKey:!!extras.breeze.apiKey}};}
export function cleanVoiceError(error,key='') {let value=String(error?.message||error||'语音合成失败');if(key)value=value.split(key).join('[已隐藏]');return value.replace(/Bearer\s+\S+|sk[-_][\w-]+|brz_[\w-]+|https?:\/\/\S+/gi,'[已隐藏]').slice(0,220);}
async function voiceFetch(url,options,fetchImpl,label) {
 // 手机网络抖一下就会 ECONNRESET/UND_ERR_SOCKET，过去只对少数几个错误码重试，
 // 剩下的直接判失败（14:44 那条就是这样丢的）。这里改成：只要不是我们自己主动中止，
 // 都视作「连接没建立、没拿到响应」，安全地重试两次。
 for(let attempt=0;attempt<3;attempt++){
  try{return await fetchImpl(url,options)}catch(error){
   const causes=[error,error?.cause,...(error?.cause?.errors||[])],codes=causes.map(e=>e?.code).filter(Boolean);
   const connecting=codes.some(code=>['EAI_AGAIN','ENETUNREACH','EHOSTUNREACH','ECONNREFUSED','ECONNRESET','EPIPE','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET','UND_ERR_CLOSED'].includes(code));
   if(attempt<2&&!options.signal?.aborted){await new Promise(resolve=>setTimeout(resolve,400*(attempt+1)));continue}
   const hint=codes.some(c=>['EAI_AGAIN','ENOTFOUND'].includes(c))?'（手机网络域名解析失败）':codes.includes('UND_ERR_CONNECT_TIMEOUT')?'（连接服务超时，请检查网络）':codes.some(c=>['ENETUNREACH','EHOSTUNREACH','ECONNREFUSED'].includes(c))?'（当前网络无法连接该服务）':'';
   throw Error(label+'连接失败或超时'+hint);
  }
 }
}
// 保留兼容导出；实际合成不再据此表自动修改用户的语速。
const MOOD_SPEED={crying:.88,pained:.9,moan:.92,breathless:1.08,anxious:1.05,anxiety:1.05,nervous:1.06,excited:1.08,angry:1.04,laugh:1.05,whisper:.92,tired:.9,sad:.92,lonely:.94,tender:.94,gentle:.94,natural:1,serious:.98,commanding:.97};
export function moodSpeed(mood){return MOOD_SPEED[mood]||1;}
function describedVoiceMood(value){
 const label=String(value||'').trim();
 // Model reviews commonly include strength/physical qualifiers. Interpret only
 // the emotion label, never the dialogue or a negated performance instruction.
 if(!label||label.length>80||/(?:不(?:要|是|再|用)?|别|无需|没有|避免|非).*(?:哭|泣|笑|怒|喊|怕|恐惧|生气)|\b(?:not|no|without|avoid)\b/i.test(label))return '';
 for(const [pattern,mood]of [[/哭|泣|抽噎|哽咽|\b(?:crying|sobbing|weeping)\b/i,'crying'],[/愤怒|暴怒|怒火|愤慨|盛怒|生气|\b(?:angry|furious|rage)\b/i,'angry'],[/狂喜|狂欢|兴奋|激动|欣喜|\b(?:excited|ecstatic|elated)\b/i,'excited'],[/大笑|狂笑|笑到|笑得|爆笑|笑出声|笑声|\b(?:laughing|laughter|giggling)\b/i,'laugh'],[/恐惧|害怕|惊恐|惊惧|\b(?:afraid|terrified|frightened)\b/i,'afraid'],[/气息急促|呼吸急促|喘不上气|\bbreathless\b/i,'breathless'],[/悲伤|悲痛|伤心|失落|低落|\b(?:sad|sorrowful)\b/i,'sad']])if(pattern.test(label))return mood;
 return '';
}
export function voiceMood(value='auto',line='') {
 const aliases={'温柔':'gentle','轻柔':'gentle','安慰':'gentle','开心':'happy','自然':'natural','低落':'sad','难过':'sad','惊喜':'surprised','认真':'serious','撒娇':'tender','黏':'tender','软':'tender','害羞':'shy','羞':'shy','挑逗':'teasing','逗':'teasing','耳语':'whisper','小声':'whisper','懒':'tired','累':'tired','困':'tired','兴奋':'excited','激动':'excited','气':'angry','生气':'angry','凶':'angry','害怕':'afraid','怕':'afraid','恐惧':'afraid','发抖':'afraid','急':'breathless','喘':'breathless','急促':'breathless','喘不上气':'breathless','娇喘':'moan','喘气':'moan','断续':'moan','酥':'moan','痛':'pained','用力':'pained','吃痛':'pained','咬牙':'pained','哭':'crying','哭腔':'crying','委屈':'crying','哽咽':'crying','得意':'smug','欠揍':'smug','傲':'smug','冷':'cold','冷淡':'cold','冷漠':'cold','释然':'relieved','松口气':'relieved','放心':'relieved','疑惑':'confused','困惑':'confused','拿不准':'confused','强势':'commanding','命令':'commanding','强硬':'commanding','紧张':'nervous','慌':'nervous','不安':'nervous','笑':'laugh','轻笑':'laugh','笑着':'laugh','信任':'trust','依赖':'trust','安心':'trust','期待':'anticipation','盼望':'anticipation','盼':'anticipation','嫌弃':'disgust','厌恶':'disgust','恶心':'disgust','愧疚':'guilt','自责':'guilt','内疚':'guilt','焦虑':'anxiety','没底':'anxiety','心慌':'anxiety','无聊':'boredom','没兴致':'boredom','好奇':'curiosity','想知道':'curiosity','感动':'moved','鼻酸':'moved','孤单':'lonely','孤独':'lonely','寂寞':'lonely','吃醋':'jealousy','酸':'jealousy','无奈':'helpless','没辙':'helpless','嘲讽':'sarcastic','翻白眼':'sarcastic','阴阳':'sarcastic','心疼':'pity','怜惜':'pity','渴望':'breathless','想要':'tender','馋':'breathless','迫不及待':'excited','忍不住':'breathless','发抖声':'afraid','半梦半醒':'tired','黏人':'tender'};
 value=aliases[value]||describedVoiceMood(value)||value;
 if(value!=='auto'&&VOICE_MOODS.some(v=>v.id===value))return value;
 if(/别难过|不要难过|不开心|没关系|慢慢来|辛苦|我在(?:听|呢|这)|我陪|抱抱|不着急/.test(line))return'gentle';
 if(/对不起|抱歉|舍不得|失落/.test(line))return'sad';
 if(/太好了|好耶|哈哈|嘿嘿|真开心|好开心/.test(line))return'happy';
 if(/没想到|居然|真的呀|哇[，！!]/.test(line))return'surprised';
 return'natural';
}
/** 解析一个或多个情绪：支持“渴望+挑逗”“娇喘、耳语”这类叠加写法。 */
export function voiceMoodList(value='') {
 const raw=String(value||'').trim();
 if(raw===''||raw==='auto')return [];
 const parts=raw.split(/[+＋,，、\/／|]/).map(v=>v.trim()).filter(Boolean).slice(0,3);
 const out=[];
 for(const part of parts){const id=voiceMood(part,'');if(id!=='natural'&&id!=='auto'&&!out.includes(id))out.push(id);}
 return out;
}
const BRACKET=/\[[^\]]{1,12}\]|\([^)]{1,20}\)/;
export function normalizeVoiceMood(value='auto') {
 const raw=String(value||'').trim();
 if(!raw||raw==='auto')return'natural';
 if(voiceScene(raw))return raw;
 const combo=voiceMoodList(raw);
 return combo.length?combo.join('+'):voiceMood(raw);
}
export function breezeDelivery(line,config={},options={}) {
 const extras=voiceExtras(config),requested=options.emotion||extras.emotion;
 /* 场景预设（口含、被捂嘴…）：标签与表演方向都走官方字典，不自己编标签。 */
 const scene=voiceScene(requested);
 if(scene&&options.performance!=='sing'){
  const english=!/[\p{Script=Han}]/u.test(String(line));
  const current=String(options.instructions||'').trim();
  if(options.instructionsPrepared&&current)return{mood:'natural',scene:scene.id,sceneTags:scene.tags,instructions:current};
  return{mood:'natural',scene:scene.id,sceneTags:scene.tags,instructions:composeDirection({mood:'natural',userDirection:current,extra:[extras.breeze.instructions,String(scene.instruction||'')+'；只改表演，不改台词。'].filter(Boolean).join('；'),line:String(line||''),language:english?'en':'zh'})};
 }const combo=voiceMoodList(requested),moodsList=combo.length?combo:[voiceMood(requested,line)],mood=moodsList[0];
 const english=!/[\p{Script=Han}]/u.test(String(line));
 const direction=String(options.instructions||'').trim();
 if(options.instructionsPrepared&&direction&&options.performance!=='sing')return{mood,instructions:direction};
 if(options.performance==='sing')return{mood:'natural',instructions:english?'Keep this same voice and sing the supplied words as a short, tuneful unaccompanied song. Use a simple original melody, sustained vowels, clear pitch changes and a gentle steady beat. Sing rather than recite, with no spoken introduction or accompaniment.':'保持当前音色，把下面的文字清唱成一小段歌。使用简单的原创旋律、清楚的音高变化和稳定节拍，元音自然延长；不要朗诵歌词，不加口头开场，不加伴奏。'};
 // A real contextual direction already describes intensity and pacing. Generic
 // defaults such as "angry but not shouting" must not negate that direction.
 if(direction)return{mood,instructions:composeDirection({mood,userDirection:direction,extra:extras.breeze.instructions,language:english?'en':'zh',profile:{mood,cues:[]}})};
 // One contextual direction wins. Do not stack a stale fixed performance and
 // multiple contradictory mood recipes onto the same utterance.
 const profiles=moodsList.map(emotionProfile),fallback={mood:profiles.map(p=>p.mood).join('、'),cues:[...new Set(profiles.flatMap(p=>p.cues||[]))].slice(0,2)};
 return{mood,instructions:composeDirection({mood,userDirection:extras.breeze.instructions,language:english?'en':'zh',profile:fallback})};
}
export function resolveVoiceDelivery(config={},options={},review={}){
 const requested=options.emotion||config.emotion||'auto';
 // 组合情绪（哭腔+害怕+吃痛）要原样往后传，breezeDelivery 才拆得开；
 // 以前这里用 voiceMood() 解析，遇到“+”直接掉成 natural，标签和配方全丢。
 const combo=voiceMoodList(requested);
 const mood=normalizeVoiceMood(requested==='auto'?review?.delivery?.emotion:requested);
 // 以前二选一：手动情绪时丢掉审核方向，auto 时丢掉情绪配方。auto 只剩一句笼统方向，台词自然被读平。
 const direction=String(options.instructions||review?.delivery?.instructions||'').trim();
 const instructions=breezeDelivery(String(options.text||''),config,{emotion:combo.length?requested:mood,instructions:direction,performance:options.performance}).instructions;
 return{emotion:mood,instructions,instructionsPrepared:true,performance:options.performance||'speech',autoTags:options.autoTags===true};
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
export function voiceCacheKey(line,config,plan) {
 const extras=voiceExtras(config);
 const synthesis=config.engine==='breeze'?extras.breeze:config.engine==='minimax'?extras.minimax:null;
 return createHash('sha256').update(JSON.stringify({line,engine:config.engine,plan,synthesis,performanceRevision:VOICE_PERFORMANCE_REVISION,accountKey:extras.minimax.apiKey,breezeKey:extras.breeze.apiKey})).digest('hex').slice(0,32);
}
export async function miniMaxSpeech(line,config={},options={},fetchImpl=globalThis.fetch) {
 const mini=voiceExtras(config).minimax;if(!mini.apiKey)throw Error('情绪增强需要单独填写 MiniMax API Key');
 const override=String(options.voiceOverride||'');const voiceId=override&&!/^zh-/.test(override)?text(override,120):mini.voiceId;
 const requested=options.emotion||options.emotionHint||config.emotion||'auto';const moods=voiceMoodList(requested);const mood=moods[0]||voiceMood(requested,line);
 const emotion={natural:'calm',happy:'happy',gentle:'calm',sad:'sad',crying:'sad',surprised:'surprised',serious:'calm',tender:'happy',shy:'calm',teasing:'happy',whisper:'calm',tired:'calm',excited:'happy',angry:'angry'}[mood]||'calm';
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
/** 官方：HTTP 单次 1000 字上限；中文超过 500 字由服务端按 ≤500 字分段、段间补 0.25s。
 *  我们按同一口径切，避免自己切成 900 字后和官方分段规则打架。 */
import {execFileSync as _execFile} from 'node:child_process';
import {tmpdir as _tmpdir,platform as _platform} from 'node:os';
import {writeFileSync as _writeTmp,readFileSync as _readTmp,existsSync as _existsTmp,unlinkSync as _unlinkTmp} from 'node:fs';
/** 场景声学后处理：合成后用 tools/scene-fx.py 改谱包络（鼻音、反共振、闷、辅音帧）。
 *  失败不抛错，退回原始音频，只在返回值里标注 fx 未生效。 */
function sceneShaped(bytes,fx,label){
 if(!fx||!Object.keys(fx).length)return bytes;
 const py=process.env.DSH_SCENE_PYTHON||SCENE_RUNTIME.scoreSingingPythonPath||'/root/projects/.dsh/tools/qq-bridge-mobile-media/bin/python';
 const script=fileURLToPath(new URL('./tools/scene-fx.py',import.meta.url));
 if(!_existsTmp(py))return bytes;
 const ffmpeg=process.env.DSH_FFMPEG||SCENE_RUNTIME.ffmpegPath||'/usr/bin/ffmpeg';
 const stamp=Date.now()+'-'+Math.random().toString(36).slice(2,7);
 const src=_tmpdir()+'/dsh-scene-'+stamp+'.mp3',out=_tmpdir()+'/dsh-scene-'+stamp+'.wav',mp3=_tmpdir()+'/dsh-scene-'+stamp+'-fx.mp3';
 try{
  _writeTmp(src,bytes);
  const parsed=JSON.parse(String(_execFile(py,[script],{input:JSON.stringify({input:src,output:out,ffmpegPath:ffmpeg,fx}),encoding:'utf8',timeout:120000})||'{}'));
  if(!parsed.ok)throw Error(parsed.error||'场景处理失败');
  _execFile(ffmpeg,['-v','error','-y','-i',out,'-ar','32000','-ac','1','-b:a','128k',mp3],{timeout:60000});
  const shaped=_readTmp(mp3);if(!shaped.length)throw Error('场景处理没有产出音频');
  return shaped;
 }catch(error){voiceDbg('scene fx skipped '+label+' '+(error?.message||error));return bytes;}
 finally{for(const file of [src,out,mp3])try{_unlinkTmp(file);}catch{}}
}
export function breezeChunks(value,limit=500){
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
  voiceDbg('job poll http='+r.status+' state='+JSON.stringify(state).slice(0,120));
  if(!r.ok)throw Error('Breeze 任务查询失败（HTTP '+r.status+'），未重复合成');
  const status=String(state.status||state.state||'').toLowerCase();
  if(['failed','error','cancelled','canceled'].includes(status)){
   const detail=state.error?.detail||state.error?.code||status;
   if(status==='failed'&&isBreezeCapacityError(detail))throw capacityError();
   throw Object.assign(Error('Breeze 合成任务失败：'+cleanVoiceError(detail,breeze.apiKey)),{terminalFailure:true});
  }
  if(['ready','completed','complete','succeeded','success'].includes(status)){
   /* 下载这一步常常在连接上抖一下，重试几次不会重复合成。 */
   let lastError;
   for(let attempt=0;attempt<3;attempt++){
    try{return await voiceFetch(base+'/audio',{method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(30000)},fetchImpl,'Breeze 音频下载');}
    catch(error){lastError=error;if(error?.name==='AbortError'||options.signal?.aborted)throw error;if(attempt<2)await new Promise(resolve=>setTimeout(resolve,1500));}
   }
   throw lastError;
  }
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
 const breeze=breezeExtras(config),raw=String(line??'').trim();
 // Preserve the supplied words; performance instructions carry breathing and pacing.
 const body=raw;
 if(body==='')throw Error('语音文本为空');
 const override=String(options.voiceOverride||'').trim();
 const voice=override&&!/^zh-/.test(override)?override:breeze.voiceId;
 const recipe=options.recipe?recipePayload(typeof options.recipe==='string'?options.recipe:options.recipe.name):null;
 const delivery=breezeDelivery(body,config,options);
 let instructions=recipe?recipe.instructions:delivery.instructions.trim();
 if(breeze.mode==='official'&&!breeze.apiKey)throw Error('先在语音设置里填写 Breeze API Key，或把合成模式改成自建 vLLM');
 if(breeze.mode==='official'&&!voice)throw Error('先填写 Breeze 音色 ID（voc_…，在 breeze.blue 里设计或克隆音色后复制）');
 const tag=(Array.isArray(delivery.sceneTags)&&delivery.sceneTags.length?delivery.sceneTags.join(''):'')||(options.autoTags===true?MOOD_TAGS[delivery.mood]||'':'');
 // 每段只在句首落一个标签：多插方括号在不支持该标签的音色上会被念出来。
 const distribute=(text,tags)=>{
  if(!tags.length)return text;
  const segs=String(text).split(/(?<=……)|(?<=[。！？!?])|(?<=，)/).filter(Boolean);
  if(segs.length<=1)return tags.join('')+text;
  let k=0;
  return segs.map(seg=>{const usable=tags.length&&k<tags.length&&!BRACKET.test(seg);if(usable){k+=1;return tags[k-1]+seg;}return seg;}).join('');
 };
 const sceneTags=Array.isArray(delivery.sceneTags)?delivery.sceneTags:[];
 const parts=recipe?[recipe.text]:breezeChunks(body).map(part=>sceneTags.length?distribute(part,sceneTags):tag?anchorTags(part,tag):part),buffers=[];let format='mp3';
 for(const part of parts){
  let url,headers,payload;
  if(breeze.mode==='official'){
   url=breeze.baseUrl+'/v1/text-to-speech/'+encodeURIComponent(voice)+'?output_format=mp3';
   headers={'xi-api-key':breeze.apiKey,'content-type':'application/json',accept:'audio/mpeg'};
   // 说话尊重面板的引导强度，不因识别到强烈情绪而暗中抬高。
   const scale=recipe?recipe.guidance:guidanceFor(delivery.mood,breeze.guidance,options.performance);
   // 本轮明确速度优先，否则使用保存速度；情绪节奏交给本轮表演指令。
   const settings={guidance_scale:scale};
   const speed=Number(options.speed??breeze.speed);
   if(Number.isFinite(speed)&&speed!==1)settings.speed=Math.max(.5,Math.min(2,Math.round(speed*100)/100));
   payload={text:part,model_id:breeze.model,language_code:breeze.language,voice_settings:settings};
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
    let response;const t0=Date.now();
    voiceDbg('POST start mode='+breeze.mode+' chars='+part.length+' attempt='+attempt+' voice='+(voice||'')+' model='+breeze.model);
    try{response=await voiceFetch(url,{method:'POST',redirect:'error',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(120000)},fetchImpl,'Breeze 语音接口');}
    catch(error){voiceDbg('POST error '+(error?.name||'')+' '+(Date.now()-t0)+'ms '+(String(error?.message||'').slice(0,140)));error.deliveryUnknown=true;throw error;}
    voiceDbg('POST status='+response.status+' '+(Date.now()-t0)+'ms');
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
   /* 上游 502/503/504 是对方服务自己抖动：请求没被受理，重试不会重复扣费。 */
   if([502,503,504].includes(response.status)&&attempt<2){
    const delay=[2000,6000][attempt];
    options.onRetry?.({attempt:attempt+1,delay,nextAt:Date.now()+delay,reason:'upstream',status:response.status});
    await new Promise(resolve=>setTimeout(resolve,delay));
    options.signal?.throwIfAborted();
    continue;
   }
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
 let bytes=buffers.length===1?buffers[0]:Buffer.concat(buffers);
 /* 场景预设带 fx 时，合成后再整一次谱包络，光靠标签做不出“嘴里塞着东西”。 */
 const sceneFx=delivery.scene?SCENE_TABLE[delivery.scene]?.fx:null;
 let sceneFxApplied=false;
 if(breeze.mode==='official'&&sceneFx&&format==='mp3'){const shaped=sceneShaped(bytes,sceneFx,delivery.scene);if(shaped!==bytes){bytes=shaped;sceneFxApplied=true;}}
 try{writeFileSync('/tmp/dsh-voice-last.'+format,bytes);voiceDbg('dump /tmp/dsh-voice-last.'+format+' bytes='+bytes.length+' mood='+delivery.mood);}catch{}
 return {bytes,format,engine:'breeze',voice:voice||'S0',mode:breeze.mode,capability:'emotion',mood:delivery.mood,scene:delivery.scene||'',sceneFx:sceneFxApplied,parts:parts.length};
}
