import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {diagnosticFailure, logOptInRawPayload, oneBotMessageShape} from '../log-retention.js';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const secret='SYNTHETIC-PRIVATE-SENTINEL';

test('unparsed cards expose only trusted segment types and counts; inbound raw logging requires true',()=>{
  const payload={post_type:'message',raw_message:secret,message:[
    {type:'json',data:{data:secret}},
    {type:'xml',data:{data:secret}},
    {type:secret,data:{text:secret}},
    {type:'text',data:{text:secret}},
  ]};
  assert.equal(oneBotMessageShape(payload),'segments=4 json=1 xml=1 other=1 text=1');
  assert.equal(oneBotMessageShape({raw_message:secret}),'string chars='+secret.length);
  const seen=[];
  for(const enabled of [undefined,false,'true',1])logOptInRawPayload(s=>seen.push(s),payload,enabled);
  logOptInRawPayload(s=>seen.push(s),{...payload,post_type:'notice'},true);
  assert.deepEqual(seen,[]);
  logOptInRawPayload(s=>seen.push(s),payload,true);
  assert.equal(seen[0],'RAW '+JSON.stringify(payload));
  assert.match(source,/diag:\s*\{\s*rawPayload:\s*false/);
  assert.match(source,/logOptInRawPayload\(log,payload,settings\.diag\?\.rawPayload\)/);
  assert.match(source,/log\('nothing to admit \(' \+ oneBotMessageShape\(payload\)/);
});

function hostFunction(name,dependencies){
  const start=source.indexOf('  async function '+name+'(');
  const end=source.indexOf('\n  }',start);
  assert(start>=0 && end>start);
  const body=source.slice(start,end+4).replaceAll('import.meta.url', JSON.stringify(new URL('../index.js',import.meta.url).href));
  return Function(...Object.keys(dependencies),'return ('+body+');')(...Object.values(dependencies));
}

test('both real image generators receive the prompt but log only dimensions, byte and character counts',async()=>{
  const mockLog=[];
  const image=Buffer.alloc(15000);
  const common={settings:{imagegen:{apiKey:'unit-test-key',cropWatermark:false}},cacheRoot:'in-memory',join,
    log:line=>mockLog.push(line),mediaInvocationAllowed:()=>true,imageDimensions:()=>'512x512',USER_AGENT:'test',
    recordApiMediaInputs:()=>{},generatedDir:()=>'in-memory',imageSize:()=>({width:512,height:512}),
    sniffImage:()=>'image/png',writeFileSync:()=>{},mkdirSync:()=>{},diagnosticFailure,Buffer};
  let imageRequests=0;
  const cloud=hostFunction('generateWithSiliconFlowRawImpl',{...common,fetch:async(url,options)=>{
    if(options?.method==='POST'){
      assert.equal(JSON.parse(options.body).prompt,secret);
      return {ok:true,text:async()=>JSON.stringify({images:[{url:'https://example.invalid/test'}]})};
    }
    imageRequests++;return {ok:true,arrayBuffer:async()=>image};
  }});
  await cloud(secret,'',{});
  const other=hostFunction('generateWithPollinationsImpl',{...common,fetch:async url=>{
    assert(url.includes(encodeURIComponent(secret)));imageRequests++;return {ok:true,arrayBuffer:async()=>image};
  }});
  await other(secret,{});
  assert.equal(imageRequests,2);
  assert.equal(mockLog.length,2);
  for(const entry of mockLog){assert(entry.includes('15000 bytes'));assert(entry.includes('prompt chars='+secret.length));assert(!entry.includes(secret));}
});

test('model errors retain HTTP status without copying the response body or untrusted names',()=>{
  assert.equal(diagnosticFailure(Object.assign(new Error('HTTP 401 '+secret),{name:secret,details:{token:secret}})),'error HTTP 401');
  assert.equal(diagnosticFailure(new SyntaxError(secret)),'SyntaxError');
  assert.match(source,/log\(`autonomy: completed \$\{action\} \(reply chars=\$\{text\.length\}\)`\)/);
  assert.match(source,/log\(`prompt failed for \$\{chat\.key\}: \$\{diagnosticFailure\(error\)\}`\)/);
});
