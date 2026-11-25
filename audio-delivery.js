import {statSync,readFileSync,mkdirSync,existsSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

export const AUDIO_DELIVERY_GUIDANCE='语音、翻唱和音频作品默认发QQ语音气泡，听一听不等于索要文件。仅对方明确要求音频文件、原件或下载保存时才选delivery="file"；发送失败先如实说明或修复，不擅自改发文件。';
export function audioDeliveryKind(file,{delivery}={}){
  return /\.(?:wav|mp3|flac|ogg|opus|m4a|aac|amr|silk)$/i.test(String(file))&&delivery!=='file'?'record':'file';
}
const mp3=bytes=>bytes.subarray(0,3).toString()==='ID3'||bytes[0]===255&&(bytes[1]&224)===224;
export async function prepareRecordFile(file,{outputDir,ffmpegPath,maxBytes=24*1024*1024,signal,run=promisify(execFile)}={}){
  signal?.throwIfAborted();
  const stat=statSync(file);if(!stat.isFile())throw Error('待发送语音不是音频文件');
  if(stat.size<=maxBytes&&!/\.(?:flac|m4a|aac)$/i.test(file))return file;
  if(!ffmpegPath||!outputDir)throw Object.assign(Error('语音较大，尚未配置音频转换工具；未发送，也没有改发文件'),{code:'VOICE_TRANSPORT_PREPARE_FAILED',submitted:false});
  const hash=createHash('sha256').update(readFileSync(file)).digest('hex');
  mkdirSync(outputDir,{recursive:true});const target=join(outputDir,hash+'-qq.mp3'),temp=join(outputDir,hash+'-'+randomUUID()+'.partial.mp3');
  const valid=path=>{try{const stat=statSync(path);return stat.size>128&&stat.size<=maxBytes&&mp3(readFileSync(path));}catch{return false;}};
  if(valid(target))return target;
  try{
    await run(ffmpegPath,['-nostdin','-v','error','-y','-i',file,'-map','0:a:0','-vn','-c:a','libmp3lame','-b:a','128k','-f','mp3',temp],{windowsHide:true,timeout:180000,maxBuffer:512*1024,signal});
    signal?.throwIfAborted();
    if(!valid(temp))throw Error('转换结果不是符合语音大小要求的MP3');
    renameSync(temp,target);return target;
  }catch(error){throw Object.assign(Error('语音传送准备失败，原始音频已保留，未改发文件：'+String(error.message||error).slice(0,180)),{code:'VOICE_TRANSPORT_PREPARE_FAILED',submitted:false});}
  finally{if(existsSync(temp))try{unlinkSync(temp);}catch{}}
}
