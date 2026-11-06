import {createHash,randomUUID} from 'node:crypto';
const scope=m=>[m.accountId||'',m.personaId||'',m.ownerId||''].join('\0');
const origin=url=>{try{const u=new URL(url);return /^https?:$/.test(u.protocol)?u.origin:'';}catch{return '';}};
// 本人口语里的"去登录"都算：用账号/密码登录、允许登录、帮我登一下、登录我的账号。
// 否定、疑问、举例、转述一律不算；它只覆盖一次 10 分钟内、绑定到一个站点的登录页手势。
const LOGIN_DENY=/(?:不要|不用|不许|不允许|不同意|不批准|禁止|先别|别用|别|甭|不是让你|不能(?:使用|用|拿|自己|擅自)|不可以|不准)[^。！？]{0,8}(?:登|登录|登陆)|他说|她说|例如|举例|假设|假如|要是|提示词|如果|除非|[？?]|["'「」『』]/;
const LOGIN_ASK=/(?:用|使用|拿|改用)[^。！？]{0,24}(?:账号|帐号|账户|密码|凭据)[^。！？]{0,12}(?:登录|登陆|登)|(?:同意|允许|授权|批准|准你)[^。！？]{0,24}(?:登录|登陆|登)|(?:帮我|替我|给我|为你|麻烦你)[^。！？]{0,6}(?:登|登录|登陆)(?:一下|进去|上去|进来|看看|我|号|账号|帐号|账户|B站|b站|QQ|微信|微博|知乎|小红书|抖音|吧)?|(?:登录|登陆|登)(?:一下|进去)?我(?:的)?(?:账号|帐号|账户|号|QQ|微信|B站|b站|微博|知乎|小红书|淘宝|京东|邮箱|网易云|抖音)|(?:登录|登陆|登)(?:一下|进去)(?:[，,。.!！\s]|$)/;
export function explicitLoginInstruction(value){const s=String(value||'').trim();return s.length>0&&s.length<=600&&!LOGIN_DENY.test(s)&&LOGIN_ASK.test(s);}
// A real owner's instruction grants one short login flow at one observed site.
// It never grants reading a password store, an unrelated site, OAuth consent,
// payment or publishing. Only browser-observed login controls can use it:
// the site is bound on the first real login-page gesture, not from the text.
export function createLoginWorkflows({state,now,save,event}){
 state.loginWorkflows=Array.isArray(state.loginWorkflows)?state.loginWorkflows:[];
 const authorized=m=>m.ownerId&&m.personaId&&m.chat==='private:'+m.ownerId;
 function grant(meta,url,sourceId){const site=origin(url);if(!authorized(meta))return null;
  for(const old of state.loginWorkflows)if(old.scope===scope(meta)&&old.status==='active')old.status='superseded';
  const item={id:randomUUID(),scope:scope(meta),origin:site,sourceId:String(sourceId||''),status:'active',createdAt:now(),expiresAt:now()+10*60_000,steps:[],credentials:{}};
  state.loginWorkflows=state.loginWorkflows.concat(item).slice(-40);save();return item;
 }
 function instruction(meta,{text,id,url}={}){if(!authorized(meta))return null;if(/(?:不要|不许|别|停止|取消).{0,10}(?:登录|登陆)/.test(String(text||''))){invalidate(meta);return null;}return explicitLoginInstruction(text)?grant(meta,url,id):null;}
 function fromDecision(item,meta){if(item.loginContext&&authorized(meta))return grant(meta,item.operation.url,item.id);}
 function check(meta,args,trusted,d){if(!authorized(meta)||args.toolName!=='bridge_browser'||!['login','privacy'].includes(d.kind)||!trusted.loginPage||!['credential','submit'].includes(trusted.loginControl)||trusted.oauthConsent)return null;
  const site=origin(trusted.url),flow=state.loginWorkflows.findLast(f=>f.scope===scope(meta)&&(f.origin===site||(f.origin===''&&site!==''))&&f.status==='active'&&f.expiresAt>now());if(!flow||flow.steps.length>=20)return null;
  // "登录我的账号"这类不带网址的指令，在真正落到登录页的第一下才绑定站点。
  if(!flow.origin){flow.origin=site;save();}
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
