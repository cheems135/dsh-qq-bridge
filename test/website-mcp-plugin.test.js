import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {installWebsiteMcpPlugin} from '../website-mcp-plugin.js';
test('plugin HTTP flow discovers, tests, saves, toggles, exports and isolates account sites',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'website-mcp-web-'));let handler,accountId='a';const records=[];
  installWebsiteMcpPlugin({ctx:{get:()=>({register:route=>{handler=route.handler;return()=>{};}}),effect:fn=>fn()},dataDir:dir,writeAtomic:(file,data)=>writeFileSync(file,JSON.stringify(data)),getScope:()=>({accountId}),onRecord:event=>records.push(event),scriptFile:'D:/plugin/tools/website-mcp.mjs',nodePath:'node',request:async url=>({url,status:200,text:url.includes('openapi')||url.includes('swagger')?'{}':'<title>公共资料</title><p>这是网站的真实正文。</p>'})});
  const server=createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/im-bridge/website-mcp';
  async function post(body,headers={}){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:typeof body==='string'?body:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  try{
    assert.equal((await fetch(url).then(r=>r.json())).sites.length,0);
    const preview=(await post({action:'inspect',url:'https://example.com'})).body;assert.ok(preview.previewId);
    const tested=await post({action:'test',previewId:preview.previewId,name:'read_page',arguments:{}});assert.equal(tested.body.ok,true);assert.ok(records.at(-1).output.text);
    assert.equal((await post({action:'save',previewId:preview.previewId})).body.ok,true);
    let snapshot=await fetch(url).then(r=>r.json());assert.equal(snapshot.tools.length,1);assert.equal(snapshot.accountId,'a');
    assert.equal((await post({action:'call',name:snapshot.tools[0].name,arguments:{}})).body.ok,true);
    const exported=(await post({action:'export'})).body.config.mcpServers['qq-websites'];assert.equal(exported.command,'node');assert.deepEqual(exported.args.slice(-2),['--account','a']);
    accountId='b';assert.equal((await fetch(url).then(r=>r.json())).sites.length,0);
    assert.equal((await post({action:'remove',id:snapshot.sites[0].id})).status,400);
    accountId='a';await post({action:'toggle',id:snapshot.sites[0].id,enabled:false});assert.equal((await fetch(url).then(r=>r.json())).tools.length,0);
    assert.equal((await post({action:'inspect',url:'https://example.com'},{origin:'https://evil.test'})).status,403);
    assert.equal((await post('broken json')).status,400);
    assert.equal((await post({action:'inspect',url:'x'.repeat(70000)})).status,413);
    assert.equal(JSON.parse(readFileSync(join(dir,'website-mcp.json'),'utf8')).sites.length,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
