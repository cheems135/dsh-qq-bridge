import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,utimesSync} from 'node:fs';import {join} from 'node:path';
import {LOG_RETENTION_MS,recentRecords,pruneDiagnosticState,pruneLogFile,pruneOperationLogs} from '../log-retention.js';
const now=Date.parse('2026-11-07T19:00:00+08:00');
test('seven-day diagnostic expiry respects the boundary and never touches chat history, memories or delivery control',()=>{
 const old={at:now-LOG_RETENTION_MS-1,status:'failed'},fresh={at:now-LOG_RETENTION_MS,status:'returned'},state={bridgeIssues:[old,fresh],invocations:[old,fresh],audits:[old,fresh],messages:[old],memories:{old},outbox:[old],inbox:[old],qqActions:[old]};
 assert.equal(recentRecords([old,fresh],now).length,1);assert.equal(pruneDiagnosticState(state,now),3);
 assert.deepEqual(state.messages,[old]);assert.deepEqual(state.outbox,[old]);assert.deepEqual(state.inbox,[old]);assert.equal(state.memories.old,old);assert.deepEqual(state.qqActions,[old]);
});
test('timestamped text logs remove old records with their stack continuation lines and retain recent errors',()=>{
 const dir=mkdtempSync(new URL('../.retention-test-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')),file=join(dir,'bridge.log');
 try{writeFileSync(file,'[2026-10-20T00:00:00.000Z] old error\n    old stack\n[2026-11-07T10:00:00.000Z] new error\n    new stack\n');assert.equal(pruneLogFile(file,{now}),2);assert.equal(readFileSync(file,'utf8'),'[2026-11-07T10:00:00.000Z] new error\n    new stack\n');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('only recognized daily operation logs expire; settings and similarly named user files survive',()=>{
 const dir=mkdtempSync(new URL('../.retention-test-',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'));
 try{const old=join(dir,'2026-10-20.jsonl'),current=join(dir,'2026-11-07.jsonl');writeFileSync(old,JSON.stringify({at:now-15*86400000})+'\n');writeFileSync(current,JSON.stringify({at:now})+'\n');writeFileSync(join(dir,'settings.json'),'keep');mkdirSync(join(dir,'2026-10-01.jsonl'));
  pruneOperationLogs(dir,{now});assert.equal(existsSync(old),false);assert(existsSync(current));assert.equal(readFileSync(join(dir,'settings.json'),'utf8'),'keep');assert(existsSync(join(dir,'2026-10-01.jsonl')));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
