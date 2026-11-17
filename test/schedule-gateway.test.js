import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';
import {createLocalModelServer} from '../local-model-server.mjs';import {listenLocalServer} from './local-server-listen.js';
test('actual local gateway keeps a failed media tool paused across turns and restarts, then resumes only in a later slot',async()=>{
 const dir=mkdtempSync(new URL('../.schedule-gateway-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),configFile=join(dir,'config.json');writeFileSync(configFile,JSON.stringify({voiceEnabled:false,fastDialogue:false,mediaDir:dir}));
 let attempts=0,issued=false,server;
 const make=async()=>{issued=false;const s=createLocalModelServer({configFile,env:{LOCAL_AI_WORK_DIR:dir,LOCAL_AI_LOG_FILE:join(dir,'test.log')},logger:()=>{},runtime:{status:async()=>({reachable:true}),release:async()=>({freed:true})},tools:{image:{execute:async()=>{attempts++;return {ok:true};}}},model:async()=>{if(issued)return '没有生成成功。';issued=true;return {tool_calls:[{id:'one',function:{name:'image',arguments:{prompt:'测试普通山水画'}}}]};}});await listenLocalServer(s);return s;};
 const turn=async(start='10:00')=>{issued=false;return fetch('http://127.0.0.1:'+server.server.address().port+'/v1/local/turn',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({messages:[{role:'user',content:'调用工具'}],turnContext:{scheduleScope:{accountId:'a',personaId:'p',date:'2026-11-07',start,end:'12:00'}}})}).then(r=>r.json());};
 try{server=await make();for(let i=0;i<4;i++)await turn();assert.equal(attempts,4);await turn();assert.equal(attempts,4);await server.close();server=await make();await turn();assert.equal(attempts,4);await turn('11:00');assert.equal(attempts,5);}finally{await server?.close();rmSync(dir,{recursive:true,force:true});}
});
