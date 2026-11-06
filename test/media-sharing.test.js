import test from 'node:test';
import assert from 'node:assert/strict';
import {sharingConfig,sharingLedger,reserveShare,finishShare} from '../media-sharing.js';

const now=Date.parse('2026-11-05T12:00:00+08:00');
const scope={kind:'voice',key:'private:10001',personaId:'persona-a',topic:'同一段录音'};

test('limited sharing keeps repeated-topic rejection',()=>{
  const config=sharingConfig({enabled:true,limits:true,duringChat:true,minGapMinutes:10,maxVoicePerDay:20});
  const ledger=sharingLedger({},now);
  const first=reserveShare(config,ledger,{...scope,now});
  assert.ok(first);
  ledger.lastAt=0;
  assert.equal(reserveShare(config,ledger,{...scope,now:now+1}),null);
  assert.equal(ledger.counts.voice,1);
});

test('limits false allows the same topic again but retains each reservation identity',()=>{
  const config=sharingConfig({enabled:true,limits:false,duringChat:true,minGapMinutes:1440,maxVoicePerDay:0});
  const ledger=sharingLedger({},now);
  const first=reserveShare(config,ledger,{...scope,now});
  const second=reserveShare(config,ledger,{...scope,now:now+1});
  assert.ok(first);
  assert.ok(second);
  assert.notEqual(first.id,second.id);
  assert.equal(ledger.counts.voice,2);
  assert.deepEqual(ledger.log.map(item=>item.id),[first.id,second.id]);
  finishShare(ledger,first,'completed');
  assert.equal(ledger.log.find(item=>item.id===first.id).status,'completed');
  assert.equal(ledger.log.find(item=>item.id===second.id).status,'generating');
  finishShare(ledger,second,'failed','test failure');
  assert.equal(ledger.log.find(item=>item.id===second.id).status,'failed');
  assert.equal(ledger.log.find(item=>item.id===second.id).error,'test failure');
});

test('limits false still honors media kind and mode switches',()=>{
  const config=sharingConfig({enabled:true,limits:false,duringChat:true,voice:false,images:true});
  const ledger=sharingLedger({},now);
  assert.equal(reserveShare(config,ledger,{...scope,now}),null);
  assert.equal(ledger.counts.voice,0);
});
