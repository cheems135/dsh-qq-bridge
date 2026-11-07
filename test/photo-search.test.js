import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {preferredPhotoSource,readPhotoResponse} from '../photo-search.js';

test('photo source quality scoring matches real hostnames, not a URL containing a trusted name',()=>{
 for(const url of ['https://images.unsplash.com/a.jpg','https://pexels.com/photo/1'])assert.equal(preferredPhotoSource(url),true);
 for(const url of ['https://unsplash.com.attacker.example/a.jpg','https://other.example/unsplash.com/a.jpg','not a URL'])assert.equal(preferredPhotoSource(url),false);
});

test('photo downloads enforce the size bound during transfer, including without Content-Length',async()=>{
 const chunks=[new Uint8Array(8),new Uint8Array(8)];let cancelled=false;
 const response=new Response(new ReadableStream({start(c){chunks.forEach(x=>c.enqueue(x));},cancel(){cancelled=true;}}));
 await assert.rejects(readPhotoResponse(response,10),/大小上限/);assert.equal(cancelled,true);
 await assert.rejects(readPhotoResponse(new Response('abc',{headers:{'content-length':'100'}}),10),/大小上限/);
 assert.equal((await readPhotoResponse(new Response(new Uint8Array([1,2,3])),10)).toString('hex'),'010203');
});

test('the ordinary search-photo entry selects a downloaded candidate without missing-domain errors',async()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8'),start=source.indexOf('  async function searchPhoto('),end=source.indexOf('\n  }',start)+4;
 assert.ok(start>0);const photos=[],plain='https://other.example/picture.jpg',stock='https://images.unsplash.com/picture.jpg';
 const dependencies={photoFromLibrary:()=>null,settings:{photo:{minWidth:800}},bingImageUrls:async()=>[plain,stock],log:()=>{},fetch:async url=>new Response(Buffer.alloc(50000,url===stock?2:1)),AbortSignal,USER_AGENT:'test',readPhotoResponse,sniffImage:()=> 'image/jpeg',imageSize:()=>({width:1000,height:800}),preferredPhotoSource,join:(...parts)=>parts.join('/'),cacheRoot:'cache',mkdirSync:()=>{},writeFileSync:(_file,bytes)=>photos.push(bytes),Buffer,Date};
 const search=Function(...Object.keys(dependencies),'return ('+source.slice(start,end).trim()+');')(...Object.values(dependencies));
 const file=await search('窗边绿植');assert.match(file,/\.jpg$/);assert.equal(photos.length,1);assert.equal(photos[0][0],2);
});
