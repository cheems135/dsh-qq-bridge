// Plugin-owned loopback IPC for its local CLI. DSHBox's web authentication stays intact.
import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
export async function createMobileEndpoint({dataDir,act,status}){
  const token=randomBytes(32).toString('hex'),file=join(dataDir,'phone-endpoint.json');
  const reply=(res,code,body)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(body));};
  const server=createServer((req,res)=>{
    const supplied=Buffer.from(String(req.headers.authorization||'')),expected=Buffer.from('Bearer '+token);
    if(req.headers.origin||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return reply(res,401,{error:'需要本机客户端凭据'});
    if(req.method==='GET'&&req.url==='/status')return reply(res,200,status());
    if(req.method!=='POST'||req.url!=='/im-bridge/features/phone')return reply(res,404,{error:'不存在的本机操作'});
    let body='',large=false;req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>65536){large=true;req.destroy();}});
    req.on('end',async()=>{if(large)return;try{const value=JSON.parse(body||'{}');if(value.source!=='agent'||typeof value.sessionId!=='string'||!value.sessionId)throw Error('需要有效的号主会话');if(['save-password','clear-password'].includes(value.action))throw Error('请在本地面板设置密码');reply(res,200,await act(value));}catch(error){reply(res,400,{error:String(error.message||error).slice(0,500)});}});
  });
  server.requestTimeout=300000;server.headersTimeout=15000;server.maxConnections=8;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});server.unref();
  mkdirSync(dataDir,{recursive:true});writeFileSync(file,JSON.stringify({origin:'http://127.0.0.1:'+server.address().port,token}),{mode:0o600});
  return()=>{server.close();try{if(JSON.parse(readFileSync(file,'utf8')).token===token)unlinkSync(file);}catch{}};
}
