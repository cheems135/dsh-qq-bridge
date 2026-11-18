import test from 'node:test';
import assert from 'node:assert/strict';
import {createLifeMemory} from '../life-memory.js';
import {lifeExecutionStorage,createLifeExecution} from '../life-execution.js';
import {mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

test('a zero-filled execution file preserves the original, skips the uncertain slot and allows the following slot',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'bridge-life-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'life-execution.json'),damaged=Buffer.alloc(1236034);writeFileSync(file,damaged);
 let now=new Date(2026,10,18,16,10).getTime(),calls=0;
 const store=lifeExecutionStorage(file,()=>{},()=>now);
 const meta={accountId:'a',personaId:'p'};
 let scene={date:'2026-11-18',start:'16:00',end:'17:00',activity:'绘画',taskKind:'create'};
 const life=createLifeExecution({storage:store,roles:()=>[{meta}],config:()=>({enabled:true,execute:true}),sceneFor:()=>scene,allowed:()=>true,now:()=>now,dispatch:async()=>{calls++;return 'test-session';}});
 t.after(()=>life.close());
 assert.deepEqual(readFileSync(join(dir,readdirSync(dir).find(x=>x.includes('.corrupt-')))),damaged);
 await life.tick();assert.equal(calls,0);
 now+=3600000;scene={...scene,start:'17:00',end:'18:00'};await life.tick();assert.equal(calls,1);
 assert.deepEqual(JSON.parse(readFileSync(file)),JSON.parse(readFileSync(file+'.last-good')));
});

test('restoring an earlier valid execution record retains history and holds unverified actions',t=>{
 const dir=mkdtempSync(join(tmpdir(),'bridge-life-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'life-execution.json'),store=lifeExecutionStorage(file);
 const jobs=[{id:'done',status:'completed'},{id:'pending',status:'paused',resume:true}];
 store.write({version:2,jobs});writeFileSync(file,'{}');
 const restored=store.read();assert.deepEqual(restored.jobs[0],jobs[0]);assert.equal(restored.jobs[1].status,'needs_reconcile');assert.equal(restored.jobs[1].resume,false);
});

test('one corrupt calendar document cannot abort startup pruning', () => {
  const badName = `${'a'.repeat(64)}.json`;
  const life = createLifeMemory({
    storage: {
      list: () => [badName],
      read: () => { throw Object.assign(new Error('quarantined'), {code:'MEMORY_CORRUPT'}); },
      write: () => {},
      remove: () => { throw new Error('corrupt document must not be deleted by prune'); },
    },
    config: () => ({life:{enabled:false},memory:{enabled:false}}),
    allowed: () => true,
    roles: () => [],
    signature: () => '',
    ask: async () => '',
  });
  assert.doesNotThrow(() => life.prune(() => true));
  assert.deepEqual(life.scopes(), []);
});
