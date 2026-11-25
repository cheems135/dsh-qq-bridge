import fs from 'node:fs';import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
function availablePort(host,port) {
 return new Promise(resolve=>{
  const server=createServer();
  server.once('error',()=>resolve(false));
  server.listen({host,port,exclusive:true},()=>server.close(()=>resolve(true)));
 });
}

export async function ensureLocalListener({client,wsUrl,expectedQQ,current,available=availablePort}) {
 const url=new URL(wsUrl), host=url.hostname==='[::1]'?'::1':url.hostname==='localhost'?'127.0.0.1':url.hostname;
 if(url.protocol!=='ws:'||!['127.0.0.1','::1'].includes(host)||url.pathname!=='/'||url.search||url.hash||url.username||url.password)return null;
 const port=Number(url.port)||80;
 if(!current())return null;
 const status=await client.getStatus();
 if(!current()||!status.isLogin||status.isOffline||status.hasLoginError)return null;
 const {uin}=await client.getLoginInfo();
 if(!current()||!/^\d{5,12}$/.test(uin)||expectedQQ&&expectedQQ!==uin)return null;
 const config=await client.getOneBotConfig();
 if(!current())return null;
 const servers=config?.network?.websocketServers;
 if(!Array.isArray(servers))throw Error('本机连接配置格式无法确认，请检查 NapCat 的网络配置。');
 const match=servers.find(s=>s.enable===true&&Number(s.port)===port&&(!s.path||s.path==='/'));
 if(match)return {qq:uin,created:false};
 if(servers.length)throw Error('当前 QQ 已有自定义 WebSocket 配置，请在账号与连接里核对端口及启用状态。');
 if(!await available(host,port))throw Error('桥接端口已被占用，请在账号与连接里核对端口。');
 const entry={name:'qq-bridge-local',enable:true,host,port,messagePostFormat:'array',reportSelfMessage:false,token:randomBytes(32).toString('hex'),enableForcePushEvent:true,debug:false,heartInterval:30000};
 const latest=await client.getOneBotConfig();
 if(!current()||JSON.stringify(latest)!==JSON.stringify(config)||(await client.getLoginInfo()).uin!==uin||!current())return null;
 await client.saveOneBotConfig({...latest,network:{...latest.network,websocketServers:[entry]}});
 if(!current()||(await client.getLoginInfo()).uin!==uin||!current())return null;
 const back=await client.getOneBotConfig();
 if(!current())return null;
 if(!back?.network?.websocketServers?.some(s=>s.enable===true&&s.host===host&&Number(s.port)===port&&s.token===entry.token))throw Error('本机连接已提交，NapCat 尚未确认配置。');
 return {qq:uin,created:true};
}

export function localOneBotAccount({wsUrl,napcatDir,token},io=fs){
 if(!token)return '';
 try{const ids=io.readdirSync(path.join(napcatDir,'config')).map(n=>/^onebot11_(\d{5,12})\.json$/.exec(n)?.[1]).filter(Boolean).filter(qq=>localOneBotBinding({wsUrl,napcatDir,qq},io.readFileSync.bind(io))?.token===token);return ids.length===1?ids[0]:'';}catch{return '';}
}
export function localOneBotBinding({wsUrl,napcatDir,qq},readFile=fs.readFileSync){
 try{
  const url=new URL(wsUrl);if(!['ws:','wss:'].includes(url.protocol)||!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!/^\d{5,12}$/.test(String(qq)))return null;
  const config=JSON.parse(readFile(path.join(napcatDir,'config','onebot11_'+qq+'.json'),'utf8'));
  const port=Number(url.port)||(url.protocol==='wss:'?443:80),server=config.network?.websocketServers?.find(s=>s.enable===true&&Number(s.port)===port&&(!s.path||s.path===url.pathname));
  return server?{token:String(server.token||''),port}:null;
 }catch{return null;}
}
