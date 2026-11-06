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
 if(headers?.get?.('x-cancelled')==='1'||headers?.get?.('x-timed-out')==='1'||headers?.get?.('x-complete')==='0')throw Error('本地语音服务返回了未完成或被截断的语音，未当作完整语音发送。');
 if(bytes.length<44||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE')throw Error('本地语音服务未返回有效 WAV 音频，未将响应当作语音文件');
 return bytes;
}

// Local speech is a protocol choice, independent of the installed application.
export function normalizeVoiceService(input={},base={}){
 const v={...base,...input},type=v.type||'voicelab';
 if(!['voicelab','openai','json'].includes(type))throw Error('请选择有效的本地语音协议');
 const baseUrl=String(v.baseUrl||'http://127.0.0.1:7870').replace(/\/+$/,'');
 voiceEndpoint(baseUrl,'');
 const out={type,baseUrl,model:String(v.model||'').trim(),device:v.device==='cpu'?'cpu':'gpu',
  apiKey:input.clearApiKey===true?'':String(input.apiKey||(base.baseUrl&&new URL(base.baseUrl).origin===new URL(baseUrl).origin?base.apiKey:'')||''),
  responseMode:v.responseMode||'audio',responseField:String(v.responseField||'audio'),
  bodyTemplate:typeof v.bodyTemplate==='string'?v.bodyTemplate:JSON.stringify(v.bodyTemplate||{text:'{{text}}',voice:'{{voice}}'}),
  directory:String(v.directory||''),startupExecutable:String(v.startupExecutable||''),startupArguments:String(v.startupArguments||''),startupDirectory:String(v.startupDirectory||'')};
 if(!['audio','base64','url'].includes(out.responseMode))throw Error('请选择有效的语音返回类型');
 let body;try{body=JSON.parse(out.bodyTemplate);}catch{throw Error('语音请求模板必须是有效 JSON');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw Error('语音请求模板必须是 JSON 对象');
 if(type==='json'&&!out.bodyTemplate.includes('{{text}}'))throw Error('自定义语音模板需包含 {{text}}，否则无法传入要说的内容');
 for(const name of ['ttsPath','statusPath','voicesPath','unloadPath']){
  out[name]=String(v[name]||'').trim();if(out[name])voiceEndpoint(baseUrl,out[name]);
 }
 return out;
}

export function voiceEndpoint(baseUrl,path){
 const base=new URL(baseUrl),url=new URL(path||'',baseUrl.replace(/\/+$/,'')+'/');
 const host=base.hostname.toLowerCase();
 const privateHost=['localhost','127.0.0.1','[::1]'].includes(host)||/^10\.\d+\.\d+\.\d+$/.test(host)||/^192\.168\.\d+\.\d+$/.test(host)||/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host);
 if(!privateHost||!['http:','https:'].includes(base.protocol)||base.username||base.password||url.origin!==base.origin||url.username||url.password||url.hash)throw Error('本地语音只连接本机或局域网地址，接口必须与服务同站点');
 if(['localhost','127.0.0.1','[::1]'].includes(host)&&Number(base.port)===8777)throw Error('语音服务不能指向网关自身 8777');
 return url.href;
}

export function voiceServicePath(service,kind){
 const defaults=service.type==='voicelab'?{tts:'/api/tts',status:'/api/status',voices:'/api/presets',unload:'/api/model/unload'}:service.type==='openai'?{tts:'audio/speech',status:'models',voices:'',unload:''}:{tts:'/tts',status:'',voices:'',unload:''};
 return service[kind+'Path']||defaults[kind]||'';
}

function voiceHeaders(service){return service.apiKey?{authorization:'Bearer '+service.apiKey}:{};}

export async function voiceServiceState(service,{fetchImpl=fetch,signal}={}){
 const path=voiceServicePath(service,'status');
 if(!path)return {alive:null,busy:false,detail:'未配置只读状态接口；生成时验证连接'};
 try{
  const r=await fetchImpl(voiceEndpoint(service.baseUrl,path),{headers:voiceHeaders(service),redirect:'error',signal});
  if(!r.ok)return {alive:false,busy:false,detail:'状态接口 HTTP '+r.status};
  const data=await r.json();return {alive:true,busy:data.busy===true,loaded:data.loaded};
 }catch(error){if(signal?.aborted)throw error;return {alive:false,busy:false,detail:'状态接口暂不可达'};}
}

export async function serviceVoices(service,{fetchImpl=fetch,signal}={}){
 const path=voiceServicePath(service,'voices');
 if(!path)return [];
 const response=await fetchImpl(voiceEndpoint(service.baseUrl,path),{headers:voiceHeaders(service),redirect:'error',signal});
 if(!response.ok)throw Error('读取本地音色失败（HTTP '+response.status+'）');
 const body=await response.json(),rows=Array.isArray(body)?body:body.items||body.presets||body.voices||body.data||[];
 if(!Array.isArray(rows))throw Error('音色接口没有返回列表；可以直接填写音色 ID');
 return rows.filter(row=>typeof row==='string'||row&&typeof row.id==='string'&&row.has_audio!==false).map(row=>typeof row==='string'?{id:row,name:row}:{id:row.id,name:String(row.name||row.id).slice(0,120)});
}

function fillVoiceTemplate(value,vars){
 if(typeof value==='string')return value.replace(/\{\{(text|voice|model|instruction)\}\}/g,(_,key)=>vars[key]);
 if(Array.isArray(value))return value.map(v=>fillVoiceTemplate(v,vars));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,fillVoiceTemplate(v,vars)]));
 return value;
}

function voiceField(body,path){return path.split('.').reduce((v,key)=>v&&Object.hasOwn(v,key)?v[key]:undefined,body);}

export async function requestLocalSpeech(service,{text,voice='',instruction='',fetchImpl=fetch,signal}={}){
 if(service.type==='openai'&&!service.model)throw Error('请先填写本地语音服务使用的模型 ID');
 let body,headers=voiceHeaders(service);
 if(service.type==='voicelab'){
  body=new FormData();body.append('mode','auto');body.append('text',text);body.append('preset_id',voice);if(instruction)body.append('instruction',instruction);
 }else{
  headers={...headers,'content-type':'application/json'};
  const vars={text,voice,model:service.model,instruction};
  body=JSON.stringify(service.type==='openai'?{model:service.model,input:text,voice,response_format:'wav',...(instruction?{instructions:instruction}:{})}:fillVoiceTemplate(JSON.parse(service.bodyTemplate),vars));
 }
 const r=await fetchImpl(voiceEndpoint(service.baseUrl,voiceServicePath(service,'tts')),{method:'POST',headers,body,redirect:'error',signal});
 if(!r.ok)throw Error('本地语音合成失败：HTTP '+r.status);
 const mode=service.type==='json'?service.responseMode:'audio';let bytes,finalHeaders=r.headers;
 if(mode==='audio')bytes=Buffer.from(await r.arrayBuffer());
 else{
  const data=voiceField(await r.json(),service.responseField);
  if(typeof data!=='string'||!data)throw Error('语音返回中未找到字段：'+service.responseField);
  if(mode==='base64')bytes=Buffer.from(data.replace(/^data:audio\/[^;,]+;base64,/,''),'base64');
  else{
   const audioUrl=voiceEndpoint(service.baseUrl,data);
   const audio=await fetchImpl(audioUrl,{headers:voiceHeaders(service),redirect:'error',signal});
   if(!audio.ok)throw Error('下载本地语音失败：HTTP '+audio.status);
   bytes=Buffer.from(await audio.arrayBuffer());finalHeaders=audio.headers;
  }
 }
 // The QQ speech pipeline currently requires WAV; never label an error/MP3 as WAV.
 return validateLocalWav(bytes,finalHeaders);
}

export async function releaseVoiceService(service,{fetchImpl=fetch,signal}={}){
 if(service.device==='cpu')return true;
 const path=voiceServicePath(service,'unload');if(!path)return false;
 const state=await voiceServiceState(service,{fetchImpl,signal});if(state.busy)return false;if(state.loaded===false)return true;
 const response=await fetchImpl(voiceEndpoint(service.baseUrl,path),{method:'POST',headers:voiceHeaders(service),redirect:'error',signal});
 return response.ok;
}

