import {readFileSync} from 'node:fs';

// Read common TTS formats locally. Unknown formats remain explicitly unchecked.
export function audioDuration(bytes){
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE'){
    let rate=0,size=0;
    for(let at=12;at+8<=bytes.length;){const id=bytes.toString('ascii',at,at+4),n=bytes.readUInt32LE(at+4),end=at+8+n;if(end>bytes.length)return null;if(id==='fmt '&&n>=16)rate=bytes.readUInt32LE(at+16);if(id==='data')size+=n;at=end+(n%2);}
    return rate&&size?size/rate:null;
  }
  let at=0,seconds=0,frames=0;
  if(bytes.toString('ascii',0,3)==='ID3'&&bytes.length>=10){at=10+((bytes[6]&127)*2097152+(bytes[7]&127)*16384+(bytes[8]&127)*128+(bytes[9]&127))+((bytes[5]&16)?10:0);}
  while(at+4<=bytes.length){
    const h=bytes.readUInt32BE(at),version=(h>>>19)&3,layer=(h>>>17)&3,index=(h>>>12)&15,sr=(h>>>10)&3;
    if((h>>>21)!==2047||version===1||layer!==1||index===0||index===15||sr===3){if(frames)break;at++;continue;}
    const rate=[44100,48000,32000][sr]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index]*1000;
    const length=Math.floor((version===3?144:72)*bitrate/rate)+((h>>>9)&1);
    if(at+length>bytes.length)break;seconds+=(version===3?1152:576)/rate;frames++;at+=length;
  }
  return frames>=3?seconds:null;
}

export function checkVoiceBytes(bytes,text,{performance='speech'}={}){
  const duration=audioDuration(bytes),units=Array.from(String(text).replace(/\[[^\]]*\]/g,'').replace(/[A-Za-z0-9]+/g,'字').replace(/[\s\p{P}\p{S}]/gu,'')).length;
  // Deliberately generous for slow speech, pauses and crying; not a semantic verdict.
  const limit=Math.max(60,20+units*1.2),checked=duration!==null;
  const result={durationSeconds:duration===null?null:Math.round(duration*1000)/1000,durationCheck:checked?'passed':'unavailable',contentCheck:'not-transcribed'};
  if(checked&&performance!=='sing'&&duration>limit){const error=Error('这段语音比台词应有的长度长了很多，可能误读了提示词，先不发送这段异常音频。请在调用记录查看台词和发声指令');error.code='VOICE_OUTPUT_ANOMALY';error.retryable=false;error.voiceOutput={...result,durationCheck:'failed',expectedMaximumSeconds:limit};throw error;}
  return result;
}
export function inspectVoiceFile(file,text,options){return checkVoiceBytes(readFileSync(file),text,options);}
