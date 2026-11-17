import test from 'node:test';import assert from 'node:assert/strict';
import {compactLocalProtocol} from '../local-context.js';import {strictActionProtocol} from '../local-agent.js';
test('context compaction preserves mandatory next website tool and completed search progress',()=>{
 const protocol=strictActionProtocol({bridge_tools:{kind:'data',execute:async()=>({}),parameters:{type:'object'},description:'router'}},{requiredDataTools:['bridge_read']})+'\n【本轮执行进度】[{"tool":"bridge_search","ok":true}]。下一步链接来自真实搜索回执，不重复搜索。';
 const compact=compactLocalProtocol(protocol);assert.ok(compact.length<protocol.length);assert.match(compact,/本轮必须实际执行的工具：bridge_read/);assert.match(compact,/"action":"schema","name":"bridge_read"/);assert.match(compact,/"tool":"bridge_search","ok":true/);
});
