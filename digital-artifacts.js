import {realpathSync,statSync,readFileSync} from 'node:fs';
import {relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
export function digitalArtifact(root,file,{since=0}={}){
 const base=realpathSync(root),target=realpathSync(String(file||'')),rel=relative(base,target);
 if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('只登记当前角色自己的数字作品目录中的文件');
 const stat=statSync(target);if(!stat.isFile()||stat.size<=0||stat.size>32*1024*1024)throw Error('作品文件为空或超过32MB');
 if(stat.mtimeMs+2000<since)throw Error('文件早于本次任务，不能当成本次的新作品');
 return {ok:true,file:target,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(target)).digest('hex'),substantive:true,coverage:'已核实本次任务时段内作品目录里的实际文件、大小和校验值；文件内容是否完成目标仍需结合工具结果核对，没有自动分享'};
}
