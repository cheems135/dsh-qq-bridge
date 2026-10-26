import {normalizeSearchSources} from './tone-routing.js';
import {biliTarget} from './humanism-adapter.js';
// Search results and popular-video titles are discovery hints, never learning evidence.
export async function researchLearning({query,signal,context},{search,readPage,readVideo,discover}={}){
  const bounded=work=>!signal?Promise.resolve().then(work):new Promise((resolve,reject)=>{if(signal.aborted){reject(Error('research timeout'));return;}const abort=()=>reject(Error('research timeout'));signal.addEventListener('abort',abort,{once:true});Promise.resolve().then(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));});
  let candidates=[],searchAvailable=typeof search==='function';
  if(searchAvailable){try{candidates=normalizeSearchSources(await bounded(()=>search(query,signal)));}catch{}}
  if(typeof discover==='function'&&candidates.length<2){
    try{const publicVideos=await bounded(()=>discover(context,signal));for(const v of publicVideos||[])if(/梗|吐槽|聊天|说话|采访|街访|对话|脱口秀|交流|朋友|尴尬|沟通|语言|热词/.test(v.title||'')&&!candidates.some(c=>c.url===v.url))candidates.push(v);}catch{}
  }
  const sources=[];
  for(const candidate of candidates.slice(0,3)){
    if(signal?.aborted)break;
    let target=biliTarget([candidate.url]);
    try{
      if(target&&typeof readVideo==='function'){
        const value=await bounded(()=>readVideo(context,target,signal)),source=value.source||value;
        const segments=source.segments||[];const text=segments.map(s=>s.text).join('\n').slice(0,8000);
        if(text.trim().length>=30)sources.push({id:'bili:'+source.bvid+':'+source.page+':'+source.readingId,type:'video',title:source.title||candidate.title,url:source.url||candidate.url,text,partial:source.sourceTextPartial!==false||source.coverage?.state!=='complete'});
      }else if(typeof readPage==='function'){
        const page=await bounded(()=>readPage(candidate.url,signal));target=biliTarget([page?.finalUrl]);
        if(target&&typeof readVideo==='function'){
          const value=await bounded(()=>readVideo(context,target,signal)),source=value.source||value;
          const text=(source.segments||[]).map(s=>s.text).join('\n').slice(0,8000);
          if(text.trim().length>=30)sources.push({id:'bili:'+source.bvid+':'+source.page+':'+source.readingId,type:'video',title:source.title||candidate.title,url:source.url||page.finalUrl,text,partial:true});
        }else if(page?.status==='read'&&String(page.body||'').trim().length>=80){
          sources.push({type:'web',title:page.title||candidate.title,url:page.finalUrl||candidate.url,text:String(page.body).slice(0,8000),partial:String(page.body).length>8000});
        }
      }
    }catch{}
    if(sources.length>=2)break;
  }
  if(!sources.length)throw Error(!searchAvailable&&!candidates.length?'NO_SEARCH':'NO_SOURCES');
  return sources;
}
