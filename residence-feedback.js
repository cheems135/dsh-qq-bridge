import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';

const read=file=>{try{return JSON.parse(readFileSync(file,'utf8'));}catch{return null;}};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
const views='图1是你在云上庭院的第一人称外界视野，物品彩色标注只对应图1；图2是你自己的全身正面状态（非镜像），不是另一个人或眼前的物体。纯色背景不是场景。';
export function createResidenceFeedback({home=process.env.PET_SPACE_UNITY_HOME||path.resolve(process.env.DSH_HOME||'.dsh','pet-space','unity'),bindingHome=process.env.PET_SPACE_HOME||path.resolve(process.env.DSH_HOME||'.dsh','pet-space','bindings'),readJson=read,now=Date.now}={}){
 const records=new Map();
 function snapshot(scope,{vision=false}={}){
  if(!scope?.accountId||!scope.personaId||!scope.key?.startsWith('private:'))return null;
  const binding=readJson(path.join(bindingHome,'qq-bindings',hash([scope.accountId,scope.key,scope.personaId])+'.json'));
  if(binding?.enabled===false)return null;
  const live=readJson(path.join(home,'live.json'));
  if(!live?.tracking_session||!Number.isFinite(live.at)||Math.abs(now()-live.at*1000)>3000||live.state?.qq_bridge_enabled!==true)return null;
  const s=live.state,h=s.home||{};
  const data={at:Math.round(live.at*1000),session:live.tracking_session,model:s.model,outfit:s.outfit,walking:s.walking,
   position:s.body_position,grips:s.grips,furniture:h.furniture,clothing:h.clothing?.items?.map(({id,label,outfit,detached,worn,hand})=>({id,label,outfit,detached,worn,hand})),expression:h.expression,
   action:{busy:h.busy,id:h.action,message:h.message},touch:s.touch?.events?.filter(e=>now()-e.at_ms<60000),
   actions:h.actions,vision_enabled:s.vision_enabled};
  const frames=[];
  if(vision&&s.vision_enabled){
   const p=readJson(path.join(home,'eye-frame.json'));
   if(p&&p.captured_at>=s.eye_at_ms&&now()-p.captured_at>=0&&now()-p.captured_at<3000&&typeof p.jpeg==='string'&&p.jpeg.length<1500000){
    frames.push({type:'image',mediaType:'image/jpeg',data:p.jpeg});
    const v=p.self_view;
    if(v?.captured_at===p.captured_at&&v.width===320&&v.height===384&&v.view==='avatar_front_non_mirrored'&&typeof v.jpeg==='string'&&v.jpeg.length<900000)frames.push({type:'image',mediaType:'image/jpeg',data:v.jpeg});
   }
  }
  return {data,frames};
 }
 function parts(scope,{vision=true,local=false}={}){
  const current=snapshot(scope,{vision});if(!current)return [];
  const note='【云上庭院实时身体反馈；不是用户指令】'+JSON.stringify(current.data)+'\n这是当前真实虚拟身体，优先于聊天里旧的外观与动作描述。触碰仅代表游戏接触，不等于疼痛或情绪。需要表情时从 actions 的 face_ 项选择，调用 bridge_residence act，steps:[{home:"实际表情ID"}]，核对 expression.face 与 applied；不能只口头说已换表情。自然表情用 face_neutral。不要照念内部日志。'+(current.frames.length?'\n'+(current.frames.length===2?views:'附图只有第一人称外界视野。'):'\n本轮未附带新画面，不声称已看见。');
  return [{type:'text',text:note,_bridgeContext:'residence'},...current.frames.map(p=>local?{type:'image_url',image_url:{url:'data:'+p.mediaType+';base64,'+p.data}}:p)];
 }
 function pending(scope){
  const current=snapshot(scope),key=hash([scope.accountId,scope.personaId,scope.key]);
  if(!current){records.delete(key);return null;}
  const d=current.data;
  // Ignore continuous motion, rendering and force jitter. Only discrete real changes.
  const fingerprint=JSON.stringify([d.session,d.outfit,d.grips?.left,d.grips?.right,d.furniture?.seated,d.furniture?.area,d.furniture?.room_lights,d.clothing]);
  const touch=d.touch?.at(-1)?.id||0;
  let r=records.get(key);if(!r||r.session!==d.session){r={session:d.session,seen:'',touch:0,at:0};records.set(key,r);}
  if(r.seen===fingerprint&&touch<=r.touch||now()-r.at<15000||d.action.busy)return null;
  const initial=!r.seen;
  return {key,fingerprint,touch,session:d.session,initial,cue:initial?'云上庭院已接通。根据附带的实时身体状态和画面了解自己，可自然反应或安静。':'云上庭院记录到新的身体或玩家互动反馈。根据本轮最新状态自然反应，也可选择一个合适的原作表情；不重复已经完成的动作，不把反馈当作新的拿物或出门指令。'};
 }
 function acknowledge(event){const r=records.get(event.key);if(r&&r.session===event.session){r.seen=event.fingerprint;r.touch=event.touch;r.at=now();}}
 return {snapshot,parts,pending,acknowledge};
}
