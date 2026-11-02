export function rechargeAmount(value){const n=Number(value);if(!Number.isFinite(n)||n<=0||n>10000||Math.abs(n*100-Math.round(n*100))>1e-6)throw Error('先确定本次要充多少元，金额需在0.01到10000元之间');return n.toFixed(2);}
export function nativeRechargeEntry(state){
 const url=new URL(state?.links?.topUpUrl||'https://invalid.invalid');
 if(state?.status!=='credential-stored'||url.protocol!=='https:'||url.username||url.password||url.pathname!=='/top_up')throw Error('Harness账号尚未登录或没有有效的官方充值入口');
 return {url:url.href,service:'DeepSeek Harness',currency:'CNY',loggedIn:true};
}
export function rechargeLow(snapshot){return (snapshot?.accounts||[]).some(a=>a.id==='chat'&&a.status==='ok'&&!a.stale&&['low','empty'].includes(a.state));}
export const RECHARGE_RULES='【口粮与充值】只有查到真实低余额，才可自己斟酌向本人要一点口粮；用当前人设自然说清这次想充多少人民币、充到Harness还是其他接口。Harness余额与独立API Key余额不是同一钱包，不能拿错二维码。本人拒绝或无回应就等待，不反复催促。查不到余额不等于余额为零。充值页面按实际选项选择金额，支付二维码必须含同一实际金额并核对收款服务，不能自画二维码或从其他联系人拿收款码。只把真实码发给本人，扫码付款由本人完成；生成二维码、打开支付页面、排队发送都不代表充值成功，最后重新查余额或订单回执。';
