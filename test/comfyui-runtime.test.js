import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createComfyRuntime} from '../comfyui-runtime.js';

test('Comfy output is downloaded and written only after MIME verification', async () => {
  const mediaDir = mkdtempSync(join(tmpdir(), 'local-agent-comfy-'));
  let submittedWorkflow;
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const fetchImpl = async (url, init = {}) => {
    const value = String(url);
    if (value.endsWith('/prompt')) {
      submittedWorkflow = JSON.parse(init.body);
      return new Response(JSON.stringify({prompt_id: 'prompt-1'}), {status: 200, headers: {'content-type': 'application/json'}});
    }
    if (value.includes('/history/prompt-1')) {
      return new Response(JSON.stringify({'prompt-1': {outputs: {'2': {images: [{filename: 'result.png', subfolder: '', type: 'output'}]}}}}), {status: 200});
    }
    if (value.includes('/view?')) return new Response(png, {status: 200, headers: {'content-type': 'image/png'}});
    throw new Error('unexpected url ' + value);
  };
  const runtime = createComfyRuntime({
    root: process.cwd(),
    mediaDir,
    fetchImpl,
    getConfig: () => ({
      baseUrl: 'http://127.0.0.1:8188',
      mediaDir,
      workflows: {
        studio: {
          api: {'1': {inputs: {text: ''}}, '2': {inputs: {}}},
          inputs: {prompt: {node: '1', field: 'text'}},
          output: {node: '2', field: 'images', kind: 'image'},
          timeoutMs: 5000,
        },
      },
    }),
  });
  try {
    const result = await runtime.run('studio', {prompt: '海边', seed: 7});
    assert.equal(result.ok, true);
    assert.equal(result.media.length, 1);
    assert.equal(result.media[0].kind, 'image');
    assert.deepEqual(readFileSync(result.media[0].file), png);
    assert.equal(submittedWorkflow.prompt['1'].inputs.text, '海边');
  } finally {
    rmSync(mediaDir, {recursive: true, force: true});
  }
});

test('native Comfy images are uploaded and bound to the chat node on a private workflow copy',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'native-upload-'));
  const {writeFileSync}=await import('node:fs');const image=join(directory,'input.png');writeFileSync(image,Buffer.from('89504e470d0a1a0a','hex'));
  const workflow={'1':{class_type:'QwenTE_MultiTurnChat',inputs:{'用户消息':'','当前图片JSON':'[]'}}};let submitted;
  const runtime=createComfyRuntime({root:process.cwd(),getConfig:{baseUrl:'http://127.0.0.1:8188',mediaDir:directory,memoryProfile:'8gb',workflows:{chat:{api:workflow,inputs:{text:{node:'1',field:'用户消息'},images:{node:'1',field:'当前图片JSON'}},output:{node:'1',field:'助手回复'}}}},fetchImpl:async(url,init={})=>{
    if(url.endsWith('/upload/image'))return Response.json({name:'actual.png',subfolder:'bridge'});
    if(url.endsWith('/prompt')){submitted=JSON.parse(init.body).prompt;return Response.json({prompt_id:'native'});}
    if(url.endsWith('/history/native'))return Response.json({native:{outputs:{'1':{'助手回复':['看到了实际图片。']}}}});
    throw Error('unexpected url '+url);
  }});
  try{
    const result=await runtime.run('chat',{text:'看看这张图',imageFiles:[image]});assert.equal(result.text,'看到了实际图片。');
    assert.equal(submitted['1'].inputs['用户消息'],'看看这张图');
    assert.deepEqual(JSON.parse(submitted['1'].inputs['当前图片JSON']),[{filename:'actual.png',subfolder:'bridge',type:'input'}]);
    assert.equal(workflow['1'].inputs['当前图片JSON'],'[]');
  }finally{rmSync(directory,{recursive:true,force:true});}
});
