import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseRunningHubExample} from '../image-studio.js';
import {importRunningHubAudio} from '../runninghub-audio-import.js';
import {runningHubAudioNodes} from '../runninghub-audio.js';
import {recognizeServiceRequest} from '../ui/execution-overview.js';

const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const json=name=>JSON.parse(read(name));
const catalog=json('assets/api-presets/catalog.json');

test('every published RunningHub request is accepted by the real example importer with its original ID',()=>{
 for(const entry of catalog.presets){
  const curl=read('assets/api-presets/'+entry.requestFile),body=json('assets/api-presets/'+entry.jsonFile);
  const parsed=parseRunningHubExample(curl),service=recognizeServiceRequest(curl,entry.kind);
  assert.equal(parsed.targetId,entry.appId);assert.equal(service.type,'runninghub');
  assert.equal(body.webappId,entry.appId);assert.equal(parsed.fields.length,body.nodeInfoList.length);
  for(const node of body.nodeInfoList){const field=parsed.fields.find(f=>f.nodeId===node.nodeId&&f.fieldName===node.fieldName);assert(field);assert.equal(String(field.value),String(node.fieldValue));}
 }
});

test('both singing presets bind voice and source correctly and leave account-specific uploads to the user',()=>{
 for(const entry of catalog.presets.filter(p=>p.kind==='sing')){
  for(const extension of ['requestFile','jsonFile']){
   const result=importRunningHubAudio(read('assets/api-presets/'+entry[extension]),'sing',{referenceAudio:'api/my-reference.wav',songAudio:''});
   assert.deepEqual(result.warnings,[]);assert.equal(result.config.referenceAudio,'api/my-reference.wav');assert.equal(result.config.songAudio,'');
   const nodes=runningHubAudioNodes(result.config,'sing',{song_audio:'api/my-new-song.wav',reference_audio:'api/my-reference.wav',song_start:'0:00',song_end:'0:30'});
   const songId=entry.appId==='2102953894560231426'?'1':'45',voiceId=entry.appId==='2102953894560231426'?'2':'23';
   assert.equal(nodes.find(n=>n.nodeId===songId&&n.fieldName==='audio').fieldValue,'api/my-new-song.wav');
   assert.equal(nodes.find(n=>n.nodeId===voiceId&&n.fieldName==='audio').fieldValue,'api/my-reference.wav');
   if(entry.appId==='2055815336380911617'){assert.equal(result.config.outputNodeId,'46');assert.equal(result.config.outputIndex,1);assert.equal(nodes.find(n=>n.nodeId==='57'&&n.fieldName==='end_time').fieldValue,'0:30');}
  }
 }
});

test('the bundled speaking reference is an actual WAV and reference crop stays inside its measured duration',()=>{
 const info=json('assets/voice-presets/reference.json'),bytes=readFileSync(new URL('../assets/voice-presets/'+info.file,import.meta.url));
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WAVE');
 assert.equal(bytes.length,info.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),info.sha256);
 let rate=0,size=0;for(let at=12;at+8<=bytes.length;){const type=bytes.toString('ascii',at,at+4),n=bytes.readUInt32LE(at+4);if(type==='fmt ')rate=bytes.readUInt32LE(at+16);if(type==='data')size=n;at+=8+n+(n%2);}
 assert(Math.abs(size/rate-info.durationSeconds)<.001);
 const current=json('assets/api-presets/rh-sing-current.json');assert(Number(current.nodeInfoList.find(n=>n.nodeId==='6').fieldValue)<=size/rate);
});

test('preset data has no usable keys, uploaded media handles or account login state',()=>{
 const body=[...catalog.presets.flatMap(p=>[read('assets/api-presets/'+p.requestFile),read('assets/api-presets/'+p.jsonFile)]),read('assets/api-presets/breeze-speech.json')].join('\n');
 assert.doesNotMatch(body,/api\/[a-f0-9]{32,}\.|sk-[a-zA-Z0-9]{24,}|ghp_[a-zA-Z0-9]{24,}|Cookie:|session_token/i);
 const breeze=json('assets/api-presets/breeze-speech.json');assert.equal(breeze.breeze.apiKey,'');assert.equal(breeze.engine,'breeze');assert.equal(breeze.breeze.model,'breeze-tts-2');
 assert.equal(catalog.automaticApply,false);assert.equal(catalog.noBundledAccountUploads,true);
});

test('quickstart documentation and reference assets are included in the package manifest',()=>{
 const pkg=json('package.json');assert(pkg.files.includes('assets/**'));
 for(const doc of ['quickstart.md','api-workflows.md','feature-guide.md']){
  assert(pkg.files.includes('docs/'+doc));
  for(const link of read('docs/'+doc).matchAll(/\]\(([^)]+)\)/g))if(!/^https?:|^#/.test(link[1]))assert(existsSync(new URL('../docs/'+link[1].split('#')[0],import.meta.url)),doc+': '+link[1]);
 }
 assert(pkg.files.includes('test/fixtures/runninghub-sing-2102953894560231426.txt'));
});
