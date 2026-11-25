import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {resourceFileEvidence,resourceOutputFiles} from '../resource-files.js';
import {registerDigitalArtifact} from '../digital-artifacts.js';
import {createMusicInput,musicTarget,webpageAudioCandidates} from '../music-input.js';
import {renderRunningHubAudio} from '../runninghub-audio.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(process.cwd(),'resource-check-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('actual tool outputs can be shared from any download directory, for arbitrary file formats, preserving originals',t=>{
 const dir=fixture(t),root=path.join(dir,'archive'),file=path.join(dir,'platform-download.custom');fs.mkdirSync(root);fs.writeFileSync(file,'real original');
 const resources=resourceFileEvidence({content:[{type:'text',text:JSON.stringify({result:{downloads:[{path:file}]}})}]});assert.equal(resources.length,1);
 const r=registerDigitalArtifact(root,file,{action:'import',trustedFiles:resources});assert.equal(r.ok,true);assert.equal(r.originalPreserved,true);assert.equal(fs.readFileSync(r.file,'utf8'),'real original');assert.equal(fs.readFileSync(file,'utf8'),'real original');
 fs.writeFileSync(file,'changed after tool completed');assert.equal(registerDigitalArtifact(root,file,{action:'import',trustedFiles:resources}).ok,false);
 assert.deepEqual(resourceOutputFiles({content:[{type:'text',text:'a made-up file is at '+file}]}),[]);
});
test('credential files and paths without successful source evidence do not become shareable',t=>{
 const dir=fixture(t),root=path.join(dir,'archive'),file=path.join(dir,'notes.txt'),secret=path.join(dir,'.env');fs.mkdirSync(root);fs.writeFileSync(file,'notes');fs.writeFileSync(secret,'not for sharing');
 assert.equal(registerDigitalArtifact(root,file,{action:'import'}).ok,false);
 assert.deepEqual(resourceFileEvidence({file:secret}),[]);
 assert.equal(registerDigitalArtifact(root,secret,{action:'import',workspace:dir}).ok,false);
});
test('resource receipts stay isolated by current account, persona, chat and successful status',()=>{
 const source=fs.readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  function resourceEvidenceFor('),end=source.indexOf('\n  function verifiedSharedFile',start);
 const rows=[{personaId:'p',chat:'private:1',status:'returned',resources:[{file:'correct'}]},{personaId:'other',chat:'private:1',status:'returned',resources:[{file:'other-persona'}]},{personaId:'p',chat:'private:2',status:'returned',resources:[{file:'other-chat'}]},{personaId:'p',chat:'private:1',status:'failed',resources:[{file:'failed'}]}];
 const fn=Function('invocationJournal',source.slice(start,end)+';return resourceEvidenceFor;')({list:args=>{assert.equal(args.accountId,'a');return rows;}});
 assert.deepEqual(fn({accountId:'a',personaId:'p',key:'private:1'}),[{file:'correct'}]);
});
test('generic song pages discover real media without a fixed platform or audio suffix',async t=>{
 const dir=fixture(t),calls=[];
 assert.equal(musicTarget('https://other-platform.example/song/42').provider,'web');assert.equal(musicTarget('javascript:alert(1)'),null);
 assert.deepEqual(webpageAudioCandidates('<audio src="/stream?id=42&amp;token=ok"></audio>','https://other-platform.example/song/42'),['https://other-platform.example/stream?id=42&token=ok']);
 const music=createMusicInput({getCacheDir:()=>dir,request:async url=>{calls.push(url);return url.includes('/song/')?{status:200,headers:{'content-type':'text/html'},bytes:Buffer.from('<audio src="/stream?id=42"></audio>')}:{status:200,headers:{'content-type':'audio/ogg'},bytes:Buffer.from('OggS'+'a'.repeat(300))};}});
 const r=await music.resolve({url:'https://other-platform.example/song/42',includeLyrics:false,title:'actual title'});assert.equal(r.title,'actual title');assert.equal(fs.existsSync(r.file),true);assert.equal(calls.length,2);
});
test('RunningHub follows bounded redirects and accepts actual Ogg audio without forwarding credentials',async()=>{
 const seen=[],ogg=Buffer.from('OggS'+'x'.repeat(300));
 const result=await renderRunningHubAudio({config:{id:'123456789',mode:'app',outputIndex:0,nodeInfoList:[{nodeId:'1',fieldName:'audio',fieldValue:'{{song_audio}}'}]},kind:'sing',inputs:{song_audio:'song.mp3'},apiConfig:{apiKey:'secret'},poll:async()=>{},request:async(_c,p)=>p.includes('/run/')?{taskId:'12'}:{status:'SUCCESS',results:[{url:'https://cdn.example/download',fileType:'audio/ogg'}]},fetchImpl:async(url,options)=>{seen.push(url.href);assert.equal(options.headers,undefined);assert.equal(options.redirect,'manual');return seen.length===1?new Response(null,{status:302,headers:{location:'https://other-cdn.example/stream'}}):new Response(ogg);}});
 assert.equal(result.extension,'ogg');assert.deepEqual(result.bytes,ogg);assert.equal(seen.length,2);
});
