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
test('phone sessions use API and preserve working pause/resume and text submission',()=>{
 const engine=createVisualSessions({schedule:()=>0,cancel:()=>{},local:()=>false});try{engine.start({target:'phone',sourceLabel:'本机屏幕'},{key:'private:1'});engine.submit('private:1','这是什么');assert.equal(engine.list()[0].backend,'api');assert.equal(engine.list()[0].pendingInputs,1);engine.control('private:1','pause');assert.equal(engine.list()[0].status,'paused');engine.control('private:1','resume');assert.equal(engine.list()[0].status,'running');}finally{engine.close();}
});
test('mobile backend rejects desktop capture and browser game actions before opening resources',()=>{
 const cleanup=[],ctx={get:()=>null,effect:fn=>cleanup.push(fn())};const service=installVisualCompanion({ctx,platform:'android',valid:()=>true,local:()=>false,record:()=>{}});try{for(const target of ['browser','shared','screen'])assert.throws(()=>service.command({action:'start',target,url:'https://example.test'},{key:'private:1'},{fromPanel:true}),/手机版陪伴/);}finally{service.close();for(const fn of cleanup)fn?.();}
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
