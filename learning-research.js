import {normalizeSearchSources} from './tone-routing.js';
// Discovery snippets are not learning evidence. Only fetched page text is returned.
export async function researchLearning({query,signal},{search,readPage}={}){
  if(typeof search!=='function')throw Error('NO_SEARCH');
  const bounded=work=>!signal?Promise.resolve().then(work):new Promise((resolve,reject)=>{
    if(signal.aborted){reject(Error('research timeout'));return;}
    const abort=()=>reject(Error('research timeout'));signal.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(work).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
  });
  const candidates=normalizeSearchSources(await bounded(()=>search(query,signal))),sources=[];
  for(const candidate of candidates.slice(0,4)){
    if(signal?.aborted)break;
    try{const page=await bounded(()=>readPage(candidate.url,signal));
      if(page?.status==='read'&&String(page.body||'').trim().length>=80)sources.push({id:page.sourceId,type:'web',title:page.title||candidate.title,url:page.finalUrl||candidate.url,text:String(page.body).slice(0,8000),partial:true});
    }catch{}
    if(sources.length>=2)break;
  }
  if(!sources.length)throw Error('NO_SOURCES');return sources;
}
