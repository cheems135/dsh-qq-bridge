import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {join} from 'node:path';
import {imageExecutionInquiry,localImageRequest,requestsImage} from '../media-intent.js';
import {resolveLocalMediaTask} from '../local-media-task.js';
import {planLocalMediaTask} from '../local-media-planner.js';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';
import {probeColorPng} from '../local-probe-image.js';
const questions=['这张图片你是不是没有用参考图生成','你有没有用参考图生成这张图？','这张图是否使用了参考图？','刚才那张图怎么生成的','为什么没有用参考图生成','这张是不是用参考图生成的，用语音回答我'];
test('P1 B01 inquiries never require a new image or invoke semantic generation planning',async()=>{
 for(const request of questions){assert.equal(imageExecutionInquiry(request),true,request);assert.equal(requestsImage(request),false,request);assert.equal(localImageRequest(request),false,request);const initial=resolveLocalMediaTask(request);assert.equal(initial.image,false,request);let calls=0;const task=await planLocalMediaTask(initial,{request,model:async()=>{calls++;return JSON.stringify({kind:'image',evidence:'参考图',confidence:1});}});assert.equal(task.image,false);assert.equal(calls,0);}
});
test('P1 B01 explicit reference generation and redo remain actionable without changing scene constraints',()=>{
 for(const request of ['生成一张海边鲸鱼的图片','请用参考图生成一张图片','能不能用参考图生成一张鲸鱼图片','这张是不是没用参考图生成，重新生成一张','这张是不是没用参考图生成，请用原图生成一张新的','这张图是不是没有用参考图？按刚才要求重新生成一张','重新生成一张，不要猫咪，换成鲸鱼']){assert.equal(imageExecutionInquiry(request),false,request);assert.equal(resolveLocalMediaTask(request).image,true,request);}
 for(const request of ['不要再生成图片了','“生成一张图”是什么意思','例如生成一张鲸鱼图片'])assert.equal(localImageRequest(request),false,request);
});
for(const intent of ['text','misclassified-tool','explicit-redo'])test('P1 B01 real gateway '+intent+' submits images only for an explicit current request',async()=>{
 const dir=fs.mkdtempSync(join(process.env.TEMP||process.cwd(),'inquiry-regression-')),file=join(dir,'result.png'),configFile=join(dir,'config.json');fs.writeFileSync(file,probeColorPng());fs.writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir}));let images=0,models=0;
 const service=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir},logger:()=>{},fetchImpl:async()=>Response.json({queue_running:[],queue_pending:[]}),model:async()=>{models++;return intent==='misclassified-tool'&&models===1?'{"action":"image","arguments":{"prompt":"incorrect extra generation"}}':'你问的是上一张图有没有使用参考图。';},tools:{image:{execute:async()=>{images++;return {ok:true,kind:'image',file,media:[{kind:'image',file}]};}}}});
 const base=await listenLocalServer(service);
 try{const request='这张图片你是不是没有用参考图生成'+(intent==='explicit-redo'?'，请用原图重新生成一张':''),response=await fetch(base+'/v1/local/turn',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:request}]})}),body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.equal(images,intent==='explicit-redo'?1:0);assert.equal(body.attachments.length,intent==='explicit-redo'?1:0);assert(models<=3);}finally{service.server.closeAllConnections();await service.close();}
});
