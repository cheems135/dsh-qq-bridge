import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {profileBackgroundRoute, profileBackgroundScope, storedProfileBackgroundUrl} from '../qq-profile-background.js';

// Exercise the same magic-byte reader as the plugin, with complete packaged images.
const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function hostFunction(pattern) {
  const definition=source.match(pattern);
  assert.ok(definition, 'production image helper is present');
  return Function('return (' + definition[0] + ')')();
}
const sniffImage = hostFunction(/^function sniffImage\(bytes\) \{[\s\S]*?^\}/m);
const imageSize = hostFunction(/^  function imageSize\(bytes, mediaType\) \{[\s\S]*?^  \}/m);
const artwork = name => readFileSync(new URL('../assets/' + name, import.meta.url));
const png = artwork('runninghub-neutral-canvas.png');
const jpeg = artwork('preset/肥鱼087.jpg');
const webp = artwork('preset/大肥鱼001.webp');
const first = {state:'ready', accountId:'desktop', selfId:'123456789', connection:{}, revision:1};

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(),'qq-card-background-'));
  const env = {root:join(dir,'cache-a'), scope:{...first}};
  const route = profileBackgroundRoute({
    sniffImage, imageSize, getRoot:()=>env.root, getScope:()=>({...env.scope}),
    jsonResponse(res, status, body) {
      res.statusCode=status;
      res.setHeader('Content-Type','application/json');
      res.end(Buffer.from(JSON.stringify(body)));
    },
  });
  assert.equal(route.kind,'exact');
  const scope = () => profileBackgroundScope(env.scope.accountId,env.scope.selfId);
  const url = () => route.path + '?scope=' + scope();
  const folder = () => join(env.root,'qq-profile-backgrounds');
  const files = () => existsSync(folder()) ? readdirSync(folder()).sort() : [];
  t.after(() => {
    try {
      const names = readdirSync(dir,{recursive:true});
      assert.ok(names.every(name=>!String(name).endsWith('.tmp')), 'no temporary upload files remain');
    } finally { rmSync(dir,{recursive:true,force:true}); }
  });
  function start(method, {path = url(), headers = {}} = {}) {
    const req = Object.assign(new PassThrough(), {method, url:path, headers:{host:'bridge.test',...headers}, socket:{encrypted:false}});
    let finish;
    const done = new Promise(resolve=>{ finish=resolve; });
    const responseHeaders = {};
    const res = {statusCode:200, destroyed:false, setHeader(name,value) { responseHeaders[name.toLowerCase()]=value; },
      end(bytes) { finish({status:this.statusCode, headers:responseHeaders, body:Buffer.from(bytes || '')}); }};
    route.handler(req,res);
    return {req,done};
  }
  async function perform(method, bytes, options) {
    const {req,done} = start(method,options);
    req.end(bytes);
    return done;
  }
  const save = (bytes = png, mime = 'image/png', options = {}) => perform('POST',bytes,
    {...options,headers:{'content-type':mime,'content-length':String(bytes.length),...options.headers}});
  return {env,dir,url,scope,folder,files,start,perform,save};
}

test('background routes return unchanged JPEG, PNG and WebP bytes with their actual type and private cache headers', async t => {
  const f = fixture(t);
  assert.equal((await f.perform('GET')).status,404);
  assert.equal(storedProfileBackgroundUrl(f.env.root,f.scope()),'');
  const urls = new Set();
  for (const [mime,bytes] of [['image/jpeg',jpeg],['image/png',png],['image/webp',webp]]) {
    assert.equal(sniffImage(bytes),mime);
    const reply = await f.save(bytes,mime === 'image/webp' ? 'application/octet-stream' : mime);
    assert.equal(reply.status,200);
    const {cardBackgroundUrl,cardBackgroundSource} = JSON.parse(reply.body);
    assert.equal(cardBackgroundSource,'local');
    assert.equal(cardBackgroundUrl,storedProfileBackgroundUrl(f.env.root,f.scope()));
    urls.add(cardBackgroundUrl);
    const picture = await f.perform('GET',null,{path:cardBackgroundUrl});
    assert.equal(picture.status,200);
    assert.equal(picture.headers['content-type'],mime);
    assert.match(picture.headers['cache-control'],/private.*no-store/);
    assert.equal(picture.headers['x-content-type-options'],'nosniff');
    assert.equal(picture.headers['cross-origin-resource-policy'],'same-origin');
    assert.deepEqual(picture.body,bytes);
  }
  assert.equal(urls.size,3);
  assert.deepEqual(f.files(),[f.scope()+'.image']);
  for (let i=0;i<2;i++) {
    const reply=await f.perform('DELETE');
    assert.equal(reply.status,200);
    assert.deepEqual(JSON.parse(reply.body),{ok:true,cardBackgroundUrl:'',cardBackgroundSource:''});
  }
  assert.equal((await f.perform('GET')).status,404);
  assert.deepEqual(f.files(),[]);
});

test('mismatched MIME, nonimages, and unsupported content never overwrite existing artwork', async t => {
  const f=fixture(t);
  await f.save();
  for (const [bytes,mime] of [[jpeg,'image/png'],[png,'text/html'],[Buffer.from('<svg><script></script></svg>'),'application/octet-stream'],
    [Buffer.from('ordinary text, no picture'),'image/jpeg'],[Buffer.alloc(0),'image/png']]) {
    assert.equal((await f.save(bytes,mime)).status,415);
  }
  assert.deepEqual((await f.perform('GET')).body,png);
  assert.deepEqual(f.files(),[f.scope()+'.image']);
});

test('incomplete raster files keep the previous original even when the MIME and magic bytes look right', async t => {
  const f=fixture(t);
  await f.save();
  for (const [bytes,mime] of [[png,'image/png'],[jpeg,'image/jpeg'],[webp,'image/webp']]) {
    const cut=bytes.subarray(0,36);
    assert.equal(sniffImage(cut),mime);
    assert.equal((await f.save(cut,mime)).status,415,mime);
  }
  assert.deepEqual((await f.perform('GET')).body,png);
});

test('limit on declared size and streamed bytes, partial read error and premature end keep the old image', async t => {
  const f=fixture(t);
  await f.save();
  const overLimit=8*1024*1024 + 1;
  assert.equal((await f.save(jpeg,'image/jpeg',{headers:{'content-length':String(overLimit)}})).status,413);
  const stream=f.start('POST',{headers:{'content-type':'application/octet-stream'}});
  stream.req.write(Buffer.alloc(overLimit-1));
  stream.req.end(Buffer.alloc(1));
  assert.equal((await stream.done).status,413);
  const broken=f.start('POST',{headers:{'content-type':'image/webp'}});
  broken.req.write(webp.subarray(0,50));
  broken.req.destroy(new Error('test connection closed'));
  assert.equal((await broken.done).status,400);
  assert.equal((await f.save(jpeg,'image/jpeg',{headers:{'content-length':String(jpeg.length+1)}})).status,400);
  assert.deepEqual((await f.perform('GET')).body,png);
  assert.deepEqual(f.files(),[f.scope()+'.image']);
});

test('backgrounds are isolated by both selected account and authenticated QQ; old links cannot read, replace, or delete', async t => {
  const f=fixture(t);
  const firstUrl=f.url();
  await f.save(png);
  const storedA=storedProfileBackgroundUrl(f.env.root,f.scope());
  const accountA={...f.env.scope};
  f.env.scope={...accountA,accountId:'other',connection:{}};
  assert.equal((await f.perform('GET')).status,404);
  for (const verb of ['GET','POST','DELETE']) assert.equal((await f.perform(verb,webp,{path:firstUrl})).status,409);
  await f.save(jpeg,'image/jpeg');
  assert.deepEqual((await f.perform('GET')).body,jpeg);
  f.env.scope={...accountA,selfId:'987654321',revision:2};
  assert.equal((await f.perform('GET')).status,404);
  assert.equal((await f.perform('GET',null,{path:storedA})).status,409);
  await f.save(webp,'image/webp');
  await f.perform('DELETE');
  f.env.scope=accountA;
  assert.deepEqual((await f.perform('GET')).body,png);
  for (const state of ['paused','unbound','offline']) {
    f.env.scope={...accountA,state};
    for (const verb of ['GET','POST','DELETE']) assert.equal((await f.perform(verb,png,{path:firstUrl})).status,409);
  }
  f.env.scope=accountA;
  assert.deepEqual((await f.perform('GET')).body,png);
});

test('a pending upload rechecks account, receiver, connection, revision, availability and cache root before committing', async t => {
  const f=fixture(t);
  await f.save();
  const original={...f.env,scope:{...f.env.scope}};
  const originalUrl=storedProfileBackgroundUrl(f.env.root,f.scope());
  for (const change of [
    ()=>{f.env.scope.accountId='other';}, ()=>{f.env.scope.selfId='555555555';},
    ()=>{f.env.scope.connection={};}, ()=>{f.env.scope.revision++;},
    ()=>{f.env.scope.state='paused';}, ()=>{f.env.root=join(f.dir,'cache-b');},
  ]) {
    const upload=f.start('POST',{headers:{'content-type':'image/webp'}});
    upload.req.write(webp.subarray(0,16));
    change();
    upload.req.end(webp.subarray(16));
    assert.equal((await upload.done).status,409);
    Object.assign(f.env,original,{scope:{...original.scope}});
    assert.equal(storedProfileBackgroundUrl(f.env.root,f.scope()),originalUrl);
    assert.deepEqual((await f.perform('GET')).body,png);
  }
  assert.equal(existsSync(join(f.dir,'cache-b')),false);
  assert.deepEqual(f.files(),[f.scope()+'.image']);
});

test('browser-side cross-site changes are rejected while same-origin and nonbrowser calls work', async t => {
  const f=fixture(t);
  const sameOrigin={origin:'http://bridge.test','sec-fetch-site':'same-origin'};
  assert.equal((await f.save(png,'image/png',{headers:sameOrigin})).status,200);
  for (const headers of [{origin:'https://foreign.test'}, {origin:'https://bridge.test'},
    {origin:'null'}, {'sec-fetch-site':'cross-site'}]) {
    assert.equal((await f.save(jpeg,'image/jpeg',{headers})).status,403,JSON.stringify(headers));
    assert.equal((await f.perform('DELETE',null,{headers})).status,403,JSON.stringify(headers));
  }
  assert.deepEqual((await f.perform('GET')).body,png);
  assert.equal((await f.perform('DELETE',null,{headers:sameOrigin})).status,200);
});
