import {realpathSync,statSync,readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export function protectedResourceFile(file){const value=String(file).replaceAll('\\','/');return /\/(?:\.ssh|\.aws|\.codex|\.dsh|\.gnupg|User Data)\//i.test(value)||/(?:^|\/)(?:\.env(?:\.[^/]*)?|credentials(?:\.[^/]*)?|Cookies|Login Data|Local State|id_rsa|id_ed25519)$/i.test(value);}

// Only structured outputs of an actually completed tool establish provenance.
// Text mentioning a path, input arguments and web page instructions do not.
export function resourceOutputFiles(value){
 const found=new Set(),seen=new Set();let count=0;
 const add=v=>{try{if(typeof v!=='string')return;const file=v.startsWith('file:')?fileURLToPath(v):v;if(isAbsolute(file))found.add(realpathSync(file));}catch{}};
 function scan(v,depth=0){
  if(!v||depth>9||count++>800||typeof v!=='object'||seen.has(v))return;seen.add(v);
  if(Array.isArray(v)){for(const item of v.slice(0,80)){if(typeof item==='string')add(item);else scan(item,depth+1);}return;}
  for(const key of ['file','path','filePath','file_path','outputPath','downloadPath','screenshot'])add(v[key]);
  if(v.type==='resource_link'&&v.uri?.startsWith('file:'))add(v.uri);
  if(v.resource?.uri?.startsWith('file:'))add(v.resource.uri);
  if(v.type==='text'&&typeof v.text==='string'&&v.text.length<200000)try{scan(JSON.parse(v.text),depth+1);}catch{}
  for(const key of ['files','media','attachments','value','result','content','data','body','output','outputs','downloads'])scan(v[key],depth+1);
 }
 scan(value);return [...found].slice(0,40);
}
export function resourceFileEvidence(value){
 return resourceOutputFiles(value).flatMap(file=>{try{if(protectedResourceFile(file))return [];const stat=statSync(file);if(!stat.isFile()||!stat.size||stat.size>32*1024*1024)return [];return [{file,bytes:stat.size,sha256:createHash('sha256').update(readFileSync(file)).digest('hex')}];}catch{return [];}});
}
