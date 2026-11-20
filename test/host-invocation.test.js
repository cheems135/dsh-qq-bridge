import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import vm from 'node:vm';
import {createScheduleToolBreaker} from '../schedule-tool-breaker.js';
import {createInvocationJournal,invocationKind} from '../invocation-journal.js';
const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('the real host middleware blocks the fifth failed dispatch in one slot and admits a later slot',async()=>{
 const h=setup(),breaker=createScheduleToolBreaker();let startClock='10:00',calls=0,handler;
 h.s.settings.localChat.enabled=false;
 h.s.runScheduledTool=(_key,name,args,execute)=>breaker.run({accountId:'a',personaId:'p',date:'2026-11-07',start:startClock,end:'12:00'},name,args,execute);
 h.s.chats=new Map([['session',{key:'private:test'}]]);h.s.ctx={on:(_event,fn)=>handler=fn};vm.createContext(h.s);
 const start=source.indexOf("  ctx.on('tools/execute',async(exec,next)=>"),end=source.indexOf("\n  ctx.on('tools/result'",start);vm.runInContext(source.slice(start,end),h.s);
 const exec=()=>({agent:{id:'session'},name:'bridge_search',arguments:{query:'test '+calls}});
 for(let i=0;i<4;i++)await assert.rejects(handler(exec(),async()=>{calls++;throw Error('network down');}),/network down/);
 await assert.rejects(handler(exec(),async()=>calls++),e=>e.code==='SCHEDULE_TOOL_PAUSED');assert.equal(calls,4);
 startClock='11:00';await handler(exec(),async()=>{calls++;return {value:{ok:true}};});assert.equal(calls,5);
});
function setup(){let rows=[];const apiModelScope=new AsyncLocalStorage(),journal=createInvocationJournal({getRows:()=>rows,setRows:value=>rows=value});return {rows:()=>rows,s:{runScheduledTool:(_key,_name,_args,execute)=>execute(),apiModelScope,randomUUID,invocationKind,recordInvocation:(row,scope)=>journal.record(row,scope),invocationScope:chat=>({accountId:'test-account',personaId:'test-persona',chat}),settings:{localChat:{enabled:true,apiComplement:true}},currentOwnerToolDenial:()=>undefined,isPanelPhoneRead:()=>false,agencyContext:()=>({}),executionRuntime:{beginHost:()=>{},finish:()=>{}}}};}
test('actual host tool middleware records API-complement calls and results in the shared schema',async()=>{
 const h=setup(),chat={key:'private:test',apiComplement:true};let handler,calls=0;h.s.chats=new Map([['session',chat]]);h.s.ctx={on:(event,fn)=>handler=fn};vm.createContext(h.s);
 const start=source.indexOf("  ctx.on('tools/execute',async(exec,next)=>"),end=source.indexOf("\n  ctx.on('tools/result'",start);vm.runInContext(source.slice(start,end),h.s);
 const result=await handler({agent:{id:'session'},name:'bridge_search',arguments:{query:'测试词'}},async()=>{calls++;assert.equal(h.s.apiModelScope.getStore().complement,true);return {value:{ok:true,coverage:'取得实际结果'}};});
 assert.equal(calls,1);assert.equal(result.value.ok,true);assert.equal(h.rows().length,1);assert.equal(h.rows()[0].status,'returned');assert.equal(h.rows()[0].backend,'api');assert.equal(h.rows()[0].arguments.query,'测试词');
 h.s.settings.localChat.apiComplement=false;await assert.rejects(handler({agent:{id:'session'},name:'bridge_search',arguments:{}},async()=>calls++));assert.equal(calls,1);assert.equal(h.rows()[1].status,'failed');
});
test('actual API media tracer keeps submitted prompt and redacted payload through provider failure',async()=>{
 const h=setup();vm.createContext(h.s);const start=source.indexOf('  async function traceApiMedia('),end=source.indexOf("\n  let localInvocationMediaRoot=",start);vm.runInContext(source.slice(start,end),h.s);
 await assert.rejects(h.s.apiModelScope.run({complement:true,recordScope:{accountId:'test-account',personaId:'test-persona',chat:'private:test'}},()=>h.s.traceApiMedia('runninghub.image',async()=>{h.s.recordApiMediaInputs({prompt:'最终画面提示词',negativePrompt:'模糊',apiKey:'PRIVATE'});throw Error('provider timeout');})),/provider timeout/);
 const row=h.rows()[0];assert.equal(row.backend,'api');assert.equal(row.kind,'image');assert.equal(row.status,'failed');assert.equal(row.arguments.prompt,'最终画面提示词');assert.equal(row.arguments.apiKey,'[已隐藏]');assert.equal(row.chat,'private:test');
});
