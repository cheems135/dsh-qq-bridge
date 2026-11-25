import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {get} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {openBilibiliRange} from '../bilibili-range.js';
import {createVideoReader} from '../video-reader.js';

// FFmpeg connects directly over HTTP, including to OS-assigned ports blocked by Fetch.
function readRelay(url, range) {
  return new Promise((resolve,reject)=>{
    const req=get(url,{headers:range?{range}:{}},async res=>{
      try {
        const chunks=[];
        for await (const bytes of res) chunks.push(bytes);
        resolve({status:res.statusCode,headers:res.headers,bytes:Buffer.concat(chunks)});
      } catch (error) {reject(error);}
    });
    req.on('error',reject);
  });
}

test('Bilibili playback reads byte ranges on demand, including media indexes near the end',async t=>{
  const blockSize=256*1024;
  const size=16*blockSize+123;
  const requests=[];
  const relay=await openBilibiliRange({
    loadChunk:async(start,end)=>{
      requests.push([start,end]);
      return {total:size,bytes:Buffer.alloc(end-start+1,start/blockSize)};
    },
    formatOf:()=> 'mov',
  });
  t.after(()=>relay.close());
  const origin=new URL(relay.url).origin;
  assert.deepEqual(requests,[[0,blockSize-1]]);
  assert.equal((await readRelay(origin+'/different')).status,404);
  assert.equal((await readRelay(relay.url,'bytes='+size+'-')).status,416);

  const tail=await readRelay(relay.url,'bytes='+(size-8)+'-');
  assert.equal(tail.status,206);
  assert.equal(tail.headers['content-range'],'bytes '+(size-8)+'-'+(size-1)+'/'+size);
  assert.deepEqual(tail.bytes,Buffer.alloc(8,16));

  const next=await readRelay(relay.url,'bytes='+(blockSize-2)+'-'+(blockSize+1));
  assert.deepEqual(next.bytes,Buffer.from([0,0,1,1]));
  assert.deepEqual(requests,[[0,blockSize-1],[16*blockSize,size-1],[blockSize,2*blockSize-1]]);
});

test('closing Bilibili playback cancels an outstanding download',{timeout:5000},async t=>{
  const blockSize=256*1024;
  let began,aborted;
  const started=new Promise(resolve=>{began=resolve;});
  const stopped=new Promise(resolve=>{aborted=resolve;});
  const relay=await openBilibiliRange({
    async loadChunk(start,end,signal){
      if(start===0)return{total:blockSize*2,bytes:Buffer.alloc(end+1)};
      return new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>{aborted();reject(signal.reason);},{once:true});
        began();
      });
    },
    formatOf:()=> 'mov',
  });
  t.after(()=>relay.close());
  const response=readRelay(relay.url,'bytes='+blockSize+'-');
  await Promise.race([started,response.then(()=>assert.fail('Response ended before the requested chunk started'))]);
  relay.close();
  await Promise.all([stopped,assert.rejects(response,{code:'ECONNRESET'})]);
});

test('Bilibili video reader rejects a CDN response with a mismatched byte range',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'bili-range-'));
  const reads=[];
  const reader=createVideoReader({
    getConfig:()=>({ffmpegPath:process.execPath}),
    getCacheDir:()=>directory,
    spawnImpl:()=>assert.fail('malformed range reached FFmpeg'),
    fetchImpl:async(url,options)=>{
      reads.push({url,options});
      return new Response(Buffer.alloc(8),{status:206,headers:{'content-range':'bytes 1-8/9'}});
    },
  });
  t.after(()=>{reader.close();rmSync(directory,{force:true,recursive:true});});
  await assert.rejects(reader.read({source:'bilibili',url:'https://cdn.bilivideo.com/test.mp4'}),{code:'VIDEO_RESOURCE'});
  assert.equal(reads.length,1);
  const {options}=reads[0];
  assert.equal(options.headers.Range,'bytes=0-262143');
  assert.equal(options.headers.Cookie,undefined);
  assert.equal(options.redirect,'error');
  assert.equal(options.credentials,'omit');
});
