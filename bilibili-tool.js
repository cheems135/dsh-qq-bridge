// Both local and API agents call the same account service. Local turns return
// media to their final QQ sender; API turns enqueue the QR via the host outbox.
export function createBilibiliTool({service, sendQr} = {}) {
  const queued = new Map();
  return async (args, context) => {
    const raw = await service.act(args, context);
    const {qrImage, qrFile, qrUrl, login, ...result} = raw;
    if (login) result.login = {status:login.status, expiresAt:login.expiresAt};
    if (!qrFile) return result;
    if (context.localTurn) return {...result, media:[{kind:'image',file:qrFile}], coverage:'本轮实际登录二维码将随本地回复进入 QQ 发送队列，请用手机 B站扫码并确认；无需重复生成。'};
    if (context.panel) return {...result, loginPage:'/im-bridge/console#bilibili', coverage:'请打开桥接控制台的 B站功能页扫描当前二维码，面板试聊未自动发 QQ。'};
    const key=JSON.stringify([context.accountId,context.personaId,context.key,qrFile]);
    for(const [id,row] of queued)if(row.expiresAt<Date.now())queued.delete(id);
    let delivery=queued.get(key);
    if(!delivery){
      if(typeof sendQr!=='function')throw Error('当前 QQ 二维码发送服务不可用，请在 B站功能页扫码');
      delivery={expiresAt:result.expiresAt||Date.now()+180000};
      delivery.promise=Promise.resolve().then(()=>sendQr(qrFile,context,key)).then(deliveryId=>{
        if(!deliveryId)throw Error('二维码未能进入 QQ 发送队列，请在 B站功能页扫码');
        return deliveryId;
      }).catch(error=>{if(queued.get(key)===delivery)queued.delete(key);throw error;});
      queued.set(key,delivery);
    }
    return {...result,qrDelivery:{status:'queued',id:await delivery.promise},coverage:'真实二维码已进入当前 QQ 私聊的可靠发送队列，平台回执后才算送达。请用手机 B站扫码确认，再检查登录状态；不要重复生成二维码或发送文件路径。'};
  };
}
