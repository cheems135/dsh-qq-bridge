import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync,copyFileSync} from 'node:fs';
import {join,basename} from 'node:path';
import {createSingingSourcePreparer,musicSearchCandidates} from '../singing-source.js';
import {createMusicInput} from '../music-input.js';
import {selectSingingPlan} from '../singing-plan.js';

const context={accountId:'account',personaId:'persona',key:'private:12345'};
function fixture(t,overrides={}){
 const root=mkdtempSync(join(process.cwd(),'auto-song-source-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const audio=join(root,'a'.repeat(64)+'.audio'),bytes=Buffer.alloc(512);bytes.write('RIFF');bytes.write('WAVE',8);writeFileSync(audio,bytes);
 const calls={resolve:0,upload:0,lookup:0};
 const helper=createSingingSourcePreparer({rootFor:c=>join(root,c.personaId),
  resolve:async input=>{calls.resolve++;return {file:audio,title:'稻香',author:'原唱',provider:'netease',songId:'12345',url:input.url};},
  probe:async()=>({duration:30,extension:'wav'}),materialize:async(file,_info,dir)=>{const target=join(dir,'source.wav');copyFileSync(file,target);return target;},
  upload:async input=>{calls.upload++;assert.equal(input.type,'audio');assert.equal(input.name,'稻香.wav');assert.deepEqual(Buffer.from(input.data,'base64'),bytes);return {fileName:'api/prepared.wav'};},
  lookup:async()=>{calls.lookup++;return [{url:'https://music.163.com/song?id=12345'}];},...overrides});
 return {root,audio,bytes,calls,helper};
}

test('a remembered song is resolved, named from actual metadata and uploaded without a person filling the workflow; repeats use the prepared source',async t=>{
 const {helper,calls}=fixture(t);
 const source=await helper.prepare({title:'稻香',candidates:[{url:'https://music.163.com/song?id=12345'}]},context);
 assert.equal(source.title,'稻香');assert.equal(source.artist,'原唱');assert.equal(source.verified,true);assert.equal(source.audio,'api/prepared.wav');
 assert.equal(calls.resolve,1);assert.equal(calls.upload,1);assert.equal(calls.lookup,0);
 const again=await helper.prepare({title:'稻香'},context);assert.equal(again.cached,true);assert.equal(calls.resolve,1);assert.equal(calls.upload,1);
 const plan=selectSingingPlan({request:'唱《稻香》',config:{songAudio:'api/old.wav',songTitle:'旧歌',songIdentityAudio:'api/old.wav'},sources:helper.list(context)});
 assert.equal(plan.action,'generate');assert.equal(plan.audio,'api/prepared.wav');assert.equal(plan.sourceSong.title,'稻香');
});

test('having only a title triggers lookup and real resolution before uploading',async t=>{
 const {helper,calls}=fixture(t);const source=await helper.prepare({title:'稻香'},context);
 assert.equal(source.title,'稻香');assert.equal(calls.lookup,1);assert.equal(calls.resolve,1);assert.equal(calls.upload,1);
});

test('the wrong song is not relabeled with the requested name, even when it downloads successfully',async t=>{
 let uploads=0;const {helper}=fixture(t,{upload:async()=>{uploads++;return {fileName:'api/wrong.wav'};},lookup:undefined});
 await assert.rejects(helper.prepare({title:'晴天',input:{url:'https://music.163.com/song?id=12345'}},context),error=>error.code==='SONG_ACQUISITION_FAILED'&&/与点歌.*不一致/.test(error.message));
 assert.equal(uploads,0);assert.equal(helper.list(context).length,0);
});

test('a downloaded hashed file without a real title cannot get the requested title blindly filled in',async t=>{
 let uploads=0;const {audio,helper}=fixture(t,{resolve:async()=>({file:audio,provider:'direct'}),probe:async()=>({duration:30,extension:'wav'}),upload:async()=>{uploads++;},lookup:undefined});
 await assert.rejects(helper.prepare({title:'稻香',input:{url:'https://example.invalid/source.mp3'}},context),/没有可靠歌名/);
 assert.equal(uploads,0);
});

test('a local extracted file uses its real audio tags; no network download or human naming is required',async t=>{
 const {audio,helper,calls}=fixture(t,{probe:async()=>({title:'稻香',artist:'原唱',duration:30,extension:'wav'})});
 const source=await helper.prepare({input:{file:audio}},context);assert.equal(source.title,'稻香');assert.equal(calls.resolve,0);assert.equal(calls.lookup,0);assert.equal(calls.upload,1);
});

test('simultaneous requests upload once and preserve account/persona boundaries',async t=>{
 const {helper,calls}=fixture(t);const input={title:'稻香',candidates:[{url:'https://music.163.com/song?id=12345'}]};
 const [a,b]=await Promise.all([helper.prepare(input,context),helper.prepare(input,context)]);
 assert.equal(a.id,b.id);assert.equal(calls.upload,1);assert.equal(helper.list({...context,personaId:'another'}).length,0);
});

test('changing the active scope while extracting prevents upload and persistence',async t=>{
 let active=true,uploads=0;const {helper}=fixture(t,{probe:async()=>{active=false;return {title:'稻香',extension:'wav'};},upload:async()=>{uploads++;}});
 await assert.rejects(helper.prepare({title:'稻香',input:{url:'https://music.163.com/song?id=12345'}},{...context,validate:()=>{if(!active)throw Error('scope changed');}}),/scope changed/);
 assert.equal(uploads,0);assert.equal(helper.list(context).length,0);
});

test('changing the RunningHub account does not reuse the previous account upload',async t=>{
 let key='first';const {helper}=fixture(t,{getUploadScope:()=>key});await helper.prepare({title:'稻香'},context);assert.equal(helper.list(context).length,1);key='second';assert.equal(helper.list(context).length,0);
});

test('search candidates include actual platform links, including Bing redirect targets, not guessed song IDs',()=>{
 const song='https://music.163.com/song?id=12345',redirect='https://www.bing.com/ck/a?u=a1'+Buffer.from(song).toString('base64url');
 const urls=musicSearchCandidates({links:[{url:redirect},{url:song}],text:'https://example.invalid/not-a-song'});
 assert.equal(urls.length,2);assert.equal(urls[0].id,'12345');assert.equal(urls[1].provider,'web');
});

test('source acquisition uses the existing music resolver and skips the unused lyrics request',async t=>{
 const root=mkdtempSync(join(process.cwd(),'source-resolver-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const requests=[];
 const music=createMusicInput({getCacheDir:()=>root,request:async url=>{requests.push(url);if(url.includes('/api/song/detail'))return {status:200,bytes:Buffer.from(JSON.stringify({songs:[{id:12345,name:'稻香',artists:[{name:'原唱'}],duration:30000}]}))};if(url.includes('/song/media/outer/url'))return {status:200,headers:{'content-type':'audio/mpeg'},bytes:Buffer.alloc(512,1)};throw Error('unexpected lyrics or other request');}});
 const song=await music.resolve({url:'https://music.163.com/song?id=12345',includeLyrics:false});assert.equal(song.title,'稻香');assert.equal(song.author,'原唱');assert.equal(song.lyrics,null);assert.equal(requests.length,2);
});
