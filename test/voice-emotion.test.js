import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {emotionProfile,guidanceFor,composeDirection,anchorTags,VOICE_PERFORMANCE_REVISION} from '../voice-performance.js';
import {breezeDelivery,resolveVoiceDelivery,breezeSpeech,MOOD_TAGS,voiceCacheKey,voiceExtras} from '../voice-studio.js';

// 证据：情绪由音高、语速/停顿、能量、音质多通道共同承载（Banse & Scherer 1996；
// Juslin & Laukka 2003）。所以不同情绪必须在不止一个通道上有差异。
test('不同情绪给出不同的听感线索，而不是只换一个形容词',()=>{
  const anger=emotionProfile('angry'),sad=emotionProfile('sad');
  assert.ok(Array.isArray(anger.cues)&&anger.cues.length===2);
  assert.notDeepEqual(anger.cues,sad.cues);
  assert.ok(anger.arousal>sad.arousal);
});

// 官方示例是一句话；长指令、分条脚本会被模型念出来。
test('方向必须是一句话短指令，不超过 160 字且不分条',()=>{
  for(const mood of ['angry','sad','happy','crying','whisper','gentle']){
    const text=composeDirection({mood});
    assert.ok(text.length<=160,mood+' 太长：'+text.length);
    assert.ok(!/\n/.test(text),mood+' 不能换行');
    assert.ok(!/具体做法|音高：|语速与停顿：|1\.|①/.test(text),mood+' 不能像分条脚本：'+text);
  }
});

test('调用方方向保留在前面，且只追加一句听感线索',()=>{
  const own='她刚被放了鸽子，压着失望但不发火';
  const text=composeDirection({mood:'sad',userDirection:own});
  assert.ok(text.startsWith(own),text);
  assert.ok(text.length<=160);
  assert.match(text,/只改表演，不改台词/);
});

test('重复合并不会越来越长（幂等）',()=>{
  const once=composeDirection({mood:'sad',userDirection:'压着失望'});
  const twice=composeDirection({mood:'sad',userDirection:once});
  const thrice=composeDirection({mood:'sad',userDirection:thriceInput(twice)});
  assert.equal(twice,once);assert.equal(thrice,once);
});
function thriceInput(v){return v;}
test('Chinese speech preserves extra direction and an explicit new request even after a previous merge',()=>{
 const once=composeDirection({mood:'sad',userDirection:'压着失落',extra:'保持当前音色，别拖长最后一个字'});
 assert.match(once,/压着失落/);assert.match(once,/保持当前音色/);assert.match(once,/别拖长/);
 const updated=composeDirection({mood:'happy',userDirection:'这次轻快一些',extra:once});assert.match(updated,/这次轻快一些/);assert.match(updated,/保持当前音色/);
 assert.equal(updated.split('只改表演，不改台词').length-1,1);assert(updated.length<=160);
});

test('英文台词不混进中文指令',()=>{
  const text=composeDirection({mood:'sad',userDirection:'Hold it together',language:'en',extra:'Quiet.'});
  assert.ok(!/[\u4e00-\u9fa5]/.test(text),text);
  assert.match(text,/Hold it together/);
});

// 多插方括号可能被念出来；一次句首足矣。
test('标签只在句首加一次，台词本体不变',()=>{
  const tag=MOOD_TAGS.sad,line='你今天回来得好晚，我一直在等你，饭都凉了。';
  const anchored=anchorTags(line,tag);
  assert.equal(anchored,tag+line);
  assert.equal(anchored.split(tag).join(''),line);
  assert.equal(anchorTags('真的吗',MOOD_TAGS.happy),MOOD_TAGS.happy+'真的吗');
});

test('台词已有方括号事件、空台词、无标签时都不改动原文',()=>{
  assert.equal(anchorTags('[轻笑]真的吗',MOOD_TAGS.happy),'[轻笑]真的吗');
  assert.equal(anchorTags('',MOOD_TAGS.happy),'');
  assert.equal(anchorTags('真的吗',undefined),'真的吗');
});

// 官方建议表现力档位起点 1–3。
test('说话保留面板引导强度，不按情绪自动抬高',()=>{
  assert.equal(guidanceFor('angry',2),2);assert.equal(guidanceFor('happy',2),2);assert.equal(guidanceFor('sad',2),2);
  assert.equal(guidanceFor('whisper',2),2);assert.equal(guidanceFor('angry',4),4);assert.equal(guidanceFor('happy',1),1);
});

test('auto 模式使用审核提供的方向，不额外堆叠固定的语速音量',()=>{
  const config={engine:'breeze',emotion:'auto',breeze:{mode:'official',voiceId:'voc_x',model:'breeze-tts-2'}};
  const review={delivery:{emotion:'sad',instructions:'她等了一晚上，声音有点发空'}};
  const out=resolveVoiceDelivery(config,{text:'你今天回来得好晚。'},review);
  assert.equal(out.emotion,'sad');
  assert.match(out.instructions,/等了一晚上/);
  assert.match(out.instructions,/声音有点发空/);
  assert.doesNotMatch(out.instructions,/语速明显放慢|音量偏低|；；/);
  assert.ok(out.instructions.length<=160,out.instructions.length+' 字');
});

test('手动选情绪时不丢审核方向和自定义音色方向',()=>{
  const config={engine:'breeze',emotion:'happy',breeze:{mode:'official',voiceId:'voc_x',model:'breeze-tts-2',instructions:'保持清亮自然的当前音色'}};
  const review={delivery:{emotion:'happy',instructions:'她真的等到了'}};
  const out=resolveVoiceDelivery(config,{text:'你终于来了！'},review);
  assert.match(out.instructions,/她真的等到了/);
  assert.match(out.instructions,/清亮自然/);
  assert.ok(out.instructions.length<=160);
});

// 真链路：发出去的正文只有台词加一个句首标签，指令是短句，档位符合唤醒度。
test('实际请求正文不被指令污染，指令短且只发一次',async()=>{
  const bodies=[];const mp3=Buffer.alloc(1200);mp3.write('ID3');
  const line='你今天回来得好晚，我一直在等你，饭都凉了。';
  const config={engine:'breeze',emotion:'auto',breeze:{mode:'official',apiKey:'mock-key',voiceId:'voc_x',model:'breeze-tts-2',guidance:2}};
  await breezeSpeech(line,config,{emotion:'sad',instructions:'压着失望'},async(_u,o)=>{bodies.push(JSON.parse(o.body));return new Response(mp3,{status:200});});
  const body=bodies[0];
  assert.equal(body.text,line,'普通语音正文保留原台词，不自动加情绪事件标签');
  assert.ok(body.instructions.length<=160,body.instructions.length+' 字：'+body.instructions);
  assert.equal(body.instructions.split('只改表演，不改台词').length-1,1,'方向不能被重复合并');
  assert.equal(body.voice_settings.guidance_scale,2);
});

test('高唤醒情绪的真实请求仍使用保存的档位 2',async()=>{
  let body=null;const mp3=Buffer.alloc(1200);mp3.write('ID3');
  await breezeSpeech('你到底想怎么样！',{engine:'breeze',breeze:{mode:'official',apiKey:'mock-key',voiceId:'voc_x',model:'breeze-tts-2',guidance:2}},{emotion:'angry'},async(_u,o)=>{body=JSON.parse(o.body);return new Response(mp3,{status:200});});
  assert.equal(body.voice_settings.guidance_scale,2);
  assert.equal(body.text,'你到底想怎么样！');
});

test('情绪版本号可用于缓存失效',()=>{
  assert.equal(typeof VOICE_PERFORMANCE_REVISION,'string');assert(VOICE_PERFORMANCE_REVISION.length>0);
  const versioned=revision=>new Function('createHash','voiceExtras','VOICE_PERFORMANCE_REVISION','return ('+voiceCacheKey.toString()+')')(createHash,voiceExtras,revision);
  const line='今天我想早点休息。',config={engine:'breeze',breeze:{apiKey:'test-only'}},plan={mood:'sad',instructions:'当前方向'};
  assert.equal(versioned(VOICE_PERFORMANCE_REVISION)(line,config,plan),voiceCacheKey(line,config,plan));
  assert.notEqual(versioned('previous-recipe')(line,config,plan),voiceCacheKey(line,config,plan),'表演配方版本变化必须使旧录音缓存失效');
  assert.equal(voiceCacheKey(line,config,plan),voiceCacheKey(line,config,plan),'同一版本和输入仍复用缓存');
});
