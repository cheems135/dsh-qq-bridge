import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPromptContext,
  normalizeLocalConfig,
  normalizeWorkflowSpec,
  resolveMediaWorkflow,
} from '../local-config.js';

test('only prompt mapping is required for media workflows', () => {
  const spec = normalizeWorkflowSpec({
    file: 'assets/comfyui/example.json',
    inputs: {
      prompt: {node: '1', field: 'text'},
      negativePrompt: {node: '', field: ''},
      seed: {node: '', field: ''},
      image: {node: '', field: ''},
    },
    output: {kind: 'image', node: '2', field: 'images'},
  }, 'workflows.image');
  assert.equal(spec.inputs.prompt.node, '1');
  assert.equal(spec.inputs.negativePrompt.node, '');
  assert.equal(spec.inputs.seed.field, '');
  assert.throws(() => normalizeWorkflowSpec({
    file: 'example.json',
    inputs: {prompt: {node: '', field: ''}},
    output: {kind: 'image'},
  }, 'workflows.image'), /inputs\.prompt/);
});

test('explicit workflow library is authoritative; legacy slots migrate only when the library is absent', () => {
  const config = normalizeLocalConfig({
    workflowLibrary: [{
      id: 'soft-portrait',
      name: '柔和自拍',
      kind: 'image',
      description: '日常角色自拍',
      file: 'assets/comfyui/example.json',
      inputs: {prompt: {node: '1', field: 'text'}},
    }],
    defaultWorkflows: {image: 'soft-portrait', video: ''},
    workflows: {
      image: {file: '', inputs: {prompt: {node: '', field: ''}}},
      video: {
        file: 'assets/comfyui/video.json',
        inputs: {prompt: {node: '3', field: 'text'}},
        output: {kind: 'video'},
      },
    },
  });
  assert.equal(config.modelId, config.chatWorkflow);
  assert.equal(config.workflowLibrary.length, 1);
  assert.equal(resolveMediaWorkflow(config, 'image').id, 'soft-portrait');
  assert.throws(() => resolveMediaWorkflow(config, 'video'), /没有选中当前视频工作流/);
  const migrated = normalizeLocalConfig({workflows: config.workflows});
  assert.equal(resolveMediaWorkflow(migrated, 'video').id, 'video-default');
  assert.equal(normalizeLocalConfig({workflowLibrary: []}, migrated).workflowLibrary.length, 0);
});

test('local media uses only the manually selected workflow, even when a model names another one', () => {
  const entry = (id, kind) => ({id, name:id, kind, file:`${id}.json`, inputs:{prompt:{node:'1',field:'text'}}});
  const library = [entry('portrait', 'image'), entry('landscape', 'image'), entry('motion', 'video')];
  const unselected = normalizeLocalConfig({workflowLibrary:library});
  assert.equal(unselected.defaultWorkflows.image, '');
  assert.equal(unselected.defaultWorkflows.video, 'motion');
  assert.throws(() => resolveMediaWorkflow(unselected, 'image', 'landscape'), /没有选中当前图片工作流/);
  const selected = normalizeLocalConfig({defaultWorkflows:{image:'portrait'}}, unselected);
  assert.equal(resolveMediaWorkflow(selected, 'image', 'landscape').id, 'portrait');
  const cleared = normalizeLocalConfig({defaultWorkflows:{image:''}}, selected);
  assert.equal(cleared.defaultWorkflows.image, '');
  assert.throws(() => resolveMediaWorkflow(cleared, 'image'), /没有选中/);
  assert.throws(() => normalizeLocalConfig({defaultWorkflows:{image:'missing'}}, selected), /不存在/);
});

test('video workflow keeps its fixed LoRA trigger words through config save and reload', () => {
  const item={id:'motion',name:'动作视频',kind:'video',file:'motion.json',inputs:{prompt:{node:'1',field:'text'}},triggerWords:'motion_style\n<lora:motion:0.8>'};
  const saved=normalizeLocalConfig({workflowLibrary:[item],defaultWorkflows:{video:'motion'}});
  assert.equal(resolveMediaWorkflow(saved,'video').triggerWords,item.triggerWords);
  const reloaded=normalizeLocalConfig(JSON.parse(JSON.stringify(saved)));
  assert.equal(resolveMediaWorkflow(reloaded,'video').triggerWords,item.triggerWords);
});

test('workflow and address validation rejects unsafe values', () => {
  assert.throws(() => normalizeLocalConfig({workflowLibrary: [{id: 'x', name: 'x', kind: 'audio', file: 'x.json'}]}), /kind/);
  assert.throws(() => normalizeLocalConfig({workflowLibrary: [
    {id: 'same', name: 'a', kind: 'image', file: 'a.json', inputs: {prompt: {node: '1', field: 'x'}}},
    {id: 'same', name: 'b', kind: 'video', file: 'b.json', inputs: {prompt: {node: '1', field: 'x'}}},
  ]}), /重复/);
  assert.throws(() => normalizeLocalConfig({comfyUrl: 'http://example.com:8188'}), /回环/);
  assert.throws(() => normalizeLocalConfig({backend: 'remote'}), /backend/);
});

test('prompt context keeps every system message and the latest user exactly once', () => {
  const context = buildPromptContext([
    {role: 'system', content: '角色'},
    {role: 'system', content: '记忆'},
    {role: 'user', content: '旧问题'},
    {role: 'assistant', content: '旧回答'},
    {role: 'user', content: '当前问题'},
  ], {historyChars: 1000});
  assert.equal(context.system, '角色\n\n记忆');
  assert.equal(context.user, '当前问题');
  assert.deepEqual(context.history, [
    {role: 'user', content: '旧问题'},
    {role: 'assistant', content: '旧回答'},
  ]);
  assert.equal(JSON.stringify(context).split('当前问题').length - 1, 1);
});

test('local vision and memory profiles validate supported modes',()=>{
  const config=normalizeLocalConfig({});assert.equal(config.visionMode,'auto');assert.equal(config.memoryProfile,'8gb');
  assert.throws(()=>normalizeLocalConfig({visionMode:'cloud'}),/看图方式/);
  assert.throws(()=>normalizeLocalConfig({memoryProfile:'unbounded'}),/显存方案/);
});
