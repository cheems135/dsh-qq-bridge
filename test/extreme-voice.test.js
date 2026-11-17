import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeVoiceMood,resolveVoiceDelivery,breezeSpeech} from '../voice-studio.js';
import {parseOperationReview} from '../operation-context.js';
test('descriptive labels returned by the real model preserve crying, anger and ecstatic laughter',()=>{
 const examples=[['恐惧压抑转崩溃+强烈哭腔+抽噎','afraid+crying'],['压抑愤怒爆发+气息急促+失控','angry+breathless'],['狂喜+笑到发颤','excited+laugh']];
 for(const [emotion,expected]of examples){assert.equal(normalizeVoiceMood(emotion),expected);assert.equal(parseOperationReview({intent:'当前配音',delivery:{emotion,instructions:'按当前情境表达强烈情绪，保留原台词'}},{kind:'voice',request:'你终于回来了'}).delivery.emotion,expected);}
 assert.equal(normalizeVoiceMood('未知描述+强烈哭腔'),'crying');assert.equal(normalizeVoiceMood('不要哭'),'natural');assert.equal(normalizeVoiceMood('not angry'),'natural');assert.equal(normalizeVoiceMood('奇怪标签'),'natural');
});
test('a concrete shouting direction reaches the real synthesizer without restrained default cues',async()=>{
 const config={emotion:'auto',breeze:{mode:'official',apiKey:'fixture',voiceId:'fixture',guidance:2}};
 const plan=resolveVoiceDelivery(config,{text:'你终于回来了'},{delivery:{emotion:'angry',instructions:'愤怒爆发，大声喊出这句话，气息急促，重音尖锐。'}});
 assert(!/但不喊|克制|提一档/.test(plan.instructions));assert.match(plan.instructions,/大声喊/);
 let payload;const audio=Buffer.alloc(1000);audio.write('ID3');await breezeSpeech('[喊叫]你终于回来了',config,plan,async(_u,options)=>{payload=JSON.parse(options.body);return new Response(audio);});
 assert.equal(payload.instructions,plan.instructions);assert.equal(payload.text,'[喊叫]你终于回来了');assert.equal(payload.voice_settings.guidance_scale,2);
});
