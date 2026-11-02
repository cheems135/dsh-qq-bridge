import {createHash} from 'node:crypto';
export function createGameSessions({policy,metaFor,request,open,now=()=>Date.now()}={}){
 const sessions=new Map(),scope=c=>JSON.stringify([c.accountId,c.personaId,c.key,c.generation]);
 function operation(a){const name=String(a.name||'').trim().slice(0,80),url=String(a.url||''),shortcut=String(a.shortcut||'');if(!name||Boolean(url)===Boolean(shortcut))throw Error('先说明具体游戏名，以及网页地址或真实桌面快捷方式其中一个');if(url){const u=new URL(url);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('无效游戏地址');}return {toolName:'bridge_game',action:'play',name,url,shortcut,target:url||shortcut};}
 function progress(c){const s=sessions.get(scope(c));return {ok:true,session:s||null,substantive:!!s&&s.controls>0&&s.observations>=2,coverage:s&&s.controls>0&&s.observations>=2?'已在获准游戏中执行真实操作并重新观察画面；仅证明实际操作，不证明胜负、通关或奖励':'尚未形成实际游玩与后续画面的证据'};}
 function record(c,tool,args,result){const s=sessions.get(scope(c));if(!s||s.until<=now()||result?.ok===false)return null;let matches=false;if(s.url&&tool==='bridge_browser'){try{const expected=new URL(s.url),actual=new URL(result.url||result.snapshot?.url||'');matches=actual.origin===expected.origin&&actual.pathname.startsWith(expected.pathname);}catch{}}else if(s.shortcut&&tool==='bridge_device')matches=!!s.windowId&&String(result.windowId)===s.windowId;if(!matches)return null;if(['click','press','fill','scroll','type'].includes(args.action))s.controls++;if(result.file||result.elements||result.snapshot)s.observations++;return progress(c);}
 async function act(a,c){const key=scope(c);if(['status','progress'].includes(a.action))return progress(c);if(a.action==='stop'){sessions.delete(key);return {ok:true,stopped:true,coverage:'结束游戏任务许可，不自动关闭其他窗口'};}
  const args=operation(a),trusted={risk:'permission',target:args.target,label:'游玩游戏：'+args.name};
  if(a.action==='request')return request(c,'bridge_game',args,'我想玩一会儿《'+args.name+'》，可以吗？',trusted);
  if(a.action!=='play')throw Error('未知游戏动作');
  const old=sessions.get(key);if(old&&old.fingerprint===createHash('sha256').update(JSON.stringify(args)).digest('hex')&&old.until>now())return {ok:true,alreadyPlaying:true,session:old,coverage:'本次游戏已打开，继续观察现有窗口，不重开'};
  const receipt=policy.check(metaFor(c),args,trusted,{allowMatchingGrant:true,decisionId:a.decisionId});policy.consume(receipt);
  const result=await open(args,c),session={name:args.name,url:args.url,shortcut:args.shortcut,windowId:String(result.windowId||''),controls:0,observations:result.file||result.elements||result.snapshot?1:0,startedAt:now(),until:now()+60*60000,fingerprint:createHash('sha256').update(JSON.stringify(args)).digest('hex')};sessions.set(key,session);
  return {...result,session,coverage:'已获本人本次同意并实际打开游戏；继续用真实浏览器或设备工具观察和操作。打开不等于玩过，充值、账号隐私和对外发言仍独立核对'};
 }
 return {act,record};
}
