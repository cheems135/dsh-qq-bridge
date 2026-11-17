import test from 'node:test';import assert from 'node:assert/strict';
import {createSpeechStylePreparer} from '../local-speech-style.js';import {normalizeVoiceService} from '../local-voice.js';
test('long speech preferences are interpreted once, without changing saved text or spoken words',async()=>{
 const prepare=createSpeechStylePreparer(),source='语气自然，停顿清楚。'.repeat(60);let calls=0;
 const model=async args=>{calls++;assert.equal(args.messages[1].content,source);assert.deepEqual(args.tools,[]);return '用自然、轻柔的语气，语速适中，按句意停顿。';};
 const a=await prepare(source,{model}),b=await prepare(source,{model});assert.equal(a.compacted,true);assert.ok(a.instruction.length<80);assert.equal(b.cached,true);assert.equal(calls,1);assert.equal(source.length,600);
 const short=await prepare('自然说话。',{model});assert.equal(short.compacted,false);assert.equal(calls,1);
});
test('style preparation cannot execute tools or forward verbose malformed model output',async()=>{const prepare=createSpeechStylePreparer();for(const result of [{tool_calls:[{}],content:'bad'},'x'.repeat(200),'{}'])await assert.rejects(prepare('语气自然'.repeat(100),{model:async()=>result}));});
test('local speech wait is configurable and no longer fixed to four minutes',()=>{assert.equal(normalizeVoiceService().timeoutMs,600000);assert.equal(normalizeVoiceService({timeoutMs:900000}).timeoutMs,900000);for(const timeoutMs of [0,-1,'bad',1800001])assert.throws(()=>normalizeVoiceService({timeoutMs}));});
