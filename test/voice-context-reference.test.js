import test from 'node:test';
import assert from 'node:assert/strict';
import {parseOperationReview} from '../operation-context.js';
import {VOICE_MOODS,sceneNames,resolveVoiceDelivery,breezeSpeech} from '../voice-studio.js';

const direction='先因为计划被打断而着急，听到还有办法后慢慢稳下来，末句放轻';
function review(emotion,manual='auto'){
 return parseOperationReview({intent:'回应当前对话',delivery:{emotion,instructions:direction}}, {kind:'voice',emotion:manual});
}
test('every supported mood and scene survives review through synthesis selection',()=>{
 for(const mood of [...VOICE_MOODS.filter(x=>x.id!=='auto').map(x=>x.id),...sceneNames()]){
  const parsed=review(mood);
  const delivery=resolveVoiceDelivery({emotion:'auto'},{text:'我们换个办法试试'},parsed);
  assert.equal(parsed.delivery.emotion,mood,mood);
  assert.equal(delivery.emotion,mood,mood);
  assert(delivery.instructions.startsWith(direction),mood+': '+delivery.instructions);
 }
});
test('Chinese combinations remain expressive; manual selection wins and unknown labels degrade',()=>{
 assert.equal(review('委屈+害怕').delivery.emotion,'crying+afraid');
 assert.equal(resolveVoiceDelivery({emotion:'auto'},{text:'我们再试一次'},review('委屈+害怕')).emotion,'crying+afraid');
 assert.equal(review('crying','serious').delivery.emotion,'serious');
 assert.equal(review('not-a-mood').delivery.emotion,'natural');
});
test('actual synthesis request keeps contextual change before long saved directions',async()=>{
 const parsed=review('紧张');
 const config={emotion:'auto',breeze:{mode:'official',apiKey:'fixture',voiceId:'voc_fixture',instructions:'保持音色稳定，'.repeat(60)}};
 const line='那我们就换个办法，慢慢来。';
 const delivery=resolveVoiceDelivery(config,{text:line},parsed);
 let request;
 const mp3=Buffer.alloc(1200);mp3.write('ID3');
 await breezeSpeech(line,config,delivery,async(_url,opts)=>{request=JSON.parse(opts.body);return new Response(mp3);});
 assert(request.instructions.startsWith(direction),request.instructions);
 assert(request.instructions.length<=160);
 assert.equal(request.text.replace(/\[[^\]]+\]/g,''),line);
 assert.equal(request.text,line,'普通情绪不自动插入惊呼或吸气标签');
 assert(!request.text.includes(direction));
});
test('crying directions do not invent an injury as the cause',()=>{
 const delivery=resolveVoiceDelivery({emotion:'auto'},{text:'我们改天再见吧'},review('crying'));
 assert(!delivery.instructions.includes('被打到'));
});
