import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {rmSync} from 'node:fs';
import {coverRequestTitle,createCoverLibrary,isRenderedCoverFilename} from '../cover-library.js';

test('saved covers deduplicate by title and content and survive copying the library to the paired device',t=>{
  const temp=mkdtempSync(join(process.cwd(),'cover-fixture-'));
  t.after(()=>rmSync(temp,{recursive:true,force:true}));
  const desktop=join(temp,'desktop'),phone=join(temp,'phone'),source=join(temp,'preview.wav');
  const audio=Buffer.alloc(256);audio.write('RIFF');audio.write('WAVE',8);writeFileSync(source,audio);
  const scope=()=>['account','persona'];
  const a=createCoverLibrary({root:()=>desktop,scope});
  const row=a.save('晴天（副歌）',source);
  assert.equal(a.save(' 晴天(副歌) ',source).id,row.id);
  cpSync(desktop,phone,{recursive:true});
  const b=createCoverLibrary({root:()=>phone,scope});
  assert.equal(b.find(coverRequestTitle('想听《晴天（副歌）》')).id,row.id);
  assert.equal(b.find(coverRequestTitle('播放晴天（副歌）')).id,row.id);
  assert.equal(b.list().length,1);
  assert.equal(createCoverLibrary({root:()=>phone,scope:()=>['another','persona']}).list().length,0);
  assert.equal(coverRequestTitle('重新录一版《晴天（副歌）》'),'');
  assert.equal(coverRequestTitle('不想听《晴天（副歌）》'),'');
  assert.equal(coverRequestTitle('唱《晴天（副歌）》，顺便画一张图'),'');
  assert.equal(isRenderedCoverFilename('rh-audio-02946759-229e-424e-a1ec-9954771d2cb1.wav'),true);
  assert.equal(isRenderedCoverFilename('../rh-audio-02946759-229e-424e-a1ec-9954771d2cb1.wav'),false);
});
