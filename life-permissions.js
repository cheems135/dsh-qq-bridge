export function lifeRisk(args={},observation={}){
 const label=String(observation.label||''),url=String(observation.url||args.url||''),name=String(args.toolName||''),action=String(args.action||''),command=String(args.command||args.cmd||args.arguments?.command||'');
 if(name==='bridge_browser'&&observation.mediaControl===true)return '';
 if(observation.loginPage&&observation.loginControl==='credential')return observation.password?'privacy':'login';
 if(observation.loginPage&&observation.loginControl==='submit')return 'login';
 if(/支付|付款|确认购买|提交订单|立即购买|pay\s*now|checkout/i.test(label)||/payment|checkout|purchase/.test(name)||args.intent==='payment')return 'payment';
 if(observation.loginView!==true&&(/登录|登入|sign\s*in|log\s*in/i.test(label)||/\/(?:login|passport)(?:[/?#]|$)/i.test(url)||/login|sign_in/.test(name)||args.intent==='login'))return 'login';
 if(/发布|投稿|publish|post\s*now/i.test(label)||/publish|post_create|set_(?:self_)?(?:longnick|signature)|update_profile|set_profile/.test(name)||args.intent==='publish')return 'publish';
 if(/发送评论|发表评论|提交评论|post\s*comment/i.test(label)||/评论|comment/i.test(label)&&['fill','input','type','press'].includes(action)||/comment/.test(name)||args.intent==='comment')return 'comment';
 if(/删除|清空|永久移除|恢复出厂|格式化|delete|erase|format disk/i.test(label)||/^(?:delete|remove|unlink|wipe|format)$/.test(action)||/(?:^|_)delete|remove_file|delete_file|format_disk/.test(name)||/\b(?:rm\s|del\s+\/|Remove-Item\b|diskpart\b|mkfs\b|format\s+[a-z]:)/i.test(command)||args.intent==='delete')return 'delete';
 if(/关闭.{0,8}(?:防火墙|杀毒|防护)|修改.{0,8}(?:权限|密码)|授权.{0,8}(?:管理员|root)|disable.{0,8}(?:firewall|antivirus)/i.test(label+' '+command)||/\b(?:chmod\s+777|Set-ExecutionPolicy|reg\s+delete|pip\s+install|npm\s+install|curl.{0,80}\|.{0,8}(?:sh|bash|iex))\b/i.test(command)||args.intent==='security')return 'security';
 if(observation.password===true||observation.containsCredentials===true||/password|credential|secret|cookie|private.?key|密码|身份证|信用卡/i.test(label)||/credential|read_secret|export_cookie|password_store/i.test(name)||args.intent==='privacy')return 'privacy';
 if(/send_?(?:email|mail)|invite_user|share_public/i.test(name))return 'permission';
 return ['permission','choice'].includes(args.intent)?args.intent:'';
}
export function assertLifeOperation(job,args={},observation={}){
 if(!job)return;
 if(job.status==='waiting_user')throw Error('需要等待本人决定，当前日程操作暂停');
 if(!['queued','running'].includes(job.status))throw Error('日程任务已结束，不能执行旧动作');
 const label=String(observation.label||''),url=String(observation.url||args.url||''),text=String(args.text||args.arguments?.text||args.arguments?.value||'');
 const command=String(args.command||args.cmd||args.arguments?.command||'');
 const kind=lifeRisk(args,observation);if(!kind)return;
 const q=job.question;
 if(q?.expiresAt&&Number(q.expiresAt)<=Date.now())throw Error('操作许可已过期，请重新核对后询问本人');
 if(q?.usedAt)throw Error('这份操作许可已使用，请重新询问本人');
 if(!q?.answer||q.id!==args.decisionId||q.kind!==kind||!/^(?:同意|允许|确认|可以|yes|approve)(?:[：:，,。.!！\s]|$)/i.test(q.answer)||/不同意|不允许|不要|不能|禁止|取消|拒绝/.test(q.answer))throw Error('这一步需要先用bridge_life_request取得本人的明确决定');
 const details=q.details||{};
 if(['delete','security','permission','privacy'].includes(kind)){
  const target=String(args.path||args.file||args.target||args.to||args.recipient||args.arguments?.path||args.arguments?.file||url||command||'');
  if(!details.operation||!details.target)throw Error('请先说明操作与准确目标并询问本人');
  if(target!==String(details.target)||String(args.action||args.toolName||command)!==String(details.operation))throw Error('当前操作或目标与本人同意的版本不同，请重新询问');
 }
 if(details.url&&url){const a=new URL(details.url),b=new URL(url);if(a.origin!==b.origin||a.pathname!==b.pathname)throw Error('当前操作目标与本人同意的页面不同，请重新询问');}
 if(['comment','publish'].includes(kind)){
  if(!details.url||!String(details.text||'').trim())throw Error('请先把发布位置和确切文字告诉本人再询问');
  if(text&&text!==String(details.text))throw Error('文字内容与本人同意的版本不同，请重新询问');
 }
 if(kind==='payment'&&(!details.merchant||!details.amount||!details.currency))throw Error('付款前需要明确商家、金额和币种并询问本人');
}
