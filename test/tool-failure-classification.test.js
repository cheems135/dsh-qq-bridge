import test from 'node:test';
import assert from 'node:assert/strict';
import {auditModelCompletion,describeInvocation} from '../model-invocation-audit.js';
import {requestLocalSpeech,voiceServiceState} from '../local-voice.js';

test('background deferral remains an exception without becoming a failed tool',async()=>{
 const rows=[];const error=Object.assign(Error('聊天优先，后台分析等待空闲时段'),{code:'LOCAL_ANALYSIS_DEFERRED'});
 await assert.rejects(auditModelCompletion({record:r=>rows.push(r),backend:'local',run:async()=>{throw error;}}),e=>e===error);
 assert.equal(rows.at(-1).status,'deferred');
 assert.equal(describeInvocation({tool:'model.complete',status:'failed',error:error.message}).status,'deferred');
 assert.equal(describeInvocation({tool:'speech',status:'failed',error:'HTTP 500'}).status,'failed');
});

test('speech HTTP failure preserves useful server detail and redacts credentials',async()=>{
 await assert.rejects(requestLocalSpeech({type:'voicelab',baseUrl:'http://127.0.0.1:7870'},{text:'你好',fetchImpl:async()=>Response.json({detail:'显存不足 Bearer secret123456'},{status:500})}),error=>/显存不足/.test(error.message)&&!error.message.includes('secret123456'));
 const state=await voiceServiceState({type:'voicelab',baseUrl:'http://127.0.0.1:7870'},{fetchImpl:async()=>Response.json({busy:false,loaded:false,phase:'error',error:'显存不足'})});assert.equal(state.error,'显存不足');assert.equal(state.alive,true);
});
