import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {writeFileSync,mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publicWebsiteIp,checkedWebsiteUrl,requestWebsite} from '../website-mcp-http.js';
import {discoverHtmlTools,discoverOpenApiTools,discoverWebsite} from '../website-mcp-discovery.js';
import {createWebsiteMcp} from '../website-mcp.js';
import {createWebsiteMcpProtocol} from '../website-mcp-protocol.js';
import {createAgentCapabilities} from '../agent-capabilities.js';
import {createLocalAgent} from '../local-agent.js';
const origin='https://example.com';
const html='<title>测试网站</title><a href="/articles">文章</a><a href="https://other.test/">跨站</a><form action="/search"><input name="q" type="search" placeholder="关键词"><input type="hidden" name="lang" value="zh"></form><form method="post" action="/login"><input type="password" name="password"></form>';
const response=(text=html,url=origin,status=200)=>({status,text,url,type:'text/html'});
const scope={accountId:'a'},other={accountId:'b'};
function fixture(request=async url=>response(url.includes('openapi')||url.includes('swagger')?'{}':url.includes('/search')?html+'<main>搜索结果 '+new URL(url).searchParams.get('q')+'</main>':html,url)){
  let state={version:1,sites:[]};const records=[],requests=[];
  const manager=createWebsiteMcp({storage:{read:()=>structuredClone(state),write:v=>state=structuredClone(v)},request:async(url,options)=>{requests.push({url,options});return request(url,options);},onRecord:e=>records.push(e)});
  return {manager,records,requests,state:()=>state};
}
test('public website transport rejects private, mapped, reserved IPs and credential URLs',()=>{
  for(const ip of ['127.0.0.1','10.1.1.1','172.16.0.1','192.168.1.2','169.254.169.254','100.64.0.1','198.18.0.1','224.0.0.1','::1','::ffff:127.0.0.1','2001:db8::1'])assert.equal(publicWebsiteIp(ip),false,ip);
  for(const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(publicWebsiteIp(ip),true,ip);
  for(const url of ['file:///tmp/a','http://127.0.0.1','http://localhost','https://user:pass@example.com','https://example.com/?token=secret','https://example.com:8443'])assert.throws(()=>checkedWebsiteUrl(url));
  assert.throws(()=>checkedWebsiteUrl('https://other.test/',origin));
});
test('transport validates every DNS result and pins actual socket lookup',async()=>{
  let calls=0;
  await assert.rejects(requestWebsite(origin,{resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>{calls++;}}),/非公开/);assert.equal(calls,0);
  await assert.rejects(requestWebsite(origin,{resolve:async()=>[{address:'1.1.1.1',family:4},{address:'10.1.1.1',family:4}]}),/非公开/);
  const request=(url,opts,callback)=>{
    calls++;opts.lookup(url.hostname,{},(_error,address,family)=>{assert.equal(address,'1.1.1.1');assert.equal(family,4);});
    const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=200;res.headers={};queueMicrotask(()=>{callback(res);res.emit('data',Buffer.from('ok'));res.emit('end');});};return req;
  };
  assert.equal((await requestWebsite(origin,{resolve:async()=>[{address:'1.1.1.1',family:4}],request})).text,'ok');assert.equal(calls,1);
});
test('cross-origin redirect is rejected before sending second request',async()=>{
  let calls=0;const request=(_url,_opts,cb)=>{calls++;const req=new EventEmitter();req.end=()=>{const res=new EventEmitter();res.statusCode=302;res.headers={location:'https://other.test/'};res.resume=()=>{};queueMicrotask(()=>cb(res));};return req;};
  await assert.rejects(requestWebsite(origin,{origin,resolve:async()=>[{address:'1.1.1.1',family:4}],request}),/同一站点/);assert.equal(calls,1);
});
test('HTML search detection preserves real names and fixed fields without login tools',()=>{
  const found=discoverHtmlTools(html,origin);assert.equal(found.title,'测试网站');assert.equal(found.tools.length,2);assert.equal(found.tools[1].request.url,origin+'/search');assert.deepEqual(found.tools[1].inputSchema.required,['q']);assert.equal(found.tools[1].request.fixed.lang,'zh');assert.deepEqual(found.links,[{url:origin+'/articles',title:'文章'}]);assert.ok(found.limitations.length);
  assert.equal(discoverHtmlTools('<form><input type="search" name="q"><input type="hidden" name="csrf_token"></form>',origin).tools.length,1);
});
const openapi={openapi:'3.0.0',info:{title:'公开目录'},servers:[{url:'/api'}],paths:{'/items/{id}':{get:{summary:'读取条目',parameters:[{name:'id',in:'path',required:true,schema:{type:'integer'}},{name:'lang',in:'query',schema:{type:'string',enum:['zh','en']}}]}},'/logout':{get:{}},'/private':{get:{security:[{key:[]}]}},'/complex':{get:{parameters:[{name:'filter',in:'query',schema:{type:'object'}}]}},'/write':{post:{}}}};
test('OpenAPI maps path/query types and omits authentication, writes and unsupported shapes',()=>{
  const found=discoverOpenApiTools(openapi,origin+'/openapi.json',origin);assert.equal(found.tools.length,1);assert.equal(found.tools[0].request.url,origin+'/api/items/{id}');assert.equal(found.tools[0].inputSchema.properties.id.type,'integer');assert.ok(found.limitations.length>=3);
  assert.equal(discoverOpenApiTools({...openapi,servers:[{url:'https://other.test'}]},origin,origin).tools.length,0);
});
test('direct OpenAPI document produces callable tools; missing search remains explicit',async()=>{
  const site=await discoverWebsite(origin+'/openapi.json',{request:async url=>response(JSON.stringify(openapi),url)});assert.equal(site.tools.length,1);assert.match(site.tools[0].name,/^api_/);
  const plain=await discoverWebsite(origin,{request:async url=>response('<title>静态网站</title>',url)});assert.equal(plain.tools.length,1);assert.ok(plain.limitations.some(x=>x.includes('动态功能')));
});
test('preview does not enable tools; save, discovery, schema and search execute with exact fields',async()=>{
  const f=fixture();const preview=await f.manager.inspect(origin,scope);assert.equal(f.manager.tools(scope).length,0);
  assert.throws(()=>f.manager.save(preview.previewId,other),/过期/);
  f.manager.save(preview.previewId,scope);assert.equal(f.manager.tools(scope).length,2);assert.equal(f.manager.tools(other).length,0);
  const list=await f.manager.agent({action:'list'},scope);const name=list.tools.find(t=>t.name.includes('__search_')).name;
  const schema=await f.manager.agent({action:'schema',name},scope);assert.ok(schema.inputSchema.properties.q);
  const result=await f.manager.agent({action:'call',name,arguments:{q:'你好 & 世界'}},scope);
  assert.equal(result.ok,true);const url=new URL(f.requests.at(-1).url);assert.equal(url.searchParams.get('q'),'你好 & 世界');assert.equal(url.searchParams.get('lang'),'zh');
  assert.equal(f.records.at(-1).status,'returned');assert.ok(f.records.at(-1).output.text);
});
test('call validation blocks unknown params, cross-site pages, state-changing GET and disabled tools',async()=>{
  const f=fixture(),p=await f.manager.inspect(origin,scope),site=f.manager.save(p.previewId,scope),name=site.id+'__read_page',before=f.requests.length;
  await assert.rejects(f.manager.call(name,{url:'https://other.test/'},scope),/同一站点/);
  await assert.rejects(f.manager.call(name,{unknown:'x'},scope),/未识别/);
  await assert.rejects(f.manager.call(name,{url:origin+'/delete/item'},scope),/改变网站/);
  await assert.rejects(f.manager.call(name,{url:origin+'/?action=delete'},scope),/改变网站/);assert.equal(f.requests.length,before);
  f.manager.change(site.id,scope,{enabled:false});await assert.rejects(f.manager.call(name,{},scope),/未找到/);
  assert.throws(()=>f.manager.change(site.id,other,{remove:true}),/未找到/);
});
test('OpenAPI calls interpolate path, validate enum/types and reject missing input',async()=>{
  const f=fixture(async url=>response(JSON.stringify(openapi),url)),p=await f.manager.inspect(origin+'/openapi.json',scope),s=f.manager.save(p.previewId,scope),name=s.id+'__'+s.tools[0].name;
  await assert.rejects(f.manager.call(name,{},scope),/缺少/);await assert.rejects(f.manager.call(name,{id:'abc'},scope),/数字/);await assert.rejects(f.manager.call(name,{id:12,lang:'bad'},scope),/范围/);
  await f.manager.call(name,{id:12,lang:'zh'},scope);assert.equal(f.requests.at(-1).url,origin+'/api/items/12?lang=zh');
});
test('disabling during an in-flight call discards its result',async()=>{
  const f=fixture(),p=await f.manager.inspect(origin,scope),s=f.manager.save(p.previewId,scope);
  const call=f.manager.call(s.id+'__read_page',{},scope);
  f.manager.change(s.id,scope,{enabled:false});await assert.rejects(call,/未启用/);
});
test('dynamic search does not claim completion from an empty shell and can reuse an authorized renderer',async()=>{
  const f=fixture(async url=>response(html,url)),p=await f.manager.inspect(origin,scope),s=f.manager.save(p.previewId,scope),name=s.id+'__'+s.tools.find(t=>t.name.startsWith('search_')).name;
  const shell=await f.manager.call(name,{q:'asyncio'},scope);assert.equal(shell.ok,false);assert.equal(shell.needsBrowser,true);
  let rendered=0;
  const result=await f.manager.call(name,{q:'asyncio'},scope,{render:async url=>{rendered++;assert.equal(new URL(url).searchParams.get('q'),'asyncio');return {body:'asyncio 的实际搜索结果',links:[]};}});
  assert.equal(result.ok,true);assert.equal(result.rendered,true);assert.equal(rendered,1);
});
test('MCP lifecycle, list, successful call, error results, and unknown methods are standard JSON-RPC',async()=>{
  const f=fixture(),p=await f.manager.inspect(origin,scope);f.manager.save(p.previewId,scope);const rpc=createWebsiteMcpProtocol({manager:f.manager,scope});
  assert.equal((await rpc({jsonrpc:'2.0',id:1,method:'tools/list'})).error.code,-32002);
  const init=await rpc({jsonrpc:'2.0',id:2,method:'initialize',params:{protocolVersion:'2025-06-18'}});assert.equal(init.result.capabilities.tools.listChanged,false);
  assert.equal(await rpc({jsonrpc:'2.0',method:'notifications/initialized'}),null);
  const listed=await rpc({jsonrpc:'2.0',id:3,method:'tools/list'});assert.equal(listed.result.tools.length,2);
  const name=listed.result.tools[0].name;
  const called=await rpc({jsonrpc:'2.0',id:4,method:'tools/call',params:{name,arguments:{}}});assert.equal(called.result.isError,false);assert.equal(called.result.content[0].type,'text');
  const failed=await rpc({jsonrpc:'2.0',id:5,method:'tools/call',params:{name,arguments:{unknown:'x'}}});assert.equal(failed.result.isError,true);
  assert.equal((await rpc({jsonrpc:'2.0',id:6,method:'tools/call',params:{name:'missing'}})).error.code,-32602);
  assert.equal((await rpc({jsonrpc:'2.0',id:7,method:'missing'})).error.code,-32601);
});
test('actual stdio process emits only MCP messages and discovers persisted sites',async()=>{
  const f=fixture(),p=await f.manager.inspect(origin,scope);f.manager.save(p.previewId,scope);const dir=mkdtempSync(join(tmpdir(),'website-mcp-')),file=join(dir,'sites.json');writeFileSync(file,JSON.stringify(f.state()));
  const proc=spawn(process.execPath,[new URL('../tools/website-mcp.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/i,'$1'),'--manifest',file,'--account','a'],{windowsHide:true});let stdout='',stderr='';proc.stdout.on('data',chunk=>stdout+=chunk);proc.stderr.on('data',chunk=>stderr+=chunk);
  proc.stdin.end([{jsonrpc:'2.0',id:1,method:'initialize'},{jsonrpc:'2.0',method:'notifications/initialized'},{jsonrpc:'2.0',id:2,method:'tools/list'}].map(JSON.stringify).join('\n')+'\n');
  const code=await new Promise((resolve,reject)=>{proc.on('exit',resolve);proc.on('error',reject);});assert.equal(code,0,stderr);const rows=stdout.trim().split('\n').map(JSON.parse);assert.equal(rows.length,2);assert.equal(rows[1].result.tools.length,2);
});
test('API tool registration and the local tool router share the exact website executor',async()=>{
  const registered=new Map(),calls=[],context={capabilities:{tools:true},chat:{kind:'private',isOwner:true},localTurn:true};
  const stub={status:()=>({}),close:()=>{}};
  const agent=createAgentCapabilities({ctx:{get:n=>n==='tools'?{register:d=>{registered.set(d.name,d);return()=>{};}}:null},getConfig:()=>({enabled:true}),getContext:()=>context,authorize:()=>true,browser:stub,desktop:stub,audio:stub,getPhone:()=>({status:async()=>({})}),services:{websiteMcp:async(args,c)=>{calls.push({args,c});return {ok:true,tools:[]};}}});
  assert.equal(agent.start(),true);
  await registered.get('bridge_website_mcp').execute({action:'list'},{});
  await agent.localTools(context).bridge_tools.execute({action:'call',name:'bridge_website_mcp',arguments:{action:'list'}});
  assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);agent.close();
});
test('a real website search receipt satisfies local search/read checks without redundant generic search',async()=>{
  const f=fixture(),p=await f.manager.inspect(origin,scope),s=f.manager.save(p.previewId,scope),name=s.id+'__'+s.tools.find(t=>t.name.startsWith('search_')).name;let modelCalls=0,toolCalls=0;
  const router={kind:'data',repeatable:true,parameters:{type:'object',properties:{action:{type:'string'},name:{type:'string'},arguments:{type:'object'}},required:['action'],additionalProperties:false},execute:async args=>{toolCalls++;assert.equal(args.name,'bridge_website_mcp');return f.manager.agent(args.arguments,scope);}};
  const agent=createLocalAgent({requiredDataTools:['bridge_search','bridge_read'],acceptMixedActions:true,tools:{bridge_tools:router},model:async()=>++modelCalls===1?JSON.stringify({action:'bridge_tools',arguments:{action:'call',name:'bridge_website_mcp',arguments:{action:'call',name,arguments:{q:'asyncio'}}}}):'已经读到了网站返回的资料。'});
  const result=await agent.run({messages:[{role:'user',content:'帮我在这个网站搜索 asyncio，然后读取结果'}]});assert.equal(modelCalls,2);assert.equal(toolCalls,1);assert.deepEqual(result.receipts[0].fulfilledDataTools,['bridge_search','bridge_read']);
});
