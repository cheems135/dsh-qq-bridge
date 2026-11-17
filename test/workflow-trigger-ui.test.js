import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readConsoleSource} from './console-source.js';

const source = readConsoleSource();
function code(name) {
  const start = source.indexOf('  function ' + name + '(');
  assert.ok(start >= 0, name + ' exists');
  const tail = source.slice(start + 1);
  const end = tail.search(/\n  (?:async )?function |\n  var /);
  assert.ok(end > 0, name + ' has a boundary');
  return source.slice(start, start + end + 1);
}
const esc = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
function localContext(workflows) {
  const rows = workflows.map(item => ({querySelector(selector) {
    const field = /^\[data-wf="([^"]+)"\]$/.exec(selector)?.[1];
    if (field) return {value: field === 'outputNode' ? item.output?.node || '' : field === 'outputField' ? item.output?.field || '' : item[field] ?? ''};
    return null;
  }}));
  const context = vm.createContext({
    esc, document: {querySelectorAll: () => rows}, localDefaultsDraft: {image: 'image-1', video: 'video-1'},
    localWorkflowDraft: workflows, localImportMarkup: () => '',
  });
  for (const name of ['localMapValue', 'localWorkflowMarkup', 'captureLocalWorkflows']) vm.runInContext(code(name), context);
  return context;
}

test('local image and video trigger words remain editable and survive capture/readback', () => {
  const context = localContext([
    {id: 'image-1', name: '图片', kind: 'image', file: 'image.json', triggerWords: 'old_image',
      promptModel: 'flux', fixedPromptMode: 'preserve', discovery: {version: 1}, extraNodes: [{nodeId: '9'}], output: {node: '2'}, inputs: {}},
    {id: 'video-1', name: '视频', kind: 'video', file: 'video.json', triggerWords: 'old_video', output: {node: '3'}, inputs: {}},
    {id: 'chat-1', name: '聊天', kind: 'chat', file: 'chat.json', output: {node: '4'}, inputs: {}},
  ]);
  const markup = context.localWorkflowMarkup();
  assert.equal((markup.match(/data-wf="triggerWords"/g) || []).length, 2);
  assert.match(markup, /LoRA 触发词／固定追加词/);
  assert.match(markup, /old_image/);
  assert.match(markup, /old_video/);
  const captured = context.captureLocalWorkflows();
  assert.equal(captured[0].triggerWords, 'old_image');
  assert.equal(captured[1].triggerWords, 'old_video');
  assert.equal(captured[0].promptModel, 'flux');
  assert.equal(captured[0].fixedPromptMode, 'preserve');
  assert.equal(captured[0].discovery.version, 1);
  assert.equal(captured[0].extraNodes[0].nodeId, '9');
  assert.equal(captured[2].triggerWords, undefined);
  context.localWorkflowDraft = captured;
  assert.match(context.localWorkflowMarkup(), /old_image/);
  assert.match(context.localWorkflowMarkup(), /old_video/);
});

test('RunningHub trigger words are visible near workflow name and captured for current entry', () => {
  const elements = Object.fromEntries(Object.entries({
    rhId: '123', rhName: '我的 LoRA', rhNote: '', rhReference: 'auto', rhPromptLanguage: '',
    rhPromptModel: 'auto', rhFixedMode: 'refine', rhTriggers: 'fish_lora', rhMode: 'workflow',
    rhNode: '6', rhField: 'text', rhInstance: 'lite', rhExtra: '', rhQueue: '', rhAuto: '',
  }).map(([id, value]) => [id, {value, checked: false}]));
  const context = vm.createContext({
    esc, $: id => elements[id] || null,
    imagegenDraft: {runninghub: {workflows: [{id: 'r1', name: '我的 LoRA', workflowId: '123', mode: 'workflow'}], activeWorkflowId: 'r1'}},
    data: {settings: {imagegen: {}}}, imagegenTypedKeys: {}, studioCaptureInputs: value => value,
    rhParseExtraNodes: () => [], rhRoutingMarkup: () => '<div>路由</div>', rhModelMarkup: () => '',
  });
  for (const name of ['rhEntry', 'rhLibrary', 'rhCapture', 'rhTriggerMarkup', 'rhLibraryMarkup']) vm.runInContext(code(name), context);
  const captured = context.rhCapture();
  assert.equal(captured.workflows[0].triggerWords, 'fish_lora');
  const markup = context.rhLibraryMarkup(context.rhLibrary(captured));
  assert.ok(markup.indexOf('LoRA 触发词／固定追加词') < markup.indexOf('id="rhNote"'));
  assert.match(markup, /fish_lora/);
});
