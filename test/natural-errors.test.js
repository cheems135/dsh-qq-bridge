import test from 'node:test';import assert from 'node:assert/strict';import {localIssueReply} from '../local-issue-reply.js';
test('persona tones vary without technical leaks, fake success, gestures or extra model calls',()=>{
 const error=Error('TypeError C:/private/sk-secret');const first=localIssueReply(error,{style:'playful',scope:'test'}),second=localIssueReply(error,{style:'playful',scope:'test'});
 assert.notEqual(first,second);assert.match(first,/没做成/);assert.doesNotMatch(first,/TypeError|private|sk-secret|[（(]|已完成|已经发出/);
 assert.match(localIssueReply(Error('arguments 参数错误')),/格式没写对/);
 assert.match(localIssueReply(Object.assign(Error('pause'),{code:'SCHEDULE_TOOL_PAUSED'})),/四次.*下个日程/);
});
test('unknown completion does not encourage blind retry and API errors preserve their actual reason',()=>{
 assert.match(localIssueReply(Error('timeout')),/不能确认.*免得重复/);
 assert.match(localIssueReply(Error('fetch failed')),/核对.*再决定/);
 const reply=localIssueReply(Error('401 unauthorized'),{backend:'api'});assert.match(reply,/账号或密钥验证/);assert.doesNotMatch(reply,/本地窗口|ECONN|401/);
});
