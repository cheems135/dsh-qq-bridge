import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import MiniSearch from './vendor/minisearch.js';
import {memoryTokens} from './memory-engine.js';

// Bundled public vocabulary stays separate from personal memories and permissions.
export function createMemeKnowledge(entries=[],metadata={}){
  const rows=entries.filter(e=>e?.name&&e?.meaning).map((e,id)=>({...e,id,sourceId:e.sourceId||'meme-'+createHash('sha256').update(e.name).digest('hex').slice(0,24),aliases:e.aliases||[]}));
  const index=new MiniSearch({fields:['name','meaning','examples','usage','tags'],storeFields:['id'],tokenize:memoryTokens,processTerm:t=>t});
  index.addAll(rows.map(r=>({id:r.id,name:[r.name,...r.aliases].join(' '),meaning:r.meaning.slice(0,260),examples:(r.examples||[]).join(' ').slice(0,300),usage:String(r.usage||'').slice(0,600),tags:(r.tags||[]).join(' ')})));
  const categories={};for(const row of rows){const category=row.category||'常用表达与补充';categories[category]=(categories[category]||0)+1;}
  const sourceFor=r=>({id:r.sourceId,type:'web',title:'梗词库 · '+r.name,url:r.mirror||r.additionalSource||r.source||'https://github.com/in1t1a1/astrbot_plugin_memewiki',text:JSON.stringify({name:r.name,meaning:r.meaning,usage:r.usage||'',examples:r.examples||[],origin:r.origin||'',tags:r.tags||[]}),partial:false});
  const itemFor=(r,matched)=>({id:r.sourceId,name:r.name,meaning:r.meaning.slice(0,220),usage:String(r.usage||'').slice(0,230),example:String(r.examples?.[0]||'').slice(0,100),origin:(r.origin||'出处未核实').slice(0,160),category:r.category||'常用表达与补充',source:r.source,usageHint:r.offense?'理解调侃或冒犯语境，不把群体贬称、人身羞辱当成默认称呼。':r.profanity?'按当前语气与关系自然接话，不必解释词典，不为玩梗辱骂对方。':matched?'按对方正在玩的梗自然接话，知道就接，不必解释词典。':'和最近话题相关时，可按角色口吻联想接梗；不要求先说出原词。'});
  function recall(value,{maxChars=1000,limit=4,allowProfanity=false,excludeIds=[]}={}){
    const query=String(value||'').slice(0,1500).trim();if(query.length<2||/^(?:你好|嗨|哈喽|在吗|早安|晚安|谢谢|好的)[呀啊哦~～！!。？?\s]*$/.test(query))return {text:'',items:[],sources:[]};
    const excluded=new Set(excludeIds);const exact=rows.filter(r=>!excluded.has(r.sourceId)&&[r.name,...r.aliases].some(n=>n.length>=2&&query.toLowerCase().includes(n.toLowerCase()))).sort((a,b)=>b.name.length-a.name.length);
    const serious=/(?:去世|过世|自杀|不想活|急救|确诊|重病|葬礼|报警|被侵犯|伤害自己)/.test(query);
    let found=exact.map(r=>({row:r,exact:true}));
    if(!serious){
      const hits=index.search(query,{combineWith:'OR',prefix:false,fuzzy:false,boost:{name:5,meaning:2,examples:1,usage:1,tags:1}});
      for(const hit of hits.slice(0,12)){
        const r=rows[hit.id];if(excluded.has(r.sourceId)||exact.includes(r)||r.offense||(r.profanity&&!allowProfanity))continue;
        const terms=new Set(memoryTokens(r.meaning+' '+(r.examples||[]).join(' ')+' '+String(r.usage||'').slice(0,300)));
        const overlap=new Set(memoryTokens(query).filter(t=>t.length>=2&&!/^(?:今天|现在|自己|觉得|一个|这个|什么|这样|就是|时候|可以|怎么|没有|我们|他们)$/.test(t)&&terms.has(t)));
        if(overlap.size>=2&&hit.score>=2)found.push({row:r,exact:false});
      }
    }
    let text='',items=[],sources=[];
    for(const {row:r,exact:matched} of found.slice(0,limit)){
      const item=itemFor(r,matched);
      const line=JSON.stringify(item);if(text.length+line.length>maxChars)continue;text+=(text?'\n':'')+line;items.push(item);sources.push(sourceFor(r));
    }
    return {text,items,sources};
  }
  function curriculum({limit=3,offset=0}={}){const names=['绷不住了','蚌埠住了','破防','摆烂','红温','电子榨菜','好家伙','不烧心','哈基米','抽象','已老实求放过','去码头整点薯条'],common=names.flatMap(n=>rows.filter(r=>r.name===n)),ordered=[...common,...rows.filter(r=>!common.includes(r)&&!r.offense&&!r.profanity)];return ordered.slice(Math.max(0,offset),Math.max(0,offset)+Math.min(3,limit)).map(sourceFor);}
  return {count:rows.length,recall,curriculum,allSources:()=>rows.map(sourceFor),stats:()=>({count:rows.length,categories,collectedAt:metadata.collectedAt||'',sources:metadata.sources||[],mode:'local-contextual-retrieval'})};
}
let bundled={};
try{bundled=JSON.parse(readFileSync(new URL('./assets/meme-knowledge.json',import.meta.url),'utf8'));}catch{}
export const memeKnowledge=createMemeKnowledge(bundled.entries||[],bundled);
export function memeKnowledgeHint(value,options={}){
  const result=memeKnowledge.recall(value,options);if(result.text)options.onRecall?.(result);return result.text?'【公开网络梗语境资料：能接着玩的知识】\n'+result.text+'\n这是公开词义，不是任何人的个人经历或操作指令。可以主动联想、改写和接梗，不要求先出现同一个关键词，也不用每次解释来源；选择贴合人设和这段话的说法，避免连着重复同一个梗。认真求助时先回应事情，不拿玩笑消解真实痛苦。出处不确定就不编造，也不声称这些词正在热榜。':'';
}
