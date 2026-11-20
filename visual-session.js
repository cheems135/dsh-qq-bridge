import {randomUUID,createHash} from 'node:crypto';

export function visualCompanionIntent(words='',{mobile=false}={}){
 const text=String(words).trim();
 if(/[“”「」`]/.test(text)||/^(?:例如|比如|假设|如果|能不能解释|什么是)/.test(text))return null;
 if(/^(?:先)?(?:暂停|停止|结束|关闭)(?:一下)?(?:陪看|陪玩|陪伴|持续观察|视听)[吧了。！!\s]*$/.test(text))return {action:/暂停/.test(text)?'pause':'stop'};
 if(/^(?:继续|恢复)(?:陪看|陪玩|陪伴|持续观察|视听)[吧。！!\s]*$/.test(text))return {action:'resume'};
 if(/不要|不用|不想|别陪|别看|先别/.test(text))return null;
 if(/^(?:帮我|给我|请|你)?(?:打开|开启|显示)(?:一下)?(?:陪我看|陪看|识屏|视听)?(?:的)?(?:悬浮窗|悬浮球)(?:功能)?[吧。！!\s]*$/.test(text))return {action:'open-window'};
 const url=text.match(/https?:\/\/[^\s<>“”]+/i)?.[0]?.replace(/[，。！？）]+$/,'');
 if(mobile||!url||!/(?:一起看|陪我看|陪我玩|一起玩|帮我玩|替我玩|你来玩)/.test(text))return null;
 return {action:'start',target:'browser',url,mode:/陪我玩|一起玩|帮我玩|替我玩|你来玩/.test(text)?'game':'watch',audio:true,control:/帮我玩|替我玩|你来玩|你来操作/.test(text)};
}

export function visualSessionBudget(local=false,target='',profile='balanced'){if(target==='phone'&&!local){const modes={saver:{sampleMs:3000,inferMs:12000,maxAgeMs:20000,maxEdge:640,quality:60},balanced:{sampleMs:2000,inferMs:8000,maxAgeMs:15000,maxEdge:768,quality:65},detail:{sampleMs:1500,inferMs:6000,maxAgeMs:15000,maxEdge:1024,quality:70}};return {...(modes[profile]||modes.balanced)};}return local
 ?{sampleMs:2500,inferMs:12000,maxAgeMs:30000,maxEdge:640,quality:60}
 :{sampleMs:1000,inferMs:8000,maxAgeMs:10000,maxEdge:1024,quality:70};}
export function visualDistance(a,b){
 if(!a||!b)return Infinity;
 if(Array.isArray(a.signature)&&a.signature.length&&a.signature.length===b.signature?.length)
  return a.signature.reduce((sum,v,i)=>sum+Math.abs(v-b.signature[i]),0)/a.signature.length;
 return a.digest===b.digest?0:Infinity;
}
export function visualGameAction(request,frame,{mode,control,target,windowId}={}){
 if(!request||mode!=='game'||!control)return null;
 if(request.action==='press'){
  if(!/^(?:ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Space|Enter|Escape|[wasdWASD])$/.test(request.key||''))throw Error('游戏只允许方向键、WASD、空格、回车和退出键');
  return {action:'press',key:request.key,...(target==='window'?{windowId}: {})};
 }
 if(target==='browser'&&request.action==='click'&&frame.elements?.some(e=>e.ref===request.ref&&e.type==='canvas'))return {action:'click',ref:request.ref};
 throw Error('游戏动作必须使用本次观察中的游戏画布或允许按键');
}

// One latest-frame mailbox and one inference at a time. Capture never waits on
// inference; replacements are discarded instead of becoming a historical queue.
export function createVisualSessions({capture,observeAudio,analyze,deliver,act,release=()=>{},valid=()=>true,busy=()=>false,local=()=>false,onEvent=()=>{},onError=()=>{},now=()=>Date.now(),schedule=setTimeout,cancel=clearTimeout}={}){
 const sessions=new Map();let closed=false,inferenceOwner=null;
 const safe=s=>({id:s.id,key:s.context.key,accountId:s.context.accountId,personaId:s.context.personaId,target:s.options.target,captureSource:s.options.captureSource||'host',mode:s.options.mode,url:s.options.url||'',windowId:s.options.windowId||'',control:s.options.control===true,sourceLabel:s.options.sourceLabel||'',profile:s.options.profile||'balanced',status:s.status,backend:s.local?'local':'api',startedAt:s.startedAt,observedAt:s.latest?.capturedAt||s.lastFrame?.capturedAt||0,analyzing:!!s.inferenceTask,analyzedAt:s.analyzedAt||0,captures:s.captures,analyses:s.analyses,reactions:s.reactions,actions:s.actions,dropped:s.dropped,priorityWait:s.priorityWait,sourceWait:s.sourceWait||'',error:s.error||'',coverage:s.latest?.coverage||'',messages:(s.messages||[]).slice(-12),pendingInputs:(s.pendingInputs||[]).length,budget:s.budget,events:s.events.slice(-12)});
 function event(s,type,extra={}){const row={at:now(),type,...extra};s.events.push(row);s.events=s.events.slice(-30);try{onEvent(safe(s),row,s.context);}catch{}}
 const current=s=>!closed&&sessions.get(s.context.key)===s&&s.status==='running'&&valid(s.context,s.options);
 function suspend(s,reason='paused'){s.status=reason;cancel(s.timer);s.inference?.abort();s.captureController?.abort();s.latest=null;s.pendingAudio=null;void Promise.resolve(release(s.options,s.context)).catch(()=>{});event(s,reason);}
 function start(options={},context={}){
  if(closed)throw Error('视听会话服务已停止');
  if(!context.key)throw Error('缺少陪伴会话的接收对象');
  if(!['browser','window','screen','shared','phone'].includes(options.target||'browser'))throw Error('请选择浏览器、窗口或屏幕');
  if(options.target==='window'&&!/^\d+$/.test(String(options.windowId||'')))throw Error('先选择真实窗口');
  if((options.target||'browser')==='browser'){let url;try{url=new URL(options.url);}catch{throw Error('请填写完整的视频或游戏网址');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error('需要不含凭据的视频或游戏网址');}
  if(options.mode==='game'&&options.control&&options.target!=='browser')throw Error('自动游戏操作目前只支持独立浏览器；窗口和屏幕可以陪看');
  const old=sessions.get(context.key);if(old)suspend(old,'stopped');
  const isLocal=local(context),s={id:randomUUID(),context:{...context},options:{...options,target:options.target||'browser',mode:options.mode==='game'?'game':'watch'},local:isLocal,budget:visualSessionBudget(isLocal,options.target,options.profile),status:'running',startedAt:now(),captures:0,analyses:0,reactions:0,actions:0,dropped:0,priorityWait:false,failures:0,events:[],messages:[],pendingInputs:[],lastInfer:-Infinity,lastFrame:null,latest:null};
  s.context.visualSessionId=s.id;sessions.set(context.key,s);event(s,'started');arm(s,0);return safe(s);
 }
 function arm(s,ms=s.budget.sampleMs){if(current(s)){cancel(s.timer);s.timer=schedule(()=>{void tick(s).catch(e=>failure(s,e));},ms);s.timer?.unref?.();}}
 function failure(s,error){if(!current(s)||error?.name==='AbortError')return;if(error?.code==='LOCAL_ANALYSIS_DEFERRED'){s.priorityWait=true;event(s,'deferred',{reason:'聊天或本地任务优先，等待空闲'});return;} s.error=String(error?.message||error).slice(0,500);event(s,'error',{error:s.error});if(++s.failures>=3){suspend(s,'error');void Promise.resolve(onError(s.context,s.error)).catch(()=>{});}}
 async function tick(s){
  if(!current(s)){if(s.status==='running')suspend(s,'stopped');return;}
  const chatBusy=busy(s.context);s.priorityWait=chatBusy;if(chatBusy){s.inference?.abort();if(s.options.target!=='phone'){arm(s);return;}}
  if(s.captureBusy)return;s.captureBusy=true;const captureController=new AbortController();s.captureController=captureController;
  try{
   const frame=await capture(s.options,{...s.context,signal:captureController.signal},s.budget);
   if(!current(s)||captureController.signal.aborted)return;
   if(frame.pending){
    s.sourceWait=String(frame.reason||'').slice(0,160);
    if(s.sourceWait){s.latest=null;s.pendingAudio=null;s.inference?.abort();s.error='';}
    return;
   }
   s.sourceWait='';
   if(frame.ended){suspend(s,'ended');return;}
   frame.capturedAt=Number(frame.capturedAt)||now();frame.digest=frame.digest||createHash('sha256').update(frame.data||JSON.stringify(frame.signature||frame)).digest('hex');
   if(observeAudio&&s.options.audio===true){frame.hearing=observeAudio(frame.audioChunk,s.context,s.options);delete frame.audioChunk;}
   if(frame.audioChunk)s.pendingAudio=frame.audioChunk;if(s.pendingAudio&&now()-s.pendingAudio.at<12000)frame.audioChunk=s.pendingAudio;
   if(s.latest)s.dropped++;s.latest=frame;s.captures++;
   if(!chatBusy&&!inferenceOwner&&!s.inferenceTask&&(s.pendingInputs.length||now()-s.lastInfer>=s.budget.inferMs)&&(s.pendingInputs.length||s.options.mode==='game'&&s.options.control||visualDistance(frame,s.lastFrame)>6||frame.subtitle!==s.lastFrame?.subtitle||frame.hearing?.sourceCapturedAt&&frame.hearing.sourceCapturedAt!==s.lastFrame?.hearing?.sourceCapturedAt||frame.audioChunk?.at&&frame.audioChunk.at!==s.lastFrame?.audioChunk?.at))launch(s);
  }catch(e){failure(s,e);}finally{if(s.captureController===captureController)s.captureController=null;s.captureBusy=false;arm(s);}
 }
 function launch(s){
  inferenceOwner=s;const requests=s.pendingInputs.splice(0);const frame={...s.latest,userInputs:requests,dialogue:s.messages.slice(-4),speechAllowed:requests.length>0||s.lastSpokeAt===undefined||now()-s.lastSpokeAt>=30000};s.latest=null;s.pendingAudio=null;s.lastFrame=frame;s.lastInfer=now();s.inference=new AbortController();const controller=s.inference;let inputSettled=false;
  s.inferenceTask=(async()=>{
   try{
    const result=await analyze(frame,s.options,{...s.context,signal:controller.signal},s.budget);if(!current(s)||controller.signal.aborted||busy(s.context))return;
    s.analyses++;s.analyzedAt=now();
    const stale=now()-frame.capturedAt>s.budget.maxAgeMs,changed=s.latest&&visualDistance(frame,s.latest)>35&&now()-frame.capturedAt>4000;
    const stillVisible=s.latest&&now()-s.latest.capturedAt<=s.budget.maxAgeMs&&visualDistance(frame,s.latest)<=6;
    const answeringSnapshot=requests.length>0&&!s.options.control;
    if((stale&&!stillVisible||changed)&&!answeringSnapshot){event(s,stale?'stale-result':'scene-changed');return;}
    if(answeringSnapshot&&(stale||changed))event(s,'snapshot-answer',{capturedAt:frame.capturedAt});
    if(requests.length&&(!result.say||!String(result.say).trim()))throw Error('本次输入没有取得可显示的回复');
    const action=visualGameAction(result.action,frame,s.options);
    if(action){await act(action,frame,s.options,{...s.context,signal:controller.signal});if(!current(s)||controller.signal.aborted)return;s.actions++;s.latest=null;event(s,'action',{action});}
    const say=typeof result.say==='string'?result.say.trim().slice(0,700):'';
    let said=false;
    if(say&&frame.speechAllowed&&(requests.length||say!==s.lastSay)){if(!current(s)||controller.signal.aborted||busy(s.context))return;await deliver(say,s.context,controller.signal);s.lastSay=say;s.lastSpokeAt=now();said=true;s.reactions++;s.messages.push({id:randomUUID(),role:'assistant',text:say,at:now(),state:'answered'});s.messages=s.messages.slice(-20);event(s,'reaction',{text:say});}
    for(const request of requests){const row=s.messages.find(m=>m.id===request.id);if(row)row.state='answered';}inputSettled=true;s.failures=0;s.error='';event(s,'analyzed',{observedAt:frame.capturedAt,said});
   }catch(e){if(controller.signal.aborted){s.lastFrame=null;event(s,'yielded-to-chat');}else failure(s,e);}
   finally{if(!inputSettled&&current(s))s.pendingInputs.unshift(...requests);if(inferenceOwner===s)inferenceOwner=null;if(controller.signal.aborted)s.lastFrame=null;s.inferenceTask=null;if(s.inference===controller)s.inference=null;}
  })();
 }
 function control(key,action){const s=sessions.get(key);if(!s)throw Error('当前没有持续视听会话');if(action==='status')return safe(s);if(action==='pause'||action==='stop'){suspend(s,action==='stop'?'stopped':'paused');return safe(s);}if(action==='resume'){if(!valid(s.context,s.options))throw Error('账号、人设、模式或设备条件已改变，请重新开始');if(s.status==='running')return safe(s);s.status='running';s.lastFrame=null;s.failures=0;s.error='';s.lastInfer=-Infinity;event(s,'resumed');arm(s,0);return safe(s);}throw Error('未知视听控制动作');}
 function submit(key,text){const s=sessions.get(key);if(!s||!current(s))throw Error('请先开始或继续视听陪伴，再输入文字');text=String(text||'').trim();if(!text||text.length>2000)throw Error('请输入1到2000字');if(s.pendingInputs.length>=12)throw Error('待处理的输入较多，请等当前回复完成');const request={id:randomUUID(),text,at:now()};s.pendingInputs.push(request);s.messages.push({...request,role:'user',state:'queued'});s.messages=s.messages.slice(-20);s.inference?.abort();event(s,'input',{text,id:request.id});return {accepted:true,id:request.id,state:'queued'};}
 return {start,control,submit,list:()=>[...sessions.values()].map(safe),authorizes:c=>{const s=sessions.get(c.key);return !!s&&s.id===c.visualSessionId&&current(s);},close(){closed=true;for(const s of sessions.values())suspend(s,'stopped');sessions.clear();}};
}
