export async function localVoices({url,fetchImpl=fetch,signal}={}){
 const response=await fetchImpl(url+'/api/presets',{signal});
 if(!response.ok)throw Error('读取本地音色失败（HTTP '+response.status+'）');
 const body=await response.json();return (body.items||body.presets||[]).filter(row=>typeof row.id==='string'&&row.has_audio!==false).map(row=>({id:row.id,name:String(row.name||row.id).slice(0,120)}));
}

export function selectLocalVoice(voices,{requested='',configured=''}={}){
 const explicit=requested&&requested!=='default'?requested:configured;
 if(explicit){const exact=voices.find(v=>v.id===explicit);if(exact)return exact.id;const matches=voices.filter(v=>v.name===explicit);if(matches.length===1)return matches[0].id;throw Error('本地音色不存在或名称不唯一，请在本地设置重新选择音色；API/Windows 音色名不能用于 VoiceLab。');}
 if(voices.length===1)return voices[0].id;
 throw Error(voices.length?'本地有多个音色，请先在本地设置选择一个。':'VoiceLab 没有可用的参考音色，请先在 VoiceLab 创建音色。');
}

export function validateLocalWav(bytes,headers){
 if(headers?.get?.('x-cancelled')==='1'||headers?.get?.('x-timed-out')==='1'||headers?.get?.('x-complete')==='0')throw Error('VoiceLab 返回了未完成或被截断的语音，未当作完整语音发送。');
 if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw Error('VoiceLab 未返回有效 WAV 音频，未将响应当作语音文件');
 return bytes;
}
