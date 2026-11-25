import {realpathSync,statSync,readFileSync,copyFileSync,constants} from 'node:fs';
import {relative,isAbsolute,resolve,join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {protectedResourceFile} from './resource-files.js';
export function digitalArtifact(root,file,{since=0}={}){
 const base=realpathSync(root),target=realpathSync(String(file||'')),rel=relative(base,target);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('只登记当前角色自己的数字作品目录中的文件');
 const stat=statSync(target);if(!stat.isFile()||stat.size<=0||stat.size>32*1024*1024)throw Error('作品文件为空或超过32MB');
 if(stat.mtimeMs+2000<since)throw Error('文件早于本次任务，不能当成本次的新作品');
 return {ok:true,file:target,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(target)).digest('hex'),substantive:true,coverage:'已核实本次任务时段内作品目录里的实际文件、大小和校验值；文件内容是否完成目标仍需结合工具结果核对，没有自动分享'};
}

// Resolve against the host's task workspace, never the DSH process cwd.
// An import is explicit and preserves the original; existing files are never overwritten.
export function registerDigitalArtifact(root,file,{workspace,since=0,action='register',trustedFiles=[]}={}){
 const artifactDir=realpathSync(root),workspaceDir=workspace?resolve(workspace):'',raw=String(file||'');
 const suggestedFile=join(artifactDir,basename(raw)||'作品.md');
 let copying=false;
 const refusal=error=>({ok:false,status:copying?'unknown':'not_applied',submitted:copying,queued:false,artifactDir,workspaceDir,suggestedFile,error:String(error.message||error),code:error.code||'ARTIFACT_VALIDATION',nextStep:'先核对文件是否存在。可直接写入 artifactDir 后登记；文件在当前任务目录，或已由浏览器、平台、MCP、原生工具实际取得时，用 bridge_life_artifact action=import 和真实 file 按来源记录复制归档，保留原件，不必重做或搬目录。不要把登记失败说成文件写入失败。'});
 try{
  const target=realpathSync(isAbsolute(raw)?raw:resolve(workspaceDir||artifactDir,raw));
  if(protectedResourceFile(target))throw Error('登录凭据或受保护的私有配置不能作为分享资源导入');
  const rel=relative(artifactDir,target),inside=rel&&!rel.startsWith('..')&&!isAbsolute(rel);
  if(inside)return digitalArtifact(artifactDir,target,{since});
  if(action!=='import')throw Error('文件不在角色作品目录；请按返回的目录写入，或显式 import 当前任务目录中的原文件');
  const receipt=trustedFiles.find(row=>{try{return row.sha256&&realpathSync(row.file)===target;}catch{return false;}});
  if(!workspaceDir&&!receipt)throw Error('没有可核实的任务目录或资源来源记录，未复制文件');
  const base=receipt?realpathSync(resolve(target,'..')):realpathSync(workspaceDir),part=relative(base,target);
  if(!part||part.startsWith('..')||isAbsolute(part))throw Error('请先用实际可用工具获取文件，取得来源记录后可从任意存放位置导入');
  // Validate contents, timestamp and size before the first filesystem mutation.
  const source=digitalArtifact(base,target,{since:receipt?0:since});
  if(receipt&&receipt.sha256!==source.sha256)throw Error('资源在工具返回后发生变化，请重新读取或获取后再发送');
  const destination=join(artifactDir,source.sha256+'-'+basename(target));
  copying=true;
  try{copyFileSync(target,destination,constants.COPYFILE_EXCL);}catch(error){if(error.code!=='EEXIST')throw error;}
  const result=digitalArtifact(artifactDir,destination);
  if(result.sha256!==source.sha256)throw Error('归档校验不一致，原件保留，请核对后重新登记');
  return {...result,sourceFile:target,imported:true,originalPreserved:true};
 }catch(error){return refusal(error);}
}
