import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {join} from 'node:path';

export const GUILD_ACTIONS=[
  ['get_guild_service_profile','查看频道身份',[]],
  ['get_guild_list','查看已加入的频道',[]],
  ['get_guild_channel_list','查看子频道',['guild_id']],
  ['get_topic_channel_feeds','读取话题帖子',['guild_id','channel_id']],
  ['get_guild_msg','按编号读回频道消息',['guild_id','channel_id','message_id']],
  ['send_guild_channel_msg','发送子频道文字',['guild_id','channel_id','message']],
].map(([action,title,required])=>({action,title,required,scope:'guild',write:action==='send_guild_channel_msg'}));

const coverage={
  unsupported:'当前 QQ 接入端表示不支持此频道接口。',offline:'QQ 连接未就绪。',failed:'平台请求失败，尚无可用结果。',
  unavailable:'接口返回的内容不足以核实当前频道。',denied:'该身份没有取得目标频道或子频道的访问范围。',
  empty:'平台返回空列表，当前没有可展示的条目。',read:'已读取频道资料。',accepted:'平台已返回发送编号，可凭编号读回。',
  unknown:'提交结果待核对，原请求不会自动重发。',invalid:'频道请求的参数或操作来源无效。',storage:'无法保存操作记录，本次未提交。',
};
const result=(action,status,data=null)=>({action,status,ok:['empty','read','accepted'].includes(status),verified:status==='read',result:data,coverage:coverage[status],...(!['empty','read','accepted'].includes(status)?{error:coverage[status]}:{})});
function id(v){return (typeof v==='string'||Number.isSafeInteger(v))&&/^[1-9]\d{0,19}$/.test(String(v))&&BigInt(v)<=18446744073709551615n?String(v):'';}
const opaque=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\s\x00-\x1f]/.test(v)&&v!=='0'?v:'';
const words=(v,max=200)=>typeof v==='string'?v.slice(0,max):'';
const messageText=v=>Array.isArray(v)?v.filter(x=>x?.type==='text').map(x=>words(x.data?.text,4000)).join('').slice(0,4000):words(v,4000);
function failure(e){if(['1404','404'].includes(String(e?.retcode))||/unsupported|not supported|unknown action|action not found|不支持该接口/i.test(e?.message||''))return 'unsupported';return e?.code==='ONEBOT_NOT_READY'?'offline':'failed';}
function list(v,convert){
  if(v===null||Array.isArray(v)&&!v.length)return [];
  if(!Array.isArray(v))throw Error('invalid data');
  const items=v.map(convert);
  if(items.some(x=>!x))throw Error('invalid data');
  return items;
}
export function createGuildAccess({request,receiptDir}){
  async function read(action,params,c){
    c.validate?.();const value=await request(action,params,c);c.validate?.();return value;
  }
  const guilds=async c=>list(await read('get_guild_list',{},c),g=>id(g?.guild_id)&&{guild_id:id(g.guild_id),name:words(g.guild_name)});
  const channels=async(g,c)=>list(await read('get_guild_channel_list',{guild_id:g,no_cache:true},c),ch=>id(ch?.channel_id)&&(!ch.owner_guild_id||id(ch.owner_guild_id)===g)&&{guild_id:g,channel_id:id(ch.channel_id),name:words(ch.channel_name),type:ch.channel_type});
  const listed=(a,data)=>result(a,data.length?'read':'empty',data);
  async function send(a,p,c,g,ch){
    const origin=c.meta?.auditId||c.meta?.lifeJobId||c.meta?.decisionId;
    if(!origin||!receiptDir)return result(a,'invalid');
    const digest=createHash('sha256').update(JSON.stringify([c.accountId,c.receiverId||'',c.personaId,c.key,origin,g,ch])).digest('hex');
    const file=join(receiptDir,digest+'.json');
    try{
      mkdirSync(receiptDir,{recursive:true});
      writeFileSync(file,JSON.stringify({status:'unknown'}),{flag:'wx',mode:0o600});
    }catch(e){
      if(e.code!=='EEXIST')return result(a,'storage');
      try{const previous=JSON.parse(readFileSync(file,'utf8'));return result(a,previous.status,previous.message_id?{message_id:previous.message_id}:null);}catch{return result(a,'unknown');}
    }
    let status='unknown',mid='';
    try{
      c.validate?.();
      const value=await request(a,{guild_id:g,channel_id:ch,message:[{type:'text',data:{text:p.message}}]},c);
      mid=opaque(value?.message_id);
      if(mid)status='accepted';
    }catch(e){if(e.submitted===false||e.retcode!=null&&!e.deliveryUnknown)status=failure(e);}
    const temp=file+'.'+randomUUID()+'.tmp';
    try{writeFileSync(temp,JSON.stringify({status,message_id:mid}),{flag:'wx',mode:0o600});renameSync(temp,file);}catch{if(!mid)status='unknown';}
    c.validate?.();return result(a,status,mid?{message_id:mid}:null);
  }
  return async function call(a,p,c){
    const def=GUILD_ACTIONS.find(x=>x.action===a);
    if(!def||!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!def.required.includes(k))||def.required.some(k=>!Object.hasOwn(p,k)))return result(a,'invalid');
    const g=id(p.guild_id),ch=id(p.channel_id),mid=opaque(p.message_id);
    if((def.required.includes('guild_id')&&!g)||(def.required.includes('channel_id')&&!ch)||(a==='get_guild_msg'&&!mid)||(def.write&&(typeof p.message!=='string'||!p.message.trim()||p.message.length>4000)))return result(a,'invalid');
    try{
      if(a==='get_guild_service_profile'){
        const v=await read(a,{},c);return id(v?.tiny_id)?result(a,'read',{tiny_id:id(v.tiny_id),nickname:words(v.nickname)}):result(a,'unavailable');
      }
      const joined=await guilds(c);if(a==='get_guild_list')return listed(a,joined);
      if(!joined.some(row=>row.guild_id===g))return result(a,'denied');
      const available=await channels(g,c);if(a==='get_guild_channel_list')return listed(a,available);
      if(!available.some(row=>row.channel_id===ch))return result(a,'denied');
      if(def.write)return await send(a,p,c,g,ch);
      if(a==='get_guild_msg'){
        const v=await read(a,{message_id:mid,no_cache:true},c);
        if(!v||opaque(v.message_id)!==mid||id(v.guild_id)!==g||id(v.channel_id)!==ch||v.message_source==='direct')return result(a,'unavailable');
        return result(a,'read',{message_id:mid,guild_id:g,channel_id:ch,text:messageText(v.message),author:words(v.sender?.nickname),time:v.time});
      }
      const feeds=list(await read(a,{guild_id:g,channel_id:ch},c),v=>id(v?.guild_id)===g&&id(v.channel_id)===ch&&opaque(v.id)&&{id:v.id,guild_id:g,channel_id:ch,title:words(v.title),text:messageText(v.contents),author:words(v.poster_info?.nickname),time:v.create_time});
      return listed(a,feeds);
    }catch(e){return result(a,e.message==='invalid data'?'unavailable':failure(e));}
  };
}
