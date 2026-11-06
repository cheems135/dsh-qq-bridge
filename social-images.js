import {readFileSync,statSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,extname} from 'node:path';
import {createHash} from 'node:crypto';
export function imageBytes(bytes){
 const b=Buffer.from(bytes);if(!b.length||b.length>12*1024*1024)throw Error('配图应小于 12MB');
 const head=b.subarray(0,16);let type='';
 if(head.subarray(0,8).toString('hex')==='89504e470d0a1a0a')type='png';
 else if(head[0]===255&&head[1]===216&&head[2]===255)type='jpeg';
 else if(/^GIF8[79]a/.test(head.toString('ascii')))type='gif';
 else if(head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP')type='webp';
 if(!type)throw Error('配图需要真实 PNG、JPEG、GIF 或 WebP 图片');
 return {bytes:b,mime:'image/'+type,extension:type==='jpeg'?'jpg':type,hash:createHash('sha256').update(b).digest('hex')};
}
export function loadSocialImage(source,{roots=[],allowData=false}={}){
 if(allowData&&typeof source==='object'&&typeof source?.data==='string'){
  const encoded=source.data.replace(/^data:image\/[\w.+-]+;base64,/,'');if(encoded.length>17*1024*1024||!/^[-\w+/=\r\n]+$/.test(encoded))throw Error('配图编码无效或过大');return imageBytes(Buffer.from(encoded,'base64'));
 }
 const file=typeof source==='string'?source:source?.file;if(!file||!isAbsolute(file))throw Error('配图必须来自当前角色已准备的真实图片或明确上传的文件');
 const resolved=realpathSync(file),valid=roots.some(root=>{try{const rel=relative(realpathSync(root),resolved);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel);}catch{return false;}});
 if(!valid)throw Error('配图不在当前角色允许的素材目录中');if(statSync(resolved).size>12*1024*1024)throw Error('配图应小于 12MB');return {...imageBytes(readFileSync(resolved)),file:resolved};
}
export function safeImageList(value,max=9){if(value===undefined)return[];if(!Array.isArray(value)||value.length>max)throw Error('本次配图最多 '+max+' 张');return value;}
