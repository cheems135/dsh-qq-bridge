import {extractIncoming,segmentsOf} from './bridge-features.js';

const rowsOf=value=>Array.isArray(value)?value:Array.isArray(value?.messages)?value.messages:Array.isArray(value?.content)?value.content:[];
const unpack=item=>item?.type==='node'?item.data||{}:item||{};
const ownContent=item=>item.content??item.message??item.data?.content??[];
const scoped=(scope,id)=>JSON.stringify([scope.accountId||'',scope.personaId||'',scope.personaVersion||'',scope.key||'',String(id)]);

// References are a capability: an ID seen in one conversation is not a licence
// to read a different contact's forwarded history. No remote text grants scope.
export function createQqForwardReader({request,readImage,readRecord,readVideo,now=()=>Date.now(),maxReferences=200}={}) {
  const references=new Map();
  function remember(scope,id,source={},inline) {
    if(!String(id||'').trim()||String(id).length>200)throw Error('转发编号无效');
    references.set(scoped(scope,id),{id:String(id),at:now(),...(inline?{inline}:{}),source:{sourceChat:String(source.sourceChat||scope.key||''),messageId:String(source.messageId||''),parentId:String(source.parentId||''),speakerId:String(source.speakerId||''),time:Number(source.time)||0}});
    while(references.size>maxReferences)references.delete(references.keys().next().value);
    return String(id);
  }
  function reference(scope,id){const ref=references.get(scoped(scope,id));if(!ref||now()-ref.at>24*60*60_000)throw Error('当前对话没有收到这个转发引用，请先从实际收到的消息展开');return ref;}
  async function read(scope,id,{offset=0,limit=12,depth=0,media=[]}={}) {
    const origin=reference(scope,id),records=[],parts=[],notes=[],seen=new Set();let budget=80,partial=false;
    const selected=new Set(Array.isArray(media)?media.map(String):[]),seenSelected=new Set(),maxDepth=Math.max(0,Math.min(4,Number(depth)||0));
    async function walk(fid,nesting,path='',inline) {
      if(seen.has(fid)){notes.push('嵌套转发存在循环，已停止展开');return;}
      seen.add(fid);const response=inline??reference(scope,fid).inline??await request('get_forward_msg',{message_id:fid,id:fid},15000),all=rowsOf(response);
      if(!Array.isArray(all)||!all.length)throw Error('转发没有返回可读取的消息');
      const first=nesting?0:Math.max(0,Number(offset)||0),end=Math.min(all.length,first+Math.max(1,Math.min(40,Number(limit)||12)));
      if(first>0||end<all.length)partial=true;
      for(let index=first;index<end&&budget>0;index++,budget--) {
        const item=unpack(all[index]),content=ownContent(item),data=extractIncoming(content),segments=segmentsOf(content),position=path+index;
        const row={index:position,forwardId:fid,messageId:String(item.message_id??item.id??''),speakerId:String(item.sender?.user_id??item.user_id??item.uin??''),speaker:String(item.sender?.card||item.sender?.nickname||item.nickname||item.name||'未提供姓名').slice(0,80),time:Number(item.time)||0,text:data.text.slice(0,2500),media:segments.map((s,i)=>({type:s.type,index:i})).filter(s=>['image','mface','record','video','forward','file','json','xml','music'].includes(s.type)),children:[],mediaResults:[]};
        records.push(row);
        for(const [segmentIndex,segment] of segments.entries()) {
          const marker=position+':'+segmentIndex,kind=segment?.type;
          if(kind==='forward'&&segment.data?.id){const child=remember(scope,segment.data.id,{messageId:row.messageId,parentId:fid,speakerId:row.speakerId,time:row.time});row.children.push({id:child,index:marker});if(nesting<maxDepth)try{await walk(child,nesting+1,position+'.');}catch(error){row.mediaResults.push({index:marker,type:kind,status:'failed',error:String(error.message).slice(0,150)});}continue;}
          if(kind==='node'){const child='inline:'+fid+':'+marker;remember(scope,child,{parentId:fid},[segment]);if(nesting<maxDepth)await walk(child,nesting+1,position+'.',[segment]);else row.children.push({id:child,inline:true,index:marker});continue;}
          if(!selected.has(marker))continue;
          if(!['image','mface','record','video'].includes(kind))throw Error('media索引不指向可读取的图片、语音或视频：'+marker);
          seenSelected.add(marker);
          try {
            const context={...scope,forwardId:fid,index:marker,speakerId:row.speakerId,time:row.time};let result;
            if(['image','mface'].includes(kind)){result=await readImage?.(segment.data||{},context);if(!result)throw Error('图片未读取');parts.push(result);}
            else if(kind==='record'){result=await readRecord?.(segment.data||{},context);if(!result)throw Error('语音未转写');notes.push(row.speaker+'（'+marker+'语音转写）：'+String(result));}
            else if(kind==='video'){result=await readVideo?.(segment.data||{},context);if(!result?.ok)throw Error(result?.error||'视频未读取');parts.push(...result.parts||[]);notes.push(row.speaker+'（'+marker+'视频抽样）：'+String(result.coverage||''));}
            else continue;
            row.mediaResults.push({index:marker,type:kind,status:'read'});
          }catch(error){row.mediaResults.push({index:marker,type:kind,status:'failed',error:String(error.message).slice(0,200)});}
        }
      }
      if(budget<=0)partial=true;
      return all.length;
    }
    const total=await walk(String(id),0);
    const missing=[...selected].filter(index=>!seenSelected.has(index));if(missing.length)throw Error('所选媒体不在当前页或展开深度中，请先查看目录：'+missing.join(',').slice(0,160));
    const mediaResults=records.flatMap(r=>r.mediaResults),readCount=mediaResults.filter(r=>r.status==='read').length,failedCount=mediaResults.filter(r=>r.status==='failed').length;
    const coverage=selected.size?(readCount?'实际读取了'+readCount+'项所选媒体'+(failedCount?'，有'+failedCount+'项未取得；未取得的内容不能声称看过':'')+'；视频仅抽样，其他未选媒体没有观看':'消息文字已展开，但所选媒体读取失败，没有看懂图片、听到语音或看过视频'):'仅展开消息文字与媒体目录，未看图片、未听语音、未看视频；可按兴趣选择media索引继续读取';
    return {ok:!selected.size||readCount>0,id:String(id),source:origin.source,total,offset:Math.max(0,Number(offset)||0),records,parts,notes,partial:partial||failedCount>0,mediaRead:readCount,mediaFailed:failedCount,coverage,untrusted:true};
  }
  return {remember,read,known:(scope,id)=>{try{return !!reference(scope,id)}catch{return false}},list:scope=>[...references.entries()].filter(([key,r])=>key===scoped(scope,r.id)).map(([,r])=>({id:r.id,source:r.source}))};
}
