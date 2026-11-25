import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLocalModelServer} from '../local-model-server.mjs';
import {listenLocalServer} from './local-server-listen.js';

test('gateway diagnostics keep the service origin and HTTP status without copying secrets or model text', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'local-private-log-'));
  const logFile = join(directory, 'gateway.log');
  const configToken = 'FIXTURE-ONLY-QUERY-TOKEN';
  const modelText = 'FIXTURE-ONLY-PRIVATE-REPLY';
  const lines = [];
  const service = createLocalModelServer({
    configFile: join(directory, 'config.json'),
    env: {LOCAL_AI_WORK_DIR: directory, LOCAL_AI_LOG_FILE: logFile, LOCAL_MEDIA_DIR: directory},
    logger: line => lines.push(line),
    runtime: {status: async () => ({reachable: true}), release: async () => ({freed: true})},
    fetchImpl: async url => String(url).endsWith('/chat/completions')
      ? new Response(modelText, {status: 422})
      : Response.json({queue_running: [], queue_pending: []}),
  });
  try {
    const base = await listenLocalServer(service);
    const post = (route, payload) => fetch(base + route, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify(payload),
    });
    const configResponse = await post('/config', {
      backend: 'openai',
      modelId: 'fixture-model',
      modelBaseUrl: 'http://127.0.0.1:8000/v1',
      comfyUrl: 'http://127.0.0.1:8188/private-path?token=' + configToken,
    });
    assert.equal(configResponse.status, 200);
    const turn = await post('/v1/local/turn', {
      messages: [{role: 'user', content: '你好'}],
      turnContext: {toolsEnabled: false},
    });
    assert.equal(turn.status, 500);
    assert.ok((await turn.json()).error.message.includes(modelText));
    for (const output of [lines.join('\n'), readFileSync(logFile, 'utf8')]) {
      assert.match(output, /config backend=openai .*comfy=http:\/\/127\.0\.0\.1:8188(?:\n|$)/);
      assert.match(output, /local turn error elapsedMs=\d+ error HTTP 422/);
      assert.ok(!output.includes(configToken));
      assert.ok(!output.includes(modelText));
    }
  } finally {
    await service.close();
    rmSync(directory, {recursive: true, force: true});
  }
});
