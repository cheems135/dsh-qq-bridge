import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createLocalToolBroker,runWithHostTools} from '../local-tool-broker.js';
import {createLocalModelServer} from '../local-model-server.mjs';

const definition={name:'bridge_read',description:'读取',parameters:{type:'object',properties:{url:{type:'string'}},required:['url'],additionalProperties:false}};
test('broker isolates sessions, correlates one result, and rejects replay',async()=>{
  const broker=createLocalToolBroker({pollMs:10});
  try{
    const first=broker.create([definition]),other=broker.create([definition]),claimed=broker.claim(first);
    assert.throws(()=>broker.claim(first),/另一轮/);assert.throws(()=>broker.claim({...first,secret:other.secret}),/凭证/);
    const pending=claimed.tools.bridge_read.execute({url:'https://example.com'}),jobs=await broker.poll(first);
    assert.equal((await broker.poll(other)).length,0);
    assert.throws(()=>broker.result(other,jobs[0].id,{ok:true}),/待处理/);
    broker.result(first,jobs[0].id,{ok:true,text:'实际结果'});assert.equal((await pending).text,'实际结果');
    assert.throws(()=>broker.result(first,jobs[0].id,{}),/重放/);
    claimed.close();assert.equal(broker.done(first),true);assert.deepEqual(await broker.poll(first),[]);
  }finally{broker.dispose();}
});
test('broker cancellation rejects pending host work instead of executing a replacement',async()=>{
  const broker=createLocalToolBroker(),controller=new AbortController();
  try{
    const auth=broker.create([definition]),claimed=broker.claim(auth,controller.signal),pending=claimed.tools.bridge_read.execute({url:'https://example.com'});
    const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;assert.equal(broker.size(),0);
  }finally{broker.dispose();}
});
test('host and real gateway complete a structured tool turn and completion poll race is harmless',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'local-tool-integration-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:false,mediaDir:join(dir,'media')}));
  let modelCalls=0,executions=0;
  const gateway=createLocalModelServer({configFile:file,env:{LOCAL_AI_LOG_FILE:join(dir,'gateway.log')},logger:()=>{},runtime:{status:async()=>({reachable:true})},model:async({messages})=>{
    modelCalls++;return messages.some(m=>m.role==='tool')?'读取成功。':{tool_calls:[{id:'read',function:{name:'bridge_read',arguments:{url:'https://example.com'}}}]};
  }});
  await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
  try{
    for(let i=0;i<8;i++){
      const response=await runWithHostTools({baseUrl:'http://127.0.0.1:'+gateway.server.address().port,messages:[{role:'user',content:'读取网页'}],tools:{bridge_read:{...definition,execute:async args=>{executions++;return {ok:true,url:args.url,text:'真实网页正文'};}}}});
      assert.equal(response.body.text,'读取成功。');assert.equal(response.body.receipts[0].data.text,'真实网页正文');assert.equal(response.body.qqDelivered,false);
    }
    assert.equal(modelCalls,16);assert.equal(executions,8);
  }finally{gateway.server.closeAllConnections();await gateway.close();rmSync(dir,{recursive:true,force:true});}
});

test('actual local screenshot bytes are analyzed by the local vision runtime and raw bytes stay out of receipts',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'local-vision-integration-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({voiceEnabled:false,mediaDir:join(dir,'media')}));
  let calls=0,captions=0;
  const gateway=createLocalModelServer({configFile:file,env:{LOCAL_AI_LOG_FILE:join(dir,'gateway.log'),LOCAL_AI_WORK_DIR:dir},logger:()=>{},fetchImpl:async()=>Response.json({ok:true}),runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true}),caption:async({image})=>{captions++;assert.match(image,/input-.*\.png$/);return {text:'实际画面里有一个蓝色按钮。'};}},model:async({messages})=>++calls===1?{tool_calls:[{id:'s',function:{name:'bridge_read',arguments:{url:'https://example.com'}}}]}:'蓝色按钮。'});
  await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
  try{
    const response=await runWithHostTools({baseUrl:'http://127.0.0.1:'+gateway.server.address().port,messages:[{role:'user',content:'看一下截图'}],tools:{bridge_read:{...definition,execute:async()=>({ok:true,localObservations:[{url:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8RIAAAAASUVORK5CYII='}]})}}});
    assert.equal(captions,1);assert.equal(response.body.receipts[0].data.observations[0].text,'实际画面里有一个蓝色按钮。');assert.doesNotMatch(JSON.stringify(response.body.receipts),/base64|iVBOR/);
  }finally{gateway.server.closeAllConnections();await gateway.close();rmSync(dir,{recursive:true,force:true});}
});
