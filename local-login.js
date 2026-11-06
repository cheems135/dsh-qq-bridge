// Local QQ authentication is independent of which device owns the chat bridge.
export async function performLocalLogin({action,qq,readStatus,napcat,client,getQr,refreshQr,isStopped=()=>false,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  if(!['start','restart'].includes(action))throw Error('不支持的本机登录操作');
  const hasAccount=/^\d{5,12}$/.test(String(qq||''));
  const check=()=>{if(isStopped())throw Error('插件已停止，本次登录操作已取消');};
  check();
  if(action==='restart'){
    if(!hasAccount)throw Error('无法确认当前机器人账号，未停止任何 QQ 进程；请先扫码登录或配置账号');
    await napcat.stop();await delay(900);check();
    const result=await napcat.start();
    return{...result,via:'restart',message:'已重新启动本机QQ登录服务。是否登录成功以QQ状态为准。'};
  }
  const current=await readStatus();check();
  if(current.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};
  if(!current.webuiReachable){if(!hasAccount)throw Error('请先在 NapCat 启动 QQ 登录窗口，或配置机器人账号后再启动');return napcat.start();}
  let history=[];
  try{history=await client.getQuickLoginList();}catch(error){if(['WEBUI_2FA','WEBUI_AUTH','AUTH_EXPIRED'].includes(error.code))throw error;}
  check();
  if(hasAccount&&history.includes(String(qq))&&current.status!=='qrcode_scanned'){
    try{await client.setQuickLogin(String(qq));check();return{scheduled:true,started:false,message:'已请求使用本机历史登录记录；需要验证时请在QQ完成。'};}
    catch(error){check();const latest=await readStatus();if(latest.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};if(['WEBUI_2FA','WEBUI_AUTH','AUTH_EXPIRED'].includes(error.code))throw error;}
  }
  const latest=await readStatus();check();
  if(latest.qqLoggedIn===true)return{already:true,started:false,scheduled:false,message:'本机QQ已登录。'};
  if(latest.status==='qrcode_scanned')return{scheduled:true,started:false,message:'二维码已扫描，请在手机QQ完成登录确认。'};
  const qr=await getQr();check();
  if(!qr.available){try{await refreshQr();check();}catch(error){if(error.code!=='QR_NOT_READY')throw error;}}
  return{scheduled:true,started:false,message:'本机QQ登录服务正在运行，请扫描当前二维码并在手机确认。'};
}
