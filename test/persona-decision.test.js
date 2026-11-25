import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {personaDecisionPrompt, cosplayPrompt,qqPersonaSection,qqRuntimeSection,QQ_CONTEXT_LAYER_RULE,personaInjectionBlock} from '../dialogue-persona.js';
import {DIALOGUE_ONLY_RULE,DRAFT_VOICE_RULE} from '../dialogue-only.js';

test('QQ persona uses the same injection family at its end, with literal text and a separate runtime layer',()=>{
  const card='喜欢慢慢看云，保留模板字样 {{literal_card}}。';
  const prompt=personaDecisionPrompt({name:'青禾',card});
  assert.equal(prompt.split(QQ_CONTEXT_LAYER_RULE).length,2);
  assert.ok(prompt.indexOf(QQ_CONTEXT_LAYER_RULE)<prompt.indexOf(card));
  for(const configured of [0,-200000,25,NaN,undefined]){
    const layer=qqPersonaSection({getSectionOrder:()=>configured},prompt);
    const global={name:'dsh-purge',order:-100000,text:'GLOBAL_FIXTURE'};
    const ordered=[layer,global].sort((a,b)=>a.order-b.order);
    assert.equal(ordered[0],global);
    assert.equal(layer.text,personaInjectionBlock(prompt));
    assert.equal(layer.name,'dsh-purge:qq-persona');
    assert.equal(layer.interpolate,false);
    assert.notEqual(layer.complete,true);
  }
});

test('persona and runtime remain ordered inside the injection family before requests are frozen',()=>{
 const persona=qqPersonaSection(null,'我叫青禾，保留 {{literal_card}}'),runtime=qqRuntimeSection('RUNTIME');
 const sections=[runtime,persona,{name:'dsh-purge:tail',order:10150,text:'GLOBAL_END'}].sort((a,b)=>a.order-b.order);
 assert.deepEqual(sections.map(s=>s.name),['dsh-purge:tail','dsh-purge:qq-persona','dsh-purge:qq-runtime']);
 assert.equal(runtime.interpolate,false);assert.equal(persona.text.split('{{literal_card}}').length,2);
 assert(!persona.text.includes('知夏'));assert.equal(qqPersonaSection(null,'我叫知夏').text.includes('青禾'),false);
});

test('the selected card reaches the decision context before a long self description', () => {
  const self = '我喜欢看天气和云层。'.repeat(180);
  const card = '我会先留意材料的纹理。';
  const growth = '这位朋友在认真求助时更希望听到直接的意见。';
  const prompt = personaDecisionPrompt({self, card, growth, name:'阿衡'});
  assert.ok(prompt.indexOf(card) < prompt.indexOf(self));
  assert.ok(prompt.includes(self));
  assert.equal(prompt.split(growth).length, 2);
  assert.equal(prompt.split(card).length, 2);
  assert.equal(cosplayPrompt({self, card, growth, name:'阿衡'}), prompt);
});

test('switching to the empty self or a named empty card does not import another persona', () => {
  const self = '我一向重视守信。';
  const withoutCard = personaDecisionPrompt({self});
  const namedEmpty = personaDecisionPrompt({self, name:'未填写'});
  assert.ok(withoutCard.includes(self));
  assert.doesNotMatch(withoutCard, /当前人设卡/);
  assert.ok(namedEmpty.includes(self));
  assert.match(namedEmpty, /未填写/);
  assert.doesNotMatch(namedEmpty, /去演|穿上的角色/);
});

test('a correction preview uses the original account and persona through completion', async () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
  const start = source.indexOf("    if(route==='regenerate'){");
  const end = source.indexOf("    if(route==='correction'){", start);
  assert.ok(start >= 0 && end > start);
  const settings = {activeAccountId:'a', memory:{maxChars:100}};
  const card = {id:'p1'};
  let calls = 0;
  let duringRequest = () => {};
  const deps = {
    auditById:() => ({accountId:'a', chat:'private:1', persona:'p1'}),
    settings, activePersona:() => card, personaPromptText:p => personaDecisionPrompt({card:p.id}),
    DIALOGUE_ONLY_RULE,expressionHint:() => '', companionSettings:() => ({}),
    memoryText:() => ({text:''}), memories:{}, effectiveModel:() => '',
    askModel:async system => {
      assert.equal(system.split(DRAFT_VOICE_RULE).length,2);
      assert.ok(system.includes('p1'));
      calls++;
      duringRequest();
      return '预览';
    }
  };
  const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
  const run = new AsyncFunction('route', 'body', ...Object.keys(deps), source.slice(start, end));
  const preview = () => run('regenerate', {id:'1'}, ...Object.values(deps));
  settings.activeAccountId = 'b';
  await assert.rejects(preview, /桥接账号/);
  settings.activeAccountId = 'a';
  card.id = 'p2';
  await assert.rejects(preview, /使用的人设/);
  assert.equal(calls, 0);
  card.id = 'p1';
  assert.deepEqual(await preview(), {ok:true, draft:'预览'});
  duringRequest = () => { settings.activeAccountId = 'b'; };
  await assert.rejects(preview, /已失效/);
  settings.activeAccountId = 'a';
  duringRequest = () => { card.id = 'p2'; };
  await assert.rejects(preview, /已失效/);
  assert.equal(calls, 3);
});
