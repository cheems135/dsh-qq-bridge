import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {invocationOutputs,serveInvocationOutput} from '../invocation-outputs.js';
import {probeColorPng} from '../local-probe-image.js';
import {listenLocalServer} from './local-server-listen.js';
test('actual host record and output routes expose existing results only for the active account without running a model',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'host-output-record-')),file=join(dir,'result.png');writeFileSync(file,probeColorPng());
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),handlers=new Map(),rows=[];
 const records=[{id:'ours',accountId:'a',chat:'private:1',auditId:'audit',kind:'image',result:{files:[file]}},{id:'other',accountId:'b',kind:'image',result:{files:[file]}}];
 const sandbox={isDesktop:true,URL,String,LOCAL_MEDIA_DEFAULT:dir,invocationOutputs,serveInvocationOutput,settings:{activeAccountId:'a',localChat:{}},generatedDir:()=>dir,voiceDir:dir,featureState:{outbox:[{id:'sent',accountId:'a',chat:'private:1',auditId:'audit',status:'sent',messageId:'321',segments:[{type:'image',data:{file}}]}]},isLoopbackUrl:()=>true,requestLocalJson:async()=>({body:{records,mediaRoot:dir}}),recordInvocation:row=>rows.push(row),invocationJournal:{list:({accountId})=>rows.filter(r=>r.accountId===accountId)},jsonResponse:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},ctx:{get:()=>({register:r=>{handlers.set(r.path,r.handler);}}),effect:fn=>fn()}};
 vm.createContext(sandbox);const start=source.indexOf('  let localInvocationMediaRoot='),end=source.indexOf('\n  const inboxRunning',start);assert.ok(start>0&&end>start);vm.runInContext(source.slice(start,end),sandbox);
 const server=createServer((req,res)=>{const handler=handlers.get(new URL(req.url,'http://localhost').pathname);if(handler)handler(req,res);else res.end('{}');});await listenLocalServer({server});const base='http://127.0.0.1:'+server.address().port;
 try{
  const result=await(await fetch(base+'/im-bridge/invocations')).json();assert.equal(result.records.length,1);assert.equal(result.records[0].id,'ours');assert.equal(result.records[0].outputs[0].available,true);assert.equal(result.records[0].outputs[0].delivery.status,'sent');
  assert.equal((await fetch(base+result.records[0].outputs[0].url)).status,200);
  assert.equal((await fetch(base+'/im-bridge/invocation-output?id=other&index=0')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
