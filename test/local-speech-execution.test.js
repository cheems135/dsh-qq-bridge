import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalAgent} from '../local-agent.js';

test('explicit voice request executes once when model twice omits tool call',async()=>{
 let calls=0;const lines=[];const events=[];
 const agent=createLocalAgent({requiredSpeech:true,model:async options=>{calls++;return options.purpose==='speech-content'?'我在呢，今天过得怎么样？':'好，等会儿发语音。';},onProgress:e=>events.push(e),tools:{speech:{execute:async args=>{lines.push(args.text);return {file:'D:/test.wav',kind:'speech'};}}}});
 const result=await agent.run({messages:[{role:'user',content:'用语音问候我'}]});
 assert.equal(calls,3);assert.deepEqual(lines,['我在呢，今天过得怎么样？']);assert.equal(result.attachments.length,1);assert.equal(result.text,'');assert.ok(events.some(e=>e.phase==='invocation'&&e.invocation.status==='returned'));
});

test('real synthesis failure is not retried or reported as success',async()=>{
 let executions=0;const agent=createLocalAgent({requiredSpeech:true,model:async o=>o.purpose==='speech-content'?'你好。':'稍等。',tools:{speech:{execute:async()=>{executions++;throw Error('TTS offline');}}}});
 await assert.rejects(agent.run({messages:[{role:'user',content:'发语音'}]}),/TTS offline/);assert.equal(executions,1);
});
