import {createHash} from 'node:crypto';
const qqId=value=>typeof value==='number'&&!Number.isSafeInteger(value)?'':/^\d{5,20}$/.test(String(value??''))?String(value):'';
// A platform notice is an observed interaction, never a user-authored command.
export function normalizeQqPoke(event,{selfId='',now=Date.now}={}){
 if(event?.post_type!=='notice'||event.notice_type!=='notify'||event.sub_type!=='poke')return null;
 const self=qqId(event.self_id||selfId),actor=qqId(event.user_id||event.sender_id),target=qqId(event.target_id);
 if(!self||!actor||target!==self||actor===self)return null;
 const group=event.group_id===undefined||event.group_id===null||String(event.group_id)==='0'?'':qqId(event.group_id);
 if(event.group_id&&String(event.group_id)!=='0'&&!group)return null;
 const time=Number.isFinite(Number(event.time))&&Number(event.time)>0?Number(event.time):Math.floor(now()/1000);
 const stamp=createHash('sha256').update(JSON.stringify([self,group,actor,target,time,String(event.message_id||event.seq||'')])).digest('hex').slice(0,24);
 const body='【QQ戳一戳事件】当前发言者刚戳了你一下。这是实际QQ互动，不是他说出的文字，也不代表他另提了任务。结合关系、此刻情绪和前文自然反应，可以打趣、继续原话题或不回应；别照念事件说明，不必询问他想做什么。';
 return {post_type:'message',message_type:group?'group':'private',sub_type:group?'normal':'friend',self_id:self,user_id:actor,...(group?{group_id:group,_groupAttentionApproved:true}:{}),message_id:'poke-'+stamp,time,sender:{user_id:actor,nickname:String(event.sender?.nickname||'QQ尾号'+actor.slice(-4)).slice(0,60)},message:[...(group?[{type:'at',data:{qq:self}}]:[]),{type:'text',data:{text:body,_bridgeEvent:'poke'}}],_bridgePoke:{actorId:actor,targetId:target,kind:group?'group':'private',time},_bridgeReceivedAt:now()};
}
export function qqHumanWords(message){return (Array.isArray(message)?message:[]).filter(s=>s?.type==='text'&&!s.data?._bridgeEvent).map(s=>String(s.data?.text||'')).join('\n').trim();}
