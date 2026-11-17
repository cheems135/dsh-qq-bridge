import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=['.','ui','assets'].flatMap(dir=>fs.readdirSync(path.join(root,dir),{withFileTypes:true}).filter(e=>e.isFile()&&/\.(?:mjs|js)$/.test(e.name)).map(e=>path.join(dir,e.name)));
for(const file of files){
 const r=spawnSync(process.execPath,['--check',path.join(root,file)],{encoding:'utf8',windowsHide:true});
 if(r.error||r.status!==0){console.error(file,r.error||r.stderr);process.exit(1);}
}
let inline=0;
for(const file of ['console.html','prompt-manager.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)){
  if(!match[1].trim())continue;
  new vm.Script(match[1],{filename:file});inline++;
 }
}
console.log(`Syntax OK: ${files.length} JavaScript modules and ${inline} inline scripts`);
