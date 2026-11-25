import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,relative,resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
test('every local JS dependency of the shipped root modules is included in the release manifest',()=>{
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const listed=new Set(pkg.files);
  const missing=new Set();
  for(const source of readdirSync(root).filter(p=>p.endsWith('.js')&&listed.has(p))){
    const body=readFileSync(join(root,source),'utf8');
    for(const match of body.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\bnew URL\(\s*)['"](\.\/[\w./-]+\.m?js)(?:['"?])/g)){
      const dependency=relative(root,resolve(root,match[1])).replaceAll('\\','/');
      if(!existsSync(join(root,dependency))||!listed.has(dependency)&&!pkg.files.some(s=>s.endsWith('/**')&&dependency.startsWith(s.slice(0,-2))))missing.add(source+' → '+dependency);
    }
  }
  assert.deepEqual([...missing],[]);
});
