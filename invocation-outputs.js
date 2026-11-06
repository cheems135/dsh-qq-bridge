import {createReadStream,openSync,readSync,closeSync,realpathSync,statSync} from 'node:fs';
import {basename,extname,isAbsolute,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const types={'.png':['image','image/png'],'.jpg':['image','image/jpeg'],'.jpeg':['image','image/jpeg'],'.webp':['image','image/webp'],'.gif':['image','image/gif'],'.wav':['speech','audio/wav'],'.mp3':['speech','audio/mpeg'],'.ogg':['speech','audio/ogg'],'.flac':['speech','audio/flac'],'.m4a':['speech','audio/mp4'],'.mp4':['video','video/mp4'],'.webm':['video','video/webm'],'.mov':['video','video/quicktime']};
function localFile(value){try{if(typeof value!=='string')return '';if(value.startsWith('file:'))return resolve(fileURLToPath(value));return isAbsolute(value)?resolve(value):'';}catch{return '';}}
export function invocationOutputFiles(row){
 const found=[],seen=new Set();
 const add=value=>{const file=localFile(typeof value==='string'?value:value?.file||value?.path);if(file&&!seen.has(file)&&types[extname(file).toLowerCase()]){seen.add(file);found.push(file);}};
 const scan=(value,depth=0)=>{if(!value||depth>3)return;if(typeof value==='string'){add(value);return;}if(Array.isArray(value)){value.slice(0,24).forEach(v=>scan(v,depth+1));return;}if(typeof value==='object'){add(value);for(const key of ['files','media','attachments','value','result'])if(value[key])scan(value[key],depth+1);}};
 scan(row.result);return found.slice(0,12);
}
function inspect(file,roots){
 try{
  const actual=realpathSync(file),allowed=roots.filter(Boolean).some(root=>{try{const rel=relative(realpathSync(resolve(root)),actual);return !!rel&&rel!=='..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);}catch{return false;}});
  if(!allowed)return {available:false,reason:'结果不在已登记的媒体目录内'};
  const info=statSync(actual);if(!info.isFile()||!info.size||info.size>512*1024*1024)return {available:false,reason:'结果文件为空或超出预览大小'};
  const [kind,mime]=types[extname(actual).toLowerCase()]||[];if(!kind)return {available:false,reason:'此文件格式不支持预览'};
  const fd=openSync(actual,'r'),head=Buffer.alloc(16);try{readSync(fd,head,0,head.length,0);}finally{closeSync(fd);}
  const ext=extname(actual).toLowerCase(),valid=ext==='.png'?head.subarray(0,8).toString('hex')==='89504e470d0a1a0a':['.jpg','.jpeg'].includes(ext)?head[0]===255&&head[1]===216:ext==='.webp'?head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP':ext==='.gif'?/^GIF8[79]a/.test(head.toString('ascii')):ext==='.wav'?head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WAVE':ext==='.mp3'?head.toString('ascii',0,3)==='ID3'||head[0]===255&&(head[1]&224)===224:ext==='.ogg'?head.toString('ascii',0,4)==='OggS':ext==='.flac'?head.toString('ascii',0,4)==='fLaC':ext==='.webm'?head.subarray(0,4).toString('hex')==='1a45dfa3':head.toString('ascii',4,8)==='ftyp';
  return valid?{available:true,file:actual,bytes:info.size,kind,mime}:{available:false,reason:'文件内容与媒体格式不符'};
 }catch{return {available:false,reason:'结果文件已清理或暂时无法读取'};}
}
function deliveryFor(row,file,outbox){
 const jobs=outbox.filter(job=>job.accountId===row.accountId&&(!row.chat||job.chat===row.chat)&&(!row.auditId||job.auditId===row.auditId)&&(job.segments||[]).some(s=>localFile(s.data?.file)===file));
 if(!jobs.length)return {status:'unrecorded',messageIds:[]};
 const statuses=jobs.map(j=>j.status==='sent'&&!j.messageId?'unknown':j.status),status=statuses.includes('sent')?'sent':statuses.includes('sending')?'sending':statuses.includes('queued')?'queued':statuses.includes('unknown')?'unknown':statuses.includes('failed')?'failed':statuses.at(-1);
 return {status,messageIds:jobs.filter(j=>j.status==='sent'&&j.messageId).map(j=>String(j.messageId)),outboxIds:jobs.map(j=>j.id)};
}
export function invocationOutputs(row,{roots=[],outbox=[]}={}){
 return invocationOutputFiles(row).map((file,index)=>{const info=inspect(file,roots);return {index,name:basename(file),kind:info.kind||types[extname(file).toLowerCase()]?.[0],available:info.available,bytes:info.bytes,reason:info.reason,url:info.available?'/im-bridge/invocation-output?id='+encodeURIComponent(row.id)+'&index='+index:'',delivery:deliveryFor(row,file,outbox)};});
}
export function serveInvocationOutput(req,res,{rows=[],roots=[]}={}){
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 const query=new URL(req.url,'http://localhost').searchParams,index=Number(query.get('index'));
 const row=rows.find(r=>r.id===query.get('id')),file=row&&Number.isInteger(index)&&index>=0?invocationOutputFiles(row)[index]:'';
 const info=file?inspect(file,roots):{available:false};
 if(!info.available){res.writeHead(404,{'Cache-Control':'no-store'});res.end('结果文件不可用');return;}
 const headers={'Content-Type':info.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(basename(info.file))};
 let start=0,end=info.bytes-1,status=200;
 if(req.headers.range){const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!match||!match[1]&&!match[2]){res.writeHead(416,{'Content-Range':'bytes */'+info.bytes});res.end();return;}if(!match[1])start=Math.max(0,info.bytes-Number(match[2]));else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=info.bytes){res.writeHead(416,{'Content-Range':'bytes */'+info.bytes});res.end();return;}status=206;headers['Content-Range']='bytes '+start+'-'+end+'/'+info.bytes;}
 headers['Content-Length']=end-start+1;res.writeHead(status,headers);if(req.method==='HEAD'){res.end();return;}
 const stream=createReadStream(info.file,{start,end});stream.on('error',()=>res.destroy());res.on('close',()=>stream.destroy());stream.pipe(res);
}
