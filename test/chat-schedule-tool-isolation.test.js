import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createScheduleToolBreaker,scheduleToolScope} from '../schedule-tool-breaker.js';
import {speakerIdentity} from '../contact-policy.js';
test('failed scheduled QQ reads never lock a fresh user chat, and chat failures do not poison the schedule',async()=>{
 const scope={accountId:'a',personaId:'p',date:'2026-11-15',start:'20:00',end:'22:00'},b=createScheduleToolBreaker();
 for(let i=0;i<4;i++)await b.run(scope,'bridge_qq_read',{},()=>({ok:false}));
 await assert.rejects(b.run(scheduleToolScope(scope,{kind:'proactive'}),'bridge_qq_read',{},()=>1),e=>e.code==='SCHEDULE_TOOL_PAUSED');
 assert.equal(await b.run(scheduleToolScope(scope,{kind:'user'}),'bridge_qq_read',{},()=>({ok:true,image:'fixture'})).then(r=>r.image),'fixture');
 assert.equal(b.snapshot(scope)[0].failures,4);
 const next={...scope,start:'22:00'};
 for(let i=0;i<5;i++)await b.run(scheduleToolScope(next,{kind:'user'}),'bridge_qq_read',{},()=>({ok:false}));
 assert.equal(b.snapshot(next).length,0);
 assert.equal(await b.run(scheduleToolScope(next,{kind:'proactive'}),'bridge_qq_read',{},()=>42),42);
});
test('all host and local tool paths carry turn metadata into the scheduled guard',()=>{
 const s=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.match(s,/exec\.arguments,\(\)=>next\(\),context\.meta/);
 assert.match(s,/runScheduledTool\(chat\.key,name,args,execute,active\.localContext\?\.meta\)/);
 assert.match(s,/args\.arguments:args,execute,meta\)/);
});
test('group identity prompt recognizes owner permission without claiming a private-only restriction',()=>{
 const s=speakerIdentity('123456',{owners:['123456']});
 assert.match(s,/群聊也可使用/);assert.doesNotMatch(s,/也不授予私聊工具权限/);
});
