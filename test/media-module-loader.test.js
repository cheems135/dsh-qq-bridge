import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {loadVideoModules,versionedMediaUrl} from '../media-module-loader.js';

const TEST_DIRECTORY=fileURLToPath(new URL('.',import.meta.url));
const MODULE_NAMES=[
  'video-reader.js',
  'bilibili-service.js',
  'agent-capabilities.js',
  'bilibili-tool.js',
  'bilibili-video-link.js',
];

function temporaryFixture(t){
  const root=mkdtempSync(join(TEST_DIRECTORY,'media-module-loader-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  writeFileSync(join(root,'package.json'),'{"type":"module"}\n');
  return root;
}

function expectedSnapshot(revision){
  return {
    readerRevision:revision==='one'?'reader-one':'reader-'+revision,
    bilibiliRevision:'bilibili-'+revision,
    capabilitiesRevision:'capabilities-'+revision,
    toolRevision:'tool-'+revision,
    linksRevision:'links-'+revision,
    nestedRevision:'runtime-'+revision,
  };
}

function writeFixture(root,revision){
  const sources={
    'fixture-runtime.js':`export const runtimeRevision=${JSON.stringify('runtime-'+revision)};\n`,
    'video-reader.js':`
const incoming=new URL(import.meta.url);
const nested=new URL('./fixture-runtime.js',incoming);
nested.search=incoming.search;
const {runtimeRevision}=await import(nested.href);
export const readerRevision=${JSON.stringify(revision==='one'?'reader-one':'reader-'+revision)};
export const nestedRevision=runtimeRevision;
export function createVideoReader(){return readerRevision;}
`,
    'bilibili-service.js':`
export const bilibiliRevision=${JSON.stringify('bilibili-'+revision)};
export function createBilibiliService(){return bilibiliRevision;}
`,
    'agent-capabilities.js':`
export const capabilitiesRevision=${JSON.stringify('capabilities-'+revision)};
export function createAgentCapabilities(){return capabilitiesRevision;}
`,
    'bilibili-tool.js':`
export const toolRevision=${JSON.stringify('tool-'+revision)};
export function createBilibiliTool(){return toolRevision;}
`,
    'bilibili-video-link.js':`
export const linksRevision=${JSON.stringify('links-'+revision)};
export function isBiliVideoLink(){return linksRevision;}
`,
    'entry.js':`
import {readerRevision,nestedRevision} from './video-reader.js';
import {bilibiliRevision} from './bilibili-service.js';
import {capabilitiesRevision} from './agent-capabilities.js';
import {toolRevision} from './bilibili-tool.js';
import {linksRevision} from './bilibili-video-link.js';
export const canonicalSnapshot={readerRevision,bilibiliRevision,capabilitiesRevision,toolRevision,linksRevision,nestedRevision};
`,
  };
  for(const [filename,source] of Object.entries(sources))writeFileSync(join(root,filename),source);
}

test('versionedMediaUrl keeps the sibling path and uses an exact reusable revision',()=>{
  const base=new URL('file:///opt/plugin/nested/index.js?reload=91#dialog');
  const before=base.href;
  const url=versionedMediaUrl(base,'video-reader.js','1.54.7-beta+2');
  assert.ok(url instanceof URL);
  assert.equal(url.protocol,'file:');
  assert.equal(url.pathname,'/opt/plugin/nested/video-reader.js');
  assert.equal(url.searchParams.get('mediaRevision'),'1.54.7-beta+2');
  assert.deepEqual([...url.searchParams],[['mediaRevision','1.54.7-beta+2']]);
  assert.equal(url.hash,'');
  assert.equal(base.href,before);
  assert.equal(url.href,versionedMediaUrl(base,'video-reader.js','1.54.7-beta+2').href);
  assert.doesNotMatch(url.search,/random|nonce|timestamp/i);
});

test('all five media helpers are versioned together and invalid requests never import',async()=>{
  const base='https://plugins.example.test/qq/nested/index.js?reload=17';
  const calls=[];
  const result=await loadVideoModules(base,'release-17',{
    importModule:async url=>{
      calls.push(url);
      return {filename:url.pathname.split('/').at(-1)};
    },
  });
  assert.equal(calls.length,5);
  assert.deepEqual(calls.map(url=>url.pathname.split('/').at(-1)),MODULE_NAMES);
  assert.ok(calls.every(url=>url.pathname.startsWith('/qq/nested/')));
  assert.ok(calls.every(url=>url.search==='?mediaRevision=release-17'));
  assert.equal(result.version,'release-17');
  assert.equal(result.reader.filename,'video-reader.js');
  assert.equal(result.bilibili.filename,'bilibili-service.js');
  assert.equal(result.capabilities.filename,'agent-capabilities.js');
  assert.equal(result.tool.filename,'bilibili-tool.js');
  assert.equal(result.links.filename,'bilibili-video-link.js');

  const badNames=[
    '../video-reader.js',
    'sub/video-reader.js',
    '/video-reader.js',
    'video-reader.js?mediaRevision=x',
    'video-reader.js#fragment',
    'https://evil.example/video-reader.js',
    'bili-service.js',
  ];
  for(const filename of badNames)assert.throws(()=>versionedMediaUrl(base,filename,'release-17'),TypeError);
  for(const revision of ['', '   ',null,undefined,12,{},'bad\u0000revision']){
    assert.throws(()=>versionedMediaUrl(base,'video-reader.js',revision),TypeError);
  }
  assert.throws(()=>versionedMediaUrl('data:text/javascript,export default 1','video-reader.js','release-17'),TypeError);
  assert.throws(()=>versionedMediaUrl('https://user:secret@plugins.example.test/index.js','video-reader.js','release-17'),TypeError);

  let invalidLoads=0;
  await assert.rejects(
    loadVideoModules(base,' ',{importModule:async()=>{invalidLoads++;}}),
    TypeError,
  );
  assert.equal(invalidLoads,0);
});

test('real ESM cache: canonical static children stay stale while revisioned modules replace',async t=>{
  const root=temporaryFixture(t);
  const base=pathToFileURL(join(root,'index.js'));

  writeFixture(root,'one');
  const first=await import(new URL('./entry.js?reload=first',base).href);
  assert.deepEqual(first.canonicalSnapshot,expectedSnapshot('one'));

  writeFixture(root,'two');
  const canonicalAgain=await import(new URL('./entry.js?reload=second',base).href);
  assert.deepEqual(
    canonicalAgain.canonicalSnapshot,
    expectedSnapshot('one'),
    'a new parent query must expose the stale unversioned static dependency cache',
  );

  const releaseTwo=await loadVideoModules(base,'release-two');
  assert.equal(releaseTwo.version,'release-two');
  assert.deepEqual({
    readerRevision:releaseTwo.reader.readerRevision,
    bilibiliRevision:releaseTwo.bilibili.bilibiliRevision,
    capabilitiesRevision:releaseTwo.capabilities.capabilitiesRevision,
    toolRevision:releaseTwo.tool.toolRevision,
    linksRevision:releaseTwo.links.linksRevision,
    nestedRevision:releaseTwo.reader.nestedRevision,
  },expectedSnapshot('two'));
  assert.equal(releaseTwo.reader.createVideoReader(),expectedSnapshot('two').readerRevision);
  assert.equal(releaseTwo.links.isBiliVideoLink(),'links-two');

  writeFixture(root,'three');
  const stable=await loadVideoModules(base,'release-two');
  assert.deepEqual({
    readerRevision:stable.reader.readerRevision,
    bilibiliRevision:stable.bilibili.bilibiliRevision,
    capabilitiesRevision:stable.capabilities.capabilitiesRevision,
    toolRevision:stable.tool.toolRevision,
    linksRevision:stable.links.linksRevision,
    nestedRevision:stable.reader.nestedRevision,
  },expectedSnapshot('two'),'the same revision must reuse its complete cached graph');

  const releaseThree=await loadVideoModules(base,'release-three');
  assert.deepEqual({
    readerRevision:releaseThree.reader.readerRevision,
    bilibiliRevision:releaseThree.bilibili.bilibiliRevision,
    capabilitiesRevision:releaseThree.capabilities.capabilitiesRevision,
    toolRevision:releaseThree.tool.toolRevision,
    linksRevision:releaseThree.links.linksRevision,
    nestedRevision:releaseThree.reader.nestedRevision,
  },expectedSnapshot('three'),'a new revision must read replacement source, including forwarded nested imports');
});
