import {createHash,randomUUID} from 'node:crypto';
const scope=m=>[m.accountId||'',m.personaId||'',m.ownerId||''].join('\0');
const origin=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)?u.origin:'';}catch{return '';}};
export function explicitLoginInstruction(value){const s=String(value||'').trim();return s.length<=600&&!/不要|不用|不许|不允许|不同意|不批准|禁止|先别|别用|不是让你|不能(?:使用|用|拿)|不可以|不准|别.{0,6}(?:登录|登陆)|他说|她说|例如|举例|提示词|如果|除非|[？?]|[“”「」]/.test(s)&&/(?:用|使用|拿)(?:我(?:的)?|这个|这组|刚才(?:的)?|上面(?:的)?).{0,20}(?:账号|帐号|账户|密码|凭据).{0,15}(?:登录|登陆)|(?:同意|允许|授权|批准).{0,20}(?:登录|登陆)/.test(s);}
// A real owner's instruction grants one short login flow at one observed site.
// It never grants reading a password store, an unrelated site, OAuth consent,
// payment or publishing. Only browser-observed login controls can use it.
export function createLoginWorkflows({state,now,save,event}){
 state.loginWorkflows=Array.isArray(state.loginWorkflows)?state.loginWorkflows:[];
 const authorized=m=>m.ownerId&&m.personaId&&m.chat==='private:'+m.ownerId;
 function grant(meta,url,sourceId){const site=origin(url);if(!authorized(meta)||!site)return null;
  for(const old of state.loginWorkflows)if(old.scope===scope(meta)&&old.status==='active')old.status='superseded';
  const item={id:randomUUID(),scope:scope(meta),origin:site,sourceId:String(sourceId||''),status:'active',createdAt:now(),expiresAt:now()+10*60_000,steps:[],credentials:{}};
  state.loginWorkflows=state.loginWorkflows.concat(item).slice(-40);save();return item;
 }
 function instruction(meta,{text,id,url}={}){if(!authorized(meta))return null;if(/(?:不要|不许|别|停止|取消).{0,10}(?:登录|登陆)/.test(String(text||''))){invalidate(meta);return null;}return explicitLoginInstruction(text)?grant(meta,url,id):null;}
 function fromDecision(item,meta){if(item.loginContext&&authorized(meta))return grant(meta,item.operation.url,item.id);}
 function check(meta,args,trusted,d){if(!authorized(meta)||args.toolName!=='bridge_browser'||!['login','privacy'].includes(d.kind)||!trusted.loginPage||!['credential','submit'].includes(trusted.loginControl)||trusted.oauthConsent)return null;
  const site=origin(trusted.url),flow=state.loginWorkflows.findLast(f=>f.scope===scope(meta)&&f.origin===site&&f.status==='active'&&f.expiresAt>now());if(!flow||flow.steps.length>=20)return null;
  // Changing a credential after it was supplied needs a fresh user instruction.
  const field=args.action==='fill'?(trusted.password?'password':trusted.loginControl==='credential'?'account':''):'',value=field?createHash('sha256').update(String(args.text||'')).digest('hex'):'';
  if(field&&flow.credentials[field]&&flow.credentials[field]!==value)return null;
  if(flow.steps.includes(d.fingerprint))return null;
  return {ok:true,ordinary:false,loginWorkflowId:flow.id,fingerprint:d.fingerprint,scope:flow.scope,field,value};
 }
 function consume(receipt){const flow=state.loginWorkflows.find(f=>f.id===receipt.loginWorkflowId&&f.scope===receipt.scope);if(!flow||flow.status!=='active'||flow.expiresAt<=now()||flow.steps.includes(receipt.fingerprint))throw Error('这次登录许可已结束或该步骤已执行，请先观察结果');
  if(receipt.field)flow.credentials[receipt.field]=receipt.value;flow.steps.push(receipt.fingerprint);const decision=state.decisions.find(d=>d.id===flow.sourceId&&d.status==='approved');if(decision){decision.status='consumed';decision.usedAt=now();}save();event('login-step',{id:flow.id,scope:flow.scope},{origin:flow.origin});return {...receipt,consumed:true};}
 function invalidate(meta){for(const f of state.loginWorkflows)if(f.scope===scope(meta))f.status='cancelled';save();}
 return {instruction,fromDecision,check,consume,invalidate};
}
