import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalGroupWindow} from '../local-group-window.js';
test('one mention activates two minutes and generation time does not consume them',()=>{
 let time=0;const window=createLocalGroupWindow({now:()=>time});window.activate('a:p:g');time=30000;assert.equal(window.snapshot('a:p:g').remainingMs,90000);
 const resume=window.pause('a:p:g');time+=300000;assert.equal(window.active('a:p:g'),true);assert.equal(window.snapshot('a:p:g').remainingMs,90000);resume();time+=89999;assert.equal(window.active('a:p:g'),true);time++;assert.equal(window.active('a:p:g'),false);
});
test('overlapping attention and generation pauses count their union, and repeat mention resets two minutes',()=>{
 let time=0;const window=createLocalGroupWindow({now:()=>time});window.activate('a:p:g');time=20000;const releaseA=window.pause('a:p:g');time=30000;const releaseB=window.pause('a:p:g');time=60000;releaseA();releaseA();time=90000;assert.equal(window.snapshot('a:p:g').remainingMs,100000);window.activate('a:p:g');assert.equal(window.snapshot('a:p:g').paused,true);time=120000;releaseB();assert.equal(window.snapshot('a:p:g').remainingMs,120000);time+=120000;assert.equal(window.active('a:p:g'),false);
});
test('groups and scopes remain independent and cancellation cannot resurrect an expired window',()=>{
 let time=0;const window=createLocalGroupWindow({now:()=>time});window.activate('a:p:g1');window.activate('a:p:g2');const resume=window.pause('a:p:g1');time=120000;assert.equal(window.active('a:p:g2'),false);assert.equal(window.active('other:p:g1'),false);assert.equal(window.active('a:other:g1'),false);assert.equal(window.active('a:p:g1'),true);window.clear();resume();assert.equal(window.active('a:p:g1'),false);const noRevive=window.pause('a:p:g2');noRevive();assert.equal(window.active('a:p:g2'),false);
});
