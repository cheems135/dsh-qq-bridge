export function phoneConfig(v={}){v=v&&typeof v==='object'?v:{};const apps=Array.isArray(v.learningApps)?v.learningApps.filter(item=>['bilibili','douyin','heybox'].includes(item)):null;return {enabled:v.enabled!==false,autonomous:v.autonomous!==false,maxAutonomousPerDay:Math.min(10,Math.max(0,Number.isFinite(Number(v.maxAutonomousPerDay))?Math.round(Number(v.maxAutonomousPerDay)):2)),deviceId:String(v.deviceId||'').slice(0,64),learning:v.learning!==false,shareLearning:v.shareLearning!==false,learningComments:v.learningComments!==false,learningLimit:Math.min(3,Math.max(1,Number.isFinite(Number(v.learningLimit))?Math.round(Number(v.learningLimit)):1)),learningApps:apps?[...new Set(apps)]:['bilibili','douyin','heybox'],paymentMode:['saved','platform'].includes(v.paymentMode)?v.paymentMode:'manual',paymentMethod:['wechat','alipay'].includes(v.paymentMethod)?v.paymentMethod:'',maxAmount:Math.min(10000,Math.max(0,Number(v.maxAmount)||0)),dailyAmount:Math.min(100000,Math.max(0,Number(v.dailyAmount)||0))};}
export function redactPhoneXml(xml=''){return String(xml).replace(/<node\b[^>]*password="true"[^>]*>/g,node=>node.replace(/\b(?:text|content-desc)="[^"]*"/g,'text="[密码已隐藏]"')).slice(0,40000);}
export function paymentEvidence(xml,{amount,merchant,method},config){
  const n=Number(amount),body=String(xml),packages={wechat:'com.tencent.mm',alipay:'com.eg.android.AlipayGphone'};
  if(!packages[method]||method!==config.paymentMethod)throw Error('付款方式与本地设置不一致');
  if(!(n>0)||n>config.maxAmount||!(config.dailyAmount>0))throw Error('请在手机设置中配置适用的单笔和每日金额');
  if(!String(merchant||'').trim()||!body.includes(merchant))throw Error('当前页面没有核实到该商户');
  if(!/(?:支付|付款|收银|确认订单)/.test(body))throw Error('当前不是可核对的订单或付款页面');
  const amounts=[...body.matchAll(/(?:¥|￥|金额[:：]?\s*|实付[:：]?\s*|合计[:：]?\s*)(\d+(?:\.\d{1,2})?)/g)].map(m=>Number(m[1]));
  if(!amounts.includes(n))throw Error('没有从当前页面核实到指定金额，未授权输入密码');
  return {amount:n,merchant:String(merchant).slice(0,100),method,package:packages[method]};
}
