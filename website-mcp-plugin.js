import {readFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createWebsiteMcp} from './website-mcp.js';
import {redactInvocation} from './invocation-journal.js';

export function installWebsiteMcpPlugin({ctx,dataDir,writeAtomic,getScope,onRecord=()=>{},scriptFile,nodePath=process.execPath,request}) {
  const manifest=join(dataDir,'website-mcp.json');
  const manager=createWebsiteMcp({request,storage:{read(){try{if(statSync(manifest).size>4*1024*1024)throw Error('网站配置文件过大');return JSON.parse(readFileSync(manifest,'utf8'));}catch(e){if(e.code==='ENOENT')return {version:1,sites:[]};throw e;}},write:value=>writeAtomic(manifest,value)},onRecord});
  const server=ctx.get('webServer');
  if(server)ctx.effect(()=>server.register({kind:'exact',path:'/im-bridge/website-mcp',handler(req,res){
    const send=(status,value)=>{if(!res.writableEnded){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(value));}};
    const host=req.headers.host;
    try{if(req.headers.origin&&new URL(req.headers.origin).host!==host)return send(403,{error:'拒绝跨站网站工具操作'});}catch{return send(403,{error:'来源地址无效'});}
    if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'拒绝跨站网站工具操作'});
    if(req.method==='GET'){
      try {
        const scope=getScope();let externalRecords=[];
        const logFile=manifest+'.calls.ndjson';
        if(existsSync(logFile)&&statSync(logFile).size<=4*1024*1024)externalRecords=readFileSync(logFile,'utf8').split('\n').filter(Boolean).slice(-200).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).filter(row=>row.accountId===scope.accountId).slice(-60).map(redactInvocation);
        return send(200,{accountId:scope.accountId,sites:manager.list(scope),tools:manager.tools(scope),externalRecords});
      }catch{return send(500,{error:'网站工具配置暂时无法读取，请检查文件权限或配置格式'});}
    }
    if(req.method!=='POST')return send(405,{error:'请使用 GET 或 POST'});
    let body='',oversized=false;req.setEncoding('utf8');
    req.on('data',chunk=>{if(oversized)return;body+=chunk;if(Buffer.byteLength(body)>65536){oversized=true;body='';send(413,{error:'请求过大'});}});
    req.on('end',()=>{if(oversized)return;void(async()=>{
      try {
        const input=JSON.parse(body||'{}'),scope=getScope(),options={signal:AbortSignal.timeout(45000)};
        let result;
        if(input.action==='inspect')result=await manager.inspect(input.url,scope,options);
        else if(input.action==='save')result={site:manager.save(input.previewId,scope)};
        else if(input.action==='toggle')result=manager.change(input.id,scope,{enabled:input.enabled});
        else if(input.action==='remove')result=manager.change(input.id,scope,{remove:true});
        else if(input.action==='test')result=await manager.test(input.previewId,input.name,input.arguments||{},scope,options);
        else if(input.action==='call')result=await manager.call(input.name,input.arguments||{},scope,options);
        else if(input.action==='export')result={config:{mcpServers:{'qq-websites':{command:nodePath,args:[scriptFile,'--manifest',manifest,'--account',scope.accountId||'']}}}};
        else throw Error('未知网站工具操作');
        send(200,{ok:true,...result});
      }catch(e){send(400,{error:String(e.message).slice(0,240)});}
    })();});
  }}));
  return manager;
}
