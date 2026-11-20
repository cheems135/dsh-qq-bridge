import test from 'node:test';
import assert from 'node:assert/strict';
import {visualObservationPolicy,currentVisualFrames} from '../visual-observation.js';
import {readBrowserVideo} from '../browser-video.js';
const url='https://example.org/watch';
function fixture(){
 let at=10,sequence=0,shots=0;const waits=[],actions=[];
 const browser={peekVideo:async()=>({url,currentTime:at,duration:100,paused:false}),act:async args=>{actions.push(args.action);return {url};},captureVideo:async()=>{shots++;return {url,at,capturedAt:Date.now(),data:Buffer.from([255,216,sequence++,255,217]).toString('base64')};}};
 return {browser,actions,waits,setAt(value){at=value;},get shots(){return shots;},read:(context={},args={})=>readBrowserVideo({browser,args:{url,...args},context,scope:'test',sleep:async ms=>waits.push(ms),readFile:()=>{throw Error('old file must not be read');}})};
}
test('local submits one latest frame, including large histories and API-assist isolation',()=>{
 assert.equal(visualObservationPolicy({localTurn:true}).maxFrames,1);
 assert.equal(visualObservationPolicy({localTurn:true}).maxEdge,640);
 assert.equal(visualObservationPolicy({}).maxFrames,2);
 assert.equal(visualObservationPolicy({localTurn:true,apiTaskAssist:true}).backend,'api');
 assert.deepEqual(currentVisualFrames([{at:1},{at:2},{at:3}],{localTurn:true}),[{at:3}]);
 assert.deepEqual(currentVisualFrames([{at:1},{at:2},{at:3}],{}),[{at:2},{at:3}]);
});
test('first read is immediate, captures once, and does not navigate or play an already playing page',async()=>{
 const f=fixture(),result=await f.read({}, {maxFrames:999});
 assert.equal(result.frames.length,1);assert.equal(f.shots,1);assert.deepEqual(f.waits,[]);assert.deepEqual(f.actions,[]);
 assert.equal(result.frames[0].at,10);assert.equal(result.observationMode,'latest-frame');
});
test('API reuses one recent frame only as motion context and still captures current pixels',async()=>{
 const f=fixture();await f.read();f.setAt(11);
 const result=await f.read();assert.deepEqual(result.frames.map(frame=>frame.at),[10,11]);assert.equal(f.shots,2);assert.deepEqual(f.waits,[]);
 f.setAt(30);const later=await f.read();assert.deepEqual(later.frames.map(frame=>frame.at),[30]);
});
test('local always reads just one current frame without waiting or accumulating history',async()=>{
 const f=fixture();await f.read({localTurn:true});f.setAt(11);
 const result=await f.read({localTurn:true});assert.deepEqual(result.frames.map(frame=>frame.at),[11]);assert.equal(f.shots,2);assert.deepEqual(f.waits,[]);
});
test('persona switches and backwards seeks never attach the previous scene',async()=>{
 const f=fixture();await f.read({personaId:'one'});f.setAt(11);
 assert.equal((await f.read({personaId:'two'})).frames.length,1);
 f.setAt(5);assert.equal((await f.read({personaId:'two'},{at:5})).frames.length,1);
});
test('permission loss and navigation after capture cannot submit old evidence',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();
 await assert.rejects(f.read({signal:controller.signal}),{name:'AbortError'});assert.equal(f.shots,0);
 f.browser.captureVideo=async()=>({url:'https://example.org/other',data:'invalid'});
 await assert.rejects(f.read(),/切换视频/);
});
test('the DSH player observation can reuse one scoped hearing receipt from its actual audio',async()=>{
 const f=fixture();
 let captures=0,listens=0;
 const clip=Buffer.from('1a45dfa30000','hex');
 f.browser.captureVideoAudio=async(_context,source,at)=>{
  assert.equal(source,url);
  captures++;
  return {start:at,end:at+5,data:clip.toString('base64')};
 };
 const listenWindow=async({clip:bytes,start,end})=>{
  listens++;
  assert.deepEqual(bytes,clip);
  return {status:'transcribed',start,end,segments:[{start,end,text:'这是一段实际台词'}]};
 };
 const preview=await f.read();
 assert.ok(preview.frames.length);
 assert.equal(captures,0);
 const context={key:'private:owner',personaId:'p',accountId:'a'};
 const listen=()=>readBrowserVideo({browser:f.browser,args:{url,audio:true},context,scope:'test',listenWindow});
 const first=await listen();
 assert.equal(first.audio.segments[0].text,'这是一段实际台词');
 assert.match(first.coverage,/音轨听写/);
 f.setAt(11);
 const second=await listen();
 assert.equal(second.audio,first.audio);
 assert.equal(captures,1);
 assert.equal(listens,1);
});
