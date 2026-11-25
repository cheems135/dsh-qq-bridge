import {listenLocalServer} from './local-server-listen.js';
import {readConsoleSource} from './console-source.js';
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createServer} from 'node:http';import {EventEmitter} from 'node:events';import vm from 'node:vm';
import {normalizeBalanceConfig,readServiceBalance} from '../service-balance.js';import {createServiceConnections} from '../service-connections.js';import {installServiceConnections} from '../service-connections-plugin.js';import {createWalletAwareness,walletState} from '../wallet-awareness.js';import {requestWebsite,publicWebsiteIp} from '../website-mcp-http.js';
const config={endpoint:'/billing/balance',amountPath:'data.available',currencyPath:'data.unit'},profile={id:'a',name:'Other generator',type:'openai',baseUrl:'https://other-generator.example/v1',apiKey:'test-key',balance:config};
test('an arbitrary generation provider uses its own documented endpoint, amount and currency, not RH fields',async()=>{
 let calls=0;const value=await readServiceBalance(profile,{fetchImpl:async(url,init)=>{calls++;assert.equal(url,'https://other-generator.example/billing/balance');assert.equal(init.method,'GET');assert.equal(init.headers.authorization,'Bearer test-key');assert.equal(init.redirect,'error');return Response.json({data:{available:'12.3400',unit:'EUR',remainCoins:'999'}});}});assert.equal(calls,1);assert.deepEqual(value.entries,[{amount:'12.3400',currency:'EUR',kind:'money'}]);assert.equal(walletState(value),'normal');
});
test('missing endpoint makes zero requests; known DeepSeek host uses the official balance contract',async()=>{
 assert.equal((await readServiceBalance({...profile,balance:null},{fetchImpl:()=>{throw Error('must not probe');}})).status,'unsupported');
 const value=await readServiceBalance({...profile,baseUrl:'https://api.deepseek.com/v1',balance:null},{fetchImpl:async(url)=>{assert.equal(url,'https://api.deepseek.com/user/balance');return Response.json({balance_infos:[{total_balance:'8.70',currency:'USD'},{total_balance:'0',currency:'CNY'}]});}});assert.deepEqual(value.entries.map(e=>e.currency),['USD','CNY']);
});
test('quota units and conversions are explicit and POST queries do not invoke a generator',async()=>{
 const p={...profile,type:'anthropic',balance:{endpoint:'/account',method:'POST',body:{scope:'remaining'},rowsPath:'wallets',amountPath:'quota',currency:'字符',kind:'quota',divisor:100}};
 const value=await readServiceBalance(p,{fetchImpl:async(url,init)=>{assert(url.endsWith('/account'));assert.equal(init.headers['x-api-key'],'test-key');assert.deepEqual(JSON.parse(init.body),{scope:'remaining'});return Response.json({wallets:[{quota:'123400'}]});}});assert.equal(value.entries[0].amount,'1234');assert.equal(value.entries[0].currency,'字符');
});
test('zero stays zero; null, absent, boolean, unknown unit or API failure cannot become an empty wallet',async()=>{
 for(const data of [{available:null,unit:'EUR'},{unit:'EUR'},{available:false,unit:'EUR'},{available:'',unit:'EUR'},{available:'12',unit:null}])assert.equal((await readServiceBalance(profile,{fetchImpl:async()=>Response.json({data})})).status,'unknown');
 assert.equal(walletState(await readServiceBalance(profile,{fetchImpl:async()=>Response.json({data:{available:'0',unit:'EUR'}})})),'empty');
 assert.equal((await readServiceBalance(profile,{fetchImpl:async()=>Response.json({success:false,data:{available:'0',unit:'EUR'}})})).status,'unknown');
});
test('cross-site credential forwarding, unsafe paths and malformed conversions are rejected before request',()=>{
 for(const patch of [{endpoint:'https://evil.example/balance'},{endpoint:'/balance?key=secret'},{amountPath:'__proto__.balance'},{amountPath:'a.constructor.value'},{divisor:0},{divisor:'invalid'},{currencyPath:'',currency:''}])assert.throws(()=>normalizeBalanceConfig({...config,...patch},profile.baseUrl));
});
test('timeouts, invalid JSON and oversized responses are failures, not fallback balances',async()=>{
 for(const fetchImpl of [async()=>new Response('{}',{status:401}),async()=>new Response('not json'),async()=>new Response(' '.repeat(1024*1024+1))])await assert.rejects(readServiceBalance(profile,{fetchImpl}));
 const controller=new AbortController();controller.abort();await assert.rejects(readServiceBalance(profile,{signal:controller.signal,fetchImpl:async(_u,o)=>{o.signal.throwIfAborted();}}),e=>e.name==='AbortError');
});
test('connection persistence keeps schema and credentials separated; changing host still requires a new key',()=>{
 let state=null;const c=createServiceConnections({storage:{read:()=>state,write:s=>state=structuredClone(s)}}),saved=c.save({...profile,chatModel:'chat-model'});assert(saved.balance);assert(!JSON.stringify(saved).includes('test-key'));c.save({id:saved.id,name:'Renamed'});assert.deepEqual(c.profile(saved.id).balance,saved.balance);assert.throws(()=>c.save({id:saved.id,baseUrl:'https://new.example/v1'}));assert.equal(c.save({id:saved.id,balance:null}).balance,null);
});
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('actual wallet routing follows image/speech/chat/video connections and local selection independently',async()=>{
 const selected={image:'profile:a',speech:'local',chat:'host'},s={URL,settings:{videogen:{profileId:'video-id'}},serviceSource:k=>selected[k],effectiveModel:()=>({provider:'qq-connection-chat-id'}),serviceConnections:{profile:id=>({...profile,id,name:id})},readServiceBalance:async p=>({id:p.id})};vm.createContext(s);vm.runInContext(source.slice(source.indexOf('  function routedWalletSource('),source.indexOf('  let nativeWalletRevision='))+';this.get=routedWalletSource;',s);
 assert.equal((await s.get('image','Image',{}).read()).id,'a');assert.equal((await s.get('chat','Chat',{}).read()).id,'chat-id');assert.equal((await s.get('video','Video',{}).read()).id,'video-id');assert.equal((await s.get('speech','Voice',{}).read()).status,'unsupported');selected.image='legacy';assert.equal((await s.get('image','Image',{read:async()=>({legacy:true})}).read()).legacy,true);
});
test('switching service while a balance query is pending discards the previous provider result',async()=>{
 let identity='old',resolve;const w=createWalletAwareness({identity:()=>identity,config:()=>({}),sources:()=>[{id:identity,provider:identity,label:identity,read:()=>identity==='old'?new Promise(r=>resolve=r):Promise.resolve({status:'ok',entries:[{amount:'7',currency:'EUR'}]})}],ledger:()=>({}),save(){}});const first=w.refresh();identity='new';const second=await w.refresh();assert.equal(second.accounts[0].id,'new');resolve({status:'ok',entries:[{amount:'999',currency:'CNY'}]});await first;assert.equal(w.snapshot().accounts[0].id,'new');assert.equal(w.snapshot().accounts[0].entries[0].currency,'EUR');
});
test('failed refresh keeps stale last value, preserves arbitrary units and never claims zero',async()=>{
 let fail=false;const w=createWalletAwareness({identity:()=>1,config:()=>({}),sources:()=>[{id:'custom',provider:'custom',label:'Other',read:async()=>{if(fail)throw Error('offline');return {status:'ok',entries:[{amount:'42',currency:'生成额度',kind:'quota'}]};}}],ledger:()=>({}),save(){}});await w.refresh();fail=true;await w.refresh({force:true});const row=w.snapshot().accounts[0];assert.equal(row.entries[0].currency,'生成额度');assert.equal(row.state,'unknown');assert(row.stale);assert.equal(row.entries[0].amount,'42');
});
test('configured balance query works through actual plugin HTTP handler without exposing credentials',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'balance-http-'));let route;const c=installServiceConnections({ctx:{get:n=>n==='webServer'?{register:r=>{route=r;}}:null,effect:f=>f()},dataDir:dir,writeAtomic:(p,v)=>writeFileSync(p,JSON.stringify(v)),fetchImpl:async()=>Response.json({data:{available:'18.125',unit:'积分'}})});const p=c.save({...profile,chatModel:''});const server=createServer(route.handler);const url=await listenLocalServer({server});
 try{const result=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'balance',id:p.id})}).then(r=>r.json());assert.equal(result.balance.entries[0].amount,'18.125');assert.equal(result.balance.entries[0].currency,'积分');assert(!JSON.stringify(result).includes('test-key'));assert(!JSON.stringify(await fetch(url).then(r=>r.json())).includes('test-key'));}finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
test('reserved IP classification is strict while domain fake-IP DNS remains compatible and can be disabled',async()=>{
 assert.equal(publicWebsiteIp('198.18.0.1'),false);let calls=0;const opts={resolve:async()=>[{address:'198.18.0.1',family:4}],request:(_u,_o,callback)=>{calls++;const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.headers={};callback(res);res.emit('end');});return req;}};
 assert.equal((await requestWebsite('https://example.com',opts)).status,200);assert.equal(calls,1);await assert.rejects(requestWebsite('https://example.com',{...opts,allowFakeIpDns:false}),/非公开/);assert.equal(calls,1);await assert.rejects(requestWebsite('http://198.18.0.1',opts));
});
test('console scripts parse and balance UI has generic configuration without an RH coin display',()=>{
 const html=readConsoleSource();for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);assert(html.includes('connectionBalanceEndpoint'));assert(html.includes('connectionBalanceCurrencyPath'));assert(!html.includes('RH币'));assert(!html.includes('RH 币'));
});

test('actual homepage clock refresh is defined, uses Shanghai time across midnight, and safely ignores other pages',()=>{
 const html=readConsoleSource(),start=html.indexOf('  function updateHeroClock('),end=html.indexOf('  var lastHomeSpendAt',start);assert(start>0&&end>start);
 let node={textContent:'old'};const context={Intl,Date:class extends Date{constructor(){super('2026-11-11T16:02:00Z');}},$:()=>node};vm.createContext(context);vm.runInContext(html.slice(start,end)+';updateHeroClock();',context);assert.equal(node.textContent,'00:02');
 node=null;vm.runInContext('updateHeroClock()',context);
});
