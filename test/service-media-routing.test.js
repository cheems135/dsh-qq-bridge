import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalModelServer} from '../local-model-server.mjs';
import {runWithHostTools} from '../local-tool-broker.js';
import {mixedHostMediaTools,withoutInternalMediaTools} from '../service-media-tools.js';
import {listenLocalServer as listen} from './local-server-listen.js';
function setup(extra={}){
  const dir=mkdtempSync(join(tmpdir(),'mixed-media-')),file=join(dir,'config.json');writeFileSync(file,JSON.stringify({backend:'comfyui',dialoguePriority:'speed',voiceEnabled:false,mediaDir:join(dir,'media'),workflowLibrary:extra.workflows||[]}));
  const service=createLocalModelServer({configFile:file,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},runtime:extra.runtime||{status:async()=>({reachable:true,workflows:[]}),release:async()=>({freed:true})},fetchImpl:async url=>Response.json(url.endsWith('/api/status')?{busy:false,loaded:false}:{queue_running:[],queue_pending:[]}),model:extra.model||(async()=>{throw Error('local model must not run');}),tools:extra.tools});return {service,dir};
}
test('media-only local image runs once through its real workflow selector without a local chat inference',async()=>{
  let images=0,otherRuns=0;let imageFile;
  const s=setup({workflows:[{id:'local-picture',name:'图片工作流',kind:'image',file:'mock.json',inputs:{prompt:{node:'1',field:'text'}},output:{node:'2',field:'images',kind:'image'}}],runtime:{status:async()=>({reachable:true,workflows:[]}),release:async()=>({freed:true}),run:async(id,args)=>{if(id!=='local-picture'){otherRuns++;throw Error('wrong runtime');}images++;assert.equal(args.prompt,'窗边的木桌和一本书');return {files:[{kind:'image',file:imageFile}],file:imageFile};}}});
  imageFile=join(s.dir,'picture.png');writeFileSync(imageFile,Buffer.from('89504e470d0a1a0a','hex'));const base=await listen(s.service);let promptRequests=0;
  try{
    const response=await runWithHostTools({baseUrl:base,messages:[{role:'user',content:'窗边的木桌和一本书'}],turnContext:{mediaOnly:{kind:'image',prompt:'窗边的木桌和一本书'}},tools:{bridge_model_complete:{parameters:{type:'object',properties:{messages:{type:'array'},protocol:{type:'string'},outputTokens:{type:'integer'},purpose:{type:'string'}},required:['messages']},execute:async()=>{promptRequests++;return '等我整理好画面。';}}}});
    assert.equal(response.ok,true,JSON.stringify(response.body));assert.equal(images,1);assert.equal(otherRuns,0);assert.equal(promptRequests,1);assert.equal(response.body.attachments[0].kind,'image');assert.equal(response.body.attachments[0].file,imageFile);
  }finally{await s.service.close();}
});
test('local chat speech action goes through the selected host API callback, not the local voice engine',async()=>{
  let models=0,speech=0;const s=setup({tools:{speech:{execute:async()=>{throw Error('wrong local voice engine');}}},model:async()=>++models===1?{content:JSON.stringify({action:'speech',arguments:{text:'今天也想陪你说说话。',final:true}})}:'今天也想陪你说说话。'});const file=join(s.dir,'api-voice.wav');writeFileSync(file,Buffer.alloc(100));const base=await listen(s.service);
  try{
    const tools=mixedHostMediaTools({speech:async args=>{speech++;assert.equal(args.text,'今天也想陪你说说话。');return {ok:true,attachments:[{kind:'speech',file}]};}});
    const response=await runWithHostTools({baseUrl:base,messages:[{role:'user',content:'用语音陪我聊一句'}],tools});assert.equal(response.ok,true,JSON.stringify(response.body));assert.equal(speech,1);assert.equal(response.body.attachments[0].file,file);assert.ok(response.body.receipts.some(r=>r.tool==='speech'&&r.ok));
  }finally{await s.service.close();}
});
test('local chat image action honors a selected API callback and hides internal transport tool names',async()=>{
  let images=0;const s=setup({tools:{image:{execute:async()=>{throw Error('wrong local workflow');}}},model:async()=>({content:JSON.stringify({action:'image',arguments:{prompt:'木桌上的书本'}})})});const file=join(s.dir,'api-picture.png');writeFileSync(file,Buffer.from('89504e470d0a1a0a','hex'));const base=await listen(s.service);
  try{
    const tools=mixedHostMediaTools({image:async args=>{images++;assert.equal(args.prompt,'木桌上的书本');return {ok:true,attachments:[{kind:'image',file}]};}});
    assert.equal(Object.keys(withoutInternalMediaTools({...tools,bridge_tools:{}})).join(','),'bridge_tools');
    const response=await runWithHostTools({baseUrl:base,messages:[{role:'user',content:'生成图片'}],tools});assert.equal(response.ok,true,JSON.stringify(response.body));assert.equal(images,1);assert.equal(response.body.attachments[0].kind,'image');assert.equal(response.body.attachments[0].file,file);
  }finally{await s.service.close();}
});
