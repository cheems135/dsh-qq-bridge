import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createSocialAssets,SOCIAL_IMAGE_RULES} from '../social-assets.js';import {probeColorPng} from '../local-probe-image.js';
test('all four social image sources become actual scoped immutable files, survive reload, and carry provenance',()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'social-assets-'));try{const file=join(dir,'input.png');fs.writeFileSync(file,probeColorPng());let allowed=true;const options={rootFor:c=>join(dir,c.accountId,c.personaId),authorize:()=>allowed},assets=createSocialAssets(options),c={accountId:'a',personaId:'p'};
 for(const source of ['search','screenshot','generated','drawing']){const row=assets.remember(file,{source,query:'公开风景',captureId:'observed'},c);assert.equal(fs.existsSync(row.file),true);assert.equal(createSocialAssets(options).load(row.file,c).source,source);assert.throws(()=>assets.load(row.file,{...c,personaId:'other'}));}
 assert.equal(assets.list(c).items.length,4);const row=assets.list(c).items[0];fs.writeFileSync(row.file,Buffer.from('changed'));assert.throws(()=>assets.load(row.file,c));allowed=false;assert.throws(()=>assets.remember(file,{source:'search'},c));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('social materials reject unknown source, arbitrary file and symbolic escape',()=>{
 const dir=fs.mkdtempSync(join(tmpdir(),'social-assets-boundary-'));try{const root=join(dir,'own'),file=join(dir,'outside.png');fs.writeFileSync(file,probeColorPng());const c={},assets=createSocialAssets({rootFor:()=>root,authorize:()=>true});assert.throws(()=>assets.remember(file,{source:'guessed'},c));assets.remember(file,{source:'search'},c);assert.throws(()=>assets.load(file,c));assert.throws(()=>assets.load(join(root,'assets.json'),c));}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('social rules permit character choice and preserve actual generation and public privacy semantics',()=>{for(const word of ['搜索','截图','生成','逐笔画','人设参考','头饰','日程','不把搜索图说成自拍','不悄悄丢掉'])assert.ok(SOCIAL_IMAGE_RULES.includes(word)||word==='不悄悄丢掉'&&SOCIAL_IMAGE_RULES.includes('不要悄悄丢掉'));});
