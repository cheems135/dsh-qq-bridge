// The DSH owner's native tools use this local client; no payment password is returned.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const args=process.argv.slice(2),values={};
for(let i=0;i<args.length;i+=2)values[args[i].replace(/^--/,'')]=args[i+1];
try{
 const file=values['endpoint-file']||path.join(process.env.DSH_HOME||path.join(os.homedir(),'.dsh'),process.platform==='win32'?'im-bridge':'im-bridge-mobile','phone-endpoint.json');
 const endpoint=JSON.parse(fs.readFileSync(file,'utf8')),url=new URL(endpoint.origin);
 if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw Error('手机控制服务地址无效');
 const body=values.request?JSON.parse(fs.readFileSync(values.request,'utf8')):{...values};
 delete body.request;delete body['endpoint-file'];body.source='agent';body.sessionId=values.session||body.sessionId;
 const response=await fetch(url.origin+'/im-bridge/features/phone',{method:'POST',headers:{'content-type':'application/json',...(endpoint.token?{authorization:'Bearer '+endpoint.token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(body.action==='read-video'?420000:['learn-apps','learn-app'].includes(body.action)?180000:60000)});
 const result=await response.json();console.log(JSON.stringify(result));if(!response.ok)process.exitCode=1;
}catch{console.error('手机操作未完成；请在桥接自主页检查连接，或使用请求文件传入参数。');process.exitCode=1;}
