function operationViews(args={},observation={}){
 const views=[],seen=new Set();
 const visit=value=>{
  if(!value||typeof value!=='object'||seen.has(value))return;
  seen.add(value);views.push(value);
  for(const [key,item] of Object.entries(value)){
   if(key==='decisionId'||key==='toolName'||key==='name')continue;
   if(item&&typeof item==='object')visit(item);
  }
 };
 visit(args);visit(observation);return views;
}
const text=(value)=>String(value??'').trim();
const first=(views,key)=>views.map(view=>text(view[key])).find(Boolean)||'';
const firstOf=(views,keys)=>{for(const key of keys){const value=first(views,key);if(value)return value;}return '';};

/** Classify the actual operation for evidence and UI. The built-in permission
 * gate only consumes lifeRisk(), while callers may still record the full effect. */
export function operationRisk(args={},observation={}){
 const views=operationViews(args,observation);
 const labels=views.map(view=>text(view.label)).filter(Boolean).join(' ');
 const urls=views.map(view=>text(view.url)).filter(Boolean).join(' ');
 const names=views.flatMap(view=>[text(view.toolName),text(view.name)]).filter(Boolean).join(' ');
 const actions=views.map(view=>text(view.action)).filter(Boolean).join(' ');
 const targets=views.flatMap(view=>['target','path','file','filename','file_path','filePath','directory'].map(key=>text(view[key]))).filter(Boolean).join(' ');
 const capability=first(views,'capability');
 const command=first(views,'command')||first(views,'cmd')||first(views,'code')||first(views,'script')||first(views,'patch');
 const intents=new Set(views.map(view=>text(view.intent)).filter(Boolean));
 const effects=views.map(view=>text(view.effect||view.risk)).filter(Boolean);
 const toolName=first(views,'toolName');
 const password=views.some(view=>view.password===true||view.containsCredentials===true);
 const loginPage=views.some(view=>view.loginPage===true);
 const loginControl=first(views,'loginControl');

 const actionList=views.map(view=>text(view.action)).filter(action=>action&&action!=='call');
 const readOnly=new Set(['navigate','snapshot','screenshot','observe','get','read','list','status','search','find','fetch','inspect','wait','tabs','capabilities','schema','prepare-payment']);
 const observing=actionList.length>0&&actionList.every(action=>readOnly.has(action));
 // Opening an order/login page is an observation, not a payment submission.
 // A controller's actual payment classification still takes precedence.
 if(!['payment'].includes(observation.effect)&&observation.risk!=='payment'&&observing)return '';

 // Payment is the one operation that always needs the plugin's approval. Check
 // it before every non-payment observation and bypass flag.
 if(effects.includes('payment')||intents.has('payment')||/支付|付款|确认购买|提交订单|立即购买|pay\s*now|checkout/i.test(labels)||/payment|checkout|purchase/i.test(names)||/(?:^|[\/_.-])(?:pay|payment|checkout|purchase)(?:[\/_.-]|$)/i.test(actions)||/\/(?:pay|payment|checkout|purchase)(?:[/?#]|$)/i.test(urls))return 'payment';

 if(password)return 'privacy';
 if(toolName==='bridge_browser'&&observation.mediaControl===true)return '';
 if(loginPage&&loginControl==='credential')return password?'privacy':'login';
 if(loginPage&&loginControl==='submit')return 'login';
 if(effects.includes('login')||intents.has('login')||!views.some(view=>view.loginView===true)&&(/登录|登入|sign\s*in|sign\s*on|log\s*in/i.test(labels)||/\/(?:login|passport|sign_?in|signin|account\/login)(?:[/?#]|$)/i.test(urls)||/login|sign_?in/i.test(names)))return 'login';
 if(effects.includes('publish')||intents.has('publish')||/发布|投稿|publish|post\s*now/i.test(labels)||/publish|post_create|set_(?:self_)?(?:longnick|signature)|update_profile|set_profile/i.test(names))return 'publish';
 if(effects.includes('send')&&!views.some(view=>view.allowlistedChat===true))return 'publish';
 if(effects.includes('comment')||intents.has('comment')||/发送评论|发表评论|提交评论|post\s*comment/i.test(labels)||/评论|comment/i.test(labels)&&['fill','input','type','press'].includes(actions)||/comment/i.test(names))return 'comment';
 if(effects.includes('delete')||intents.has('delete')||/删除|清空|永久移除|恢复出厂|格式化|delete|erase|format disk/i.test(labels)||/^(?:delete|remove|unlink|wipe|format)$/i.test(actions)||/(?:^|_)delete|remove_file|delete_file|format_disk/i.test(names)||/\b(?:rm\s|del\s+\/|Remove-Item\b|diskpart\b|mkfs\b|format\s+[a-z]:)/i.test(command))return 'delete';
 if(effects.includes('security')||intents.has('security')||/关闭.{0,8}(?:防火墙|杀毒|防护)|修改.{0,8}(?:权限|密码)|授权.{0,8}(?:管理员|root)|disable.{0,8}(?:firewall|antivirus)/i.test(labels+' '+command)||/\b(?:chmod\s+777|Set-ExecutionPolicy|reg\s+delete|netsh\s+advfirewall|Set-MpPreference|sc\s+stop|net\s+stop|Stop-Service|curl.{0,80}\|.{0,8}(?:sh|bash|iex))\b/i.test(command))return 'security';
 if(password||effects.includes('privacy')||effects.includes('credentials')||intents.has('privacy')||/(?:^|[\\/])(?:credentials?|secrets?|cookies?|login[ _-]?data)(?:[\\/. _-]|$)|(?:^|[\\/])(?:\.ssh|\.aws)(?:[\\/]|$)|password|credential|secret|cookie|private.?key|密码|身份证|信用卡/i.test(labels+' '+targets)||/credential|read_secret|export_cookie|password_store/i.test(names))return 'privacy';
 if(effects.includes('permission')||intents.has('permission')||/send_?(?:email|mail)|invite_user|share_public/i.test(names))return 'permission';
 if(!/^bridge_/.test(toolName)&&/(?:click|tap|setvalue|type_text|input_text|press_key|fill)/i.test(toolName+' '+actions+' '+capability)&&!labels&&!targets)return 'permission';
 return intents.has('choice')?'choice':'';
}

/** The built-in approval plugin is now payment-only. Keep the legacy export
 * name for callers that need to decide whether a bridge decision is required. */
export function lifeRisk(args={},observation={}){
 return operationRisk(args,observation)==='payment'?'payment':'';
}

export function assertLifeOperation(job,args={},observation={}){
 if(!job)return;
 const kind=operationRisk(args,observation);
 if(job.status==='waiting_user'&&kind==='payment')throw Error('需要等待本人决定，当前日程付款操作暂停');
 if(!['queued','running','waiting_user'].includes(job.status))throw Error('日程任务已结束，不能执行旧动作');
 if(kind!=='payment')return;
 const views=operationViews(args,observation),url=first(views,'url'),text=firstOf(views,['text','value']),command=firstOf(views,['command','cmd','code','script','patch']);
 const q=job.question;
 if(q?.expiresAt&&Number(q.expiresAt)<=Date.now())throw Error('操作许可已过期，请重新核对后询问本人');
 if(q?.usedAt)throw Error('这份操作许可已使用，请重新询问本人');
 if(!q?.answer||q.id!==args.decisionId||q.kind!==kind||!/^(?:同意|允许|确认|可以|yes|approve)(?:[：:，,。.!！\s]|$)/i.test(q.answer)||/不同意|不允许|不要|不能|禁止|取消|拒绝/.test(q.answer))throw Error('这一步需要先用bridge_life_request取得本人的明确决定');
 const details=q.details||{};
 const target=firstOf(views,['target','path','file','filename','file_path','filePath','directory','to','recipient'])||url||command;
 if(!details.operation||!details.target)throw Error('请先说明付款操作与准确目标并询问本人');
 if(target!==String(details.target)||String(first(views,'action')||first(views,'toolName')||command)!==String(details.operation))throw Error('当前付款操作或目标与本人同意的版本不同，请重新询问');
 if(details.url&&url){const a=new URL(details.url),b=new URL(url);if(a.origin!==b.origin||a.pathname!==b.pathname)throw Error('当前操作目标与本人同意的页面不同，请重新询问');}
 const merchant=first(views,'merchant'),amount=first(views,'amount'),currency=first(views,'currency');
 if(!details.merchant||!details.amount||!details.currency||!merchant||!amount||!currency)throw Error('付款前需要明确商家、金额和币种并询问本人');
 if(merchant!==String(details.merchant)||amount!==String(details.amount)||currency!==String(details.currency))throw Error('当前付款信息与本人同意的版本不同，请重新询问');
 if(details.text&&text!==String(details.text))throw Error('付款内容与本人同意的版本不同，请重新询问');
}
