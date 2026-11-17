import test from 'node:test';
import assert from 'node:assert/strict';
import {breezeSpeech,breezeExtras,voiceCacheKey} from '../voice-studio.js';
const audio=Buffer.alloc(1000);audio.write('ID3');
const config={engine:'breeze',breeze:{mode:'official',apiKey:'fixture',voiceId:'voc_identity',guidance:2}};
async function capture(voice,options={},line='你终于回来了'){let result;await breezeSpeech(line,voice,options,async(url,request)=>{result={url,body:JSON.parse(request.body)};return new Response(audio);});return result;}
test('strong emotions do not change the selected voice, saved guidance or default speed',async()=>{
 for(const emotion of ['crying','afraid','angry','excited','laugh']){
  const r=await capture(config,{emotion,instructions:'保持所选音色，表达当前强烈情绪',autoTags:false});
  assert.match(r.url,/\/voc_identity\?/);assert.equal(r.body.voice_settings.guidance_scale,2);
  assert.equal(r.body.voice_settings.speed,undefined);assert.equal(r.body.text,'你终于回来了');
 }
});
test('explicit speed is preserved and does not multiply by emotion, including saved speed',async()=>{
 const saved={...config,breeze:{...config.breeze,speed:1.15}};
 assert.equal(breezeExtras(saved).speed,1.15);
 assert.equal((await capture(saved,{emotion:'crying'})).body.voice_settings.speed,1.15);
 assert.equal((await capture(saved,{emotion:'crying',speed:1.05})).body.voice_settings.speed,1.05);
 assert.equal((await capture(saved,{emotion:'crying',speed:1})).body.voice_settings.speed,undefined);
 assert.notEqual(voiceCacheKey('同一句',saved),voiceCacheKey('同一句',config));
});
test('ordinary speech keeps explicit user tags and legacy automatic tags require an explicit opt-in',async()=>{
 assert.equal((await capture(config,{emotion:'crying',autoTags:false},'[哭声]你终于回来了')).body.text,'[哭声]你终于回来了');
 assert.equal((await capture(config,{emotion:'crying'})).body.text,'你终于回来了');
 assert.equal((await capture(config,{emotion:'crying',autoTags:true})).body.text,'[抽泣]你终于回来了');
});
test('changing voice identity or synthesis controls cannot reuse a previous voice recording',()=>{
 const line='同一句',plan={emotion:'crying',instructions:'当前方向'},before=voiceCacheKey(line,config,plan);
 for(const patch of [{voiceId:'voc_different'},{model:'another-model'},{guidance:3},{speed:1.1},{baseUrl:'https://another.example'},{instructions:'新的固定音色方向'}]){
  assert.notEqual(voiceCacheKey(line,{...config,breeze:{...config.breeze,...patch}},plan),before,JSON.stringify(patch));
 }
 assert.equal(voiceCacheKey(line,config,plan),before);
});
