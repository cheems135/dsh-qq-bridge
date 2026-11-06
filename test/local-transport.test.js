import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {requestLocalJson, localReplyDelay} from '../local-transport.js';

async function fixture(handler, run) {
  const server=createServer(handler);
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await run('http://127.0.0.1:'+server.address().port); }
  finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
}

test('local transport waits for delayed headers and preserves JSON and status', async()=>{
  let calls=0;
  await fixture((req,res)=>{
    calls++; let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>setTimeout(()=>{
      assert.equal(JSON.parse(raw).messages[0].content,'一句话');
      res.writeHead(201,{'content-type':'application/json'});res.end(JSON.stringify({text:'完成'}));
    },100));
  },async base=>{
    const result=await requestLocalJson(base,{method:'POST',body:{messages:[{role:'user',content:'一句话'}]},timeoutMs:1000});
    assert.equal(result.status,201); assert.equal(result.body.text,'完成'); assert.equal(calls,1);
  });
});

test('local transport never retries an interrupted generation', async()=>{
  let calls=0;
  await fixture((req)=>{calls++;req.socket.destroy();},async base=>{
    await assert.rejects(requestLocalJson(base,{method:'POST',body:{},timeoutMs:1000}),/ECONNRESET/);
    assert.equal(calls,1);
  });
});

test('local transport abort and total deadline close the pending connection',async()=>{
  await fixture(()=>{},async base=>{
    await assert.rejects(requestLocalJson(base,{timeoutMs:30}),/等待超时/);
    const controller=new AbortController();
    const job=requestLocalJson(base,{signal:controller.signal});controller.abort();
    await assert.rejects(job,{name:'AbortError'});
  });
});

test('local transport rejects truncated and oversized responses',async()=>{
  await fixture((req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{');setTimeout(()=>res.destroy(),10);},async base=>{
    await assert.rejects(requestLocalJson(base),/响应中断/);
  });
  await fixture((req,res)=>res.end(JSON.stringify({text:'long'})),async base=>{
    await assert.rejects(requestLocalJson(base,{maxBytes:3}),/响应过大/);
  });
});

test('local owner batches typing briefly; other chat keeps its configured delay',()=>{
  assert.equal(localReplyDelay({localOwner:true,replyDelayMs:3000,mergeMs:300}),300);
  assert.equal(localReplyDelay({localOwner:false,replyDelayMs:3000,mergeMs:300}),3000);
  assert.equal(localReplyDelay({localOwner:true,replyDelayMs:0,mergeMs:300}),0);
  assert.equal(localReplyDelay({localOwner:true,replyDelayMs:3000,mergeMs:300,priority:'quality'}),1200);
});
