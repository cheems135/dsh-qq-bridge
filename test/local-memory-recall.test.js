import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryHub} from '../memory-hub.js';

test('foreground local recall uses the same memory store without a second model query expansion',async()=>{
 const files=new Map();let asks=0;
 const hub=createMemoryHub({storage:{list:()=>[...files.keys()],read:name=>{if(!files.has(name))throw Object.assign(Error('missing'),{code:'ENOENT'});return structuredClone(files.get(name));},write:(name,value)=>files.set(name,structuredClone(value))},allowed:()=>true,ask:async()=>{asks++;return '{"queries":["绘画"]}';}});
 const meta={key:'private:12345',accountId:'a',personaId:'p',personaVersion:'v'};
 try{await hub.recall(meta,'还记得以前的绘画吗',{expand:false});assert.equal(asks,0);await hub.recall(meta,'还记得以前的绘画吗');assert.equal(asks,1);}finally{hub.close();}
});
