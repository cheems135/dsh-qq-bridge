import {songKey,parseSingingRequest,sameSingingSegment} from './singing-plan.js';

export const SINGING_POLICY_RULE='唱歌先看本人提供的相关音乐参考：识别歌名和原唱后，有同曲同片段可用存档就直接发送；没有存档才生成。没有音乐参考时不找新歌、不提交生成，只挑本对话尚未发过的可用库存；库存没有或已发完就如实说明，不能重复、换标签或偷用工作流默认原曲。';
export const usableCover=row=>!!row&&row.identityVerified===true&&row.deleted!==true&&row.disabled!==true&&row.quality!=='rejected';
export const singingTitleKey=row=>songKey(typeof row==='string'?row:row?.title);
export function sameMusicReference(source,input={}){
 if(!source||!input)return false;
 const id=String(input.songId||input.id||''),sourceId=String(source.songId||source.id||'');
 if(id&&source.songId)return sourceId===id;
 if(id&&sourceId===id)return true;
 if(input.url&&source.url&&String(input.url)===String(source.url))return true;
 if(input.file&&[source.file,source.localFile,source.originalLocalFile].includes(input.file))return true;
 return !!input.sha256&&input.sha256===source.sha256;
}
export function selectReferenceSinging({request='',title='',artist='',reference=null,versions=[],sources=[],usedTitles=[],segment=null,pending=[]}={}){
 const usable=versions.filter(row=>usableCover(row)&&sameSingingSegment(row.sourceSong?.segment,segment));
 const parsed=parseSingingRequest(request);
 if(!reference){
  const wanted=title||parsed.title;
  const available=usable.filter(row=>(!wanted||songKey(row.title)===songKey(wanted))&&(!artist||songKey(row.artist||row.sourceSong?.artist)===songKey(artist))&&!usedTitles.includes(singingTitleKey(row)));
  if(!available.length)return {action:'empty',stockOnly:true,title:wanted||'',reason:'没有提供音乐参考，当前没有尚未发过的对应库存；这次不生成，也不重复发送已听过的歌曲'};
  const version=available.sort((a,b)=>(a.quality==='accepted'?0:1)-(b.quality==='accepted'?0:1)||(a.at||0)-(b.at||0))[0];
  return {action:'reuse',stockOnly:true,title:version.title,artist:version.artist||'',version,reference:null};
 }
 const matchingSources=sources.filter(source=>sameMusicReference(source,reference.input));
 const source=reference.source?.verified===true?reference.source:matchingSources.find(s=>s.verified===true)||null;
 const identity=source||reference.identity||reference.input||{};
 title=String(identity.title||'').trim();artist=String(identity.artist||identity.author||'').trim();
 if(!title){const byId=usable.find(row=>sameMusicReference(row.sourceSong,reference.input));if(byId){title=byId.title;artist=byId.artist||'';}}
 if(!title)return {action:'need-source',reference,reason:'先识别这次音乐参考的真实歌名；识别失败不使用默认歌曲代替'};
 const named=usable.filter(row=>songKey(row.title)===songKey(title)&&(!artist||songKey(row.artist||row.sourceSong?.artist)===songKey(artist)));
 if(!artist&&new Set(named.map(row=>songKey(row.artist||row.sourceSong?.artist)).filter(Boolean)).size>1)return {action:'clarify',title,reference,reason:'同名歌曲有不同原唱，需要先核对参考版本'};
 const version=named.sort((a,b)=>(a.quality==='accepted'?0:1)-(b.quality==='accepted'?0:1)||(b.at||0)-(a.at||0))[0];
 if(version)return {action:'reuse',title:version.title,artist:version.artist||'',version,reference,stockOnly:false};
 const running=pending.find(task=>task.singing?.referenceId===reference.id||task.singing?.title===title&&sameSingingSegment(task.singing.segment,segment));
 if(running)return {action:'waiting',title,artist,reference,taskId:running.id,reason:'这首已有生成任务，等待原任务结果，不重复提交生成'};
 if(!source?.audio||!sameSingingSegment(source.segment,segment))return {action:'need-source',title,artist,reference,reason:'这首没有可用存档，继续只从本人提供的音乐参考取得原曲，不使用默认素材或别的歌曲'};
 return {action:'generate',title:source.title,artist:source.artist||'',audio:source.audio,sourceSong:source,reference,stockOnly:false,segment};
}

export function singingUsedTitles({history={},jobs=[],versions=[],audits=[],tasks=[]}={}){
 const titles=new Set(Object.keys(history));
 for(const job of jobs){
  if(!['queued','sending','sent','unknown'].includes(job.status)||!(job.segments||[]).some(s=>s.type==='record'||s.type==='file'&&/\.(?:mp3|wav|flac)$/i.test(s.data?.file||'')))continue;
  const task=tasks.find(t=>t.id===job.mediaTaskId||t.deliveryId===job.id),files=[...(job.segments||[]).map(s=>s.data?.file||''),task?.file||''].join('\n');
  const version=versions.find(v=>files.includes(v.id)||v.originInvocationId&&files.includes(v.originInvocationId));
  const title=job.singing?.title||task?.singing?.title||version?.title||audits.find(a=>a.id===job.auditId)?.mediaIntent?.songTitle;
  if(title)titles.add(singingTitleKey(title));
 }
 return [...titles];
}
