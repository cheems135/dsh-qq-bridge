import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionRuntime,operationEffect} from '../execution-runtime.js';
import {readBrowserVideo} from '../browser-video.js';

const url='https://www.bilibili.com/video/BV1hrW367Emp';
function fixture(){
 const runtime=createExecutionRuntime({policy:{check:()=>({ordinary:true}),consume(){}},metaFor:c=>c});
 const exec={name:'bridge_watch',arguments:{url}},context={exec,key:'private:test'};
 return {runtime,exec,context};
}
test('watch start can navigate, play and capture real frame evidence within the same host execution',async()=>{
 const {runtime,exec,context}=fixture();runtime.begin(exec,context,{...exec.arguments,toolName:exec.name});
 let at=1;const actions=[];
 const browser={peekVideo:async()=>({url,currentTime:at++,duration:20,paused:false}),act:async args=>{
  actions.push(args.action);runtime.begin(exec,context,{...args,toolName:'bridge_browser'},{url,mediaControl:args.action==='play'});
  return {url,file:'frame.png'};
 }};
 const result=await readBrowserVideo({browser,args:{url},context,readFile:()=>Buffer.from('89504e470d0a1a0a','hex'),sleep:async()=>{}});
 assert.deepEqual(actions,['screenshot']);assert.equal(result.frames.length,1);assert.equal(result.frames[0].part.mediaType,'image/png');assert.equal(result.continuous,false);assert.equal(result.realtimeCapture,true);assert.equal(result.requiresNext,true);assert.equal(result.reactionMode,'on-demand');
});
test('unknown actions and writes cannot reuse a started watch observation',()=>{
 const {runtime,exec,context}=fixture();runtime.begin(exec,context,{...exec.arguments,toolName:exec.name});
 assert.throws(()=>runtime.begin(exec,context,{toolName:'bridge_browser',action:'fill',text:'anything'},{url}),/实际目标已变化/);
 assert.equal(operationEffect({toolName:'bridge_watch',action:'invented'}),'local');
 assert.equal(operationEffect({toolName:'bridge_browser',action:'play'}),'local');
 assert.equal(operationEffect({toolName:'bridge_browser',action:'play'},{mediaControl:true}),'read');
 assert.equal(operationEffect({toolName:'bridge_watch',action:'start'},{effect:'payment'}),'payment');
});
