import test from'node:test';import assert from'node:assert/strict';import{mkdtempSync,readFileSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{visualSessionBudget,createVisualSessions}from'../visual-session.js';import{createMobilePhoneController}from'../mobile-phone-controller.js';
test('a screenshot attachment returned by the host is read into a verified image file',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mobile-attachment-')),attachment={id:'stored-screen'},bytes=Buffer.from('ffd8ffe000104a464946','hex');
 const phone=createMobilePhoneController({getConfig:()=>({enabled:true}),getCacheDir:()=>dir,getAgent:async()=>({id:'owner'}),
  getTools:()=>({schemas:()=>[{name:'mcp__phone__screen'}],execute:async()=>({content:[{type:'image',attachment}]})}),
  readAttachment:async(ref,signal)=>{assert.equal(ref,attachment);assert.ok(!signal.aborted);return {data:bytes,ref:{mediaType:'image/jpeg'}};},
 });
 try{const captured=await phone.act({action:'observe'});assert.match(captured.file,/\.jpg$/);assert.deepEqual(readFileSync(captured.file),bytes);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('phone capture profiles bound work without changing desktop or local inference budgets',()=>{const b=visualSessionBudget(false,'phone'),s=visualSessionBudget(false,'phone','saver'),d=visualSessionBudget(false,'phone','detail');assert.equal(b.maxEdge,768);assert.equal(b.inferMs,8000);assert(s.sampleMs>b.sampleMs&&s.inferMs>b.inferMs&&s.maxEdge<b.maxEdge);assert(d.sampleMs<b.sampleMs&&d.maxEdge>b.maxEdge);assert.equal(visualSessionBudget(false).maxEdge,1024);assert.equal(visualSessionBudget(true).inferMs,12000);assert.deepEqual(visualSessionBudget(false,'phone','unknown'),b);const manager=createVisualSessions({schedule:()=>0,cancel:()=>{}});try{const started=manager.start({target:'phone',profile:'saver'},{key:'private:1'});assert.equal(started.profile,'saver');assert.equal(started.budget.maxEdge,640);}finally{manager.close();}});
test('lightweight companion observation skips the control tree and accepts actual PNG/JPEG/WebP bytes',async()=>{const dir=mkdtempSync(join(tmpdir(),'mobile-capture-'));const samples=[['image/png',Buffer.from('89504e470d0a1a0a00000000','hex'),'.png'],['image/jpeg',Buffer.from('ffd8ffe000104a464946','hex'),'.jpg'],['image/webp',Buffer.from('524946460800000057454250','hex'),'.webp']];try{for(const [mime,bytes,ext]of samples){let requested;const controller=createMobilePhoneController({getConfig:()=>({enabled:true}),getCacheDir:()=>dir,getAgent:async()=>({id:'owner'}),getTools:()=>({schemas:()=>[{name:'mcp__phone__screen'}],execute:async({arguments:args})=>{requested=args;return {content:[{type:'image',mimeType:mime,data:bytes.toString('base64')}]};}})});const result=await controller.act({action:'observe',detail:false},{});assert.equal(requested.detail,false);assert.equal(requested.image,true);assert(result.file.endsWith(ext));assert.deepEqual(readFileSync(result.file),bytes);}}finally{rmSync(dir,{recursive:true,force:true});}});
test('batch-only handset tool hosts receive one raw call and its correlated result in the owner scope',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mobile-batch-capture-')),owner={id:'owner'},image=Buffer.from('89504e470d0a1a0a00000000','hex');
 let calls=0,inside=false;
 const api={schemas:()=>[{name:'mcp__phone__screen'}],execute:async input=>{
  calls++;assert.equal(input.agent,owner);assert.equal(inside,true);assert.equal(input.calls.length,1);
  const [call]=input.calls;assert.equal(call.type,'tool-call');assert.equal(call.name,'mcp__phone__screen');
  assert.deepEqual(JSON.parse(call.arguments),{detail:false,image:true});
  return {results:[{callId:call.id,result:{content:[{type:'image',mimeType:'image/png',data:image.toString('base64')} ]}}]};
 }};
 const controller=createMobilePhoneController({getConfig:()=>({enabled:true}),getCacheDir:()=>dir,getAgent:async()=>owner,getTools:()=>api,
  runAsAgent:async(agent,work)=>{assert.equal(agent,owner);inside=true;try{return await work();}finally{inside=false;}}});
 try{const result=await controller.act({action:'observe',detail:false});assert.equal(calls,1);assert.deepEqual(readFileSync(result.file),image);}
 finally{rmSync(dir,{recursive:true,force:true});}
});
