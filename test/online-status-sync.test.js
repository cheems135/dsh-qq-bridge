import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
const start=source.indexOf('  let onlineStatusMode='),end=source.indexOf('  const onlineStatusTimer=',start);
assert(start>=0&&end>start);
function fixture(){
 const calls=[];let time=1000;
 const c={stopped:false,accountPaused:false,ready:true,socket:{ready:true},Date:{now:()=>time},
  bridgeQQReady:()=>c.ready,guardConfig:()=>({sleepOnlineStatus:'hidden'}),lifeExecution:{asleep:()=>false},
  calendarMeta:()=>({}),activePersona:()=>({id:'p'}),log:()=>{},request:async(name,args)=>{calls.push({name,args});}};
 vm.createContext(c);vm.runInContext(source.slice(start,end)+'\nthis.sync=syncOnlineStatus;',c);
 return {c,calls,advance:ms=>time+=ms};
}
test('an open transport without a confirmed QQ receiver never changes online status',async()=>{
 const f=fixture();f.c.ready=false;await f.c.sync(true);assert.equal(f.calls.length,0);
});
test('online status failures back off without pausing message delivery or overlapping calls',async()=>{
 const f=fixture();let reject;
 f.c.request=()=>{f.calls.push('request');return new Promise((_r,j)=>reject=j);};
 const pending=f.c.sync();await f.c.sync(true);assert.equal(f.calls.length,1);
 reject(Error('QQ core not ready'));await pending;await f.c.sync(true);assert.equal(f.calls.length,1);
 assert.equal(f.c.accountPaused,false);assert.equal(f.c.socket.ready,true);
 f.advance(5*60000);f.c.request=async()=>f.calls.push('retry');await f.c.sync();assert.equal(f.calls.length,2);
});
test('a new QQ connection is eligible without waiting for the old connection backoff',async()=>{
 const f=fixture();f.c.request=async()=>{f.calls.push('failure');throw Error('failed');};await f.c.sync();
 f.c.socket={ready:true};f.c.request=async()=>f.calls.push('new');await f.c.sync();assert.deepEqual(f.calls,['failure','new']);
});
test('a late success from an old connection cannot mark a replacement connection as synchronized',async()=>{
 const f=fixture();let finish;
 f.c.request=()=>{f.calls.push('old');return new Promise(resolve=>finish=resolve);};const pending=f.c.sync();
 f.c.socket={ready:true};finish();await pending;f.c.request=async()=>f.calls.push('new');await f.c.sync();
 assert.deepEqual(f.calls,['old','new']);
});
