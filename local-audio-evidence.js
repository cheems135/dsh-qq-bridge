// Local gateway evidence reconciliation; shared/API audio analysis stays unchanged.
export function reconcileLocalAudioEvidence(value){
 if(!value||value.ok!==true||!value.acoustic||value.localClassification)return value;
 const acoustic=value.acoustic,segments=value.transcription?.segments||[];
 const duration=Number(value.end)-Number(value.start);
 const span=Number.isFinite(duration)&&duration>0?duration:Number(value.duration);
 const valid=value.transcription?.status==='candidate'&&Array.isArray(segments)?segments.filter(row=>{
   const text=String(row.text||'').replace(/[^\p{L}\p{N}]/gu,'');
   return text.length>=4&&!/^(?:谢谢观看|感谢观看|感谢收看|字幕由|请不吝点赞|thankyouforwatching)/i.test(text)&&
    Number.isFinite(row.start)&&Number.isFinite(row.end)&&row.start>=0&&row.end-row.start>=.35&&row.end<=span+1&&
    Number.isFinite(row.noSpeech)&&row.noSpeech>=0&&row.noSpeech<.45;
 }):[];
 const silent=/静音|近乎无声/.test(acoustic.kind||'');
 let classification;
 if(valid.length)classification=silent?{kind:'音频类型待确认：静音测量与转写候选冲突',confidence:'low'}:
   {kind:'可能含可辨识人声（有本机转写候选）',confidence:'medium'};
 else if(/纯音|提示音|未见人声|未见明确人声/.test(acoustic.kind||''))classification={kind:'声学特征倾向提示音或音乐；是否含人声尚未确认',confidence:'low'};
 if(!classification)return value;
 const note=valid.length?'结合已通过分段筛选的本机转写候选；仍可能误听，不能据此区分说话、歌唱或断言没有背景音乐。':'声学启发式不能排除人声；无可靠转写候选不等于无语音。';
 return {...value,acoustic:{...classification,reasons:[...(acoustic.reasons||[]),note]},localClassification:{basis:valid.length?'acoustic-and-transcription':'acoustic-only',verifiedSpeechSegments:valid.length,rawAcoustic:acoustic,note},coverage:String(value.coverage||'')+'；'+note};
}
export function reconcileLocalToolAudio(name,args,result){
 return name==='bridge_audio'||name==='bridge_tools'&&args?.action==='call'&&args.name==='bridge_audio'?reconcileLocalAudioEvidence(result):result;
}
