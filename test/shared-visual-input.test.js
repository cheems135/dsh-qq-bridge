import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSharedFrame,sharedTokenMatches} from '../shared-visual-input.js';
import {installVisualCompanion} from '../companion-plugin.js';
import {EventEmitter} from 'node:events';
const jpeg=(width=640,height=360)=>{const b=Buffer.from('ffd8ffc00011080000000003011100021100031100ffd9','hex');b.writeUInt16BE(height,7);b.writeUInt16BE(width,9);return b.toString('base64');};
const frame=()=>({data:jpeg(),capturedAt:Date.now(),displaySurface:'window',signature:Array(144).fill(20)});
test('shared frame accepts only bounded fresh JPEG and validated audio chunks',()=>{
 const valid=normalizeSharedFrame(frame(),{maxEdge:640});assert.equal(valid.width,640);assert.equal(valid.height,360);assert.match(valid.coverage,/窗口/);
 for(const patch of [{data:'not jpeg'},{data:jpeg(2000)},{capturedAt:Date.now()-11000},{capturedAt:Date.now()+4000},{audioChunk:{data:'ZGF0YQ==',at:Date.now()}}])assert.throws(()=>normalizeSharedFrame({...frame(),...patch},{maxEdge:640}));
 assert.equal(sharedTokenMatches('a','a'),true);assert.equal(sharedTokenMatches('b','a'),false);assert.equal(sharedTokenMatches(null,'a'),false);
});
function fixture(){
 let handler;const plugin=installVisualCompanion({ctx:{get:name=>name==='webServer'?{register:route=>{handler=route.handler;return()=>{};}}:null,effect:fn=>fn()},browser:{},desktop:{},cacheDir:'unused',valid:()=>true,busy:()=>true,local:()=>true,record:()=>{},panelContext:key=>({key:key||'private:1',accountId:'a',personaId:'p'})});
 const request=body=>new Promise(resolve=>{const req=new EventEmitter();req.method='POST';req.headers={host:'localhost'};req.setEncoding=()=>{};handler(req,{writeHead:code=>{req.code=code;},end:raw=>resolve({status:req.code,body:JSON.parse(raw)})});req.emit('data',JSON.stringify(body));req.emit('end');});
 return {plugin,request};
}
test('shared capture requires panel selection, opaque token, matching session and current ownership',async()=>{
 const {plugin,request}=fixture();
 try{
  assert.throws(()=>plugin.command({action:'start',target:'shared'},{key:'private:1'}),/系统选择器/);
  const start=await request({action:'start',target:'shared',key:'private:1',sourceLabel:'指定窗口'});assert.equal(start.status,200);assert.ok(start.body.shareToken);assert.equal(start.body.session.target,'shared');assert.ok(!JSON.stringify(plugin.list()).includes(start.body.shareToken));
  const upload={action:'frame',key:'private:1',sessionId:start.body.session.id,token:start.body.shareToken,frame:frame()};
  assert.equal((await request({...upload,token:'wrong'})).status,400);assert.equal((await request(upload)).status,200);
  assert.equal((await request({...upload,key:'private:2'})).status,400);
  await request({key:'private:1',action:'pause'});assert.equal((await request(upload)).status,400);
  assert.equal((await request({key:'private:1',action:'resume'})).status,400);
 }finally{plugin.close();}
});
