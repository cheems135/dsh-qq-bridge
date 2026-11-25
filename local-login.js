// NapCat constructs bot_offline from QQ's onKickedOffLine(tipsTitle, tipsDesc).
// Other notices, chat content, WebUI errors and transport failures have no such authority.
export function manualLoginNotice(payload, receiver) {
  if (!/^\d{5,20}$/.test(String(receiver || '')) || payload?.post_type !== 'notice' ||
      payload.notice_type !== 'bot_offline' || String(payload.self_id) !== String(receiver) ||
      String(payload.user_id) !== String(receiver) || typeof payload.message !== 'string' ||
      typeof payload.tag !== 'string' || !Number.isSafeInteger(payload.time) || payload.time <= 0) return '';
  const reason = payload.tag.slice(0,100) + ' ' + payload.message.slice(0,1000);
  if (/(?:[帐账]号|账户)(?:目前|当前|现)?(?:已被|已|被暂时|暂被)(?:冻结|封禁|限制登录)/u.test(reason)) return 'QQ 通知当前账号已受限';
  if (/(?<![不无])(?:请|需要|必须)(?:您|你)?(?:先)?(?:在手机(?:QQ|上))?(?:进行|完成|通过)?(?:身份验证|安全验证|安全校验)/u.test(reason)) return 'QQ 要求完成账号验证';
  if (/(?<![不无])(?:请|需要|必须)(?:您|你)?重新登[录陆]/u.test(reason)) return 'QQ 要求重新登录';
  return '';
}

export function loginHold(state, accountId) {
  return Array.isArray(state.qqLoginHolds) && state.qqLoginHolds.find(row => row?.accountId === accountId && row.active);
}

export function recordLoginHold(state, accountId, receiver, time, reason) {
  const rows = Array.isArray(state.qqLoginHolds) ? state.qqLoginHolds.filter(row => row && typeof row === 'object') : [];
  const prior = rows.find(row => row.accountId === accountId);
  if (prior?.active && prior.source === 'user') return false;
  const previousReceiver=prior?.source==='user'?prior.noticeReceiver:prior?.receiver;
  if (previousReceiver === receiver && prior.time >= time) return false;
  state.qqLoginHolds = [...rows.filter(row => row.accountId !== accountId), {accountId,receiver,time,reason,active:true}];
  return true;
}

export function recordUserLoginHold(state, accountId, receiver='') {
  const rows = Array.isArray(state.qqLoginHolds) ? state.qqLoginHolds : [];
  const prior = rows.find(row => row?.accountId === accountId);
  if (prior?.active && prior.source === 'user') return false;
  const noticeReceiver=prior?.source==='user'?prior.noticeReceiver:prior?.receiver;
  state.qqLoginHolds = [...rows.filter(row => row && row.accountId !== accountId),
    {accountId,...(/^\d{5,20}$/.test(receiver)?{receiver}:{}),...(noticeReceiver&&prior.time?{noticeReceiver,time:prior.time}:{}),
      source:'user',reason:'已手动标记此 QQ 账号受限',active:true}];
  return true;
}

export function preserveLoginWindow(status) {
  if (!status || status.isLogin && !status.isOffline) return false;
  return status.hasLoginError === true || status.qrLoginAccepted === true ||
    ['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing'].includes(status.loginPhase);
}

export function loginControlRequestStatus(req) {
  if (req.method !== 'POST') return 405;
  if (req.headers?.origin === undefined) return 200;
  try {
    const origin=new URL(req.headers.origin);
    const expected=new URL((req.socket?.encrypted?'https://':'http://')+req.headers.host);
    return origin.origin===expected.origin?200:403;
  } catch { return 403; }
}

export function releaseLoginHold(state, accountId) {
  const hold = loginHold(state, accountId);
  if (hold) hold.active = false;
}

// A WebSocket upgrade alone does not identify the QQ receiving messages.
export function hasQQReceiver(socket, accountId) {
  return socket?.ready === true && socket.qqOnline !== false &&
    socket.qqAccountId === accountId && /^\d{5,20}$/.test(socket.qqSenderId || '');
}

export function hasActiveLoginWindow(state) {
  return state.webuiReachable && state.qqLoggedIn !== true &&
    (state.hasLiveQr === true || ['waiting_qrcode','generating_qrcode','qrcode_scanned','initializing'].includes(state.status));
}

export function currentQQLoginView({state, qr, verified, transportOpen, processFault, startupPhase, local}) {
  const activeLogin=hasActiveLoginWindow(state);
  const qqLoggedIn=verified?true:state.qqLoggedIn;
  const startupError=verified||state.qqLoggedIn===true||activeLogin?'':processFault||'';
  const loginPhase=verified?'ready':activeLogin?(state.status==='offline'?'waiting_qrcode':state.status):
    state.qqLoggedIn===true?'waiting_bridge':transportOpen?'verifying_receiver':
    startupError==='QQ_FILE_DAMAGED'?'qq_files_reported_damaged':
    startupError==='QQ_PROCESS_ENDED'?'qq_process_ended':startupPhase||state.status;
  return {qqLoggedIn,loginPhase,startupError,
    canScan:local&&!verified&&activeLogin&&state.status!=='qrcode_scanned'&&state.status!=='initializing',
    qrAvailable:local&&!verified&&activeLogin&&qr.available===true};
}

export async function startDesktopIfNeeded({canStart, transportReady, readStatus, start,quickLogin,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
  if (!canStart() || transportReady()) return false;
  let status = await readStatus(),started=false;
  if (!canStart() || transportReady() || status.qqLoggedIn === true) return false;
  if(!status.webuiReachable){await start();started=true;}
  if(typeof quickLogin!=='function')return started;
  // One saved-account attempt per startup. Never interrupt a scanned QR,
  // account verification or another account's already active login.
  for(let attempt=0;attempt<8;attempt++){
    if(!canStart()||transportReady()||status.qqLoggedIn===true||status.status==='account_mismatch'||status.hasLoginError||['qrcode_scanned','initializing'].includes(status.status))return started;
    if(status.webuiReachable&&(status.coreReady!==false||hasActiveLoginWindow(status))){await quickLogin();return started;}
    await delay(1000);if(!canStart()||transportReady())return started;
    status=await readStatus();
  }
  return started;
}

// Local QQ authentication is independent of which device owns the chat bridge.
export async function performLocalLogin({action,qq,readStatus,napcat,client,getQr,refreshQr,isStopped=()=>false,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  if(!['start','restart'].includes(action))throw Error('不支持的本机登录操作');
  const hasAccount=/^\d{5,12}$/.test(String(qq||''));
  const check=()=>{if(isStopped())throw Error('插件已停止，本次登录操作已取消');};
  check();
  if(action==='restart'){
    if(!hasAccount)throw Error('无法确认当前机器人账号，未停止任何 QQ 进程；请先扫码登录或配置账号');
    await napcat.stop();await delay(900);check();
    const result=await napcat.start({manualVerification:true});
    return{...result,via:'restart',message:'已重新启动本机QQ登录服务。是否登录成功以QQ状态为准。'};
  }
  const current=await readStatus();check();
  if(current.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};
  if(current.status==='account_mismatch')throw Error(current.error||'请先切换到当前配置对应的机器人账号。');
  if(!current.webuiReachable){if(!hasAccount)throw Error('请先在 NapCat 启动 QQ 登录窗口，或配置机器人账号后再启动');return napcat.start({manualVerification:true});}
  if(current.status==='qrcode_scanned'||current.status==='initializing')return{scheduled:true,started:false,message:'QQ 正在完成登录，请在手机 QQ 查看确认提示。'};
  if((current.coreReady===false||current.status==='core_not_ready')&&!hasActiveLoginWindow(current)){
    throw Error('QQ 登录服务尚未就绪，请重启当前账号的登录服务。');
  }
  let history=[];
  try{history=await client.getQuickLoginList();}catch(error){if(['WEBUI_2FA','WEBUI_AUTH','AUTH_EXPIRED'].includes(error.code))throw error;}
  check();
  if(hasAccount&&history.includes(String(qq))&&current.status!=='qrcode_scanned'){
    try{await client.setQuickLogin(String(qq));check();let remembered=false;
      if(typeof client.setQuickLoginAccount==='function')try{await client.setQuickLoginAccount(String(qq));remembered=true;}catch{}
      check();return{scheduled:true,started:false,remembered,message:'已请求使用本机历史登录记录；'+(remembered?'已保存下次启动使用的账号。':'')+'需要验证时请在QQ完成。'};}
    catch(error){check();const latest=await readStatus();if(latest.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};if(['WEBUI_2FA','WEBUI_AUTH','AUTH_EXPIRED'].includes(error.code))throw error;}
  }
  const latest=await readStatus();check();
  if(latest.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};
  if(latest.status==='qrcode_scanned')return{scheduled:true,started:false,message:'二维码已扫描，请在手机QQ完成登录确认。'};
  const qr=await getQr();check();
  if(!qr.available){await refreshQr();check();const fresh=await getQr();if(!fresh.available)throw Error('QQ 尚未生成可用二维码，不能确认登录已准备好，请稍后检查或重启本机 QQ / NapCat。');}
  return{scheduled:true,started:false,message:'本机QQ登录服务正在运行，请扫描当前二维码并在手机确认。'};
}
