import {readFileSync} from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRunningHubAudio,runningHubAudioNodes,validateRunningHubAudio} from '../runninghub-audio.js';

const config=validateRunningHubAudio({sing:{id:'2055815336380911617',outputIndex:1,referenceAudio:'api/reference.wav',nodeInfoList:[
  {nodeId:'12',fieldName:'audio',fieldValue:'{{song_audio}}'},
  {nodeId:'14',fieldName:'audio',fieldValue:'{{reference_audio}}'}
]}}).sing;
const wav=Buffer.alloc(300);
wav.write('RIFF');wav.write('WAVE',8);

test('singing maps the song and reference independently and requires a real song input',()=>{
  assert.throws(()=>runningHubAudioNodes(config,'sing',{}),/歌曲片段/);
  assert.deepEqual(runningHubAudioNodes(config,'sing',{song_audio:'api/song.mp3'}).map(n=>n.fieldValue),['api/song.mp3','api/reference.wav']);
  assert.throws(()=>runningHubAudioNodes(config,'sing',{song_audio:'../song.mp3'}),/歌曲片段/);
  assert.throws(()=>validateRunningHubAudio({speech:{id:config.id,nodeInfoList:config.nodeInfoList}}),/text/);
});

test('AI application submits once and downloads the configured audio output',async()=>{
  const calls=[],receipts=[];
  const out=await renderRunningHubAudio({config,kind:'sing',inputs:{song_audio:'api/song.mp3'},apiConfig:{apiKey:'secret'},
    onTask:id=>receipts.push(id),poll:async()=>{},
    request:async(_cfg,path,payload)=>{
      calls.push([path,payload]);
      if(calls.length===1)return {taskId:'12345'};
      if(calls.length===2)return {status:'RUNNING'};
      return {status:'SUCCESS',results:[{url:'https://cdn.example/meta.json'},{url:'https://cdn.example/first.mp3'},{url:'https://cdn.example/final.wav?signature=test'}]};
    },
    fetchImpl:async(url,options)=>{
      assert.equal(url.pathname,'/final.wav');
      assert.equal(options.headers,undefined);
      return new Response(wav);
    }
  });
  assert.equal(out.extension,'wav');assert.equal(out.taskId,'12345');
  assert.deepEqual(receipts,['12345']);
  assert.equal(calls[0][0],'/openapi/v2/run/ai-app/'+config.id);
  assert.deepEqual(calls.slice(1).map(([path])=>path),['/openapi/v2/query','/openapi/v2/query']);
});

test('workflow submission timeout keeps task ID and stops without submitting again',async()=>{
  const calls=[];
  await assert.rejects(renderRunningHubAudio({config:{...config,mode:'workflow'},kind:'sing',inputs:{song_audio:'api/song.mp3'},apiConfig:{apiKey:'x'},
    request:async(_cfg,path)=>{calls.push(path);return {data:{taskId:'12345'}};},
    poll:async()=>{throw Error('timeout');}
  }),error=>error.taskId==='12345'&&error.deliveryUnknown===true);
  assert.deepEqual(calls,['/openapi/v2/run/workflow/'+config.id]);
});

test('QQ bridge entry loads the browser module and all static imports',async()=>{
  const plugin=await import('../index.js');
  assert.ok(plugin);
});

test('RunningHub terminal failure keeps task and node details without retry or uncertain status',async()=>{
  const calls=[];
  await assert.rejects(renderRunningHubAudio({config,kind:'sing',inputs:{song_audio:'api/source.mp3'},
    apiConfig:{apiKey:'private-fixture-key'},poll:async()=>{},
    request:async(_cfg,path,_payload,_method,options)=>{
      calls.push(path);
      if(calls.length===1)return {taskId:'1010'};
      assert.equal(options.acceptTaskFailure,true);
      return {status:'FAILED',errorCode:'805',failedReason:{node_name:'Demucs_Loader',exception_message:'Invalid argument private-fixture-key'}};
    },
  }),error=>error.taskId==='1010'&&error.deliveryUnknown===false&&/Demucs_Loader/.test(error.message)&&!/private-fixture-key/.test(error.message));
  assert.deepEqual(calls,['/openapi/v2/run/ai-app/'+config.id,'/openapi/v2/query']);
});

test('a locally opted-in RunningHub speech route can pass capability admission without mixed routes',()=>{
  const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
  const start=source.indexOf('  function applyMixedCapabilities(');
  const end=source.indexOf('\n  function visualSessionContextCurrent(',start);
  assert.ok(start>=0&&end>start);
  const state={voice:{runninghub:{speech:{id:'2055815336380911617'}}},imagegen:{runninghub:{apiKey:'test-key'}}};
  const sources={image:'local',speech:'runninghub',video:'local'};
  const capabilities=new Function('settings','serviceConnections','serviceSource',source.slice(start,end)+';return applyMixedCapabilities;')(
    state,{raw:()=>({routes:{enabled:false}})},kind=>sources[kind]);
  const snapshot={features:{image:{supported:true},speech:{supported:false}}};
  assert.equal(capabilities(snapshot).features.speech.supported,true);
  assert.equal(capabilities(snapshot).features.image,snapshot.features.image);
  state.imagegen.runninghub.apiKey='';
  assert.equal(capabilities(snapshot).features.speech.supported,false);
  sources.speech='local';
  assert.equal(capabilities(snapshot),snapshot);
});
