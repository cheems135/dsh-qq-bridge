const text=(v,n=160)=>String(v??'').trim().slice(0,n);
const pathPattern=/^(?:[A-Za-z_$][\w$]*|\d+)(?:\.(?:[A-Za-z_$][\w$]*|\d+))*$/;
function fieldPath(value,required=false){const p=text(value,240);if(!p&&!required)return '';if(!pathPattern.test(p)||p.split('.').some(k=>['__proto__','constructor','prototype'].includes(k)))throw Error('余额字段请使用点分隔路径，例如 data.balance 或 balance_infos.0.total_balance');return p;}
function endpoint(value,base){const u=new URL(text(value,1000),base.replace(/\/$/,'')+'/'),origin=new URL(base);if(!['http:','https:'].includes(u.protocol)||u.origin!==origin.origin||u.username||u.password||u.search||u.hash)throw Error('余额接口必须与当前服务同站点，不含密钥、查询参数或片段');return u.pathname;}
export function normalizeBalanceConfig(value,base){
 if(!value?.endpoint)return null;
 const currency=text(value.currency,24);if(currency&&/[<>\x00-\x1f]/.test(currency))throw Error('余额单位无效');
 const cfg={endpoint:endpoint(value.endpoint,base),method:value.method==='POST'?'POST':'GET',rowsPath:fieldPath(value.rowsPath),amountPath:fieldPath(value.amountPath,true),currencyPath:fieldPath(value.currencyPath),currency,kind:['money','points','quota'].includes(value.kind)?value.kind:'money',divisor:Number(value.divisor??1)};
 if(!cfg.currencyPath&&!currency)throw Error('请填写接口返回的币种字段或文档确认的固定单位');
 if(!Number.isFinite(cfg.divisor)||cfg.divisor<=0)throw Error('余额单位换算除数必须大于0');
 if(value.body!==undefined&&value.body!==''){const body=typeof value.body==='string'?JSON.parse(value.body):value.body;if(!body||typeof body!=='object'||Array.isArray(body)||JSON.stringify(body).length>4096)throw Error('余额查询正文必须是小于4KB的JSON对象');cfg.body=body;}
 return cfg;
}
function get(value,path){for(const k of path.split('.')){if(value===null||typeof value!=='object'||!Object.hasOwn(value,k))return undefined;value=value[k];}return value;}
function numeric(value){return ['number','string'].includes(typeof value)&&String(value).trim()!==''&&/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(String(value).trim())&&Number.isFinite(Number(value));}
export async function readServiceBalance(profile,{fetchImpl=globalThis.fetch,signal}={}){
 let cfg=normalizeBalanceConfig(profile.balance,profile.baseUrl);
 // Only use an automatic endpoint when its host and response contract are documented.
 if(!cfg&&new URL(profile.baseUrl).hostname==='api.deepseek.com')cfg=normalizeBalanceConfig({endpoint:'/user/balance',rowsPath:'balance_infos',amountPath:'total_balance',currencyPath:'currency'},profile.baseUrl);
 if(!cfg)return {status:'unsupported',reason:'此连接尚未配置余额查询；生成协议兼容不代表余额接口也相同，不估算剩余余额'};
 const headers={accept:'application/json',...(profile.apiKey?(profile.type==='anthropic'?{'x-api-key':profile.apiKey,'anthropic-version':'2023-06-01'}:{authorization:'Bearer '+profile.apiKey}):{})};
 const response=await fetchImpl(new URL(cfg.endpoint,profile.baseUrl).href,{method:cfg.method,headers:cfg.method==='POST'?{...headers,'content-type':'application/json'}:headers,...(cfg.method==='POST'?{body:JSON.stringify(cfg.body||{})}:{}),redirect:'error',signal:AbortSignal.any([AbortSignal.timeout(15000),...(signal?[signal]:[])])});
 if(!response.ok){await response.body?.cancel?.();throw Error('余额查询 HTTP '+response.status);}
 let raw='';if(response.body){const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>1024*1024)throw Error('余额响应过大');chunks.push(Buffer.from(chunk));}raw=Buffer.concat(chunks).toString('utf8');}else raw=await response.text();
 if(Buffer.byteLength(raw)>1024*1024)throw Error('余额响应过大');const body=JSON.parse(raw);
 if(body?.success===false||body?.error||body?.status==='error'||body?.code!==undefined&&!['0','200'].includes(String(body.code)))return {status:'unknown',reason:'接口返回失败状态，未采用其中余额字段'};
 const rows=cfg.rowsPath?get(body,cfg.rowsPath):[body];
 if(!Array.isArray(rows)||!rows.length||rows.length>100)return {status:'unknown',reason:'接口未返回配置的余额记录，不代表零'};
 const entries=[];for(const row of rows){const amount=get(row,cfg.amountPath),currency=cfg.currencyPath?get(row,cfg.currencyPath):cfg.currency;if(!numeric(amount)||typeof currency!=='string'||!currency.trim()||currency.length>24||/[<>\x00-\x1f]/.test(currency))return {status:'unknown',reason:'余额数值或单位缺失/无效，未猜测或换算'};entries.push({amount:cfg.divisor===1?String(amount).trim():String(Number(amount)/cfg.divisor),currency:currency.trim(),kind:cfg.kind});}
 return {status:'ok',entries,reason:'来自当前连接的余额接口；不同币种和配额不相加，未推算可生成次数'};
}
