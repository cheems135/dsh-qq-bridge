// A song title is not a melody. Confirmed scores and per-syllable recordings are
// durable, persona-scoped assets; WORLD renders their actual pitch and timing.
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,mkdirSync,existsSync,statSync,realpathSync,openSync,closeSync,fsyncSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,extname,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const builtins=JSON.parse(readFileSync(new URL('./assets/songs.json',import.meta.url),'utf8')).songs;
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clean=(v,n=500)=>String(v??'').replace(/[\u0000-\u001f]/g,' ').trim().slice(0,n);
const scope=m=>hash([m.accountId||'',m.personaId||'legacy',m.personaVersion||'legacy']);
const normalized=v=>String(v||'').normalize('NFKC').toLowerCase().replace(/[\s，,。.!！?？\[\]【】]/g,'');
const copy=v=>JSON.parse(JSON.stringify(v));
function scoreOf(value,tempo){
 if(!Array.isArray(value)||!value.length||value.length>200)throw Error('歌谱需要1至200个音符');
 const score=value.map(n=>({lyric:clean(n.lyric,12),midi:n.midi===null?null:Number(n.midi),beats:Number(n.beats)}));
 if(score.some(n=>!n.lyric&&n.midi!==null||n.lyric.length>8||n.midi!==null&&(!Number.isFinite(n.midi)||n.midi<36||n.midi>96)||!Number.isFinite(n.beats)||n.beats<.125||n.beats>16))throw Error('每个音符需要歌词、MIDI36至96和0.125至16拍时值');
 if(!score.some(n=>n.midi!==null))throw Error('歌谱不能只有休止符');
 if(!Number.isFinite(tempo)||tempo<30||tempo>240||score.reduce((n,s)=>n+s.beats,0)*60/tempo>90)throw Error('速度需30至240 BPM，一次按谱最多90秒');
 return score;
}
function durable(file,value){
 mkdirSync(dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';
 const fd=openSync(temp,'w');try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,file);
}
function wavDuration(file){
 const bytes=readFileSync(file);if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')throw Error('按谱结果不是有效WAV');
 let rate=0,data=0;for(let offset=12;offset+8<=bytes.length;){const type=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(offset+8+size>bytes.length)throw Error('按谱结果WAV被截断');if(type==='fmt '&&size>=16)rate=bytes.readUInt32LE(offset+16);if(type==='data')data+=size;offset+=8+size+(size%2);}
 if(!rate||!data)throw Error('按谱结果WAV没有可播放音轨');return data/rate;
}
function runPython(executable,args,{spawnImpl=spawn,signal,timeoutMs=180000}={}){
 return new Promise((resolveResult,reject)=>{
  const child=spawnImpl(executable,[fileURLToPath(new URL('./tools/score-sing.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});
  let out='',err='',done=false;const finish=(error,result)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolveResult(result);};
  const abort=()=>{child.kill();finish(Error('按谱清唱已取消'));};const timer=setTimeout(()=>{child.kill();finish(Error('按谱清唱处理超时，样本已保留'));},timeoutMs);
  child.stdout.on('data',c=>{out+=c;if(out.length>2000000)abort();});child.stderr.on('data',c=>{err=(err+c).slice(-10000);});child.on('error',e=>finish(e));child.on('close',code=>{
   if(code!==0)return finish(Error('本地按谱程序失败：'+clean(err,300)));try{finish(null,JSON.parse(out.trim()));}catch{finish(Error('本地按谱程序没有返回可核对的结果'));}
  });child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(args));if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
 });
}

export function createSingingLibrary({dataDir,getDataDir=()=>dataDir,getRenderDir=()=>join(getDataDir(),'renders'),runtime={},getRuntime=()=>runtime,storage,sampleSyllables,getVoiceKey=m=>m.voiceId||m.personaId||'default',signature=m=>JSON.stringify([m.accountId,m.personaId,m.personaVersion,getVoiceKey(m)]),allowed=()=>true,now=()=>Date.now(),spawnImpl=spawn,renderImpl,approvedFiles=[]}={}){
 let closed=false;const cache=new Map(),inflight=new Map(),approved=new Set(approvedFiles.map(f=>resolve(f)));
 const permitted=m=>!closed&&m&&allowed(m);
 function root(){const path=getDataDir();if(!path)throw Error('尚未配置歌曲库目录');mkdirSync(path,{recursive:true});return resolve(path);}
 function save(meta,state){const name='songs-'+scope(meta)+'.json';if(storage)storage.write(name,state);else durable(join(root(),name),state);}
 function load(meta){if(!permitted(meta))throw Error('当前角色没有歌曲库权限');const id=scope(meta);if(cache.has(id))return cache.get(id);let state;
  try{state=storage?storage.read('songs-'+id+'.json'):JSON.parse(readFileSync(join(root(),'songs-'+id+'.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(state&&(state.scope!==id||state.meta?.accountId!==(meta.accountId||'')))throw Error('歌曲库范围不匹配');
  state||={version:1,scope:id,meta:{accountId:meta.accountId||'',personaId:meta.personaId||'legacy',personaVersion:meta.personaVersion||'legacy'},songs:[],samples:{},stats:{},feedback:[]};cache.set(id,state);return state;
 }
 function audioPath(filename,{trustedGenerated=false,explicitOwnerFile=false}={}){
  if(typeof filename!=='string'||!isAbsolute(filename)||!['.wav','.mp3','.flac','.ogg','.m4a','.aac','.opus'].includes(extname(filename).toLowerCase()))throw Error('需要明确的本地音频文件路径');
  const file=realpathSync(resolve(filename)),base=realpathSync(root()),part=relative(base,file),inside=part===''||!part.startsWith('..')&&!isAbsolute(part);
  if(!inside&&!trustedGenerated&&!approved.has(resolve(filename))&&!explicitOwnerFile)throw Error('示范音频不在本人歌曲库中，请由号主明确选择该本地文件');
  const info=statSync(file);if(!info.isFile()||info.size<44||info.size>80*1024*1024)throw Error('示范音频为空或超过80MB');return file;
 }
 function all(meta){const state=load(meta),custom=new Map(state.songs.map(s=>[s.id,s]));return [...builtins.map(s=>custom.get(s.id)||s),...state.songs.filter(s=>!builtins.some(b=>b.id===s.id))];}
 function find(meta,request={}){const q=normalized(request.songId||request.title||request.name||request.request||'');return all(meta).find(s=>s.id===request.songId||[s.title,...(s.aliases||[])].some(n=>normalized(n)===q||q.length>3&&q.includes(normalized(n))));}
 function list(meta){const state=load(meta);return all(meta).map(s=>({id:s.id,title:s.title,aliases:s.aliases||[],confirmed:s.confirmed===true,tempo:s.tempo,notes:s.score?.length||0,source:s.source,stats:copy(state.stats[s.id]||{}),revision:s.revision||1,hasDemonstration:!!s.demonstration,limitations:s.limitations||'实验性按谱重合成，音色与咬字需试听'}));}
 function status(meta){const state=load(meta),r=getRuntime();return {available:true,songs:list(meta),method:'WORLD按谱清唱',ready:!!(r.scoreSingingPythonPath||r.pythonPath)&&typeof sampleSyllables==='function',needsScoreForUnknown:true,pendingAlignment:Object.values(state.samples).filter(s=>s.status==='need-alignment').map(s=>({id:s.id,syllables:s.syllables,reason:s.reason})),limitations:'能约束已确认歌谱的旋律和节奏；不是专业歌声模型，不会因存入歌词便学会未知旋律。'};}
 function teach(meta,draft={},options={}){
  if(options.ownerConfirmed!==true)throw Error('新歌谱和示范需要号主在本地明确确认，不能由模型自行标记学会');
  const state=load(meta),tempo=Number(draft.tempo||96),score=scoreOf(draft.score,tempo),title=clean(draft.title,100);if(!title)throw Error('歌曲需要名称');
  const id=clean(draft.id||draft.songId||'taught-'+hash([title,score]).slice(0,20),100);if(!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw Error('歌曲ID格式无效');
  let demonstration=null;if(draft.demonstration){const d=draft.demonstration,file=audioPath(d.file,{explicitOwnerFile:options.explicitLocalFile===true});approved.add(resolve(file));
   const alignment=(d.alignment||d.syllables||[]).map(s=>({lyric:clean(s.lyric||s.text,12),start:Number(s.start),end:Number(s.end)}));if(alignment.some(s=>!s.lyric||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start))throw Error('逐字示范的时间边界不正确');
   demonstration={file,alignment,sampleLyrics:d.sampleLyrics||[...new Set(alignment.map(s=>s.lyric))],confirmedBy:'owner',at:now()};
  }
  const previous=all(meta).find(s=>s.id===id),revision=(previous?(previous.revision||1):0)+1;
  const song={id,title,aliases:(draft.aliases||[]).map(x=>clean(x,100)).slice(0,12),tempo,score,confirmed:true,source:{kind:'owner-taught',note:clean(draft.source||'号主确认的歌谱与示范',500)},revision,demonstration,at:now(),revisions:[...(previous?.revisions||[]),...(previous?[{revision:previous.revision||1,at:previous.at||now(),tempo:previous.tempo,score:previous.score,source:previous.source}]:[])]};
  state.songs=state.songs.filter(s=>s.id!==id).concat(song);save(meta,state);return copy(song);
 }
 function feedback(meta,input={},options={}){
  if(options.ownerConfirmed!==true)throw Error('试听反馈需要号主明确提供');const state=load(meta),song=find(meta,input);if(!song)throw Error('歌曲尚未在库中');
  const rating=['good','off-pitch','rhythm','timbre','pronunciation','alignment'].includes(input.rating)?input.rating:'note';
  state.feedback.push({id:randomUUID(),songId:song.id,rating,note:clean(input.note,1000),at:now(),revision:song.revision||1});const stats=state.stats[song.id]||{};state.stats[song.id]={...stats,lastFeedback:rating,needsReview:rating!=='good',feedbackAt:now()};save(meta,state);return {ok:true,songId:song.id,rating,needsReview:rating!=='good'};
 }
 async function render(meta,request={},options={}){
  const state=load(meta),stamp=signature(meta),song=find(meta,request);if(!song||!song.confirmed)return {ok:false,status:'need-score',reason:'这首歌还没有已确认的旋律与节拍。可以教我音符和逐字时值，或提供有逐字时间标记的示范；只给歌词还不能唱准。'};
  const r=getRuntime(),python=r.scoreSingingPythonPath||r.pythonPath;if(!python&&!renderImpl)return {ok:false,status:'unavailable',reason:'本地按谱歌声程序尚未配置'};
  const score=scoreOf(request.short===true&&song.shortNotes?song.score.slice(0,song.shortNotes):song.score,Number(song.tempo)),syllables=[...new Set(score.filter(n=>n.midi!==null).map(n=>n.lyric))];
  const sampleKey=hash([getVoiceKey(meta),syllables]),lock=scope(meta)+':'+song.id+':'+sampleKey;if(inflight.has(lock))return inflight.get(lock);
  const work=(async()=>{
   let sample=song.demonstration?{...song.demonstration,status:'ready'}:state.samples[sampleKey];
   if(sample?.status==='need-alignment'&&!options.retryAlignment)return {ok:false,status:'need-alignment',sampleId:sampleKey,reason:sample.reason||'请先校正已保留样本的逐字边界，避免重复调用语音接口'};
   const prior=state.stats[song.id]||{};state.stats[song.id]={...prior,attempts:(prior.attempts||0)+1,lastAttemptAt:now(),revision:song.revision||1};save(meta,state);
   try{
    if(options.signal?.aborted)throw Error('按谱清唱已取消');
    if(!sample){if(typeof sampleSyllables!=='function')return {ok:false,status:'need-demonstration',reason:'请配置当前音色逐字样本回调，或由号主提供示范'};
     const text=syllables.join('，\n')+'。';const generated=await sampleSyllables(text,{syllables,meta,songId:song.id,voiceKey:getVoiceKey(meta),signal:options.signal,instructions:'逐字清晰慢读，每个字之间停顿至少半秒；不要唱、不要连读，不增删任何字。'});
     const source=typeof generated==='string'?{file:generated}:generated;const file=audioPath(source?.file,{trustedGenerated:true});
     sample={id:sampleKey,file,syllables,sampleLyrics:syllables,alignment:source.alignment||source.syllables||[],status:'ready',at:now(),voiceKey:hash(getVoiceKey(meta))};state.samples[sampleKey]=sample;save(meta,state);
    }
    if(!permitted(meta)||signature(meta)!==stamp||options.signal?.aborted)throw Error('角色、音色或权限已改变，保留样本并放弃旧任务');
    const file=audioPath(sample.file,{trustedGenerated:!song.demonstration,explicitOwnerFile:song.demonstration?.confirmedBy==='owner'}),outputFile=join(getRenderDir(),scope(meta),song.id+'-'+randomUUID()+'.wav');
    const payload={sourceFile:file,outputFile,score,tempo:song.tempo,sampleLyrics:sample.sampleLyrics||sample.syllables||syllables,alignment:sample.alignment?.length?sample.alignment:undefined,ffmpegPath:r.ffmpegPath||''};
    const result=renderImpl?await renderImpl(payload,{signal:options.signal}):await runPython(python,payload,{spawnImpl,signal:options.signal});
    if(!permitted(meta)||signature(meta)!==stamp||options.signal?.aborted)throw Error('角色、音色或权限已改变，放弃清唱结果');
    if(result?.ok!==true){if(result?.status==='need-alignment'&&!song.demonstration){sample.status='need-alignment';sample.reason=clean(result.reason,500);sample.detectedSegments=result.detectedSegments||[];state.samples[sampleKey]=sample;}
     state.stats[song.id]={...state.stats[song.id],lastStatus:result?.status||'failed',lastError:clean(result?.reason,500)};save(meta,state);return {...result,sampleId:sampleKey};}
    if(!existsSync(outputFile)||statSync(outputFile).size<100||result.file!==outputFile||!Number.isFinite(result.duration)||result.duration<=0)throw Error('按谱程序没有产生实际可播放的结果文件');
    const expected=score.reduce((n,s)=>n+s.beats,0)*60/song.tempo,actualDuration=wavDuration(outputFile);if(Math.abs(expected-result.duration)>.04||Math.abs(expected-actualDuration)>.04)throw Error('结果音频实际时长不符合已确认歌谱');
    const previous=state.stats[song.id];state.stats[song.id]={...previous,successes:(previous.successes||0)+1,lastStatus:'rendered',lastRenderedAt:now(),lastDuration:result.duration,lastFile:outputFile};
    if(!song.demonstration){sample.status='ready';sample.alignment=result.alignment||sample.alignment;state.samples[sampleKey]=sample;}save(meta,state);
    return {...result,ok:true,status:'rendered',songId:song.id,title:song.title,revision:song.revision||1,sampleId:sampleKey,voicePreserved:'current-voice-spectral-envelope',limitations:'按谱音高/时值可控的实验重合成；音色与咬字需试听确认。'};
   }catch(e){state.stats[song.id]={...state.stats[song.id],lastStatus:'failed',lastError:clean(e.message,500)};save(meta,state);return {ok:false,status:'failed',reason:clean(e.message,500)};}
  })();inflight.set(lock,work);try{return await work;}finally{inflight.delete(lock);}
 }
 function alignSample(meta,input={},options={}){
  if(options.ownerConfirmed!==true)throw Error('逐字校正需要号主明确确认');const state=load(meta),sample=state.samples[input.sampleId];if(!sample)throw Error('找不到需要校正的声音样本');
  const alignment=(input.alignment||[]).map(s=>({lyric:clean(s.lyric||s.text,12),start:Number(s.start),end:Number(s.end)}));if(!alignment.length||alignment.some(s=>!s.lyric||!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start)||sample.syllables.some(s=>!alignment.some(a=>a.lyric===s)))throw Error('请为全部歌词提供准确的开始和结束秒数');
  sample.alignment=alignment;sample.sampleLyrics=sample.syllables;sample.status='ready';sample.correctedAt=now();sample.confirmedBy='owner';save(meta,state);return {ok:true,sampleId:input.sampleId,status:'ready'};
 }
 return {status,list,teach,render,feedback,alignSample,reload(){cache.clear()},close(){closed=true;cache.clear()}};
}
