import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/visual-share.js',import.meta.url),'utf8');
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
function fixture(handler,{selector}={}){
 const streams=[],calls=[],timers=[];
 const ctx=vm.createContext({navigator:{mediaDevices:{getDisplayMedia:async()=>{
  if(selector)return selector.promise;
  const track={label:'test',stopped:false,stop(){this.stopped=true;},addEventListener(){},getSettings:()=>({})};
  const stream={getTracks:()=>[track],getVideoTracks:()=>[track],getAudioTracks:()=>[]};streams.push(stream);return stream;
 }}},document:{createElement:type=>type==='video'?{play:async()=>{},videoWidth:640,videoHeight:360}:{getContext:()=>({drawImage(){},getImageData:()=>({data:Array(576).fill(0)})}),toDataURL:()=> 'data:image/jpeg;base64,frame'}},setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout(){},addEventListener(){}});
 vm.runInContext(source,ctx);
 const api=async(_method,_path,body)=>{calls.push(body);return handler(body);};
 return {share:ctx.DSHVisualShare,streams,calls,timers,start:()=>ctx.DSHVisualShare.start({api,key:'private:test',audio:false})};
}
const response=id=>({session:{id,budget:{maxEdge:640,quality:60,sampleMs:1000}},shareToken:'token'});

test('a failed frame releases capture and stops that exact backend session',async()=>{
 const h=fixture(body=>{if(body.action==='start')return response('first');if(body.action==='frame')throw Error('offline');return {};});
 await h.start();await flush();
 assert.equal(h.share.info(),null);
 assert.equal(h.streams[0].getTracks()[0].stopped,true);
 assert.deepEqual(h.calls.filter(b=>b.action==='stop').map(b=>b.id),['first']);
});

test('stopping while start is pending compensates the late backend session',async()=>{
 const pending=defer(),h=fixture(body=>body.action==='start'?pending.promise:{});
 const start=h.start();await flush();await h.share.stop();
 assert.equal(h.calls.filter(b=>b.action==='stop').length,0,'never send an unscoped stop');
 pending.resolve(response('late'));await start;
 assert.equal(h.share.info(),null);
 assert.deepEqual(h.calls.filter(b=>b.action==='stop').map(b=>b.id),['late']);
 assert.equal(h.calls.some(b=>b.action==='frame'),false);
});

test('an old start failure cannot close a replacement capture',async()=>{
 const pending=defer();let n=0;
 const h=fixture(body=>body.action==='start'?(++n===1?pending.promise:response('new')):{});
 const old=h.start();const rejected=assert.rejects(old,/old failure/);await flush();
 await h.start();pending.reject(Error('old failure'));await rejected;
 assert.equal(h.share.info().id,'new');
 assert.equal(h.streams[1].getTracks()[0].stopped,false);
 assert.equal(h.calls.some(b=>b.action==='stop'&&b.id==='new'),false);
 await h.share.stop();
});

test('stop while the system selector is pending releases its late stream without starting a session',async()=>{
 const selector=defer(),h=fixture(()=>response('unused'),{selector});let stopped=false;
 const start=h.start();await h.share.stop();
 selector.resolve({getTracks:()=>[{stop(){stopped=true;}}]});await start;
 assert.equal(stopped,true);assert.equal(h.calls.length,0);assert.equal(h.share.info(),null);
});
