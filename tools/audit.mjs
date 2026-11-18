import fs from 'node:fs';
const html = fs.readFileSync(new URL('../console.html',import.meta.url),'utf8');
const uiDir = new URL('../ui/', import.meta.url);
const script = fs.readdirSync(uiDir).filter(f=>f.endsWith('.js')).map(f=>fs.readFileSync(new URL(f,uiDir),'utf8')).join('\n');
// functions
const defs = new Set([...script.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
const calls = new Set([...script.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map(m=>m[1]));
const known = new Set(['if','for','while','switch','catch','function','return','typeof','new','Number','String','Array','Object','Date','JSON','Math','setTimeout','setInterval','clearInterval','parseInt','parseFloat','isNaN','encodeURIComponent','decodeURIComponent','alert','confirm','prompt','Error','Promise','Image','RegExp','Boolean','escape','unescape','do','else','try','then','map','forEach','filter','slice','join','split','replace','includes','indexOf','push','concat','trim','toFixed','toLocaleString','textContent','Number','String']);
const missing = [...calls].filter(n=>!defs.has(n)&&!known.has(n)&&/^(view|render|load|fill|fmt|chat|sw|row|esc|api|toast|applyTheme|bind|\$)/.test(n));
// ids referenced via $('...') or getElementById
const idRefs = new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]));
const idRefs2 = new Set([...script.matchAll(/getElementById\('([^']+)'\)/g)].map(m=>m[1]));
// ids defined in html strings
const idDefs = new Set([...script.matchAll(/id="([^"]+)"/g)].map(m=>m[1]));
[...html.matchAll(/id="([^"]+)"/g)].forEach(m=>idDefs.add(m[1]));
const deadIds = [...new Set([...idRefs,...idRefs2])].filter(id=>!idDefs.has(id));
// tabs
const tabs = [...html.matchAll(/data-tab="([^"]+)"/g)].map(m=>m[1]);
const dispatch = [...script.matchAll(/tab === '([^']+)'/g)].map(m=>m[1]);
// api routes
const routes = [...new Set([...script.matchAll(/api\('(?:GET|POST)',\s*'([^']+)'/g)].map(m=>m[1]))];
console.log('functions defined:', defs.size);
console.log('unresolved view/render calls:', missing);
console.log('tabs in nav:', tabs.join(','));
console.log('dispatch cases:', [...new Set(dispatch)].join(','));
console.log('tabs without dispatch:', tabs.filter(t=>!dispatch.includes(t)));
console.log('dispatch without tab:', [...new Set(dispatch)].filter(t=>!tabs.includes(t)));
console.log('ids referenced but never defined:', deadIds);
console.log('api routes used:', routes.join(' '));
