import fs from 'node:fs';
const html = fs.readFileSync(new URL('../console.html',import.meta.url),'utf8');
const styles = new URL('../ui/', import.meta.url);
const css = fs.readdirSync(styles).filter(f=>f.endsWith('.css')).map(f=>fs.readFileSync(new URL(f,styles),'utf8')).join('\n');
const uiDir = new URL('../ui/', import.meta.url);
const script = fs.readdirSync(uiDir).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(new URL(f,uiDir),'utf8')).join('\n');
const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map(m=>m[1]));
const used = new Set();
for (const m of script.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c=>{ if(c) used.add(c); });
for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach(c=>{ if(c) used.add(c); });
const missing = [...used].filter(c=>!defined.has(c)&&!c.startsWith('__'));
console.log('classes used but never styled:', missing.sort().join(', ') || '(none)');
const host = fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
const routes = [...new Set([...script.matchAll(/api\('(?:GET|POST)',\s*'([^']+)'/g)].map(m=>m[1].split('?')[0]))];
for (const r of routes) {
  const ok = host.includes(`path: '${r}'`) || host.includes(`path: "${r}"`);
  console.log((ok?'OK  ':'MISS') + '  ' + r);
}
