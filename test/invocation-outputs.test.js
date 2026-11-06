import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:http';
import {probeColorPng} from '../local-probe-image.js';
import {invocationOutputFiles,invocationOutputs,serveInvocationOutput} from '../invocation-outputs.js';
import {listenLocalServer} from './local-server-listen.js';

test('local and API result files share previews, deduplicate files, and correlate actual QQ delivery independently',()=>{
 const dir=mkdtempSync(join(tmpdir(),'invocation-results-')),image=join(dir,'result.png');writeFileSync(image,probeColorPng());
 try{
  const row={id:'local',accountId:'a',chat:'private:1',auditId:'audit1',result:{files:[image,pathToFileURL(image).href]}};
  assert.deepEqual(invocationOutputFiles(row),[image]);
  const job={id:'out1',accountId:'a',chat:'private:1',auditId:'audit1',segments:[{type:'image',data:{file:pathToFileURL(image).href}}],status:'sent',messageId:'123'};
  const options={roots:[dir],outbox:[{...job,accountId:'b'},job]};
  const preview=invocationOutputs(row,options)[0];assert.equal(preview.available,true);assert.equal(preview.kind,'image');assert.equal(preview.delivery.status,'sent');assert.deepEqual(preview.delivery.messageIds,['123']);assert.deepEqual(preview.delivery.outboxIds,['out1']);
  assert.equal(invocationOutputs({...row,result:{file:image}},options)[0].available,true);
  assert.equal(invocationOutputs(row,{...options,outbox:[{...job,messageId:''}]})[0].delivery.status,'unknown');
  assert.equal(invocationOutputs(row,{...options,outbox:[{...job,auditId:'other'}]})[0].delivery.status,'unrecorded');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('missing files, external paths and disguised media are reported unavailable without exposing arbitrary files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'invocation-limits-')),media=join(dir,'media');mkdirSync(media);const outside=join(dir,'outside.png'),fake=join(media,'fake.png');writeFileSync(outside,probeColorPng());writeFileSync(fake,'<html>not an image</html>');
 try{const row={id:'x',result:{files:[outside,fake,join(media,'missing.png')]}};const outputs=invocationOutputs(row,{roots:[media]});assert.equal(outputs.length,3);assert.ok(outputs.every(o=>!o.available&&!o.url));assert.match(outputs[0].reason,/目录/);assert.match(outputs[1].reason,/格式/);assert.match(outputs[2].reason,/清理|读取/);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('result endpoint serves registered media only and supports video/audio byte ranges without fetching remote URLs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'invocation-endpoint-')),image=join(dir,'result.png'),bytes=probeColorPng();writeFileSync(image,bytes);
 const row={id:'registered',result:{files:[image]}},server=createServer((req,res)=>{if(req.url==='/config'){res.end('{}');return;}serveInvocationOutput(req,res,{rows:[row],roots:[dir]});});
 await listenLocalServer({server});const base='http://127.0.0.1:'+server.address().port;
 try{
  const full=await fetch(base+'/?id=registered&index=0');assert.equal(full.status,200);assert.equal(full.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await full.arrayBuffer()),bytes);
  const partial=await fetch(base+'/?id=registered&index=0',{headers:{range:'bytes=0-7'}});assert.equal(partial.status,206);assert.equal((await partial.arrayBuffer()).byteLength,8);
  assert.equal((await fetch(base+'/?id=registered&index=0',{headers:{range:'bytes=999999-'}})).status,416);
  assert.equal((await fetch(base+'/?id=unknown&file='+encodeURIComponent(image))).status,404);
  assert.equal((await fetch(base+'/?id=registered&index=1')).status,404);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}
});
