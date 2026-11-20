import {readConsoleSource} from './console-source.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import vm from 'node:vm';
import {capturePhoneCompanion} from '../mobile-companion.js';
import {transcribeCompanionAudio} from '../companion-input-audio.js';
import {createVisualSessions} from '../visual-session.js';
import {installVisualCompanion} from '../companion-plugin.js';

test('native phone observation is bounded and temporary screenshot removed without inference service',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'phone-companion-')),file=join(dir,'screen.png'),calls=[];writeFileSync(file,'fixture');
 try{const frame=await capturePhoneCompanion({target:'phone'},{marker:'owner'}, {maxEdge:1024},{runtime:{ffmpegPath:process.execPath},phone:{act:async(body,context)=>{assert.equal(context.marker,'owner');assert.deepEqual(body,{action:'observe',detail:false});return {file};}},convert:async(_exe,source,filter,format)=>{assert.equal(source,file);calls.push(filter);return format==='rawvideo'?Buffer.alloc(144,50):Buffer.from('jpeg');}});
 assert.equal(frame.mediaType,'image/jpeg');assert.equal(frame.signature.length,144);assert.equal(frame.audioState,'not-captured');assert.equal(existsSync(file),false);assert.match(calls[0],/1024/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('cancelled phone observation releases screenshot and does not analyze stale frame',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'phone-companion-')),file=join(dir,'screen.png'),controller=new AbortController();writeFileSync(file,'fixture');
 try{await assert.rejects(capturePhoneCompanion({target:'phone'},{signal:controller.signal},{maxEdge:640},{runtime:{ffmpegPath:process.execPath},phone:{act:async()=>{controller.abort();return {file};}},convert:()=>{throw Error('must not convert');}}),{name:'AbortError'});assert.equal(existsSync(file),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('DSH Go its own surface waits for another app while phone permission errors surface',async()=>{
 const observe=message=>capturePhoneCompanion({target:'phone'},{},{maxEdge:640},{
  runtime:{ffmpegPath:process.execPath},phone:{act:async()=>{throw Error(message);}}
 });
 const pending=await observe('没有读取这个屏幕的内容。屏幕 s31 · DSH Go 这是 DSH 自己的界面，不读取也不操作。');
 assert.equal(pending.pending,true);
 assert.match(pending.reason,/切到要陪看的应用/);
 await assert.rejects(observe('还未开启截图授权'),/开启截图授权/);
});
test('phone sessions use API and preserve working pause/resume and text submission',()=>{
 const engine=createVisualSessions({schedule:()=>0,cancel:()=>{},local:()=>false});try{engine.start({target:'phone',sourceLabel:'本机屏幕'},{key:'private:1'});engine.submit('private:1','这是什么');assert.equal(engine.list()[0].backend,'api');assert.equal(engine.list()[0].pendingInputs,1);engine.control('private:1','pause');assert.equal(engine.list()[0].status,'paused');engine.control('private:1','resume');assert.equal(engine.list()[0].status,'running');}finally{engine.close();}
});
test('mobile backend rejects desktop capture and browser game actions before opening resources',()=>{
 const cleanup=[],ctx={get:()=>null,effect:fn=>cleanup.push(fn())};const service=installVisualCompanion({ctx,platform:'android',valid:()=>true,local:()=>false,record:()=>{}});try{for(const target of ['browser','shared','screen'])assert.throws(()=>service.command({action:'start',target,url:'https://example.test'},{key:'private:1'},{fromPanel:true}),/手机版陪伴/);}finally{service.close();for(const fn of cleanup)fn?.();}
});
test('an explicit phone panel capture recovers its owner agent after an engine restart',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  async function phoneSessionAgent('),source.indexOf('  function runPhoneToolAsAgent('));
 const chats=new Map(),owner='private:12345',agent={id:'owner-session'};let created=0;
 const deps={chats,settings:{owners:['12345'],activeAccountId:'account'},recordsAllowed:key=>key===owner,
  featureState:{generation:4},state:{chats:{}},stopped:false,accountPaused:false,
  ensureSession:async chat=>{assert.equal(chat.key,owner);created++;return agent.id;},
  attachChat:(id,chat)=>chats.set(id,{...chat,sessionId:id}),
  ctx:{get:()=>new Map(),sessionController:{resolveAgent:async id=>{assert.equal(id,agent.id);return {agent};}}},
 };
 const resolve=Function(...Object.keys(deps),'return ('+code.trim()+')')(...Object.values(deps));
 const request={panel:true,key:owner,sessionId:'visual-panel:12345',accountId:'account',generation:4};
 assert.equal(await resolve(request),null);assert.equal(created,0);
 assert.equal(await resolve({...request,generation:3,ensurePhoneAgent:true}),null);assert.equal(created,0);
 assert.equal(await resolve({...request,ensurePhoneAgent:true}),agent);assert.equal(created,1);
 assert.equal(await resolve(request),agent);assert.equal(created,1);
});
test('the panel capture grant applies only to its owner and one matching screen call',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const code=source.slice(source.indexOf('  function isPanelPhoneRead('),source.indexOf('  function currentOwnerToolDenial('));
 const chat={key:'private:owner',kind:'private',sessionId:'session',userId:'owner',isOwner:true};
 const grant={key:chat.key,sessionId:chat.sessionId,callId:'screen-1',accountId:'account',personaId:'role',generation:9};
 const deps={phonePanelReadScope:{getStore:()=>grant},chats:new Map([[chat.sessionId,chat]]),stopped:false,accountPaused:false,recordsAllowed:()=>true,
  settings:{owners:['owner'],agency:{enabled:true,phone:true},activeAccountId:'account'},activePersona:()=>({id:'role'}),featureState:{generation:9}};
 const check=Function(...Object.keys(deps),'return ('+code.trim()+')')(...Object.values(deps));
 const read={name:'mcp__phone__screen',callId:grant.callId};
 assert.equal(check(chat,read),true);
 assert.equal(check(chat,{...read,name:'mcp__phone__tap_xy'}),false);
 assert.equal(check(chat,{...read,callId:'screen-2'}),false);
 assert.equal(check({...chat,sessionId:'other'},read),false);
 grant.generation++;
 assert.equal(check(chat,read),false);
});
test('API-only microphone never probes or starts local ASR when key missing',async()=>{
 const data=Buffer.from('1a45dfa30000','hex').toString('base64');let localCalls=0,cloudCalls=0;
 await assert.rejects(transcribeCompanionAudio({data,mediaType:'audio/webm'},{apiOnly:true,analysis:{status:()=>{localCalls++;return {transcription:true};}},fetchImpl:async()=>{cloudCalls++;}}),/请先配置 API/);assert.equal(localCalls,0);assert.equal(cloudCalls,0);
});
test('phone and PC companion markup are independently selected from actual runtime',()=>{
 const html=readConsoleSource();const start=html.indexOf('function mobileVisualPanelMarkup()'),end=html.indexOf('function bindVisualPanel()',start);let phone=true;
 const scope={mobileApiOnly:()=>phone,data:{settings:{owners:['12345']}},esc:String};vm.createContext(scope);vm.runInContext(html.slice(start,end),scope);
 const mobile=scope.visualPanelMarkup();assert.match(mobile,/开始手机识屏陪伴/);assert.doesNotMatch(mobile,/value="shared"|value="browser"|本地降低|Edge/);phone=false;
 const desktop=scope.visualPanelMarkup();assert.match(desktop,/value="shared"/);assert.doesNotMatch(desktop,/开始手机识屏陪伴/);
});
