import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createDrawingStudio} from '../drawing-studio.js';

const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
const actor={accountId:'drawing-test',personaId:'artist'};
const shape={type:'line',x1:1,y1:1,x2:20,y2:20};
test('editing a drawing invalidates its exported preview and a late renderer cannot overwrite a newer result',async t=>{
 const root=mkdtempSync(join(tmpdir(),'qq-drawing-export-'));
 t.after(()=>rmSync(root,{recursive:true,force:true}));
 let render=async(_svg,file)=>writeFileSync(file,pixel);
 const studio=createDrawingStudio({getRoot:()=>root,render:(...args)=>render(...args)});
 const {id}=await studio.act({action:'create'},actor);
 const draw=()=>studio.act({action:'draw',id,shapes:[shape]},actor);
 const exportPng=()=>studio.act({action:'render',id},actor);
 const list=async()=>(await studio.act({action:'list'},actor)).works[0];
 await draw();
 const first=await exportPng();
 assert.equal(studio.verifyArtifact(first.file,actor).ok,true);
 await draw();
 assert.equal((await list()).needsRender,true);
 assert.equal((await list()).file,undefined);
 assert.throws(()=>studio.verifyArtifact(first.file,actor),/原画本/);

 // A failed retry keeps the previous bytes and the editable two-stroke draft.
 render=async(_svg,file)=>writeFileSync(file,pixel.subarray(0,28));
 await assert.rejects(exportPng(),/有效/);
 assert.deepEqual(readFileSync(first.file),pixel);
 assert.equal((await list()).strokes,2);

 let release;
 const waiting=new Promise(resolve=>{release=resolve;});
 render=async(_svg,file)=>{await waiting;writeFileSync(file,pixel);};
 const older=exportPng();
 await draw();
 render=async(_svg,file)=>writeFileSync(file,pixel);
 const newest=await exportPng();
 release();
 await assert.rejects(older,/已有新笔画/);
 assert.equal((await list()).strokes,3);
 assert.equal((await list()).file,newest.file);
 assert.equal(studio.verifyArtifact(newest.file,actor).ok,true);

 // Older projects did not save renderedStrokes. Match their existing source
 // and export, even across restarts, without redrawing or discarding the draft.
 const json=newest.file.replace(/\.png$/u,'.json');
 const legacy=JSON.parse(readFileSync(json,'utf8'));
 delete legacy.renderedStrokes;
 writeFileSync(json,JSON.stringify(legacy));
 const moment=new Date(1700000000000),later=new Date(moment.getTime()+5000);
 utimesSync(newest.sourceFile,moment,moment);utimesSync(newest.file,later,later);
 assert.equal((await list()).file,newest.file);
 assert.equal(studio.verifyArtifact(newest.file,actor).ok,true);
 legacy.shapes.push(shape);writeFileSync(json,JSON.stringify(legacy));
 assert.equal((await list()).needsRender,true);
 assert.throws(()=>studio.verifyArtifact(newest.file,actor),/原画本/);
});
