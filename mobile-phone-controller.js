import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

// Use the host's registered phone MCP tools. The app keeps its own permission,
// caller, observation and handoff checks; no direct socket or shell transport.
export function phoneScreenshotFormat(bytes){
 if(!bytes?.length||bytes.length>8*1024*1024)return null;
 if(bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a')return {extension:'png',mediaType:'image/png'};
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return {extension:'jpg',mediaType:'image/jpeg'};
 if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return {extension:'webp',mediaType:'image/webp'};
 return null;
}
export function createMobilePhoneController({getConfig,getDataDir,getCacheDir,authorize=()=>true,getTools,getAgent,readAttachment,runAsAgent=(_agent,execute)=>execute()}={}){
 let busy=false,controller=null;
 const backend='dsh-go-native';
 async function discovery(context={}){
  const agent=await getAgent?.(context),tools=getTools?.();
  const schemas=agent&&tools?.schemas?tools.schemas(agent).filter(t=>/^mcp__phone__/.test(t.name)):[];
  return {agent,tools,schemas};
 }
 async function status(context={}){
  const {schemas}=await discovery(context),cfg=getConfig();
  const connected=schemas.some(s=>s.name==='mcp__phone__screen');
  return {installed:existsSync('/etc/dsh-app/runtime.json')||connected,enabled:cfg.enabled,autonomous:cfg.autonomous,connected,backend,
   devices:connected?[{id:'this-phone',state:'device'}]:[],keyboardReady:schemas.some(s=>s.name==='mcp__phone__type'),
   wakeSupported:false,unlockSupported:false,passwordConfigured:false,paymentMode:'manual',
   inputNote:connected?'使用 DSH Go 原生手机工具；系统授权与敏感操作交接由 DSH Go 处理。':'请在 DSH Go 开启手机操控，并在当前 QQ 会话加载原生手机工具。',
   nativeTools:schemas.map(s=>({name:s.name,description:s.description||'',parameters:s.parameters||s.inputSchema||{}}))};
 }
 async function act(body,context={}){
  if(!authorize(context,body.action))throw Error('当前会话没有手机操作权限');
  if(body.action==='status')return status(context);
  if(body.action==='cancel'){controller?.abort();return {ok:true,cancelled:true};}
  if(!getConfig().enabled)throw Error('手机操作已关闭');
  const {agent,tools,schemas}=await discovery(context);
  if(body.action==='capabilities')return {ok:true,backend,nativeTools:schemas.map(s=>({name:s.name,description:s.description||'',parameters:s.parameters||s.inputSchema||{}})),note:'使用 native 并传入上述完整工具名和原生参数；screen 返回的屏幕号只用于本轮后续操作。'};
  if(!agent||!tools?.execute)throw Error('当前 QQ 会话尚未加载 DSH Go 原生手机工具，请先在 DSH Go 开启手机操控');
  if(busy)throw Error('另一个手机操作正在进行');
  let name,args;
  if(body.action==='native'){name=String(body.tool||body.capability||'');args=body.arguments||{};}
  else if(body.action==='observe'){name='mcp__phone__screen';args={detail:body.detail!==false,image:true};}
  else if(body.action==='launch'){name='mcp__phone__open';args=body.url?{url:String(body.url)}:{app:String(body.package||body.app||'')};}
  else if(body.action==='key'){name='mcp__phone__key';args={key:body.key,...(body.screen?{screen:body.screen}:{})};}
  else if(body.action==='tap'||body.action==='swipe'){
   if(!body.observation)throw Error('请先观察手机截图，再传入实际返回的 observation 屏幕号；不使用旧坐标盲点');
   name='mcp__phone__tap_xy';args={observation:body.observation,x:body.x??body.x1,y:body.y??body.y1,...(body.action==='swipe'?{action:'swipe',x2:body.x2,y2:body.y2}:{})};
  }else if(body.action==='input'){
   if(!body.screen||!Number.isInteger(body.id))throw Error('请先观察手机，传入原生 screen 屏幕号和输入框 id');
   name='mcp__phone__type';args={screen:body.screen,id:body.id,text:String(body.text||'')};
  }else if(body.action==='wake')throw Error('DSH Go 未提供绕过锁屏的接口，请点亮并解锁手机后继续');
  else if(['save-password','clear-password','prepare-payment','payment-input'].includes(body.action))throw Error('旧版密码代填入口已停用；付款请使用 DSH Go 原生 handoff 在手机完成');
  else throw Error('此旧版手机操作已停用，请使用 capabilities 发现 DSH Go 原生手机工具，再用 native 调用');
  if(!/^mcp__phone__/.test(name)||!schemas.some(s=>s.name===name))throw Error('当前会话没有这个 DSH Go 手机工具');
  if(!args||typeof args!=='object'||Array.isArray(args))throw Error('手机工具参数必须是对象');
  busy=true;controller=new AbortController();
  const stop=()=>controller?.abort(context.signal?.reason);context.signal?.addEventListener('abort',stop,{once:true});
  try{
   context.signal?.throwIfAborted();
   let result;
   try{
    const callId='bridge-phone-'+randomUUID();
    const execution={name,arguments:args,agent,signal:controller.signal,parent:context.exec,callId,
      calls:[{type:'tool-call',id:callId,name,arguments:JSON.stringify(args)}]};
    const response=await runAsAgent(agent,()=>tools.execute(execution),{name,callId,context});
    result=Array.isArray(response?.results)?response.results.find(row=>row.callId===callId)?.result:response;
    if(!result)throw Error('宿主未返回此工具调用的结果');
   }catch(error){
    controller.signal.throwIfAborted();
    const cause=String(error?.cause?.message||error?.message||'宿主工具未返回回执').replace(/https?:\/\/\S+/g,'[链接]').replace(/Bearer\s+\S+/gi,'Bearer [已隐藏]').slice(0,220);
    throw Error('DSH Go 手机工具执行失败：'+cause);
   }
   controller.signal.throwIfAborted();
   if(!authorize(context,body.action))throw Error('手机操作期间权限已改变，未提交旧结果');
   if(result.isError)throw Error(result.content?.filter(c=>c.type==='text').map(c=>c.text).join('\n')||'DSH Go 手机工具未完成，请检查手机端提示');
   const content=result.content||[],text=content.filter(c=>c.type==='text').map(c=>c.text).join('\n');
   const output={ok:true,backend,nativeTool:name,completed:false,ui:text,nativeContent:content,nativeResult:result.value,note:'以 DSH Go 返回内容为准；操作回话不代表目标业务已经完成。'};
   const image=content.find(c=>c.type==='image'&&(c.attachment&&readAttachment||typeof c.data==='string'&&['image/png','image/jpeg','image/webp'].includes(c.mimeType)));
   if(image){
    const stored=image.attachment&&readAttachment?await readAttachment(image.attachment,controller.signal):null;
    const bytes=stored?.data?Buffer.from(stored.data):typeof image.data==='string'?Buffer.from(image.data,'base64'):null;
    const format=phoneScreenshotFormat(bytes),declared=stored?.ref?.mediaType||image.mimeType;
    controller.signal.throwIfAborted();
    if(!authorize(context,body.action))throw Error('手机操作期间权限已改变，未提交旧截图');
    if(format&&(!declared||declared===format.mediaType)){
     const dir=join(getCacheDir(),'phone');mkdirSync(dir,{recursive:true});
     output.file=join(dir,'go-'+randomUUID()+'.'+format.extension);writeFileSync(output.file,bytes);
    }
   }
   return output;
  }finally{context.signal?.removeEventListener('abort',stop);busy=false;controller=null;}
 }
 return {status,act,cancel:()=>controller?.abort()};
}
