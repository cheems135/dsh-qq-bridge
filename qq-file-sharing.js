import {basename} from 'node:path';import {fileURLToPath} from 'node:url';
export function prepareQqFileUpload(job,verify){
 const files=(job.segments||[]).filter(s=>s.type==='file');if(!files.length)return null;
 if(files.length!==1||job.segments.length!==1)throw Error('文件上传必须独立排队，不混入文字或其他媒体');
 const data=files[0].data||{},raw=String(data.file||''),file=raw.startsWith('file:')?fileURLToPath(raw):raw;
 if(!file||/^(?:https?:|base64:)/i.test(file))throw Error('只上传已核实的当前角色作品文件');
 const artifact=verify(file);if(!artifact?.file||!artifact.sha256)throw Error('作品文件尚未核实');
 if(data.sha256&&data.sha256!==artifact.sha256)throw Error('作品在排队后发生变化，未发送改变后的文件');
 if(!['private','group'].includes(job.kind)||!/^\d{5,20}$/.test(String(job.chatId)))throw Error('文件收件对象无效');
 const name=basename(artifact.file);if(!name||/[\x00-\x1f]/.test(name))throw Error('文件名无效');
 return {action:job.kind==='group'?'upload_group_file':'upload_private_file',params:{[job.kind==='group'?'group_id':'user_id']:Number(job.chatId)||job.chatId,file:artifact.file,name},timeoutMs:120000};
}
export function fileUploadAccepted(result,action){
 const data=result?.data||result||{};return {action,transport:'accepted',fileId:String(data.file_id||data.id||''),recipient:'unknown',read:'unknown',coverage:'文件上传接口已接受，未核实对方收到或下载；不自动重复上传'};
}
