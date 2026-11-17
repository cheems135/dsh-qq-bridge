import fs from 'node:fs';import path from 'node:path';
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
