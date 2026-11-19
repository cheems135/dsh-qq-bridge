import {normalizeHearing,requestAudioTranscription} from './hearing-evidence.js';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
export async function transcribeCompanionAudio(audio,{localOnly=false,apiOnly=false,detailed=false,media={},analysis,cacheDir,context={},fetchImpl=fetch,signal}={}){
 if(!audio||typeof audio.data!=='string'||audio.data.length>2800000||!/^[A-Za-z0-9+/]+={0,2}$/.test(audio.data))throw Error('录音为空或超过大小限制');
 const bytes=Buffer.from(audio.data,'base64');if(!bytes.length||bytes.length>2*1024*1024||bytes.toString('base64')!==audio.data)throw Error('录音编码无效或过大');
 const webm=/^audio\/webm(?:;.*)?$/.test(audio.mediaType||'')&&bytes.subarray(0,4).toString('hex')==='1a45dfa3';
 const wav=/^audio\/wav$/.test(audio.mediaType||'')&&bytes.length>=44&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,16)==='WAVEfmt '&&bytes.readUInt32LE(4)===bytes.length-8&&bytes.readUInt32LE(16)===16&&bytes.readUInt16LE(20)===1&&[1,2].includes(bytes.readUInt16LE(22))&&bytes.readUInt32LE(24)>=8000&&bytes.readUInt32LE(24)<=48000&&bytes.readUInt16LE(34)===16&&bytes.toString('ascii',36,40)==='data'&&bytes.readUInt32LE(40)===bytes.length-44;
 if(!webm&&!wav)throw Error('当前录音格式不支持，请使用 WebM 或原生 PCM WAV 录音');
 const extension=wav?'wav':'webm',mediaType=wav?'audio/wav':'audio/webm';
 signal?.throwIfAborted();
 const key=String(media.asrApiKey||'').trim();
 if(apiOnly&&!key)throw Error('请先配置 API 语音识别连接；手机版不会启动本地语音模型，仍可直接打字');
 if(apiOnly&&localOnly)throw Error('手机版仅支持 API 语音识别');
 if(localOnly||!key){
  if(!analysis?.status().transcription)throw Error(localOnly?'本地语音识别尚未就绪；录音没有上传云端，仍可直接打字':'语音识别尚未配置，仍可直接打字');
  const directory=join(cacheDir,'companion-microphone');mkdirSync(directory,{recursive:true});const file=join(directory,randomUUID()+'.'+extension);
  try{writeFileSync(file,bytes);const result=await analysis.analyze({file,transcribe:true,voiceInput:true},{...context,signal});const hearing=normalizeHearing(result,{source:'local-asr'});if(!hearing.text&&!detailed)throw Error('这次没有识别出可靠文字，请再说一次或直接打字');return detailed&&analysis.enrichHearing?analysis.enrichHearing(bytes,hearing,{signal,live:true}):detailed?hearing:hearing.text.slice(0,2000);}finally{try{unlinkSync(file);}catch{}}
 }
 let hearing;try{hearing=await requestAudioTranscription(bytes,media,{signal,fetchImpl,mediaType,filename:'microphone.'+extension});}catch(error){if(apiOnly||!detailed||!analysis?.enrichHearing||signal?.aborted)throw error;hearing=await analysis.enrichHearing(bytes,normalizeHearing(null,{source:'no-transcript'}),{signal,live:true});if(!hearing.labels?.length)throw error;return hearing;}
 if(detailed&&!apiOnly&&analysis?.enrichHearing)return analysis.enrichHearing(bytes,hearing,{signal,live:true});
 if(!hearing.text&&!detailed)throw Error('这次没有识别出文字，请再试一次或直接打字');return detailed?hearing:hearing.text.slice(0,2000);
}
